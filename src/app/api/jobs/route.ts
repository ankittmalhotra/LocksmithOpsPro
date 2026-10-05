import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail, buildJobDispatchedEmail } from '@/lib/resend';
import { getCurrentUser } from '@/lib/auth';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { nextJobNumber } from '@/lib/job-number';
import {
  buildTechnicianAssignmentDraft,
  normalizeNanpPhone,
} from '@/lib/sms-draft';
import { parseTorontoDateTime } from '@/lib/timezone';
import { findJobsWithDetails, toTechnicianJobPayload } from '@/lib/job-helper';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { getJobReceiptState } from '@/lib/job-receipt';
import { canonicalizePhone, isInboundCallForTrackedTarget, qualifiesAsOriginatingCall } from '@/lib/job-call-matching';
import { callFields } from '@/lib/job-call-match-service';
import { getCachedTargetNumbers } from '@/lib/ringcentral-call-cache';

async function handleGET(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    if (
      currentUser.role !== 'ADMIN' &&
      currentUser.role !== 'DISPATCHER' &&
      currentUser.role !== 'TECHNICIAN'
    ) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Invalid role' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const technicianId = searchParams.get('technicianId');

    const where: any = {};
    if (status) where.status = status;
    if (currentUser.role === 'TECHNICIAN') {
      if (technicianId && technicianId !== currentUser.id) {
        return NextResponse.json(
          { success: false, error: 'Technicians may only view their own jobs' },
          { status: 403 }
        );
      }
      where.technicianId = currentUser.id;
    } else if (technicianId) {
      where.technicianId = technicianId;
    }

    const rawJobs = await findJobsWithDetails({ where, orderBy: { createdAt: 'desc' } });
    const normalizedJobs = rawJobs.map(normalizeManualJobInvoice);
    const jobs = currentUser.role === 'TECHNICIAN'
      ? normalizedJobs.map(toTechnicianJobPayload)
      : normalizedJobs.map((job) => ({ ...job, receiptState: getJobReceiptState(job) }));

    return NextResponse.json({ success: true, jobs });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/jobs', err);
    const errorCode = typeof err?.code === 'string' ? ` (${err.code})` : '';
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, `Unable to load jobs${errorCode}`) }, { status: 500 });
  }
}


async function handlePOST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Dispatcher access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      customerName,
      customerPhone,
      customerExtension,
      serviceAddress,
      serviceType,
      problemDescription,
      technicianId,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      vehicleVin,
      keyType,
      fccId,
      isScheduled = false,
      scheduledFor,
      intakeMessage,
      originatingRingCentralCallId,
    } = body;

    if (intakeMessage !== undefined && (typeof intakeMessage !== 'string' || intakeMessage.length > 10_000)) {
      return NextResponse.json(
        { success: false, error: 'intakeMessage must be text no longer than 10,000 characters.' },
        { status: 400 }
      );
    }

    if (!customerName || !customerPhone || !serviceAddress || !serviceType) {
      return NextResponse.json(
        { success: false, error: 'Missing required customer or job information' },
        { status: 400 }
      );
    }
    if (originatingRingCentralCallId !== undefined && originatingRingCentralCallId !== null
      && (typeof originatingRingCentralCallId !== 'string' || !originatingRingCentralCallId.trim())) {
      return NextResponse.json({ success: false, error: 'originatingRingCentralCallId must be a call ID string.' }, { status: 400 });
    }

    if (typeof isScheduled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isScheduled must be a boolean.' },
        { status: 400 }
      );
    }
    if (isScheduled && !scheduledFor) {
      return NextResponse.json(
        { success: false, error: 'Scheduled jobs require a scheduled time.' },
        { status: 400 }
      );
    }
    const parsedScheduledFor = scheduledFor ? parseTorontoDateTime(scheduledFor) : null;
    if (scheduledFor && !parsedScheduledFor) {
      return NextResponse.json(
        { success: false, error: 'Invalid scheduled time.' },
        { status: 400 }
      );
    }

    let assignedTechnician = null;
    let assignedTechnicianPhone: string | null = null;
    if (technicianId) {
      assignedTechnician = await prisma.user.findUnique({
        where: { id: technicianId },
        select: { id: true, name: true, phone: true, email: true, role: true, active: true, commissionRate: true },
      });

      if (!assignedTechnician || assignedTechnician.role !== 'TECHNICIAN' || !assignedTechnician.active) {
        return NextResponse.json({ success: false, error: 'Selected technician is not active.' }, { status: 400 });
      }

      try {
        assignedTechnicianPhone = normalizeNanpPhone(assignedTechnician.phone);
      } catch {
        return NextResponse.json(
          { success: false, error: 'Selected technician has an invalid phone number for SMS.' },
          { status: 400 }
        );
      }
    }

    const normalizedCustomerPhone = canonicalizePhone(customerPhone);
    // A call link is best effort; its validation or a concurrent claim must
    // never roll back an otherwise valid job save.
    const { job, customer } = await prisma.$transaction(async (tx) => {
      let customer = await tx.customer.findFirst({ where: { phone: customerPhone } });
      if (!customer) {
        customer = await tx.customer.create({
          data: { name: customerName, phone: customerPhone, extension: customerExtension || null, address: serviceAddress },
        });
      }

      const existingJobNumbers = await tx.job.findMany({ select: { jobNumber: true } });
      const generatedJobNumber = nextJobNumber(existingJobNumbers.map((job) => job.jobNumber));
      const job = await tx.job.create({
        data: {
          jobNumber: generatedJobNumber,
          customerId: customer.id,
          dispatcherId: currentUser.id,
          technicianId: technicianId || null,
          status: 'NEW',
          serviceType,
          problemDescription: problemDescription || '',
          intakeMessage: typeof intakeMessage === 'string' ? intakeMessage : null,
          serviceAddress,
          workerCommissionRate: assignedTechnician?.commissionRate || 0,
          workerCommission: 0,
          vehicleYear: vehicleYear || null,
          vehicleMake: vehicleMake || null,
          vehicleModel: vehicleModel || null,
          vehicleVin: vehicleVin || null,
          keyType: keyType || null,
          fccId: fccId || null,
          isScheduled: !!isScheduled,
          scheduledFor: isScheduled ? parsedScheduledFor : null,
        },
        include: {
          customer: true,
          technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
        },
      });

      return { job, customer };
    });

    let callLinkWarning: string | null = null;
    if (originatingRingCentralCallId) {
      try {
        if (!normalizedCustomerPhone.ok) throw new Error('Customer phone is invalid or ambiguous.');
        const now = new Date();
        const [selectedCall, targetNumbers] = await Promise.all([
          prisma.ringCentralCallLog.findFirst({
            where: {
              id: originatingRingCentralCallId,
              direction: { equals: 'Inbound', mode: 'insensitive' },
              startTime: { gte: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), lte: now },
            },
            select: {
              id: true, direction: true, result: true, reason: true, type: true, durationSeconds: true, durationMs: true,
              startTime: true, isVoicemail: true, voicemailMessageId: true, callerPhoneNumber: true, destinationPhoneNumber: true,
            },
          }),
          getCachedTargetNumbers(),
        ]);
        if (!selectedCall) throw new Error('The selected call is no longer available in the last 3 days.');
        const callRecord = callFields(selectedCall);
        const callerPhone = canonicalizePhone(callRecord.callerPhoneNumber);
        if (!callerPhone.ok || normalizedCustomerPhone.value !== callerPhone.value) throw new Error('The selected call phone no longer matches this customer.');
        if (!isInboundCallForTrackedTarget(callRecord, targetNumbers.map((target) => target.phoneNumber))) throw new Error('The call was not received by a configured RingCentral business number.');
        let callbacks: ReturnType<typeof callFields>[] = [];
        if (!qualifiesAsOriginatingCall(callRecord, [])) {
          const rows = await prisma.ringCentralCallLog.findMany({
            where: { direction: { equals: 'Outbound', mode: 'insensitive' }, startTime: { gt: selectedCall.startTime || new Date(0), lte: now } },
            orderBy: { startTime: 'asc' }, take: 2000,
            select: {
              id: true, direction: true, result: true, reason: true, type: true, durationSeconds: true, durationMs: true,
              startTime: true, isVoicemail: true, voicemailMessageId: true, callerPhoneNumber: true, destinationPhoneNumber: true,
            },
          });
          if (rows.length === 2000) throw new Error('Callback search reached its safety limit.');
          callbacks = rows.map(callFields);
        }
        if (!qualifiesAsOriginatingCall(callRecord, callbacks)) throw new Error('The selected call no longer meets inbound qualification rules.');
        await prisma.$transaction(async (tx) => {
          const duplicate = await tx.jobCallMatch.findFirst({
            where: { ringCentralCallLogId: selectedCall.id, status: 'CONFIRMED', role: 'ORIGINATING_INBOUND' },
            select: { id: true },
          });
          if (duplicate) throw new Error('The selected call is already linked to another job.');
          await tx.jobCallMatch.create({ data: {
            jobId: job.id, ringCentralCallLogId: selectedCall.id, status: 'CONFIRMED', method: 'MANUAL', role: 'ORIGINATING_INBOUND',
            candidatePhoneCanonical: normalizedCustomerPhone.value,
            rationale: 'Dispatcher explicitly selected this recent candidate during intake; inbound destination, qualification and exact phone were revalidated.',
            reviewedById: currentUser.id, reviewedByName: currentUser.name, reviewedByRole: currentUser.role, reviewedAt: now,
          } });
        });
      } catch (error: any) {
        console.warn('Job saved without originating call link:', error);
        callLinkWarning = error?.code === 'P2002'
          ? 'Job saved. Another job linked that call at the same time, so this job was saved without a call link.'
          : `Job saved without a call link: ${error instanceof Error ? error.message : 'call link validation failed'}`;
      }
    }

    // 5. If assigned to a technician, prepare a device-SMS draft.  The
    // dispatcher must review and send it from the native Messages app.
    let smsDraft = null;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (job.technician?.phone && assignedTechnicianPhone) {
      smsDraft = buildTechnicianAssignmentDraft(assignedTechnicianPhone, {
        jobNumber: job.jobNumber,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerExtension: customer.extension,
        serviceAddress,
        serviceType,
        problemDescription: problemDescription || undefined,
        vehicleYear,
        vehicleMake,
        vehicleModel,
        keyType,
        isScheduled: job.isScheduled,
        scheduledFor: job.scheduledFor,
        technicianName: job.technician.name,
        appUrl,
      });

      // Send dispatch notification email via Resend if technician has email configured
      if (job.technician.email && appUrl && smsDraft.warnings.length === 0) {
        try {
          const emailData = buildJobDispatchedEmail({
            technicianName: job.technician.name,
            jobNumber: job.jobNumber,
            customerName: customer.name,
            customerPhone: customer.phone,
            customerExtension: customer.extension || undefined,
            serviceAddress,
            serviceType,
            commissionRate: job.workerCommissionRate,
            problemDescription: problemDescription || undefined,
            appUrl,
          });

          await sendEmail({
            to: job.technician.email,
            subject: emailData.subject,
            html: emailData.html,
          });
        } catch (emailErr) {
          console.error('Failed to send dispatch email:', emailErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      job,
      smsDraft,
      smsDraftWarnings: smsDraft?.warnings || [],
      callLinkWarning,
      // Kept for clients that still expect these response keys.  No SMS is
      // sent by the server, and customer SMS is intentionally not prepared.
      smsResult: null,
      customerSmsResult: null,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/jobs', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to create job') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/jobs', handleGET);
export const POST = withRequestLogging('/api/jobs', handlePOST);
