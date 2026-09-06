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
      // Client gets SMS notification that Technician is Dispatched (No live tracking link)
      if (job.customer?.phone) {
        const clientSms = `Hello ${job.customer.name}, your locksmith technician ${techName} is dispatched and on the way for Job #${job.jobNumber}.`;
        await sendSMS({ to: job.customer.phone, body: clientSms });
      }

      // Dispatcher / Owner gets notification that Technician is Dispatched
      const dispatcherPhone = job.dispatcher?.phone || targetJob.dispatcher?.phone;
      if (dispatcherPhone) {
        const dispatcherSms = `Technician ${techName} has acknowledged and is dispatched to Job #${job.jobNumber} (${job.serviceAddress}).`;
        await sendSMS({ to: dispatcherPhone, body: dispatcherSms });
      }
    } else if (status === 'ON_SITE') {
      // Tech arrives on site to check work & quote client
      if (job.customer?.phone) {
        const arrivalSms = `📍 LockOps Update: ${techName} has arrived on site for Job #${job.jobNumber}.`;
        await sendSMS({ to: job.customer.phone, body: arrivalSms });
      }
    }

    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
