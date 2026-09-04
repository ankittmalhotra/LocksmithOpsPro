import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendSMS } from '@/lib/twilio';

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
      workerCommission,
      technicianId,
      dispatcherId,
    } = body;

    if (!customerName || !customerPhone || !serviceAddress || !serviceType) {
      return NextResponse.json(
        { success: false, error: 'Missing required customer or job information' },
        { status: 400 }
      );
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

    // 4. Create the Job
    const job = await prisma.job.create({
      data: {
        jobNumber: nextJobNumber,
        customerId: customer.id,
        dispatcherId: activeDispatcherId!,
        technicianId: technicianId || null,
        status: technicianId ? 'DISPATCHED' : 'NEW',
        serviceType,
        problemDescription: problemDescription || '',
        serviceAddress,
        workerCommission: parseFloat(workerCommission || '0') || 0,
        dispatchedAt: technicianId ? new Date() : null,
      },
      include: {
        customer: true,
        technician: true,
      },
    });

    // 5. If assigned to a technician, send Twilio SMS Dispatch notification
    let smsResult = null;
    if (job.technician?.phone) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const extStr = customer.extension ? ` #${customer.extension}` : '';
      const smsBody = `🚨 NEW JOB #${job.jobNumber}
Customer: ${customer.name} (${customer.phone}${extStr})
Address: ${serviceAddress}
Service: ${serviceType}
Notes: ${problemDescription || 'N/A'}
Commission: $${job.workerCommission.toFixed(2)}
Open Job: ${appUrl}/tech/jobs/${job.id}`;

      smsResult = await sendSMS({
        to: job.technician.phone,
        body: smsBody,
      });
    }

    return NextResponse.json({
      success: true,
      job,
      smsResult,
    });
  } catch (err: any) {
    console.error('Error creating job:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
