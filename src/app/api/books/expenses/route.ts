import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { centsToDecimal, isBooksEntityCode, normalizeTaxRate, parseCents, parseDateOnly, serializeDecimal } from '@/lib/books-api';
import { getPartnerBillingPeriod } from '@/lib/accounting';
import { dateKeyToUtcDate, getMissingGoogleAdsConfigVariables } from '@/lib/google-ads';
import { deleteAccountingReceipt, uploadAccountingReceipt } from '@/lib/accounting-receipts';

function entityCodeFrom(request: Request, body?: Record<string, unknown>) {
  const value = new URL(request.url).searchParams.get('entityCode') || body?.entityCode;
  return isBooksEntityCode(value) ? value : null;
}

function mapExpense(expense: any) {
  const { receiptStorageKey: _receiptStorageKey, ...safeExpense } = expense;
  return {
    ...safeExpense,
    subtotalAmount: serializeDecimal(safeExpense.subtotalAmount),
    hstAmount: serializeDecimal(safeExpense.hstAmount),
    totalAmount: serializeDecimal(safeExpense.totalAmount),
    hstRate: safeExpense.hstRate === null ? null : Number(safeExpense.hstRate),
  };
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

function receiptStatus(value: unknown) {
  return value === 'ATTACHED' || value === 'MISSING' || value === 'NOT_REQUIRED' ? value : 'MISSING';
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
        receiptStatus: 'NOT_REQUIRED',
        receiptFileName: null,
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
  let uploadedReceiptKey: string | null = null;
  try {
    const parsed = await readExpenseBody(request);
    const body = parsed.body;
    const code = entityCodeFrom(request, body);
    if (!code) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canManageExpenses) return NextResponse.json({ success: false, error: 'Forbidden: Expense management required' }, { status: 403 });
    const requestedDraftId = typeof body.receiptDraftId === 'string' ? body.receiptDraftId.trim() : '';
    const receiptDraft = requestedDraftId ? await prisma.accountingReceiptDraft.findUnique({ where: { id: requestedDraftId } }) : null;
    if (requestedDraftId && (!receiptDraft || receiptDraft.entityId !== access.entity.id || receiptDraft.createdById !== access.user.id || receiptDraft.status !== 'READY' || receiptDraft.expiresAt <= new Date())) {
      return NextResponse.json({ success: false, error: 'Receipt draft is unavailable or expired. Upload the receipt again.' }, { status: 400 });
    }
    const extracted = receiptDraft?.extractedData && typeof receiptDraft.extractedData === 'object' ? receiptDraft.extractedData as Record<string, unknown> : {};
    const vendorName = (typeof body.vendorName === 'string' ? body.vendorName.trim() : '') || (typeof extracted.vendorName === 'string' ? extracted.vendorName.trim() : '');
    const businessPurpose = (typeof body.businessPurpose === 'string' ? body.businessPurpose.trim() : '') || (typeof extracted.businessPurposeSuggestion === 'string' ? extracted.businessPurposeSuggestion.trim() : '');
    if (!vendorName) return NextResponse.json({ success: false, error: 'Vendor name is required' }, { status: 400 });
    if (!businessPurpose) return NextResponse.json({ success: false, error: 'Business purpose is required' }, { status: 400 });
    const expenseDate = parseDateOnly(body.expenseDate || extracted.expenseDate, 'expenseDate');
    const subtotalCents = parseCents(body.subtotalAmount ?? extracted.subtotalAmount, 'subtotalAmount');
    const hstCents = parseCents(body.hstAmount ?? extracted.hstAmount ?? 0, 'hstAmount');
    const totalCents = body.totalAmount === undefined
      ? subtotalCents + hstCents
      : parseCents(body.totalAmount, 'totalAmount');
    if (totalCents !== subtotalCents + hstCents) return NextResponse.json({ success: false, error: 'Total must equal subtotal plus HST' }, { status: 400 });
    const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : null;
    if (categoryId) {
      const category = await prisma.accountingExpenseCategory.findFirst({ where: { id: categoryId, entityId: access.entity.id, active: true }, select: { id: true } });
      if (!category) return NextResponse.json({ success: false, error: 'Expense category not found' }, { status: 400 });
    }
    const status = parsed.file || receiptDraft ? 'ATTACHED' : receiptStatus(body.receiptStatus);
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    if (status === 'ATTACHED' && !parsed.file && !receiptDraft) return NextResponse.json({ success: false, error: 'Attach the receipt file or choose a different receipt status' }, { status: 400 });
    if (status !== 'ATTACHED' && !notes) return NextResponse.json({ success: false, error: 'Add a note explaining why a receipt is missing or not required' }, { status: 400 });
    const storedReceipt = parsed.file
      ? await uploadAccountingReceipt(access.entity.id, parsed.file)
      : receiptDraft
        ? { key: receiptDraft.storageKey, fileName: receiptDraft.fileName, mimeType: receiptDraft.mimeType, size: receiptDraft.size }
        : null;
    // A draft's object becomes the final receipt and must never be cleaned up
    // by this request's failure handler. Only a newly uploaded manual receipt
    // is owned by this request until the transaction commits.
    uploadedReceiptKey = parsed.file ? storedReceipt?.key || null : null;
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.accountingExpense.create({
        data: {
        entityId: access.entity.id,
        categoryId,
        vendorName,
        businessPurpose,
        description: (typeof body.description === 'string' ? body.description.trim() : '') || (typeof extracted.description === 'string' ? extracted.description.trim() : '') || null,
        expenseDate: new Date(`${expenseDate}T00:00:00.000Z`),
        subtotalAmount: centsToDecimal(subtotalCents),
        hstAmount: centsToDecimal(hstCents),
        totalAmount: centsToDecimal(totalCents),
        hstRate: normalizeTaxRate(body.hstRate === undefined || body.hstRate === null ? extracted.hstRate : body.hstRate),
        // Books records are entered only after the company has paid the expense.
        paymentStatus: 'PAID',
        paymentMethod: body.paymentMethod || null,
        paidAt: new Date(),
        receiptUrl: typeof body.receiptUrl === 'string' ? body.receiptUrl.trim() || null : null,
        receiptStatus: status,
        receiptStorageKey: storedReceipt?.key || null,
        receiptFileName: storedReceipt?.fileName || null,
        receiptMimeType: storedReceipt?.mimeType || null,
        receiptSize: storedReceipt?.size || null,
        receiptUploadedAt: storedReceipt ? new Date() : null,
        notes: notes || null,
        createdById: access.user.id,
        updatedById: access.user.id,
        },
        include: { category: true },
      });
      if (receiptDraft) {
        const consumed = await tx.accountingReceiptDraft.updateMany({ where: { id: receiptDraft.id, status: 'READY', createdById: access.user.id }, data: { status: 'CONSUMED', consumedAt: new Date(), extractedData: Prisma.JsonNull, warnings: Prisma.JsonNull, confidence: Prisma.JsonNull } });
        if (consumed.count !== 1) throw new Error('Receipt draft was already used. Upload the receipt again.');
      }
      await tx.accountingAuditEvent.create({ data: {
        entityId: access.entity.id, actorId: access.user.id, action: 'CREATED', resourceType: 'AccountingExpense', resourceId: created.id,
        metadata: { totalAmount: totalCents / 100, receiptStatus: status, hasReceipt: status === 'ATTACHED', businessPurpose, ...(receiptDraft ? { aiReceiptDraftId: receiptDraft.id, aiModel: receiptDraft.model || 'unknown' } : {}) },
      } });
      return created;
    });
    uploadedReceiptKey = null;
    return NextResponse.json({ success: true, expense: mapExpense(expense) }, { status: 201 });
  } catch (error) {
    await deleteAccountingReceipt(uploadedReceiptKey);
    logCaughtRequestError(request, '/api/books/expenses', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to create expense') }, { status: 400 });
  }
}

export const GET = withRequestLogging('/api/books/expenses', handleGET);
export const POST = withRequestLogging('/api/books/expenses', handlePOST);
