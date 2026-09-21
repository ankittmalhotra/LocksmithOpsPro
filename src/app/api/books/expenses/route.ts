import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { centsToDecimal, isBooksEntityCode, parseCents, parseDateOnly, serializeDecimal } from '@/lib/books-api';

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
    return NextResponse.json({ success: true, entity: access.entity, expenses: expenses.map(mapExpense) });
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
