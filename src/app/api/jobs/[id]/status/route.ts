import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { sendSMS } from '@/lib/twilio';
import { getCurrentUser } from '@/lib/auth';
import type { JobStatus } from '@prisma/client';

const VALID_STATUSES = [
  'NEW',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

const DISPATCHER_STATUSES = [
  'NEW',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'CANCELLED',
] as const;

const TECHNICIAN_STATUSES = [
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const targetJob = await findJobByIdOrNumber(id);

    if (!targetJob) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    if (currentUser.role === 'TECHNICIAN' && targetJob.technicianId !== currentUser.id) {
      return NextResponse.json(
        { success: false, error: 'Technicians may only update their own jobs' },
        { status: 403 }
      );
    }

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER' && currentUser.role !== 'TECHNICIAN') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Invalid role' },
        { status: 403 }
      );
    }

    const { status } = await request.json();

    if (typeof status !== 'string' || !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    if (
      currentUser.role === 'TECHNICIAN' &&
      !(TECHNICIAN_STATUSES as readonly string[]).includes(status)
    ) {
      return NextResponse.json(
        { success: false, error: 'Technicians may only update operational status for their own jobs' },
        { status: 403 }
      );
    }

    if (
      currentUser.role === 'DISPATCHER' &&
      !(DISPATCHER_STATUSES as readonly string[]).includes(status)
    ) {
      return NextResponse.json(
        { success: false, error: 'Dispatchers may only update operational job statuses' },
        { status: 403 }
      );
    }

    const job = await prisma.job.update({
      where: { id: targetJob.id },
      data: {
        status: status as JobStatus,
        ...(status === 'DISPATCHED' && !targetJob.dispatchedAt ? { dispatchedAt: new Date() } : {}),
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
      include: {
        customer: true,
        technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
        dispatcher: { select: { id: true, name: true, phone: true, email: true, active: true } },
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
    return NextResponse.json({ success: false, error: 'Unable to update job status' }, { status: 500 });
  }
}
