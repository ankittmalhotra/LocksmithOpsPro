import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { centsToDecimal, decimalToCents, isBooksEntityCode, normalizeTaxRate, parseCents, parseDateOnly, serializeDecimal } from '@/lib/books-api';
import { deleteAccountingReceipt, uploadAccountingReceipt } from '@/lib/accounting-receipts';

function mapExpense(expense: any) {
  const { receiptStorageKey: _receiptStorageKey, ...safeExpense } = expense;
  return { ...safeExpense, reimbursementNeedsConfirmation: safeExpense.fundingSource === 'PERSONAL' && (!safeExpense.personalPayeeName || !safeExpense.paidAt), subtotalAmount: serializeDecimal(safeExpense.subtotalAmount), hstAmount: serializeDecimal(safeExpense.hstAmount), totalAmount: serializeDecimal(safeExpense.totalAmount), hstRate: safeExpense.hstRate === null ? null : Number(safeExpense.hstRate) };
}

async function readExpenseBody(request: Request): Promise<{ body: Record<string, any>; file: File | null }> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const fileValue = formData.get('receipt');
    const body: Record<string, any> = {};
    for (const [key, value] of formData.entries()) if (key !== 'receipt' && typeof value === 'string') body[key] = value;
    return { body, file: fileValue instanceof File && fileValue.size > 0 ? fileValue : null };
  }
  return { body: await request.json(), file: null };
}
function receiptStatus(value: unknown) { return value === 'ATTACHED' || value === 'MISSING' || value === 'NOT_REQUIRED' ? value : null; }

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let uploadedReceiptKey: string | null = null;
  try {
    const parsed = await readExpenseBody(request);
    const body = parsed.body;
    const code = isBooksEntityCode(body?.entityCode) ? body.entityCode : new URL(request.url).searchParams.get('entityCode');
    if (!isBooksEntityCode(code)) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canManageExpenses) return NextResponse.json({ success: false, error: 'Forbidden: Expense management required' }, { status: 403 });
    const { id } = await params;
    const existing = await prisma.accountingExpense.findFirst({ where: { id, entityId: access.entity.id } });
    if (!existing) return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });

    const fundingSource = body.fundingSource === undefined ? existing.fundingSource : body.fundingSource;
    if (fundingSource !== 'BUSINESS' && fundingSource !== 'PERSONAL') return NextResponse.json({ success: false, error: 'Invalid fundingSource' }, { status: 400 });
    const personalPayeeName = body.personalPayeeName === undefined ? existing.personalPayeeName : String(body.personalPayeeName).trim() || null;
    const personalPaymentMethod = body.personalPaymentMethod === undefined ? existing.personalPaymentMethod : body.personalPaymentMethod || null;
    const personalCardLast4 = body.personalCardLast4 === undefined ? existing.personalCardLast4 : String(body.personalCardLast4).trim() || null;
    const paidAt = body.paidAt === undefined ? existing.paidAt : body.paidAt ? new Date(`${parseDateOnly(body.paidAt, 'paidAt')}T00:00:00.000Z`) : null;
    if (personalPaymentMethod && !['CASH', 'BANK_TRANSFER', 'CHEQUE', 'INTERAC', 'CREDIT_CARD', 'DEBIT_CARD', 'OTHER'].includes(personalPaymentMethod)) return NextResponse.json({ success: false, error: 'Invalid personal payment method' }, { status: 400 });
    if (fundingSource === 'PERSONAL' && personalPayeeName && !personalPaymentMethod) return NextResponse.json({ success: false, error: 'Select how the personal expense was paid' }, { status: 400 });
    if (fundingSource === 'PERSONAL' && personalPayeeName && !paidAt) return NextResponse.json({ success: false, error: 'Original personal payment date is required before confirming the payer' }, { status: 400 });
    if (personalCardLast4 && !/^\d{4}$/.test(personalCardLast4)) return NextResponse.json({ success: false, error: 'Card last four must be exactly four digits' }, { status: 400 });
    if (fundingSource === 'BUSINESS' && (personalPayeeName || personalPaymentMethod || personalCardLast4)) return NextResponse.json({ success: false, error: 'Personal payment details require personal funding' }, { status: 400 });
    const businessPaymentReference = fundingSource === 'BUSINESS'
      ? (body.businessPaymentReference === undefined ? existing.businessPaymentReference : String(body.businessPaymentReference).trim().slice(0, 160) || null)
      : null;
    if (fundingSource !== existing.fundingSource || personalPayeeName !== existing.personalPayeeName) {
      const allocations = await prisma.accountingReimbursementAllocation.count({ where: { entityId: access.entity.id, expenseId: id } });
      if (allocations) return NextResponse.json({ success: false, error: 'Funding source or payee cannot change after repayments are recorded' }, { status: 409 });
    }

    const subtotalCents = body.subtotalAmount === undefined ? Math.round(Number(existing.subtotalAmount) * 100) : parseCents(body.subtotalAmount, 'subtotalAmount');
    const hstCents = body.hstAmount === undefined ? Math.round(Number(existing.hstAmount) * 100) : parseCents(body.hstAmount, 'hstAmount');
    const totalCents = body.totalAmount === undefined ? subtotalCents + hstCents : parseCents(body.totalAmount, 'totalAmount');
    if (totalCents !== subtotalCents + hstCents) return NextResponse.json({ success: false, error: 'Total must equal subtotal plus HST' }, { status: 400 });
    const paymentStatus = 'PAID';
    let categoryId: string | null | undefined;
    if (body.categoryId !== undefined) {
      categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : null;
      if (categoryId) {
        const category = await prisma.accountingExpenseCategory.findFirst({ where: { id: categoryId, entityId: access.entity.id, active: true }, select: { id: true } });
        if (!category) return NextResponse.json({ success: false, error: 'Expense category not found' }, { status: 400 });
      }
    }
    const businessPurpose = body.businessPurpose === undefined ? existing.businessPurpose || '' : String(body.businessPurpose).trim();
    if (!businessPurpose) return NextResponse.json({ success: false, error: 'Business purpose is required' }, { status: 400 });
    const requestedReceiptStatus = body.receiptStatus === undefined ? existing.receiptStatus : receiptStatus(body.receiptStatus);
    if (!requestedReceiptStatus) return NextResponse.json({ success: false, error: 'Invalid receipt status' }, { status: 400 });
    const status = parsed.file ? 'ATTACHED' : requestedReceiptStatus;
    const notes = body.notes === undefined ? (existing.notes || '') : String(body.notes).trim();
    if (status === 'ATTACHED' && !parsed.file && !existing.receiptStorageKey) return NextResponse.json({ success: false, error: 'Attach the receipt file or choose a different receipt status' }, { status: 400 });
    if (status !== 'ATTACHED' && !notes) return NextResponse.json({ success: false, error: 'Add a note explaining why a receipt is missing or not required' }, { status: 400 });
    const storedReceipt = parsed.file ? await uploadAccountingReceipt(access.entity.id, parsed.file) : null;
    uploadedReceiptKey = storedReceipt?.key || null;
    const receiptChanged = Boolean(storedReceipt) || status !== 'ATTACHED';
    const expense = await prisma.$transaction(async (tx) => {
      if (fundingSource === 'PERSONAL') {
        const activeAllocations = await tx.accountingReimbursementAllocation.findMany({
          where: { entityId: access.entity.id, expenseId: id, payment: { voidedAt: null } },
          select: { amount: true },
        });
        const alreadyReimbursedCents = activeAllocations.reduce((sum, allocation) => sum + decimalToCents(allocation.amount), 0);
        if (totalCents < alreadyReimbursedCents) {
          throw new Error('Expense total cannot be reduced below the amount already reimbursed');
        }
      }
      const updated = await tx.accountingExpense.update({
        where: { id },
        data: {
        vendorName: body.vendorName === undefined ? undefined : String(body.vendorName).trim(),
        categoryId,
        businessPurpose,
        description: body.description === undefined ? undefined : (String(body.description).trim() || null),
        expenseDate: body.expenseDate === undefined ? undefined : new Date(`${parseDateOnly(body.expenseDate, 'expenseDate')}T00:00:00.000Z`),
        subtotalAmount: centsToDecimal(subtotalCents), hstAmount: centsToDecimal(hstCents), totalAmount: centsToDecimal(totalCents),
        hstRate: body.hstRate === undefined ? undefined : normalizeTaxRate(body.hstRate),
        paymentStatus, paymentMethod: body.paymentMethod === undefined ? undefined : body.paymentMethod || null,
        paidAt,
        businessPaymentReference,
        fundingSource,
        personalPayeeName: fundingSource === 'PERSONAL' ? personalPayeeName : null,
        personalPaymentMethod: fundingSource === 'PERSONAL' ? personalPaymentMethod : null,
        personalCardLast4: fundingSource === 'PERSONAL' ? personalCardLast4 : null,
        paidBeforeIncorporation: body.paidBeforeIncorporation === undefined ? existing.paidBeforeIncorporation : body.paidBeforeIncorporation === true || body.paidBeforeIncorporation === 'true',
        legacyFundingBackfillApplied: true,
        receiptUrl: body.receiptUrl === undefined ? undefined : String(body.receiptUrl).trim() || null,
        receiptStatus: status,
        ...(storedReceipt ? {
          receiptStorageKey: storedReceipt.key,
          receiptFileName: storedReceipt.fileName,
          receiptMimeType: storedReceipt.mimeType,
          receiptSize: storedReceipt.size,
          receiptUploadedAt: new Date(),
        } : receiptChanged ? {
          receiptStorageKey: null,
          receiptFileName: null,
          receiptMimeType: null,
          receiptSize: null,
          receiptUploadedAt: null,
        } : {}),
        notes: notes || null,
        updatedById: access.user.id,
        }, include: { category: true },
      });
      await tx.accountingAuditEvent.create({ data: { entityId: access.entity.id, actorId: access.user.id, action: 'UPDATED', resourceType: 'AccountingExpense', resourceId: id, metadata: { totalAmount: totalCents / 100, receiptStatus: status, hasReceipt: status === 'ATTACHED', businessPurpose } } });
      return updated;
    });
    if (existing.receiptStorageKey && (storedReceipt || receiptChanged)) {
      try { await deleteAccountingReceipt(existing.receiptStorageKey); } catch { /* best-effort cleanup after the database update */ }
    }
    uploadedReceiptKey = null;
    return NextResponse.json({ success: true, expense: mapExpense(expense) });
  } catch (error) {
    await deleteAccountingReceipt(uploadedReceiptKey);
    logCaughtRequestError(request, '/api/books/expenses/[id]', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to update expense') }, { status: 400 });
  }
}

export const PATCH = withRequestLogging('/api/books/expenses/[id]', handlePATCH);
