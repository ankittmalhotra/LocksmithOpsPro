import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findJobByIdOrNumber } from '@/lib/job-helper';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = await findJobByIdOrNumber(id);

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const targetJob = await findJobByIdOrNumber(id);

    if (!targetJob) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const body = await request.json();

    const updated = await prisma.job.update({
      where: { id: targetJob.id },
      data: body,
      include: {
        customer: true,
        technician: true,
        invoice: true,
      },
    });

    return NextResponse.json({ success: true, job: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
