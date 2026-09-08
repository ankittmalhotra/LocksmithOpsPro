import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendSMS } from '@/lib/twilio';
import { sendEmail, buildJobDispatchedEmail } from '@/lib/resend';
import { getCurrentUser } from '@/lib/auth';

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
    return NextResponse.json({ success: false, error: 'Unable to load jobs' }, { status: 500 });
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

    // 2. Generate sequential Job Number
    const highestJob = await prisma.job.findFirst({
      orderBy: { jobNumber: 'desc' },
      select: { jobNumber: true },
    });
    const nextJobNumber = (highestJob?.jobNumber || 9815) + 1;

    // 3. Create the Job in NEW status awaiting technician acknowledgment
    const job = await prisma.job.create({
      data: {
        jobNumber: nextJobNumber,
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
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      },
      include: {
        customer: true,
        technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
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
    return NextResponse.json({ success: false, error: 'Unable to create job' }, { status: 500 });
  }
}
