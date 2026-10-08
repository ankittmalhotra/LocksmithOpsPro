import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateForwardInvoice,
  calculateReverseInvoice,
  calculateJobSettlementPosition,
  roundToTwo,
  SUPPORTED_CLOSEOUT_PAYMENT_METHODS,
  SupportedPaymentMethod,
} from '@/lib/calculations';
import { findJobByIdOrNumber, toTechnicianJobPayload } from '@/lib/job-helper';
import { getCurrentUser } from '@/lib/auth';
import { tryBuildDispatcherNotificationDraft } from '@/lib/sms-draft';
import {
  buildJobCloseoutClaimWhere,
  canMutateJob,
  isOpenJobStatus,
} from '@/lib/job-workflow';
import { sendRevenueChangeEmail } from '@/lib/revenue-email';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { refreshUnissuedPartnerBillingSnapshots } from '@/lib/partner-billing-snapshot-refresh';

function parseCloseoutNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function handlePOST(
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
      return NextResponse.json({ success: false, error: 'Invalid closeout request' }, { status: 400 });
    }

    const {
      calculationMode = 'FORWARD',
      amountReceived,
      laborAmount,
      parts = [],
      paymentMethod = 'CASH',
      keyBitting,
      doorDetails,
      preWorkSignature,
      customerSignature,
      proofPhotoUrl,
    } = body;

    if (calculationMode !== 'FORWARD' && calculationMode !== 'REVERSE') {
      return NextResponse.json({ success: false, error: 'Invalid calculation mode.' }, { status: 400 });
    }
    if (!Array.isArray(parts)) {
      return NextResponse.json({ success: false, error: 'Parts must be an array.' }, { status: 400 });
    }

    if (parts.length > 100) {
      return NextResponse.json({ success: false, error: 'A closeout may contain at most 100 parts.' }, { status: 400 });
    }

    const normalizedParts: Array<{ description: string; quantity: number; unitPrice: number; unitCost: number }> = [];
    for (const part of parts) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        return NextResponse.json({ success: false, error: 'Each part must be an object.' }, { status: 400 });
      }
      const description = typeof part.description === 'string' ? part.description.trim() : '';
      const quantity = part.quantity === undefined || part.quantity === null
        ? 1
        : parseCloseoutNumber(part.quantity);
      const unitPrice = parseCloseoutNumber(part.unitPrice);
      const unitCost = part.unitCost === undefined || part.unitCost === null || part.unitCost === ''
        ? 0
        : parseCloseoutNumber(part.unitCost);
      if (!description || quantity === null || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        return NextResponse.json({ success: false, error: 'Each part needs a description and quantity from 1 to 1000.' }, { status: 400 });
      }
      if (unitPrice === null || unitPrice < 0 || unitPrice > 1_000_000) {
        return NextResponse.json({ success: false, error: 'Each part price must be a finite non-negative amount.' }, { status: 400 });
      }
      if (unitCost === null || unitCost < 0 || unitCost > 1_000_000) {
        return NextResponse.json({ success: false, error: 'Each part cost must be a finite non-negative amount.' }, { status: 400 });
      }
      normalizedParts.push({ description, quantity, unitPrice, unitCost });
    }

    const receivedAmount = amountReceived === undefined || amountReceived === null
      ? 0
      : parseCloseoutNumber(amountReceived);
    const labor = laborAmount === undefined || laborAmount === null
      ? 0
      : parseCloseoutNumber(laborAmount);
    if (receivedAmount === null || receivedAmount < 0 || receivedAmount > 1_000_000) {
      return NextResponse.json({ success: false, error: 'Amount received must be a finite non-negative amount.' }, { status: 400 });
    }
    if (labor === null || labor < 0 || labor > 1_000_000) {
      return NextResponse.json({ success: false, error: 'Labor amount must be a finite non-negative amount.' }, { status: 400 });
    }

    const job = await findJobByIdOrNumber(id);

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    if (currentUser.role === 'TECHNICIAN' && job.technicianId !== currentUser.id) {
      return NextResponse.json(
        { success: false, error: 'Technicians may only invoice their own jobs' },
        { status: 403 }
      );
    }

    if (!canMutateJob(job.status) || !isOpenJobStatus(job.status)) {
      return NextResponse.json(
        { success: false, error: 'Closed jobs cannot be invoiced again' },
        { status: 409 }
      );
    }

    // Card processing is not integrated with this portal yet. Do not mark a
    // card payment as PAID without a processor confirmation/reference.
    if (!(SUPPORTED_CLOSEOUT_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      return NextResponse.json(
        { success: false, error: 'Card payments are not available until payment processing is integrated. Use Cash or Interac.' },
        { status: 400 }
      );
    }

    const isPaid = true;

    // 1. Calculate parts total
    const partsTotal = normalizedParts.reduce((sum, part) => {
      return sum + part.unitPrice * part.quantity;
    }, 0);
    if (!Number.isFinite(partsTotal) || partsTotal > 1_000_000) {
      return NextResponse.json({ success: false, error: 'Parts total is outside the allowed range.' }, { status: 400 });
    }

    // 2. Perform forward or reverse calculation
    let calcBreakdown;
    if (calculationMode === 'REVERSE') {
      calcBreakdown = calculateReverseInvoice({
        amountReceived: receivedAmount,
        partsTotal,
        paymentMethod: paymentMethod as SupportedPaymentMethod,
      });
    } else {
      calcBreakdown = calculateForwardInvoice({
        laborAmount: labor,
        partsTotal,
        paymentMethod: paymentMethod as SupportedPaymentMethod,
      });
    }

    if (!Number.isFinite(calcBreakdown.grandTotal) || calcBreakdown.grandTotal <= 0) {
      return NextResponse.json({ success: false, error: 'Closeout total must be greater than zero.' }, { status: 400 });
    }
    if (calculationMode === 'REVERSE' && calcBreakdown.partsTotal > calcBreakdown.subtotal) {
      return NextResponse.json(
        { success: false, error: 'Parts total cannot exceed the collected amount before tax.' },
        { status: 400 }
      );
    }

    // 3. Calculate the technician's percentage commission from the final job total.
    const workerCommission = roundToTwo(
      calcBreakdown.grandTotal * (job.workerCommissionRate / 100)
    );

    // 4. Compute cash ledger settlement position
    const settlement = calculateJobSettlementPosition({
      paymentMethod: paymentMethod as SupportedPaymentMethod,
      grandTotal: calcBreakdown.grandTotal,
      workerCommission,
    });

    // The conditional claim makes closeout idempotent and prevents two
    // concurrent requests (invoice vs. abandon, or double-clicks) from both
    // rewriting the invoice/items. All writes remain in one transaction so a
    // failed item or invoice write cannot leave a partially closed job.
    const closeout = await prisma.$transaction(async (tx) => {
      const claimed = await tx.job.updateMany({
        where: buildJobCloseoutClaimWhere(job),
        data: {
          status: 'COMPLETED',
          workerCommission,
          completedAt: new Date(),
        },
      });
      if (claimed.count !== 1) return null;

      // The initial read is used only to build the optimistic claim. Read the
      // claimed row again before merging optional completion details so a
      // concurrent dispatcher edit cannot be overwritten by stale fallback
      // values from the request's original snapshot.
      const claimedJob = await tx.job.findUnique({ where: { id: job.id } });
      if (!claimedJob) return null;

      await tx.job.update({
        where: { id: job.id },
        data: {
          keyBitting: keyBitting !== undefined ? keyBitting : claimedJob.keyBitting,
          doorDetails: doorDetails !== undefined ? doorDetails : claimedJob.doorDetails,
          preWorkSignature: preWorkSignature !== undefined ? preWorkSignature : claimedJob.preWorkSignature,
          customerSignature: customerSignature !== undefined ? customerSignature : claimedJob.customerSignature,
          proofPhotoUrl: proofPhotoUrl !== undefined ? proofPhotoUrl : claimedJob.proofPhotoUrl,
        },
      });

      // 7. Persist Job Items
      await tx.jobItem.deleteMany({ where: { jobId: job.id } });
      const itemsToCreate = [];

      if (calcBreakdown.laborTotal > 0) {
        itemsToCreate.push({
          jobId: job.id,
          description: 'Locksmith Service / Labor',
          quantity: 1,
          unitPrice: calcBreakdown.laborTotal,
          unitCost: 0,
          isPart: false,
        });
      }

      for (const p of normalizedParts) {
        if (p.description && p.unitPrice > 0) {
          itemsToCreate.push({
            jobId: job.id,
            description: p.description,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
            unitCost: p.unitCost,
            isPart: true,
          });
        }
      }

      if (itemsToCreate.length > 0) {
        await tx.jobItem.createMany({ data: itemsToCreate });
      }

    // 5. Upsert Invoice. Only payment methods with an in-portal closeout
    // contract are accepted until a processor reference is persisted.
      const dbPaymentMethod = paymentMethod as 'CASH' | 'INTERAC';
      const invoice = await tx.invoice.upsert({
      where: { jobId: job.id },
      create: {
        jobId: job.id,
        calculationMode,
        subtotal: calcBreakdown.subtotal,
        partsTotal: calcBreakdown.partsTotal,
        laborTotal: calcBreakdown.laborTotal,
        taxRate: calcBreakdown.taxRate,
        taxAmount: calcBreakdown.taxAmount,
        cardSurchargeRate: calcBreakdown.cardSurchargeRate,
        cardSurchargeAmount: calcBreakdown.cardSurchargeAmount,
        grandTotal: calcBreakdown.grandTotal,
        totalAmountCollected: calcBreakdown.grandTotal,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        paymentMethod: dbPaymentMethod,
        cashOwedToCompany: settlement.cashOwedToCompany,
        smsSent: false,
        stripeSessionId: null,
        stripePaymentUrl: null,
        paidAt: isPaid ? new Date() : null,
      },
      update: {
        calculationMode,
        subtotal: calcBreakdown.subtotal,
        partsTotal: calcBreakdown.partsTotal,
        laborTotal: calcBreakdown.laborTotal,
        taxRate: calcBreakdown.taxRate,
        taxAmount: calcBreakdown.taxAmount,
        cardSurchargeRate: calcBreakdown.cardSurchargeRate,
        cardSurchargeAmount: calcBreakdown.cardSurchargeAmount,
        grandTotal: calcBreakdown.grandTotal,
        totalAmountCollected: calcBreakdown.grandTotal,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        paymentMethod: dbPaymentMethod,
        cashOwedToCompany: settlement.cashOwedToCompany,
        smsSent: false,
        stripeSessionId: null,
        stripePaymentUrl: null,
        paidAt: isPaid ? new Date() : null,
      },
    });

      // The claim above owns the terminal transition; fetch the complete
      // response shape after all dependent writes have succeeded.
      const updatedJob = await tx.job.findUnique({
        where: { id: job.id },
        include: {
          customer: true,
          technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
          invoice: true,
          items: true,
        },
      });

      await refreshUnissuedPartnerBillingSnapshots(tx, currentUser.id, 'JOB_CLOSEOUT');

      return { invoice, updatedJob };
    });

    if (!closeout) {
      return NextResponse.json(
        { success: false, error: 'Job was already closed or changed. Reload and try again.' },
        { status: 409 }
      );
    }

    const { invoice, updatedJob } = closeout;
    const responseJob = currentUser.role === 'TECHNICIAN' && updatedJob
      ? toTechnicianJobPayload(updatedJob)
      : updatedJob;

    const revenueEmail = updatedJob?.invoice
      ? await sendRevenueChangeEmail(updatedJob, 'COMPLETED')
      : null;

    let dispatcherNotification = null;
    let dispatcherNotificationWarnings: string[] = [];
    if (!job.isManual) {
      const notification = tryBuildDispatcherNotificationDraft(job.dispatcher?.phone, {
        kind: 'COMPLETED',
        jobNumber: job.jobNumber,
        technicianName: updatedJob?.technician?.name || job.technician?.name,
        amountReceived: calcBreakdown.grandTotal,
        paymentMethod: paymentMethod.replace('_', ' '),
      });
      dispatcherNotification = notification.draft;
      dispatcherNotificationWarnings = notification.warnings;
    }

    return NextResponse.json({
      success: true,
      job: responseJob,
      invoice,
      breakdown: calcBreakdown,
      settlement,
      stripeLink: null,
      dispatcherNotification,
      dispatcherNotificationWarnings,
      revenueEmail: revenueEmail ? { success: revenueEmail.success, error: revenueEmail.error } : null,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/jobs/[id]/invoice', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to complete invoice') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/jobs/[id]/invoice', handlePOST);
