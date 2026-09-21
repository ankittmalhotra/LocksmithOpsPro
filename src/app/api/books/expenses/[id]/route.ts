import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { centsToDecimal, isBooksEntityCode, parseCents, parseDateOnly, serializeDecimal } from '@/lib/books-api';

function mapExpense(expense: any) {
  return { ...expense, subtotalAmount: serializeDecimal(expense.subtotalAmount), hstAmount: serializeDecimal(expense.hstAmount), totalAmount: serializeDecimal(expense.totalAmount), hstRate: expense.hstRate === null ? null : Number(expense.hstRate) };
}

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const code = isBooksEntityCode(body?.entityCode) ? body.entityCode : new URL(request.url).searchParams.get('entityCode');
    if (!isBooksEntityCode(code)) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canManageExpenses) return NextResponse.json({ success: false, error: 'Forbidden: Expense management required' }, { status: 403 });
    const { id } = await params;
    const existing = await prisma.accountingExpense.findFirst({ where: { id, entityId: access.entity.id } });
    if (!existing) return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });

    const subtotalCents = body.subtotalAmount === undefined ? Math.round(Number(existing.subtotalAmount) * 100) : parseCents(body.subtotalAmount, 'subtotalAmount');
    const hstCents = body.hstAmount === undefined ? Math.round(Number(existing.hstAmount) * 100) : parseCents(body.hstAmount, 'hstAmount');
    const totalCents = body.totalAmount === undefined ? subtotalCents + hstCents : parseCents(body.totalAmount, 'totalAmount');
    if (totalCents !== subtotalCents + hstCents) return NextResponse.json({ success: false, error: 'Total must equal subtotal plus HST' }, { status: 400 });
    const paymentStatus = body.paymentStatus === undefined ? existing.paymentStatus : body.paymentStatus === 'PAID' ? 'PAID' : body.paymentStatus === 'UNPAID' ? 'UNPAID' : null;
    if (!paymentStatus) return NextResponse.json({ success: false, error: 'Invalid paymentStatus' }, { status: 400 });
    let categoryId: string | null | undefined;
    if (body.categoryId !== undefined) {
      categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : null;
      if (categoryId) {
        const category = await prisma.accountingExpenseCategory.findFirst({ where: { id: categoryId, entityId: access.entity.id, active: true }, select: { id: true } });
        if (!category) return NextResponse.json({ success: false, error: 'Expense category not found' }, { status: 400 });
      }
    }
    const expense = await prisma.$transaction(async (tx) => {
      const updated = await tx.accountingExpense.update({
        where: { id },
        data: {
        vendorName: body.vendorName === undefined ? undefined : String(body.vendorName).trim(),
        categoryId,
        description: body.description === undefined ? undefined : (String(body.description).trim() || null),
        expenseDate: body.expenseDate === undefined ? undefined : new Date(`${parseDateOnly(body.expenseDate, 'expenseDate')}T00:00:00.000Z`),
        subtotalAmount: centsToDecimal(subtotalCents), hstAmount: centsToDecimal(hstCents), totalAmount: centsToDecimal(totalCents),
        hstRate: body.hstRate === undefined ? undefined : body.hstRate === null ? null : Number(body.hstRate),
        paymentStatus, paymentMethod: body.paymentMethod === undefined ? undefined : body.paymentMethod || null,
        paidAt: paymentStatus === 'PAID' ? (existing.paidAt || new Date()) : null,
        receiptUrl: body.receiptUrl === undefined ? undefined : String(body.receiptUrl).trim() || null,
        notes: body.notes === undefined ? undefined : String(body.notes).trim() || null,
        updatedById: access.user.id,
        }, include: { category: true },
      });
      await tx.accountingAuditEvent.create({ data: { entityId: access.entity.id, actorId: access.user.id, action: 'UPDATED', resourceType: 'AccountingExpense', resourceId: id, metadata: { totalAmount: totalCents / 100 } } });
      return updated;
    });
    return NextResponse.json({ success: true, expense: mapExpense(expense) });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/expenses/[id]', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to update expense') }, { status: 400 });
  }
}

export const PATCH = withRequestLogging('/api/books/expenses/[id]', handlePATCH);
