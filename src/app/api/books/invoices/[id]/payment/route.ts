import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { decimalToCents, serializeDecimal } from '@/lib/books-api';
import { sendEmail } from '@/lib/resend';
import { buildBooksInvoiceEmail, invoiceRecipientEmail } from '@/lib/accounting-invoice-email';
import { buildAccountingInvoicePdf } from '@/lib/accounting-invoice-pdf';

function mapPaymentInvoice(invoice: any) {
  return {
    ...invoice,
    serviceAmount: serializeDecimal(invoice.serviceAmount),
    quantity: serializeDecimal(invoice.quantity || 1),
    hstAmount: serializeDecimal(invoice.hstAmount),
    totalAmount: serializeDecimal(invoice.totalAmount),
    hstRate: Number(invoice.hstRate),
  };
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    const targetStatus = body?.status === undefined ? 'RECEIVED' : body.status;
    if (targetStatus !== 'RECEIVED' && targetStatus !== 'PENDING') return NextResponse.json({ success: false, error: 'Payment status must be RECEIVED or PENDING' }, { status: 400 });
    const existing = await prisma.partnerInvoice.findUnique({ where: { id }, include: { issuerEntity: true, recipientEntity: true } });
    if (!existing) return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    if (existing.issuerEntity.code !== 'IT_MARKETING') {
      return NextResponse.json({ success: false, error: 'Only IT & Marketing invoices can be paid here' }, { status: 409 });
    }
    if (existing.status !== 'ISSUED') return NextResponse.json({ success: false, error: 'Only issued invoices can have payment status changed' }, { status: 409 });
    if (existing.paymentStatus === targetStatus) return NextResponse.json({ success: true, invoice: mapPaymentInvoice(existing) });
    const paidAt = targetStatus === 'RECEIVED' ? (body?.paidAt ? new Date(body.paidAt) : new Date()) : null;
    if (paidAt && Number.isNaN(paidAt.getTime())) return NextResponse.json({ success: false, error: 'paidAt must be a valid date' }, { status: 400 });
    const updated = await prisma.$transaction(async (tx) => {
      const invoice = await tx.partnerInvoice.update({ where: { id }, data: { paymentStatus: targetStatus, }, include: { billingPeriod: true, issuerEntity: true, recipientEntity: true, paymentEvents: { orderBy: { createdAt: 'asc' } } } });
      await tx.partnerInvoicePaymentEvent.create({ data: { invoiceId: id, fromStatus: existing.paymentStatus, toStatus: targetStatus, amount: existing.totalAmount, paidAt, paymentMethod: typeof body?.paymentMethod === 'string' ? body.paymentMethod.trim() || null : null, reference: typeof body?.reference === 'string' ? body.reference.trim() || null : null, note: typeof body?.note === 'string' ? body.note.trim() || null : null, recordedById: user.id } });
      await tx.accountingAuditEvent.create({ data: { entityId: existing.issuerEntityId, invoiceId: id, actorId: user.id, action: 'PAYMENT_STATUS_CHANGED', resourceType: 'PartnerInvoice', resourceId: id, metadata: { fromStatus: existing.paymentStatus, toStatus: targetStatus, amount: decimalToCents(existing.totalAmount) / 100 } } });
      return invoice;
    });
    let responseInvoice = updated;
    let emailNotification: { sent: boolean; to?: string; error?: string } | undefined;
    if (targetStatus === 'RECEIVED') {
      const recipientEmail = invoiceRecipientEmail(updated);
      if (recipientEmail) {
        const email = buildBooksInvoiceEmail(updated, recipientEmail);
        const pdf = await buildAccountingInvoicePdf(updated);
        const result = await sendEmail({ to: recipientEmail, subject: email.subject, html: email.html, text: email.text, replyTo: updated.issuerEntity.email || undefined, attachments: [{ filename: `${updated.invoiceNumber}.pdf`, content: pdf }] });
        if (result.success) {
          responseInvoice = await prisma.$transaction(async (tx) => {
            const saved = await tx.partnerInvoice.update({ where: { id }, data: { emailSentAt: new Date(), emailSentTo: recipientEmail, emailMessageId: result.id || null }, include: { billingPeriod: true, issuerEntity: true, recipientEntity: true, paymentEvents: { orderBy: { createdAt: 'asc' } } } });
            await tx.accountingAuditEvent.create({ data: { entityId: existing.issuerEntityId, invoiceId: id, actorId: user.id, action: 'EMAIL_SENT', resourceType: 'PartnerInvoice', resourceId: id, metadata: { invoiceNumber: existing.invoiceNumber, recipientEmail, paymentStatus: targetStatus, messageId: result.id || null } } });
            return saved;
          });
          emailNotification = { sent: true, to: recipientEmail };
        } else {
          emailNotification = { sent: false, to: recipientEmail, error: result.error || 'Unable to send paid invoice email' };
        }
      }
    }
    return NextResponse.json({ success: true, invoice: mapPaymentInvoice(responseInvoice), emailNotification });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/invoices/[id]/payment', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to update invoice payment') }, { status: 400 });
  }
}

export const POST = withRequestLogging('/api/books/invoices/[id]/payment', handlePOST);
