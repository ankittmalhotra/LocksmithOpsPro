import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { decimalToCents, serializeDecimal } from '@/lib/books-api';

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
    return NextResponse.json({ success: true, invoice: mapPaymentInvoice(updated) });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/invoices/[id]/payment', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to update invoice payment') }, { status: 400 });
  }
}

export const POST = withRequestLogging('/api/books/invoices/[id]/payment', handlePOST);
