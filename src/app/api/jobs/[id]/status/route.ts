import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findJobByIdOrNumber } from '@/lib/job-helper';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const targetJob = await findJobByIdOrNumber(id);

    if (!targetJob) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const { status } = await request.json();

    const validStatuses = ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    const job = await prisma.job.update({
      where: { id: targetJob.id },
      data: {
        status,
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
      include: {
        customer: true,
        technician: true,
        invoice: true,
      },
    });

    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
