import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { decimalToCents } from '@/lib/books-api';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

/**
 * Compact Locksmith Books queue for the shared Dashboard. It always describes
 * the Locksmith entity (never IT & Marketing) and is cumulative: these are
 * open to-dos, not period totals. Returns `available: false` when the viewer
 * has no Locksmith Books access so the Dashboard can simply omit the card.
 */
async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') {
      return NextResponse.json({ success: false, error: 'Admin or Dispatcher access required' }, { status: 403 });
    }
    const access = await getAccountingEntityAccess('LOCKSMITH', user);
    if (!access?.canView) {
      return NextResponse.json({ success: true, available: false }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const entityId = access.entity.id;
    const [missingReceipts, personal] = await Promise.all([
      prisma.accountingExpense.count({ where: { entityId, voidedAt: null, receiptStatus: 'MISSING' } }),
      prisma.accountingExpense.findMany({
        where: { entityId, voidedAt: null, fundingSource: 'PERSONAL' },
        select: {
          totalAmount: true,
          personalPayeeName: true,
          paidAt: true,
          reimbursementAllocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
        },
      }),
    ]);
    let toRepayCents = 0;
    let needsDetailsCount = 0;
    for (const expense of personal) {
      const repaid = expense.reimbursementAllocations.reduce((sum, allocation) => sum + decimalToCents(allocation.amount), 0);
      const open = Math.max(0, decimalToCents(expense.totalAmount) - repaid);
      if (open <= 0) continue;
      if (!expense.personalPayeeName || !expense.paidAt) needsDetailsCount += 1;
      else toRepayCents += open;
    }
    return NextResponse.json({
      success: true,
      available: true,
      entityCode: 'LOCKSMITH',
      canManageExpenses: access.canManageExpenses,
      canManageReimbursements: access.canManageReimbursements,
      missingReceipts,
      needsDetailsCount,
      toRepayCents,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logCaughtRequestError(request, '/api/dashboard/books-attention', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load Books attention') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/dashboard/books-attention', handleGET);
