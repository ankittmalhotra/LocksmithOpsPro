import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateTravelFee, calculateJobSettlementPosition } from '@/lib/calculations';
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
      reason = 'Customer canceled on site',
    } = body;

    const job = await findJobByIdOrNumber(id);

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    if (paymentMethod !== 'CASH' && paymentMethod !== 'INTERAC') {
      return NextResponse.json(
        { success: false, error: 'Only Cash and Interac payments are currently supported.' },
        { status: 400 }
      );
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
        smsSent: false,
        stripeSessionId: null,
        stripePaymentUrl: null,
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
        smsSent: false,
        stripeSessionId: null,
        stripePaymentUrl: null,
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
      stripeLink: null,
      smsResult: null,
    });
  } catch (err: any) {
    console.error('Abandon fee error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
