import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { centsToDecimal, isBooksEntityCode, parseCents, parseDateOnly, serializeDecimal } from '@/lib/books-api';
import { getPartnerBillingPeriod } from '@/lib/accounting';
import { dateKeyToUtcDate, getMissingGoogleAdsConfigVariables } from '@/lib/google-ads';

function entityCodeFrom(request: Request, body?: Record<string, unknown>) {
  const value = new URL(request.url).searchParams.get('entityCode') || body?.entityCode;
  return isBooksEntityCode(value) ? value : null;
}

function mapExpense(expense: any) {
  return {
    ...expense,
    subtotalAmount: serializeDecimal(expense.subtotalAmount),
    hstAmount: serializeDecimal(expense.hstAmount),
    totalAmount: serializeDecimal(expense.totalAmount),
    hstRate: expense.hstRate === null ? null : Number(expense.hstRate),
  };
}

/**
 * Google Ads spend belongs to the IT/marketing company's books, not the
 * Locksmith company's books. Once the Admin syncs daily metrics, show one
 * read-only ledger row per anchored biweekly period in the IT ledger only. It
 * remains separate from the operational profit snapshot and cannot be edited
 * twice.
 */
async function getGoogleAdsLedgerExpenses(from?: string, to?: string) {
  if (getMissingGoogleAdsConfigVariables().length > 0) return [];
  try {
    const metrics = await prisma.googleAdsDailyMetric.findMany({
      where: { date: { gte: dateKeyToUtcDate('2026-09-07') } },
      orderBy: { date: 'asc' },
      select: { customerId: true, date: true, spend: true },
    });
    const grouped = new Map<string, { customerId: string; periodStart: string; periodEnd: string; totalCents: number }>();
    for (const metric of metrics) {
      const dateKey = metric.date.toISOString().slice(0, 10);
      const period = getPartnerBillingPeriod(dateKey);
      if (period.periodIndex < 0 || metric.spend <= 0) continue;
      const key = `${metric.customerId}:${period.periodStart}`;
      const current = grouped.get(key) || { customerId: metric.customerId, periodStart: period.periodStart, periodEnd: period.periodEnd, totalCents: 0 };
      current.totalCents += Math.round(metric.spend * 100);
      grouped.set(key, current);
    }
    return [...grouped.values()]
      .filter((entry) => (!from || entry.periodEnd >= from) && (!to || entry.periodStart <= to))
      .map((entry) => ({
        id: `google-ads-${entry.customerId}-${entry.periodStart}`,
        vendorName: 'Google Ads',
        description: `Google Ads billing · ${entry.periodStart} – ${entry.periodEnd}`,
        expenseDate: new Date(`${entry.periodEnd}T00:00:00.000Z`),
        subtotalAmount: entry.totalCents / 100,
        hstAmount: 0,
        totalAmount: entry.totalCents / 100,
        hstRate: null,
        paymentStatus: 'PAID',
        paymentMethod: 'CREDIT_CARD',
        notes: 'Automatically included from synced Google Ads daily billing. Read-only ledger entry.',
        systemGenerated: true,
        source: 'GOOGLE_ADS',
      }));
  } catch (error: any) {
    // The Google Ads cache is optional. A missing cache migration must not
    // make the core Books expense ledger unavailable.
    if (error?.code === 'P2021') return [];
    throw error;
  }
}

async function handleGET(request: Request) {
  try {
    const code = entityCodeFrom(request);
    if (!code) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    const query = new URL(request.url).searchParams;
    const expenses = await prisma.accountingExpense.findMany({
      where: {
        entityId: access.entity.id,
        ...(query.get('includeVoided') === 'true' ? {} : { voidedAt: null }),
        ...(query.get('from') || query.get('to') ? {
          expenseDate: {
            ...(query.get('from') ? { gte: new Date(`${parseDateOnly(query.get('from'), 'from')}T00:00:00.000Z`) } : {}),
            ...(query.get('to') ? { lte: new Date(`${parseDateOnly(query.get('to'), 'to')}T00:00:00.000Z`) } : {}),
          },
        } : {}),
      },
      include: { category: true },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    });
    const queryFrom = query.get('from') ? parseDateOnly(query.get('from'), 'from') : undefined;
    const queryTo = query.get('to') ? parseDateOnly(query.get('to'), 'to') : undefined;
    const googleAdsExpenses = code === 'IT_MARKETING'
      ? await getGoogleAdsLedgerExpenses(queryFrom, queryTo)
      : [];
    const mappedExpenses = [...expenses.map(mapExpense), ...googleAdsExpenses]
      .sort((left, right) => new Date(right.expenseDate).getTime() - new Date(left.expenseDate).getTime());
    return NextResponse.json({ success: true, entity: access.entity, expenses: mappedExpenses });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/expenses', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load expenses') }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  try {
    const body = await request.json();
    const code = entityCodeFrom(request, body);
    if (!code) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canManageExpenses) return NextResponse.json({ success: false, error: 'Forbidden: Expense management required' }, { status: 403 });
    const vendorName = typeof body.vendorName === 'string' ? body.vendorName.trim() : '';
    if (!vendorName) return NextResponse.json({ success: false, error: 'Vendor name is required' }, { status: 400 });
    const expenseDate = parseDateOnly(body.expenseDate, 'expenseDate');
    const subtotalCents = parseCents(body.subtotalAmount, 'subtotalAmount');
    const hstCents = parseCents(body.hstAmount ?? 0, 'hstAmount');
    const totalCents = body.totalAmount === undefined
      ? subtotalCents + hstCents
      : parseCents(body.totalAmount, 'totalAmount');
    if (totalCents !== subtotalCents + hstCents) return NextResponse.json({ success: false, error: 'Total must equal subtotal plus HST' }, { status: 400 });
    const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : null;
    if (categoryId) {
      const category = await prisma.accountingExpenseCategory.findFirst({ where: { id: categoryId, entityId: access.entity.id, active: true }, select: { id: true } });
      if (!category) return NextResponse.json({ success: false, error: 'Expense category not found' }, { status: 400 });
    }
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.accountingExpense.create({
        data: {
        entityId: access.entity.id,
        categoryId,
        vendorName,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        expenseDate: new Date(`${expenseDate}T00:00:00.000Z`),
        subtotalAmount: centsToDecimal(subtotalCents),
        hstAmount: centsToDecimal(hstCents),
        totalAmount: centsToDecimal(totalCents),
        hstRate: body.hstRate === undefined || body.hstRate === null ? null : Number(body.hstRate),
        paymentStatus: body.paymentStatus === 'PAID' ? 'PAID' : 'UNPAID',
        paymentMethod: body.paymentMethod || null,
        paidAt: body.paymentStatus === 'PAID' ? new Date() : null,
        receiptUrl: typeof body.receiptUrl === 'string' ? body.receiptUrl.trim() || null : null,
        notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
        createdById: access.user.id,
        updatedById: access.user.id,
        },
        include: { category: true },
      });
      await tx.accountingAuditEvent.create({ data: {
        entityId: access.entity.id, actorId: access.user.id, action: 'CREATED', resourceType: 'AccountingExpense', resourceId: created.id,
        metadata: { totalAmount: totalCents / 100 },
      } });
      return created;
    });
    return NextResponse.json({ success: true, expense: mapExpense(expense) }, { status: 201 });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/expenses', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to create expense') }, { status: 400 });
  }
}

export const GET = withRequestLogging('/api/books/expenses', handleGET);
export const POST = withRequestLogging('/api/books/expenses', handlePOST);
