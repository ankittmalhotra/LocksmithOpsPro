import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { getCurrentUser } from '@/lib/auth';
import { canMutateJob, canTransitionJobStatus } from '@/lib/job-workflow';
import { tryBuildDispatcherNotificationDraft } from '@/lib/sms-draft';
import type { JobStatus } from '@prisma/client';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

const VALID_STATUSES = [
  'NEW',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
] as const;

const DISPATCHER_STATUSES = [
  'NEW',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
] as const;

const TECHNICIAN_STATUSES = [
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
] as const;

async function handlePOST(
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

    if (!canMutateJob(targetJob.status)) {
      return NextResponse.json(
        { success: false, error: 'Closed jobs cannot have their status changed' },
        { status: 409 }
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

    if (!canTransitionJobStatus(targetJob.status, status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid job status transition' },
        { status: 409 }
      );
    }

    const statusChanged = targetJob.status !== status;

    const job = await prisma.$transaction(async (tx) => {
      const claimed = await tx.job.updateMany({
        where: { id: targetJob.id, status: targetJob.status },
        data: {
          status: status as JobStatus,
          ...(status === 'DISPATCHED' && !targetJob.dispatchedAt ? { dispatchedAt: new Date() } : {}),
        },
      });
      if (claimed.count !== 1) return null;

      return tx.job.findUnique({
        where: { id: targetJob.id },
        include: {
          customer: true,
          technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
          dispatcher: { select: { id: true, name: true, phone: true, email: true, active: true } },
          invoice: true,
        },
      });
    });

    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job changed while its status was being updated. Reload and try again.' },
        { status: 409 }
      );
    }

    let dispatcherNotification = null;
    let dispatcherNotificationWarnings: string[] = [];
    if (currentUser.role === 'TECHNICIAN' && statusChanged && status === 'DISPATCHED') {
      const notification = tryBuildDispatcherNotificationDraft(job.dispatcher?.phone, {
        kind: 'DISPATCHED',
        jobNumber: job.jobNumber,
        technicianName: job.technician?.name,
        serviceAddress: job.serviceAddress,
      });
      dispatcherNotification = notification.draft;
      dispatcherNotificationWarnings = notification.warnings;
    }

    return NextResponse.json({
      success: true,
      job,
      dispatcherNotification,
      dispatcherNotificationWarnings,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/jobs/[id]/status', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to update job status') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/jobs/[id]/status', handlePOST);
