import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendSMS } from '@/lib/twilio';
import { findJobByIdOrNumber } from '@/lib/job-helper';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, sessionId } = body;

    if (!jobId) {
      return NextResponse.json({ success: false, error: 'Missing jobId' }, { status: 400 });
    }

    const job = await findJobByIdOrNumber(jobId);

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    // Update invoice to PAID
    const invoice = await prisma.invoice.update({
      where: { jobId: job.id },
      data: {
        paymentStatus: 'PAID',
        paymentMethod: 'STRIPE_CARD',
        stripeSessionId: sessionId || job.invoice?.stripeSessionId,
        paidAt: new Date(),
      },
    });

    // Update job to COMPLETED
    const updatedJob = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // Send confirmation SMS to customer
    if (job.customer?.phone) {
      const smsBody = `Payment Confirmed! Your card payment of $${invoice.grandTotal.toFixed(2)} for Locksmith Job #${job.jobNumber} was successful. Thank you for your business!`;
      await sendSMS({ to: job.customer.phone, body: smsBody });
    }

    // Notify technician that payment was received online
    if (job.technician?.phone) {
      const techSms = `✅ Job #${job.jobNumber} Payment Received! Customer paid $${invoice.grandTotal.toFixed(2)} via card. Job is closed.`;
      await sendSMS({ to: job.technician.phone, body: techSms });
    }

    return NextResponse.json({
      success: true,
      message: 'Payment completed successfully',
      job: updatedJob,
      invoice,
    });
  } catch (err: any) {
    console.error('Stripe webhook error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
