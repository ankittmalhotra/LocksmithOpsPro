import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { isBooksEntityCode } from '@/lib/books-api';
import { deleteAccountingReceipt, readAccountingReceiptBytes, uploadAccountingReceiptDraft } from '@/lib/accounting-receipts';
import { extractReceiptWithGemini } from '@/lib/gemini-receipt';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

async function expireOldDrafts() {
  const stale = await prisma.accountingReceiptDraft.findMany({
    where: { expiresAt: { lt: new Date() }, status: { in: ['PROCESSING', 'READY'] } },
    select: { id: true, storageKey: true }, take: 50,
  });
  if (!stale.length) return;
  await Promise.all(stale.map(async (draft) => {
    const expired = await prisma.accountingReceiptDraft.updateMany({
      where: { id: draft.id, status: { in: ['PROCESSING', 'READY'] } },
      data: { status: 'EXPIRED', extractedData: Prisma.JsonNull, warnings: Prisma.JsonNull, confidence: Prisma.JsonNull },
    });
    if (expired.count === 1) await deleteAccountingReceipt(draft.storageKey);
  }));
}

async function handlePOST(request: Request) {
  let storageKey: string | null = null;
  let draftId: string | null = null;
  try {
    await expireOldDrafts();
    const formData = await request.formData();
    const codeValue = formData.get('entityCode');
    const code = isBooksEntityCode(codeValue) ? codeValue : null;
    if (!code) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canManageExpenses) return NextResponse.json({ success: false, error: 'Forbidden: Expense management required' }, { status: 403 });
    const fileValue = formData.get('receipt');
    if (!(fileValue instanceof File) || fileValue.size <= 0) return NextResponse.json({ success: false, error: 'Attach a receipt file' }, { status: 400 });

    const stored = await uploadAccountingReceiptDraft(access.entity.id, fileValue);
    storageKey = stored.key;
    const draft = await prisma.accountingReceiptDraft.create({ data: {
      entityId: access.entity.id, createdById: access.user.id, storageKey: stored.key,
      fileName: stored.fileName, mimeType: stored.mimeType, size: stored.size,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS), status: 'PROCESSING', model: null,
    } });
    draftId = draft.id;
    const result = await extractReceiptWithGemini({ bytes: await readAccountingReceiptBytes(stored.key), mimeType: stored.mimeType });
    const ready = await prisma.accountingReceiptDraft.update({ where: { id: draft.id }, data: {
      status: 'READY', model: result.model, extractedData: result.extraction,
      warnings: result.extraction.warnings, confidence: result.extraction.confidence,
    } });
    storageKey = null;
    await prisma.accountingAuditEvent.create({ data: {
      entityId: access.entity.id, actorId: access.user.id, action: 'RECEIPT_PARSED',
      resourceType: 'AccountingReceiptDraft', resourceId: ready.id,
      metadata: { model: result.model, fileName: ready.fileName, warningCount: result.extraction.warnings.length },
    } });
    return NextResponse.json({ success: true, draft: {
      id: ready.id, fileName: ready.fileName, mimeType: ready.mimeType, size: ready.size,
      expiresAt: ready.expiresAt, status: ready.status, model: ready.model,
      extracted: result.extraction,
    } }, { status: 201 });
  } catch (error) {
    if (draftId) await prisma.accountingReceiptDraft.updateMany({ where: { id: draftId, status: 'PROCESSING' }, data: { status: 'FAILED', errorMessage: getApiErrorMessage(error, 'Receipt extraction failed') } }).catch(() => undefined);
    await deleteAccountingReceipt(storageKey);
    logCaughtRequestError(request, '/api/books/expenses/receipt-draft', error);
    const status = error instanceof Error && error.name === 'GeminiReceiptConfigurationError' ? 503 : 400;
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to read receipt') }, { status });
  }
}

async function handleDELETE(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const id = query.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Draft id is required' }, { status: 400 });
    const [draft, user] = await Promise.all([
      prisma.accountingReceiptDraft.findUnique({ where: { id }, select: { id: true, createdById: true, storageKey: true, status: true, entity: { select: { code: true } } } }),
      getCurrentUser(),
    ]);
    if (!draft || !user || draft.createdById !== user.id || !isBooksEntityCode(draft.entity.code)) return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 });
    if (draft.status === 'CONSUMED') return NextResponse.json({ success: false, error: 'Draft is already consumed' }, { status: 409 });
    const discarded = await prisma.accountingReceiptDraft.updateMany({ where: { id, createdById: user.id, status: { in: ['PROCESSING', 'READY', 'FAILED'] } }, data: { status: 'EXPIRED', extractedData: Prisma.JsonNull, warnings: Prisma.JsonNull, confidence: Prisma.JsonNull } });
    if (discarded.count !== 1) return NextResponse.json({ success: false, error: 'Draft is no longer available' }, { status: 409 });
    await deleteAccountingReceipt(draft.storageKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/expenses/receipt-draft', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to discard receipt draft') }, { status: 400 });
  }
}

export const POST = withRequestLogging('/api/books/expenses/receipt-draft', handlePOST);
export const DELETE = withRequestLogging('/api/books/expenses/receipt-draft', handleDELETE);
