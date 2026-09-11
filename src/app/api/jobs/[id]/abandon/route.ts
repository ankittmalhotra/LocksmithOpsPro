import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateTravelFee, calculateJobSettlementPosition, roundToTwo } from '@/lib/calculations';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { getCurrentUser } from '@/lib/auth';
import { tryBuildDispatcherNotificationDraft } from '@/lib/sms-draft';
import {
  buildJobCloseoutClaimWhere,
  canMutateJob,
  isOpenJobStatus,
} from '@/lib/job-workflow';

export async function POST(
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

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'TECHNICIAN') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin or assigned technician access required' },
        { status: 403 }
      );
    }

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

    if (currentUser.role === 'TECHNICIAN' && job.technicianId !== currentUser.id) {
      return NextResponse.json(
        { success: false, error: 'Technicians may only abandon their own jobs' },
        { status: 403 }
      );
    }

    if (!canMutateJob(job.status) || !isOpenJobStatus(job.status)) {
      return NextResponse.json(
        { success: false, error: 'Closed jobs cannot be abandoned again' },
        { status: 409 }
      );
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

    const workerCommission = roundToTwo(
      breakdown.grandTotal * (job.workerCommissionRate / 100)
    );

    const settlement = calculateJobSettlementPosition({
      paymentMethod,
      grandTotal: breakdown.grandTotal,
      workerCommission,
    });

    const isPaid = paymentMethod === 'CASH' || paymentMethod === 'INTERAC';

    // Claim the open job and persist the invoice/closeout atomically. The
    // conditional status/rate predicate makes concurrent closeout requests
    // race-safe and prevents a second request from rewriting settled data.
    const closeout = await prisma.$transaction(async (tx) => {
      const claimed = await tx.job.updateMany({
        where: buildJobCloseoutClaimWhere(job),
        data: {
          status: 'ABANDONED_TRAVEL_FEE',
          isAbandoned: true,
          workerCommission,
          travelFeeAmount: fee,
          completedAt: new Date(),
        },
      });
      if (claimed.count !== 1) return null;

      // Merge the abandonment note with the row claimed in this transaction,
      // not the request's initial snapshot, so a concurrent dispatcher edit
      // is preserved.
      const claimedJob = await tx.job.findUnique({
        where: { id: job.id },
        select: { problemDescription: true },
      });
      if (!claimedJob) return null;

      await tx.job.update({
        where: { id: job.id },
        data: {
          problemDescription: `${claimedJob.problemDescription}\n[ABANDONED/TRAVEL CHARGE]: ${reason}`,
        },
      });

      const invoice = await tx.invoice.upsert({
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

      const updatedJob = await tx.job.findUnique({
        where: { id: job.id },
        include: {
          customer: true,
          technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
          invoice: true,
        },
      });

      return { invoice, updatedJob };
    });

    if (!closeout) {
      return NextResponse.json(
        { success: false, error: 'Job was already closed or changed. Reload and try again.' },
        { status: 409 }
      );
    }

    const { updatedJob } = closeout;

    let dispatcherNotification = null;
    let dispatcherNotificationWarnings: string[] = [];
    if (!job.isManual) {
      const notification = tryBuildDispatcherNotificationDraft(job.dispatcher?.phone, {
        kind: 'ABANDONED',
        jobNumber: job.jobNumber,
        technicianName: updatedJob?.technician?.name || job.technician?.name,
        amountReceived: breakdown.grandTotal,
        paymentMethod: paymentMethod === 'CASH' ? 'Cash' : 'Interac',
      });
      dispatcherNotification = notification.draft;
      dispatcherNotificationWarnings = notification.warnings;
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
      breakdown,
      settlement,
      stripeLink: null,
      smsResult: null,
      dispatcherNotification,
      dispatcherNotificationWarnings,
    });
  } catch (err: any) {
    console.error('Abandon fee error:', err);
    return NextResponse.json({ success: false, error: 'Unable to abandon job' }, { status: 500 });
  }
}
