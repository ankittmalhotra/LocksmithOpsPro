import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { isBooksEntityCode, serializeDecimal } from '@/lib/books-api';

function mapInvoice(invoice: any, redactIssuer = false) {
  const { issuerEntity, issuerSnapshot, ...safeInvoice } = invoice;
  return {
    ...safeInvoice,
    ...(redactIssuer ? {} : { issuerEntity, issuerSnapshot }),
    serviceAmount: serializeDecimal(invoice.serviceAmount),
    quantity: serializeDecimal(invoice.quantity || 1),
    hstAmount: serializeDecimal(invoice.hstAmount),
    totalAmount: serializeDecimal(invoice.totalAmount),
    hstRate: Number(invoice.hstRate),
  };
}

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const requested = new URL(request.url).searchParams.get('entityCode');
    const code = isBooksEntityCode(requested) ? requested : user?.role === 'DISPATCHER' ? 'LOCKSMITH' : 'IT_MARKETING';
    const access = await getAccountingEntityAccess(code, user);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    const { id } = await params;
    const invoice = await prisma.partnerInvoice.findFirst({ where: { id, ...(code === 'LOCKSMITH' ? { recipientEntityId: access.entity.id, status: 'ISSUED' } : { issuerEntityId: access.entity.id }) }, include: { billingPeriod: true, issuerEntity: true, recipientEntity: true, paymentEvents: { orderBy: { createdAt: 'asc' } }, auditEvents: { orderBy: { createdAt: 'asc' } } } });
    if (!invoice) return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    return NextResponse.json({ success: true, invoice: mapInvoice(invoice, user?.role === 'DISPATCHER' && code === 'LOCKSMITH') });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/invoices/[id]', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load invoice') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/books/invoices/[id]', handleGET);
