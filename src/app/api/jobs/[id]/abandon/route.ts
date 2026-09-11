import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateTravelFee, calculateJobSettlementPosition, roundToTwo, SUPPORTED_CLOSEOUT_PAYMENT_METHODS, SupportedPaymentMethod } from '@/lib/calculations';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { getCurrentUser } from '@/lib/auth';
import { tryBuildDispatcherNotificationDraft } from '@/lib/sms-draft';
import {
  buildJobCloseoutClaimWhere,
  canMutateJob,
  isOpenJobStatus,
} from '@/lib/job-workflow';
import { sendRevenueChangeEmail } from '@/lib/revenue-email';

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

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER' && currentUser.role !== 'TECHNICIAN') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Dispatcher, admin, or assigned technician access required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid abandonment request' }, { status: 400 });
    }
    const {
      travelFeeAmount = 25,
      paymentMethod = 'CASH',
      reason = 'Customer canceled on site',
    } = body;
    if (typeof reason !== 'string' || reason.trim().length > 500) {
      return NextResponse.json({ success: false, error: 'Abandonment reason is invalid.' }, { status: 400 });
    }

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

    // Card processing is not integrated with this portal yet. Do not mark a
    // card travel-fee payment as PAID without a processor confirmation.
    if (!(SUPPORTED_CLOSEOUT_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      return NextResponse.json(
        { success: false, error: 'Card payments are not available until payment processing is integrated. Use Cash or Interac.' },
        { status: 400 }
      );
    }

    const fee = Number(travelFeeAmount);
    if (!Number.isFinite(fee) || fee <= 0 || fee > 10000) {
      return NextResponse.json({ success: false, error: 'Travel fee must be greater than zero.' }, { status: 400 });
    }
    const breakdown = calculateTravelFee({
      travelFeeAmount: fee,
      paymentMethod: paymentMethod as SupportedPaymentMethod,
    });

    const workerCommission = roundToTwo(
      breakdown.grandTotal * (job.workerCommissionRate / 100)
    );

    const settlement = calculateJobSettlementPosition({
      paymentMethod: paymentMethod as SupportedPaymentMethod,
      grandTotal: breakdown.grandTotal,
      workerCommission,
    });

    const isPaid = true;

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
          problemDescription: `${claimedJob.problemDescription}\n[ABANDONED/TRAVEL CHARGE]: ${reason.trim()}`,
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
        totalAmountCollected: breakdown.grandTotal,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        paymentMethod: paymentMethod as 'CASH' | 'INTERAC',
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
        totalAmountCollected: breakdown.grandTotal,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        paymentMethod: paymentMethod as 'CASH' | 'INTERAC',
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

    const revenueEmail = updatedJob?.invoice
      ? await sendRevenueChangeEmail(updatedJob, 'ABANDONED')
      : null;

    let dispatcherNotification = null;
    let dispatcherNotificationWarnings: string[] = [];
    if (!job.isManual) {
      const notification = tryBuildDispatcherNotificationDraft(job.dispatcher?.phone, {
        kind: 'ABANDONED',
        jobNumber: job.jobNumber,
        technicianName: updatedJob?.technician?.name || job.technician?.name,
        amountReceived: breakdown.grandTotal,
        paymentMethod: paymentMethod.replace('_', ' '),
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
      revenueEmail: revenueEmail ? { success: revenueEmail.success, error: revenueEmail.error } : null,
    });
  } catch (err: any) {
    console.error('Abandon fee error:', err);
    return NextResponse.json({ success: false, error: 'Unable to abandon job' }, { status: 500 });
  }
}
