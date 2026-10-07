import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { decimalToCents, isBooksEntityCode } from '@/lib/books-api';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getBooksTaskWindow } from '@/lib/books-window';
import { formatTorontoDateInput } from '@/lib/timezone';

/**
 * Read-only Books landing data. In particular this must never call the
 * periods endpoint: its Admin IT read path can materialize closed snapshots.
 */
async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    const requested = new URL(request.url).searchParams.get('entityCode');
    const code = isBooksEntityCode(requested)
      ? requested
      : user?.role === 'DISPATCHER' ? 'LOCKSMITH' : 'IT_MARKETING';
    const access = await getAccountingEntityAccess(code, user);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });

    const window = getBooksTaskWindow(formatTorontoDateInput(new Date()));
    const expenseWhere = { entityId: access.entity.id, voidedAt: null, expenseDate: { gte: window.startsAt, lte: window.endsAt } };
    const invoiceWhere = code === 'LOCKSMITH'
      ? { recipientEntityId: access.entity.id, status: 'ISSUED' as const, issuedAt: { gte: window.invoiceStartsAt, lt: window.invoiceEndExclusiveAt } }
      : { issuerEntityId: access.entity.id, status: 'ISSUED' as const, issuedAt: { gte: window.invoiceStartsAt, lt: window.invoiceEndExclusiveAt } };
    const [expenseTotals, personalExpenseCount, awaitingConfirmation, invoiceTotals, recentInvoices] = await Promise.all([
      prisma.accountingExpense.aggregate({
        where: expenseWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.accountingExpense.count({ where: { ...expenseWhere, fundingSource: 'PERSONAL' } }),
      prisma.accountingExpense.aggregate({
        where: { ...expenseWhere, fundingSource: 'PERSONAL', OR: [{ personalPayeeName: null }, { paidAt: null }] },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.partnerInvoice.aggregate({
        where: invoiceWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.partnerInvoice.findMany({
        where: invoiceWhere,
        select: { id: true, invoiceNumber: true, invoiceKind: true, paymentStatus: true, totalAmount: true, issuedAt: true, recipientSnapshot: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);
    return NextResponse.json({
      success: true,
      entity: access.entity,
      capabilities: {
        manageExpenses: access.canManageExpenses,
        manageReimbursements: access.canManageReimbursements,
        mapAccounts: access.canMapAccounting && (access.user.role === 'ADMIN' || access.user.role === 'ACCOUNTANT'),
        issueInvoices: access.user.role === 'ADMIN' && access.canIssueInvoices,
        markPayments: access.user.role === 'ADMIN' && access.canMarkPayments,
        isAdmin: access.user.role === 'ADMIN',
      },
      summary: {
        expenseCount: expenseTotals._count._all,
        expenseCents: decimalToCents(expenseTotals._sum.totalAmount),
        invoiceCount: invoiceTotals._count._all,
        invoiceCents: decimalToCents(invoiceTotals._sum.totalAmount),
        personalExpenseCount,
        awaitingConfirmationCount: awaitingConfirmation._count._all,
        awaitingConfirmationCents: decimalToCents(awaitingConfirmation._sum.totalAmount),
      },
      window: { dateFrom: window.periodStart, dateTo: window.periodEnd, label: window.label },
      recentInvoices: recentInvoices.map((invoice) => ({ ...invoice, totalCents: decimalToCents(invoice.totalAmount), totalAmount: undefined })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/summary', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load Books overview') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/books/summary', handleGET);
