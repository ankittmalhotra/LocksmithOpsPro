import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { getApiErrorMessage } from '@/lib/api-error';
import { isBooksEntityCode } from '@/lib/books-api';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getAccountingReceipt } from '@/lib/accounting-receipts';

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const query = new URL(request.url).searchParams;
    const rawCode = query.get('entityCode');
    if (!isBooksEntityCode(rawCode)) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(rawCode);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    const { id } = await params;
    const expense = await prisma.accountingExpense.findFirst({
      where: { id, entityId: access.entity.id, voidedAt: null },
      select: { receiptStorageKey: true, receiptFileName: true, receiptMimeType: true },
    });
    if (!expense?.receiptStorageKey) return NextResponse.json({ success: false, error: 'No receipt is attached to this expense' }, { status: 404 });
    const object = await getAccountingReceipt(expense.receiptStorageKey);
    if (!object.Body) return NextResponse.json({ success: false, error: 'Receipt object is unavailable' }, { status: 404 });
    const filename = (expense.receiptFileName || 'receipt').replace(/[\\/\r\n"]+/g, '_');
    const bytes = await object.Body.transformToByteArray();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': expense.receiptMimeType || object.ContentType || 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/expenses/[id]/receipt', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load receipt') }, { status: 404 });
  }
}

export const GET = withRequestLogging('/api/books/expenses/[id]/receipt', handleGET);
