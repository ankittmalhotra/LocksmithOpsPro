import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { decimalToCents, isBooksEntityCode } from '@/lib/books-api';
import { BOOKS_BILLING_SUMMARY_LIMIT } from '@/lib/books-window';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

/**
 * Focused Billing read: no snapshot materialization and no invoice audit or
 * payment-event history. Those deliberate workflows remain in legacy Books.
 */
async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    const requested = new URL(request.url).searchParams.get('entityCode');
    const code = isBooksEntityCode(requested) ? requested : user?.role === 'DISPATCHER' ? 'LOCKSMITH' : 'IT_MARKETING';
    const access = await getAccountingEntityAccess(code, user);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    const periodWhere = code === 'LOCKSMITH' ? { recipientEntityId: access.entity.id } : { issuerEntityId: access.entity.id };
    const invoiceWhere = code === 'LOCKSMITH'
      ? { recipientEntityId: access.entity.id, status: 'ISSUED' as const }
      : { issuerEntityId: access.entity.id, status: 'ISSUED' as const };
    const [periods, invoices] = await Promise.all([
      prisma.partnerBillingPeriod.findMany({
        where: periodWhere,
        select: { id: true, periodStart: true, periodEnd: true, status: true, partnerFeeAmount: true },
        orderBy: { periodStart: 'desc' },
        take: BOOKS_BILLING_SUMMARY_LIMIT,
      }),
      prisma.partnerInvoice.findMany({
        where: invoiceWhere,
        select: { id: true, invoiceNumber: true, invoiceKind: true, status: true, paymentStatus: true, totalAmount: true, issuedAt: true, periodStart: true, periodEnd: true },
        orderBy: { issuedAt: 'desc' },
        take: BOOKS_BILLING_SUMMARY_LIMIT,
      }),
    ]);
    return NextResponse.json({
      success: true,
      limit: BOOKS_BILLING_SUMMARY_LIMIT,
      periods: periods.map((period) => ({ ...period, partnerFeeCents: decimalToCents(period.partnerFeeAmount), partnerFeeAmount: undefined })),
      invoices: invoices.map((invoice) => ({ ...invoice, totalCents: decimalToCents(invoice.totalAmount), totalAmount: undefined })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/billing-summary', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load Billing summary') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/books/billing-summary', handleGET);
