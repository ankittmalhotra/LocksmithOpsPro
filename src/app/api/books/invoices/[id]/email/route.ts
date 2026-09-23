import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { sendEmail } from '@/lib/resend';
import { buildBooksInvoiceEmail, invoiceRecipientEmail, normalizeInvoiceEmail } from '@/lib/accounting-invoice-email';
import { buildAccountingInvoicePdf } from '@/lib/accounting-invoice-pdf';
import { serializeDecimal } from '@/lib/books-api';

function mapInvoice(invoice: any) {
  return {
    ...invoice,
    serviceAmount: serializeDecimal(invoice.serviceAmount),
    quantity: serializeDecimal(invoice.quantity || 1),
    hstAmount: serializeDecimal(invoice.hstAmount),
    totalAmount: serializeDecimal(invoice.totalAmount),
    hstRate: Number(invoice.hstRate || 0),
  };
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const invoice = await prisma.partnerInvoice.findUnique({
      where: { id },
      include: { issuerEntity: true, recipientEntity: true, paymentEvents: { orderBy: { createdAt: 'asc' } } },
    });
    if (!invoice) return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    if (invoice.issuerEntity.code !== 'IT_MARKETING' || invoice.status !== 'ISSUED') {
      return NextResponse.json({ success: false, error: 'Only issued IT & Marketing invoices can be emailed' }, { status: 409 });
    }
    const requestedEmail = typeof body?.email === 'string' ? body.email.trim() : '';
    if (requestedEmail && !normalizeInvoiceEmail(requestedEmail)) return NextResponse.json({ success: false, error: 'Enter a valid customer email address before sending' }, { status: 400 });
    const recipientEmail = normalizeInvoiceEmail(requestedEmail) || invoiceRecipientEmail(invoice);
    if (!recipientEmail) return NextResponse.json({ success: false, error: 'Enter a valid customer email address before sending' }, { status: 400 });

    const email = buildBooksInvoiceEmail(invoice, recipientEmail);
    const pdf = await buildAccountingInvoicePdf(invoice);
    const result = await sendEmail({ to: recipientEmail, subject: email.subject, html: email.html, text: email.text, replyTo: invoice.issuerEntity.email || undefined, attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdf }] });
    if (!result.success) return NextResponse.json({ success: false, error: result.error || 'Unable to send invoice email' }, { status: 502 });

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.partnerInvoice.update({ where: { id }, data: { emailSentAt: new Date(), emailSentTo: recipientEmail, emailMessageId: result.id || null }, include: { billingPeriod: true, issuerEntity: true, recipientEntity: true, paymentEvents: { orderBy: { createdAt: 'asc' } }, auditEvents: { orderBy: { createdAt: 'asc' } } } });
      await tx.accountingAuditEvent.create({ data: { entityId: invoice.issuerEntityId, invoiceId: invoice.id, actorId: user.id, action: 'EMAIL_SENT', resourceType: 'PartnerInvoice', resourceId: invoice.id, metadata: { invoiceNumber: invoice.invoiceNumber, recipientEmail, paymentStatus: invoice.paymentStatus, messageId: result.id || null } } });
      return saved;
    });
    return NextResponse.json({ success: true, sentTo: recipientEmail, simulated: result.isSimulated, invoice: mapInvoice(updated) });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/invoices/[id]/email', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to send invoice email') }, { status: 400 });
  }
}

export const POST = withRequestLogging('/api/books/invoices/[id]/email', handlePOST);
