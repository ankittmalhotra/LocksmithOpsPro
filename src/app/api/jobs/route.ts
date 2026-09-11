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
import { findJobsWithDetails } from '@/lib/job-helper';

export async function GET(request: Request) {
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
    const jobs = rawJobs.map(normalizeManualJobInvoice);

    return NextResponse.json({ success: true, jobs });
  } catch (err: any) {
    console.error('Error fetching jobs:', err);
    const errorCode = typeof err?.code === 'string' ? ` (${err.code})` : '';
    return NextResponse.json({ success: false, error: `Unable to load jobs${errorCode}` }, { status: 500 });
  }
}


export async function POST(request: Request) {
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
    } = body;

    if (!customerName || !customerPhone || !serviceAddress || !serviceType) {
      return NextResponse.json(
        { success: false, error: 'Missing required customer or job information' },
        { status: 400 }
      );
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

    // 1. Find or create customer
    let customer = await prisma.customer.findFirst({
      where: { phone: customerPhone },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: customerName,
          phone: customerPhone,
          extension: customerExtension || null,
          address: serviceAddress,
        },
      });
    }

    // 2. Generate sequential Job Number
    const existingJobNumbers = await prisma.job.findMany({
      select: { jobNumber: true },
    });
    const generatedJobNumber = nextJobNumber(existingJobNumbers.map((job) => job.jobNumber));

    // 3. Create the Job in NEW status awaiting technician acknowledgment
    const job = await prisma.job.create({
      data: {
        jobNumber: generatedJobNumber,
        customerId: customer.id,
        // Dispatch ownership always comes from the authenticated session.
        dispatcherId: currentUser.id,
        technicianId: technicianId || null,
        status: 'NEW',
        serviceType,
        problemDescription: problemDescription || '',
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
      // Kept for clients that still expect these response keys.  No SMS is
      // sent by the server, and customer SMS is intentionally not prepared.
      smsResult: null,
      customerSmsResult: null,
    });
  } catch (err: any) {
    console.error('Error creating job:', err);
    return NextResponse.json({ success: false, error: 'Unable to create job' }, { status: 500 });
  }
}
