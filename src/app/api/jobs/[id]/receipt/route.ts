import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { createOrLoadJobPaymentReceipt } from '@/lib/job-receipt';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') return NextResponse.json({ success: false, error: 'Admin or Dispatcher access required' }, { status: 403 });
    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    let receipt;
    try {
      receipt = await createOrLoadJobPaymentReceipt(job, user.id);
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Receipt unavailable' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const bytes = Buffer.from(receipt.pdfBytes);
    const filename = `Locksmith-Receipt-${job.jobNumber}.pdf`.replace(/[\\/\r\n"]+/g, '_');
    return new NextResponse(bytes, { headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    logCaughtRequestError(request, '/api/jobs/[id]/receipt', error);
    return NextResponse.json({ success: false, error: 'Unable to create receipt' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export const GET = withRequestLogging('/api/jobs/[id]/receipt', handleGET);
