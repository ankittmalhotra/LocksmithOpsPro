import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { getCurrentUser } from '@/lib/auth';

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
  'workerCommissionRate',
  'workerCommission',
  'isAbandoned',
  'travelFeeAmount',
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
  'NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS',
  'ABANDONED_TRAVEL_FEE', 'INVOICED', 'COMPLETED', 'CANCELLED',
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
      if (Object.prototype.hasOwnProperty.call(body, field)) updateData[field] = body[field];
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'technicianId')) {
      const requestedTechnicianId = updateData.technicianId;
      if (requestedTechnicianId !== null && typeof requestedTechnicianId !== 'string') {
        return NextResponse.json({ success: false, error: 'Invalid technician' }, { status: 400 });
      }
      if (requestedTechnicianId) {
        const assignedTechnician = await prisma.user.findUnique({
          where: { id: requestedTechnicianId },
          select: { role: true, active: true },
        });
        if (!assignedTechnician || assignedTechnician.role !== 'TECHNICIAN' || !assignedTechnician.active) {
          return NextResponse.json({ success: false, error: 'Selected technician is not active.' }, { status: 400 });
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'status')) {
      if (typeof updateData.status !== 'string' || !(VALID_JOB_STATUSES as readonly string[]).includes(updateData.status)) {
        return NextResponse.json({ success: false, error: 'Invalid job status' }, { status: 400 });
      }
      if (currentUser.role === 'DISPATCHER' && !(DISPATCHER_STATUSES as readonly string[]).includes(updateData.status)) {
        return NextResponse.json({ success: false, error: 'Dispatchers may only set operational job statuses' }, { status: 403 });
      }
    }

    for (const field of ['workerCommissionRate', 'workerCommission', 'travelFeeAmount']) {
      if (Object.prototype.hasOwnProperty.call(updateData, field)) {
        const value = Number(updateData[field]);
        if (!Number.isFinite(value) || value < 0) return NextResponse.json({ success: false, error: `Invalid ${field}` }, { status: 400 });
        updateData[field] = Math.round(value * 100) / 100;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'isAbandoned') && typeof updateData.isAbandoned !== 'boolean') {
      return NextResponse.json({ success: false, error: 'isAbandoned must be a boolean' }, { status: 400 });
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

    const updated = await prisma.job.update({
      where: { id: targetJob.id },
      data: updateData,
      include: {
        customer: true,
        technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
        invoice: true,
      },
    });

    return NextResponse.json({ success: true, job: updated });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: 'Unable to update job' }, { status: 500 });
  }
}
