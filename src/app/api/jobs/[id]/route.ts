import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { getCurrentUser } from '@/lib/auth';
import {
  buildTechnicianUpdateDraft,
  normalizeNanpPhone,
  technicianAssignmentChanged,
} from '@/lib/sms-draft';
import {
  canMutateJob,
  canTransitionJobStatus,
  FINANCIAL_TERMINAL_JOB_STATUSES,
  normalizeTechnicianId,
} from '@/lib/job-workflow';

const DISPATCHER_STATUSES = [
  'NEW',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'CANCELLED',
] as const;

const DISPATCHER_UPDATE_FIELDS = [
  'technicianId',
  'status',
  'isScheduled',
  'scheduledFor',
] as const;

const ADMIN_UPDATE_FIELDS = [
  ...DISPATCHER_UPDATE_FIELDS,
  'serviceType',
  'problemDescription',
  'serviceAddress',
  'keyBitting',
  'doorDetails',
  'proofPhotoUrl',
  'preWorkSignature',
  'customerSignature',
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
  'vehicleVin',
  'keyType',
  'fccId',
] as const;

const VALID_JOB_STATUSES = [
  'NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'CANCELLED',
] as const;

export async function GET(
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
    const job = await findJobByIdOrNumber(id);

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    if (currentUser.role === 'TECHNICIAN' && job.technicianId !== currentUser.id) {
      return NextResponse.json(
        { success: false, error: 'Technicians may only access their own jobs' },
        { status: 403 }
      );
    }

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER' && currentUser.role !== 'TECHNICIAN') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Invalid role' },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, job });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: 'Unable to load job' }, { status: 500 });
  }
}

export async function PATCH(
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

    if (currentUser.role === 'TECHNICIAN') {
      return NextResponse.json(
        { success: false, error: 'Technicians may only update jobs through allowed actions' },
        { status: 403 }
      );
    }

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Dispatcher access required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const targetJob = await findJobByIdOrNumber(id);

    if (!targetJob) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    if (!canMutateJob(targetJob.status)) {
      return NextResponse.json(
        { success: false, error: 'Closed jobs cannot be edited' },
        { status: 409 }
      );
    }

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid job update' }, { status: 400 });
    }

    const allowedFields = currentUser.role === 'ADMIN' ? ADMIN_UPDATE_FIELDS : DISPATCHER_UPDATE_FIELDS;
    const unsupportedFields = Object.keys(body).filter(
      (key) => !(allowedFields as readonly string[]).includes(key)
    );
    if (unsupportedFields.length > 0) {
      return NextResponse.json({ success: false, error: 'Unsupported job update field' }, { status: 403 });
    }

    const updateData: any = {};
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updateData[field] = field === 'technicianId'
          ? normalizeTechnicianId(body[field])
          : body[field];
      }
    }

    let selectedTechnicianCommissionRate = 0;
    let technicianChanged = false;
    if (Object.prototype.hasOwnProperty.call(updateData, 'technicianId')) {
      const requestedTechnicianId = updateData.technicianId;
      if (requestedTechnicianId !== null && typeof requestedTechnicianId !== 'string') {
        return NextResponse.json({ success: false, error: 'Invalid technician' }, { status: 400 });
      }
      if (requestedTechnicianId) {
        technicianChanged = technicianAssignmentChanged(targetJob.technicianId, requestedTechnicianId);
        const assignedTechnician = await prisma.user.findUnique({
          where: { id: requestedTechnicianId },
          select: { role: true, active: true, commissionRate: true, phone: true },
        });
        if (!assignedTechnician || assignedTechnician.role !== 'TECHNICIAN' || !assignedTechnician.active) {
          return NextResponse.json({ success: false, error: 'Selected technician is not active.' }, { status: 400 });
        }
        if (!Number.isFinite(assignedTechnician.commissionRate) || assignedTechnician.commissionRate < 0) {
          return NextResponse.json({ success: false, error: 'Selected technician has an invalid commission rate.' }, { status: 400 });
        }
        if (technicianChanged) {
          try {
            normalizeNanpPhone(assignedTechnician.phone);
          } catch {
            return NextResponse.json(
              { success: false, error: 'Selected technician has an invalid phone number for SMS.' },
              { status: 400 }
            );
          }
        }
        selectedTechnicianCommissionRate = Math.round(assignedTechnician.commissionRate * 100) / 100;
      }
      if (!requestedTechnicianId) {
        technicianChanged = technicianAssignmentChanged(targetJob.technicianId, null);
      }
      // Clearing an assignment also clears the assignment-time commission
      // snapshot.  Closeout endpoints own the calculated commission amount.
      updateData.workerCommissionRate = selectedTechnicianCommissionRate;
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'status')) {
      if (typeof updateData.status !== 'string' || !(VALID_JOB_STATUSES as readonly string[]).includes(updateData.status)) {
        return NextResponse.json({ success: false, error: 'Invalid job status' }, { status: 400 });
      }
      if (!canTransitionJobStatus(targetJob.status, updateData.status)) {
        return NextResponse.json({ success: false, error: 'Invalid job status transition' }, { status: 409 });
      }
      if ((FINANCIAL_TERMINAL_JOB_STATUSES as readonly string[]).includes(updateData.status)) {
        return NextResponse.json({ success: false, error: 'Financial terminal statuses require the dedicated closeout action' }, { status: 409 });
      }
      if (currentUser.role === 'DISPATCHER' && !(DISPATCHER_STATUSES as readonly string[]).includes(updateData.status)) {
        return NextResponse.json({ success: false, error: 'Dispatchers may only set operational job statuses' }, { status: 403 });
      }
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'isScheduled') && typeof updateData.isScheduled !== 'boolean') {
      return NextResponse.json({ success: false, error: 'isScheduled must be a boolean' }, { status: 400 });
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'scheduledFor')) {
      if (updateData.scheduledFor === null) updateData.scheduledFor = null;
      else {
        const scheduledFor = new Date(updateData.scheduledFor);
        if (Number.isNaN(scheduledFor.getTime())) return NextResponse.json({ success: false, error: 'Invalid scheduled time' }, { status: 400 });
        updateData.scheduledFor = scheduledFor;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: false, error: 'No job fields supplied' }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Conditional update prevents a stale dispatcher form from overwriting
      // a concurrent closeout or status change.  The technician lookup and
      // commission snapshot happen in this same transaction.
      if (Object.prototype.hasOwnProperty.call(updateData, 'technicianId')) {
        const requestedTechnicianId = updateData.technicianId;
        const assignedTechnician = requestedTechnicianId
          ? await tx.user.findUnique({
              where: { id: requestedTechnicianId },
              select: { role: true, active: true, commissionRate: true },
            })
          : null;
        if (
          requestedTechnicianId &&
          (!assignedTechnician ||
            assignedTechnician.role !== 'TECHNICIAN' ||
            !assignedTechnician.active ||
            !Number.isFinite(assignedTechnician.commissionRate) ||
            assignedTechnician.commissionRate < 0)
        ) {
          return null;
        }
        updateData.workerCommissionRate = assignedTechnician
          ? Math.round(assignedTechnician.commissionRate * 100) / 100
          : 0;
      }

      const claimed = await tx.job.updateMany({
        where: { id: targetJob.id, status: targetJob.status },
        data: updateData,
      });
      if (claimed.count !== 1) return null;

      return tx.job.findUnique({
        where: { id: targetJob.id },
        include: {
          customer: true,
          technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
          invoice: true,
        },
      });
    });

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Job changed while it was being edited. Reload and try again.' },
        { status: 409 }
      );
    }

    let smsDraft = null;
    let smsDraftWarnings: string[] = [];
    if (technicianChanged) {
      if (updated.technician?.phone) {
        try {
          smsDraft = buildTechnicianUpdateDraft(updated.technician.phone, {
            jobNumber: updated.jobNumber,
            customerName: updated.customer.name,
            customerPhone: updated.customer.phone,
            customerExtension: updated.customer.extension,
            serviceAddress: updated.serviceAddress,
            serviceType: updated.serviceType,
            problemDescription: updated.problemDescription,
            vehicleYear: updated.vehicleYear,
            vehicleMake: updated.vehicleMake,
            vehicleModel: updated.vehicleModel,
            keyType: updated.keyType,
            isScheduled: updated.isScheduled,
            scheduledFor: updated.scheduledFor,
            technicianName: updated.technician.name,
            appUrl: process.env.NEXT_PUBLIC_APP_URL,
          });
          smsDraftWarnings = smsDraft.warnings;
        } catch {
          smsDraftWarnings = ['Technician SMS draft unavailable: technician phone number is invalid.'];
        }
      } else {
        smsDraftWarnings = ['Technician SMS draft unavailable: technician phone number is missing.'];
      }
    }

    return NextResponse.json({ success: true, job: updated, smsDraft, smsDraftWarnings });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: 'Unable to update job' }, { status: 500 });
  }
}
