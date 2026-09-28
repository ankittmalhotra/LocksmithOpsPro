import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { centsToDecimal, decimalToCents, isBooksEntityCode, parseDateOnly } from '@/lib/books-api';
import { openReimbursementBalanceCents, validateReimbursementAllocations } from '@/lib/accounting-reimbursements';
import { deleteAccountingReceipt, uploadAccountingReceipt } from '@/lib/accounting-receipts';

const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'INTERAC', 'CREDIT_CARD', 'DEBIT_CARD', 'OTHER'] as const;

function entityCodeFrom(request: Request, body?: Record<string, unknown>) {
  const value = new URL(request.url).searchParams.get('entityCode') || body?.entityCode;
  return isBooksEntityCode(value) ? value : null;
}

async function readBody(request: Request): Promise<{ body: Record<string, any>; proof: File | null }> {
  if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await request.formData();
    const body: Record<string, any> = {};
    for (const [key, value] of form.entries()) if (key !== 'proof' && typeof value === 'string') body[key] = value;
    if (typeof body.allocations === 'string') {
      try { body.allocations = JSON.parse(body.allocations); } catch { throw new Error('Allocations must be valid JSON'); }
    }
    const proof = form.get('proof');
    return { body, proof: proof instanceof File && proof.size > 0 ? proof : null };
  }
  return { body: await request.json(), proof: null };
}

async function handleGET(request: Request) {
  try {
    const code = entityCodeFrom(request);
    if (!code) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    const expenses = await prisma.accountingExpense.findMany({
      where: { entityId: access.entity.id, fundingSource: 'PERSONAL', voidedAt: null },
      include: { reimbursementAllocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    });
    const expenseRows = expenses.map((expense) => {
      const repaidCents = expense.reimbursementAllocations.reduce((sum, allocation) => sum + decimalToCents(allocation.amount), 0);
      const totalCents = decimalToCents(expense.totalAmount);
      const { receiptStorageKey: _receiptStorageKey, reimbursementAllocations: _allocations, ...safe } = expense;
      return {
        ...safe,
        accountName: safe.mappingAccountName,
        accountCode: safe.mappingAccountCode,
        subtotalAmount: decimalToCents(expense.subtotalAmount) / 100,
        hstAmount: decimalToCents(expense.hstAmount) / 100,
        totalAmount: totalCents / 100,
        hstRate: expense.hstRate === null ? null : Number(expense.hstRate),
        reimbursedCents: repaidCents,
        openBalanceCents: Math.max(0, totalCents - repaidCents),
        reimbursementNeedsConfirmation: !expense.personalPayeeName || !expense.paidAt,
      };
    });
    const payments = await prisma.accountingReimbursementPayment.findMany({
      where: { entityId: access.entity.id },
      include: { allocations: { include: { expense: { select: { id: true, vendorName: true, expenseDate: true, totalAmount: true, personalPayeeName: true } } } } },
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    });
    const serializedPayments = payments.map((payment) => ({
      ...payment,
      accountName: payment.mappingAccountName,
      accountCode: payment.mappingAccountCode,
      amountCents: decimalToCents(payment.amount),
      proofStorageKey: undefined,
      allocations: payment.allocations.map((allocation) => ({
        id: allocation.id,
        expenseId: allocation.expenseId,
        amountCents: decimalToCents(allocation.amount),
        expense: { ...allocation.expense, totalAmount: decimalToCents(allocation.expense.totalAmount) / 100 },
      })),
    }));
    const activeAllocatedCents = serializedPayments.filter((payment) => !payment.voidedAt)
      .flatMap((payment) => payment.allocations).reduce((sum, allocation) => sum + allocation.amountCents, 0);
    const unassignedCents = expenseRows.filter((expense) => expense.reimbursementNeedsConfirmation).reduce((sum, expense) => sum + expense.openBalanceCents, 0);
    const owedCents = expenseRows.filter((expense) => !expense.reimbursementNeedsConfirmation).reduce((sum, expense) => sum + expense.openBalanceCents, 0);
    const expenseIds = expenseRows.map((expense) => expense.id);
    const paymentIds = payments.map((payment) => payment.id);
    const history = await prisma.accountingAuditEvent.findMany({
      where: { entityId: access.entity.id, OR: [
        { resourceType: { in: ['AccountingExpense', 'AccountingExpenseMapping'] }, resourceId: { in: expenseIds } },
        { resourceType: { in: ['AccountingReimbursementPayment', 'AccountingReimbursementMapping'] }, resourceId: { in: paymentIds } },
      ] },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    return NextResponse.json({
      success: true,
      summary: { unassignedCents, owedCents, repaidCents: activeAllocatedCents, outstandingCents: unassignedCents + owedCents },
      expenses: expenseRows,
      payments: serializedPayments,
      history: history.map((event) => ({ ...event, targetType: event.resourceType, targetId: event.resourceId, actorName: event.actor.name })),
    });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/reimbursements', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load reimbursements') }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  let uploadedProofKey: string | null = null;
  try {
    const { body, proof } = await readBody(request);
    const code = entityCodeFrom(request, body);
    if (!code) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canManageReimbursements) return NextResponse.json({ success: false, error: 'Forbidden: Reimbursement management required' }, { status: 403 });
    const payeeName = typeof body.payeeName === 'string' ? body.payeeName.trim() : '';
    if (!payeeName) return NextResponse.json({ success: false, error: 'Payee name is required' }, { status: 400 });
    const paymentDate = parseDateOnly(body.paymentDate, 'paymentDate');
    const amountCents = Number(body.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 999_999_999_999) return NextResponse.json({ success: false, error: 'Amount must be a valid positive cents amount' }, { status: 400 });
    if (!PAYMENT_METHODS.includes(body.paymentMethod)) return NextResponse.json({ success: false, error: 'Select a valid payment method' }, { status: 400 });
    if (!Array.isArray(body.allocations) || body.allocations.length === 0) return NextResponse.json({ success: false, error: 'Allocate this transfer to at least one expense' }, { status: 400 });
    const allocations = body.allocations.map((allocation: any) => ({ expenseId: String(allocation.expenseId || ''), amountCents: Number(allocation.amountCents) }));
    if (allocations.some((allocation: any) => !allocation.expenseId || !Number.isSafeInteger(allocation.amountCents) || allocation.amountCents <= 0)) return NextResponse.json({ success: false, error: 'Every allocation must have an expense and a positive cents amount' }, { status: 400 });
    validateReimbursementAllocations(amountCents, allocations);
    const sourceAccountLabel = typeof body.sourceAccountLabel === 'string' ? body.sourceAccountLabel.trim().slice(0, 120) : '';
    const bankReference = typeof body.bankReference === 'string' ? body.bankReference.trim().slice(0, 160) : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
    if (proof) {
      const stored = await uploadAccountingReceipt(access.entity.id, proof);
      uploadedProofKey = stored.key;
      body._storedProof = stored;
    }
    const payment = await prisma.$transaction(async (tx) => {
      const uniqueExpenseIds = [...new Set(allocations.map((allocation: any) => allocation.expenseId))];
      const targets = await tx.accountingExpense.findMany({
        where: { id: { in: uniqueExpenseIds }, entityId: access.entity.id, fundingSource: 'PERSONAL', voidedAt: null },
        include: { reimbursementAllocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
      });
      if (targets.length !== uniqueExpenseIds.length) throw new Error('One or more expenses are unavailable in this entity');
      for (const allocation of allocations) {
        const expense = targets.find((target) => target.id === allocation.expenseId)!;
        if (!expense.personalPayeeName) throw new Error('Set the cardholder/payee before reimbursing an expense');
        if (!expense.paidAt) throw new Error('Confirm the original payment date before reimbursing an expense');
        if (expense.personalPayeeName.trim().toLocaleLowerCase() !== payeeName.toLocaleLowerCase()) throw new Error('All selected expenses must belong to the selected payee');
        const repaid = expense.reimbursementAllocations.reduce((sum, row) => sum + decimalToCents(row.amount), 0);
        const open = openReimbursementBalanceCents(decimalToCents(expense.totalAmount), repaid);
        if (allocation.amountCents > open) throw new Error(`Allocation exceeds the open balance for ${expense.vendorName}`);
      }
      const created = await tx.accountingReimbursementPayment.create({
        data: {
          entityId: access.entity.id,
          payeeName,
          paymentDate: new Date(`${paymentDate}T00:00:00.000Z`),
          amount: centsToDecimal(amountCents),
          paymentMethod: body.paymentMethod,
          sourceAccountLabel: sourceAccountLabel || null,
          bankReference: bankReference || null,
          note: note || null,
          proofStorageKey: body._storedProof?.key || null,
          proofFileName: body._storedProof?.fileName || null,
          proofMimeType: body._storedProof?.mimeType || null,
          proofSize: body._storedProof?.size || null,
          createdById: access.user.id,
          allocations: { create: allocations.map((allocation: any) => ({ entityId: access.entity.id, expenseId: allocation.expenseId, amount: centsToDecimal(allocation.amountCents) })) },
        },
        include: { allocations: true },
      });
      await tx.accountingAuditEvent.create({ data: {
        entityId: access.entity.id, actorId: access.user.id, action: 'CREATED', resourceType: 'AccountingReimbursementPayment', resourceId: created.id,
        metadata: { payeeName, amountCents, paymentDate, allocationCount: allocations.length, bankReference: bankReference || null, hasProof: Boolean(created.proofStorageKey) },
      } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    uploadedProofKey = null;
    const { proofStorageKey: _proofStorageKey, ...safePayment } = payment;
    return NextResponse.json({ success: true, payment: { ...safePayment, amountCents } }, { status: 201 });
  } catch (error) {
    await deleteAccountingReceipt(uploadedProofKey);
    logCaughtRequestError(request, '/api/books/reimbursements', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to record reimbursement') }, { status: 400 });
  }
}

export const GET = withRequestLogging('/api/books/reimbursements', handleGET);
export const POST = withRequestLogging('/api/books/reimbursements', handlePOST);
