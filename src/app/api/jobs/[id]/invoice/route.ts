import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateForwardInvoice,
  calculateReverseInvoice,
  calculateJobSettlementPosition,
  roundToTwo,
  SupportedPaymentMethod,
} from '@/lib/calculations';
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

    // Customer card/Stripe payments are intentionally disabled for now.
    if (paymentMethod !== 'CASH' && paymentMethod !== 'INTERAC') {
      return NextResponse.json(
        { success: false, error: 'Only Cash and Interac payments are currently supported.' },
        { status: 400 }
      );
    }

    const isPaid = true;

    // 1. Calculate parts total
    const partsTotal = parts.reduce((sum: number, p: any) => {
      const price = parseFloat(p.unitPrice || '0') * (parseInt(p.quantity || '1', 10) || 1);
      return sum + price;
    }, 0);

    // 2. Perform forward or reverse calculation
    let calcBreakdown;
    if (calculationMode === 'REVERSE') {
      const received = parseFloat(amountReceived || '0');
      calcBreakdown = calculateReverseInvoice({
        amountReceived: received,
        partsTotal,
        paymentMethod: paymentMethod as SupportedPaymentMethod,
      });
    } else {
      const labor = parseFloat(laborAmount || '0');
      calcBreakdown = calculateForwardInvoice({
        laborAmount: labor,
        partsTotal,
        paymentMethod: paymentMethod as SupportedPaymentMethod,
      });
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

      for (const p of parts) {
        if (p.description && parseFloat(p.unitPrice || '0') > 0) {
          itemsToCreate.push({
            jobId: job.id,
            description: p.description,
            quantity: parseInt(p.quantity || '1', 10),
            unitPrice: parseFloat(p.unitPrice || '0'),
            unitCost: parseFloat(p.unitCost || '0'),
            isPart: true,
          });
        }
      }

      if (itemsToCreate.length > 0) {
        await tx.jobItem.createMany({ data: itemsToCreate });
      }

    // 5. Upsert Invoice. Stripe fields remain available for the future, but
    // are intentionally not populated while customer card payments are off.
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

      return { invoice, updatedJob };
    });

    if (!closeout) {
      return NextResponse.json(
        { success: false, error: 'Job was already closed or changed. Reload and try again.' },
        { status: 409 }
      );
    }

    const { invoice, updatedJob } = closeout;

    let dispatcherNotification = null;
    let dispatcherNotificationWarnings: string[] = [];
    if (!job.isManual) {
      const notification = tryBuildDispatcherNotificationDraft(job.dispatcher?.phone, {
        kind: 'COMPLETED',
        jobNumber: job.jobNumber,
        technicianName: updatedJob?.technician?.name || job.technician?.name,
        amountReceived: calcBreakdown.grandTotal,
        paymentMethod: paymentMethod === 'CASH' ? 'Cash' : 'Interac',
      });
      dispatcherNotification = notification.draft;
      dispatcherNotificationWarnings = notification.warnings;
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
      invoice,
      breakdown: calcBreakdown,
      settlement,
      stripeLink: null,
      dispatcherNotification,
      dispatcherNotificationWarnings,
    });
  } catch (err: any) {
    console.error('Invoice creation error:', err);
    return NextResponse.json({ success: false, error: 'Unable to complete invoice' }, { status: 500 });
  }
}
