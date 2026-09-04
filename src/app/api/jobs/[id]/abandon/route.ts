import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateTravelFee, calculateJobSettlementPosition } from '@/lib/calculations';
import { createStripePaymentLink } from '@/lib/stripe';
import { sendSMS } from '@/lib/twilio';
import { findJobByIdOrNumber } from '@/lib/job-helper';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      travelFeeAmount = 25,
      paymentMethod = 'CASH',
      sendSms = false,
      reason = 'Customer canceled on site',
    } = body;

    const job = await findJobByIdOrNumber(id);

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const fee = parseFloat(travelFeeAmount) || 25;
    const breakdown = calculateTravelFee({
      travelFeeAmount: fee,
      paymentMethod,
    });

    const settlement = calculateJobSettlementPosition({
      paymentMethod,
      grandTotal: breakdown.grandTotal,
      workerCommission: job.workerCommission,
    });

    let stripeLink = null;
    let stripeSessionId = null;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    if (paymentMethod === 'STRIPE_CARD') {
      const stripeRes = await createStripePaymentLink({
        jobId: job.id,
        jobNumber: job.jobNumber,
        customerName: job.customer.name,
        customerPhone: job.customer.phone,
        grandTotal: breakdown.grandTotal,
        subtotal: breakdown.subtotal,
        taxAmount: breakdown.taxAmount,
        cardSurchargeAmount: breakdown.cardSurchargeAmount,
        returnUrl: `${appUrl}/pay/${job.jobNumber}`,
      });
      stripeLink = stripeRes.paymentUrl;
      stripeSessionId = stripeRes.sessionId;
    }

    let smsResult = null;
    if (sendSms && job.customer?.phone) {
      if (paymentMethod === 'STRIPE_CARD' && stripeLink) {
        const fullUrl = stripeLink.startsWith('http') ? stripeLink : `${appUrl}${stripeLink}`;
        const smsBody = `Hello ${job.customer.name}, service call/travel fee for Job #${job.jobNumber} is $${breakdown.grandTotal.toFixed(2)}.
Please complete payment securely here: ${fullUrl}`;
        smsResult = await sendSMS({ to: job.customer.phone, body: smsBody });
      } else {
        const smsBody = `Receipt: $${breakdown.grandTotal.toFixed(2)} received for Locksmith travel/service fee (Job #${job.jobNumber}). Thank you!`;
        smsResult = await sendSMS({ to: job.customer.phone, body: smsBody });
      }
    }

    const isPaid = paymentMethod === 'CASH' || paymentMethod === 'INTERAC';
    await prisma.invoice.upsert({
      where: { jobId: job.id },
      create: {
        jobId: job.id,
        calculationMode: 'FORWARD',
        subtotal: breakdown.subtotal,
        partsTotal: 0,
        laborTotal: breakdown.laborTotal,
        taxRate: breakdown.taxRate,
        taxAmount: breakdown.taxAmount,
        cardSurchargeRate: breakdown.cardSurchargeRate,
        cardSurchargeAmount: breakdown.cardSurchargeAmount,
        grandTotal: breakdown.grandTotal,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        paymentMethod,
        cashOwedToCompany: settlement.cashOwedToCompany,
        smsSent: sendSms,
        stripeSessionId,
        stripePaymentUrl: stripeLink,
        paidAt: isPaid ? new Date() : null,
      },
      update: {
        calculationMode: 'FORWARD',
        subtotal: breakdown.subtotal,
        partsTotal: 0,
        laborTotal: breakdown.laborTotal,
        taxRate: breakdown.taxRate,
        taxAmount: breakdown.taxAmount,
        cardSurchargeRate: breakdown.cardSurchargeRate,
        cardSurchargeAmount: breakdown.cardSurchargeAmount,
        grandTotal: breakdown.grandTotal,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        paymentMethod,
        cashOwedToCompany: settlement.cashOwedToCompany,
        smsSent: sendSms,
        stripeSessionId,
        stripePaymentUrl: stripeLink,
        paidAt: isPaid ? new Date() : null,
      },
    });

    const updatedJob = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'ABANDONED_TRAVEL_FEE',
        isAbandoned: true,
        travelFeeAmount: fee,
        problemDescription: `${job.problemDescription}\n[ABANDONED/TRAVEL CHARGE]: ${reason}`,
        completedAt: new Date(),
      },
      include: {
        customer: true,
        technician: true,
        invoice: true,
      },
    });

    return NextResponse.json({
      success: true,
      job: updatedJob,
      breakdown,
      settlement,
      stripeLink,
      smsResult,
    });
  } catch (err: any) {
    console.error('Abandon fee error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
