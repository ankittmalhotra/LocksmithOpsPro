import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { sendSMS } from '@/lib/twilio';

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
        ...(status === 'DISPATCHED' && !targetJob.dispatchedAt ? { dispatchedAt: new Date() } : {}),
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
      include: {
        customer: true,
        technician: true,
        dispatcher: true,
        invoice: true,
      },
    });

    const techName = job.technician?.name || 'Your technician';

    // 1. When Technician Acknowledges & Dispatches
    if (status === 'DISPATCHED') {
      // The technician device only notifies the dispatcher. Customer SMS is
      // sent once by the dispatcher-side assignment flow in /api/jobs.
      const dispatcherPhone = job.dispatcher?.phone || targetJob.dispatcher?.phone;
      if (dispatcherPhone) {
        const dispatcherSms = `Technician ${techName} has acknowledged and is dispatched to Job #${job.jobNumber} (${job.serviceAddress}).`;
        await sendSMS({ to: dispatcherPhone, body: dispatcherSms });
      }
    }

    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
