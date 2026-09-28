import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { isBooksEntityCode } from '@/lib/books-api';

async function handlePATCH(request: Request) {
  try {
    const body = await request.json();
    if (!isBooksEntityCode(body?.entityCode)) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(body.entityCode);
    if (!access?.canMapAccounting || !['ADMIN', 'ACCOUNTANT'].includes(access.user.role)) return NextResponse.json({ success: false, error: 'Forbidden: Accounting mapping access required' }, { status: 403 });
    const targetType = body.targetType;
    if (targetType !== 'EXPENSE' && targetType !== 'PAYMENT') return NextResponse.json({ success: false, error: 'targetType must be EXPENSE or PAYMENT' }, { status: 400 });
    const id = typeof body.targetId === 'string' ? body.targetId.trim() : '';
    const mappingStatus = body.mappingStatus;
    if (!id || !['NOT_REVIEWED', 'NEEDS_CLARIFICATION', 'MAPPED'].includes(mappingStatus)) return NextResponse.json({ success: false, error: 'A target and valid mapping status are required' }, { status: 400 });
    const accountName = typeof body.accountName === 'string' ? body.accountName.trim().slice(0, 160) : '';
    const accountCode = typeof body.accountCode === 'string' ? body.accountCode.trim().slice(0, 80) : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : '';
    if (mappingStatus === 'MAPPED' && !accountName) return NextResponse.json({ success: false, error: 'Account name is required to mark a record mapped' }, { status: 400 });
    const result = await prisma.$transaction(async (tx) => {
      if (targetType === 'EXPENSE') {
        const existing = await tx.accountingExpense.findFirst({ where: { id, entityId: access.entity.id, fundingSource: 'PERSONAL' }, select: { id: true } });
        if (!existing) throw new Error('Personal expense not found');
        const saved = await tx.accountingExpense.update({ where: { id }, data: { mappingStatus, mappingAccountName: accountName || null, mappingAccountCode: accountCode || null, mappingNotes: notes || null, mappedById: access.user.id, mappedAt: new Date() } });
        await tx.accountingAuditEvent.create({ data: { entityId: access.entity.id, actorId: access.user.id, action: 'UPDATED', resourceType: 'AccountingExpenseMapping', resourceId: id, metadata: { targetType, mappingStatus, accountName: accountName || null, accountCode: accountCode || null, notes: notes || null } } });
        return saved;
      }
      const existing = await tx.accountingReimbursementPayment.findFirst({ where: { id, entityId: access.entity.id }, select: { id: true } });
      if (!existing) throw new Error('Reimbursement payment not found');
      const saved = await tx.accountingReimbursementPayment.update({ where: { id }, data: { mappingStatus, mappingAccountName: accountName || null, mappingAccountCode: accountCode || null, mappingNotes: notes || null, mappedById: access.user.id, mappedAt: new Date() } });
      await tx.accountingAuditEvent.create({ data: { entityId: access.entity.id, actorId: access.user.id, action: 'UPDATED', resourceType: 'AccountingReimbursementMapping', resourceId: id, metadata: { targetType, mappingStatus, accountName: accountName || null, accountCode: accountCode || null, notes: notes || null } } });
      return saved;
    });
    const { receiptStorageKey: _receiptStorageKey, proofStorageKey: _proofStorageKey, ...safeRecord } = result as typeof result & { receiptStorageKey?: string | null; proofStorageKey?: string | null };
    return NextResponse.json({ success: true, targetType, record: safeRecord });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/reimbursements/mapping', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to save accounting mapping') }, { status: 400 });
  }
}

export const PATCH = withRequestLogging('/api/books/reimbursements/mapping', handlePATCH);
