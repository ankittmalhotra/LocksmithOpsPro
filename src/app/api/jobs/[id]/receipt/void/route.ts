import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Admin access required to void a receipt' }, { status: 403 });
    const body = await request.json();
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 8 || reason.length > 1000) return NextResponse.json({ success: false, error: 'Provide a correction reason between 8 and 1,000 characters.' }, { status: 400 });
    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job?.invoice) return NextResponse.json({ success: false, error: 'Job receipt not found' }, { status: 404 });
    const invoiceId = job.invoice.id;
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
      const active = await tx.jobPaymentReceipt.findFirst({ where: { invoiceId, voidedAt: null } });
      if (!active) return null;
      const result = await tx.jobPaymentReceipt.updateMany({ where: { id: active.id, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason } });
      return result.count === 1 ? active : false;
    });
    if (outcome === null) return NextResponse.json({ success: false, error: 'There is no active receipt to void' }, { status: 404 });
    if (outcome === false) return NextResponse.json({ success: false, error: 'Receipt changed concurrently; reload and try again.' }, { status: 409 });
    return NextResponse.json({ success: true, receiptNumber: outcome.receiptNumber, message: 'Receipt voided. Make the correction, then download a replacement receipt.' });
  } catch (error) {
    logCaughtRequestError(request, '/api/jobs/[id]/receipt/void', error);
    return NextResponse.json({ success: false, error: 'Unable to void receipt' }, { status: 500 },);
  }
}

export const POST = withRequestLogging('/api/jobs/[id]/receipt/void', handlePOST);
