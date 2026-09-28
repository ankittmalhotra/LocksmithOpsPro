import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { getAccountingReceipt } from '@/lib/accounting-receipts';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { isBooksEntityCode } from '@/lib/books-api';

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const code = new URL(request.url).searchParams.get('entityCode');
    if (!isBooksEntityCode(code)) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    const { id } = await params;
    const payment = await prisma.accountingReimbursementPayment.findFirst({ where: { id, entityId: access.entity.id }, select: { proofStorageKey: true, proofFileName: true, proofMimeType: true } });
    if (!payment?.proofStorageKey) return NextResponse.json({ success: false, error: 'No proof is attached to this reimbursement' }, { status: 404 });
    const object = await getAccountingReceipt(payment.proofStorageKey);
    if (!object.Body) return NextResponse.json({ success: false, error: 'Proof file is unavailable' }, { status: 404 });
    const bytes = await object.Body.transformToByteArray();
    const filename = (payment.proofFileName || 'payment-proof').replace(/[\\/\r\n"]+/g, '_');
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': payment.proofMimeType || object.ContentType || 'application/octet-stream', 'Content-Length': String(bytes.byteLength), 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/reimbursements/[id]/proof', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load payment proof') }, { status: 404 });
  }
}

export const GET = withRequestLogging('/api/books/reimbursements/[id]/proof', handleGET);
