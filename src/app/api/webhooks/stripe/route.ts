import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendSMS } from '@/lib/twilio';
import { sendEmail, buildInvoiceReceiptEmail } from '@/lib/resend';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    let jobId: string | null = null;
    let sessionId: string | null = null;

    const signature = request.headers.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // 1. If real Stripe signature is provided and secret is configured, verify signature
    if (signature && webhookSecret) {
      const parts = signature.split(',').reduce((acc: any, part) => {
        const [k, v] = part.split('=');
        acc[k] = v;
        return acc;
      }, {});

      const timestamp = parts.t;
      const expectedSig = parts.v1;
      const signedPayload = `${timestamp}.${rawBody}`;
      const computedSig = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');

      if (computedSig !== expectedSig) {
        return NextResponse.json({ success: false, error: 'Invalid Stripe signature' }, { status: 400 });
      }

      const event = JSON.parse(rawBody);
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        jobId = session.metadata?.jobId || session.client_reference_id;
        sessionId = session.id;
      } else {
        return NextResponse.json({ success: true, message: `Ignored event: ${event.type}` });
      }
    } else {
      // 2. Interactive simulator / local fallback mode
      try {
        const json = JSON.parse(rawBody);
        jobId = json.jobId;
        sessionId = json.sessionId;
      } catch {
        return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
      }
    }

    if (!jobId) {
      return NextResponse.json({ success: false, error: 'Missing jobId in payment notification' }, { status: 400 });
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
      include: {
        customer: true,
        technician: true,
      },
    });

    // Send confirmation SMS to customer
    if (job.customer?.phone) {
      const smsBody = `Payment Confirmed! Your card payment of $${invoice.grandTotal.toFixed(2)} for Locksmith Job #${job.jobNumber} was successful. Thank you for choosing LockOps!`;
      await sendSMS({ to: job.customer.phone, body: smsBody });

      // Google Review Booster SMS
      const googleReviewUrl = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/locksmith-toronto/review';
      const reviewSms = `Hi ${job.customer.name}, thank you for choosing LockOps! If you were satisfied with ${job.technician?.name || 'our technician'}'s service, please take 15 seconds to leave us a Google review: ${googleReviewUrl}`;
      await sendSMS({ to: job.customer.phone, body: reviewSms });
    }

    // Send payment receipt email via Resend if customer email is available
    if ((job.customer as any)?.email) {
      try {
        const emailData = buildInvoiceReceiptEmail({
          customerName: job.customer.name,
          jobNumber: job.jobNumber,
          serviceType: job.serviceType,
          subtotal: invoice.subtotal,
          taxAmount: invoice.taxAmount,
          grandTotal: invoice.grandTotal,
          paymentMethod: 'STRIPE_CARD',
          paymentStatus: 'PAID',
          technicianName: job.technician?.name,
        });

        await sendEmail({
          to: (job.customer as any).email,
          subject: emailData.subject,
          html: emailData.html,
        });
      } catch (emailErr) {
        console.error('Failed to send receipt email via Resend in webhook:', emailErr);
      }
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
