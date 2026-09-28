import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { isBooksEntityCode } from '@/lib/books-api';

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const code = isBooksEntityCode(body?.entityCode) ? body.entityCode : new URL(request.url).searchParams.get('entityCode');
    if (!isBooksEntityCode(code)) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canManageReimbursements || access.user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden: Admin access required to reverse a reimbursement' }, { status: 403 });
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
    if (!reason) return NextResponse.json({ success: false, error: 'A reason is required to reverse a reimbursement' }, { status: 400 });
    const { id } = await params;
    const updated = await prisma.$transaction(async (tx) => {
      const payment = await tx.accountingReimbursementPayment.findFirst({ where: { id, entityId: access.entity.id } });
      if (!payment) throw new Error('Reimbursement payment not found');
      if (payment.voidedAt) throw new Error('Reimbursement payment is already reversed');
      const saved = await tx.accountingReimbursementPayment.update({ where: { id }, data: { voidedAt: new Date(), voidedById: access.user.id, voidReason: reason } });
      await tx.accountingAuditEvent.create({ data: {
        entityId: access.entity.id, actorId: access.user.id, action: 'VOIDED', resourceType: 'AccountingReimbursementPayment', resourceId: id,
        metadata: { amount: payment.amount.toString(), payeeName: payment.payeeName, reason },
      } });
      return saved;
    });
    const { proofStorageKey: _proofStorageKey, ...safePayment } = updated;
    return NextResponse.json({ success: true, payment: safePayment });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/reimbursements/[id]', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to reverse reimbursement') }, { status: 400 });
  }
}

export const PATCH = withRequestLogging('/api/books/reimbursements/[id]', handlePATCH);
