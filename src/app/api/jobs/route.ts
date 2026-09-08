import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendSMS } from '@/lib/twilio';
import { sendEmail, buildJobDispatchedEmail } from '@/lib/resend';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const technicianId = searchParams.get('technicianId');

    const where: any = {};
    if (status) where.status = status;
    if (technicianId) where.technicianId = technicianId;

    const jobs = await prisma.job.findMany({
      where,
      include: {
        customer: true,
        dispatcher: { select: { id: true, name: true, phone: true } },
        technician: { select: { id: true, name: true, phone: true } },
        invoice: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, jobs });
  } catch (err: any) {
    console.error('Error fetching jobs:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message,
        code: err.code,
        meta: err.meta,
        clientVersion: err.clientVersion,
      },
      { status: 500 }
    );
  }
}


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      customerName,
      customerPhone,
      customerExtension,
      serviceAddress,
      serviceType,
      problemDescription,
      technicianId,
      dispatcherId,
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

    let assignedTechnician = null;
    if (technicianId) {
      assignedTechnician = await prisma.user.findUnique({
        where: { id: technicianId },
        select: { id: true, name: true, phone: true, email: true, role: true, active: true, commissionRate: true },
      });

      if (!assignedTechnician || assignedTechnician.role !== 'TECHNICIAN' || !assignedTechnician.active) {
        return NextResponse.json({ success: false, error: 'Selected technician is not active.' }, { status: 400 });
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

    // 2. Determine default dispatcher / creator (Owner or Dispatcher)
    let activeDispatcherId = dispatcherId;
    if (!activeDispatcherId) {
      const defaultUser = await prisma.user.findFirst({
        where: {
          role: { in: ['SUPER_ADMIN', 'OWNER', 'DISPATCHER'] },
          active: true,
        },
      });
      activeDispatcherId = defaultUser?.id;
    }

    // 3. Generate sequential Job Number
    const highestJob = await prisma.job.findFirst({
      orderBy: { jobNumber: 'desc' },
      select: { jobNumber: true },
    });
    const nextJobNumber = (highestJob?.jobNumber || 9815) + 1;

    // 4. Create the Job in NEW status awaiting technician acknowledgment
    const job = await prisma.job.create({
      data: {
        jobNumber: nextJobNumber,
        customerId: customer.id,
        dispatcherId: activeDispatcherId!,
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
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      },
      include: {
        customer: true,
        technician: true,
      },
    });

    // 5. If assigned to a technician, send the technician the job link.
    // The dispatcher-side assignment flow also sends the only customer SMS:
    // a simple "technician is on the way" notification.
    let smsResult = null;
    let customerSmsResult = null;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    if (job.technician?.phone) {
      const extStr = customer.extension ? ` #${customer.extension}` : '';
      const autoDetails = job.vehicleMake ? `\nVehicle: ${job.vehicleYear || ''} ${job.vehicleMake} ${job.vehicleModel || ''} (${job.keyType || 'Key'})` : '';
      const scheduleDetails = job.isScheduled && job.scheduledFor ? `\n📅 Scheduled: ${new Date(job.scheduledFor).toLocaleString()}` : '';
      const smsBody = `🚨 NEW JOB ASSIGNMENT #${job.jobNumber}${scheduleDetails}
Customer: ${customer.name} (${customer.phone}${extStr})
Address: ${serviceAddress}
Service: ${serviceType}${autoDetails}
Commission Rate: ${job.workerCommissionRate.toFixed(2)}%
Please open & acknowledge: ${appUrl}/tech/jobs/${job.jobNumber}`;

      smsResult = await sendSMS({
        to: job.technician.phone,
        body: smsBody,
      });

      customerSmsResult = await sendSMS({
        to: customer.phone,
        body: `Hello ${customer.name}, your locksmith technician ${job.technician.name} is on the way for Job #${job.jobNumber}.`,
      });

      // Send dispatch notification email via Resend if technician has email configured
      if (job.technician.email) {
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
      smsResult,
      customerSmsResult,
    });
  } catch (err: any) {
    console.error('Error creating job:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
