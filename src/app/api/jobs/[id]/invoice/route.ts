import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateForwardInvoice,
  calculateReverseInvoice,
  calculateJobSettlementPosition,
  roundToTwo,
  SupportedPaymentMethod,
} from '@/lib/calculations';
import { sendSMS } from '@/lib/twilio';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { getCurrentUser } from '@/lib/auth';

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

    // 7. Persist Job Items
    await prisma.jobItem.deleteMany({ where: { jobId: job.id } });
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
      await prisma.jobItem.createMany({ data: itemsToCreate });
    }

    // 5. Upsert Invoice. Stripe fields remain available for the future, but
    // are intentionally not populated while customer card payments are off.
    const dbPaymentMethod = paymentMethod as 'CASH' | 'INTERAC';
    const invoice = await prisma.invoice.upsert({
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

    // 6. Update Job Status
    const newStatus = isPaid ? 'COMPLETED' : 'INVOICED';
    const updatedJob = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: newStatus,
        workerCommission,
        keyBitting: keyBitting !== undefined ? keyBitting : job.keyBitting,
        doorDetails: doorDetails !== undefined ? doorDetails : job.doorDetails,
        preWorkSignature: preWorkSignature !== undefined ? preWorkSignature : (job as any).preWorkSignature,
        customerSignature: customerSignature !== undefined ? customerSignature : job.customerSignature,
        proofPhotoUrl: proofPhotoUrl !== undefined ? proofPhotoUrl : job.proofPhotoUrl,
        ...(isPaid ? { completedAt: new Date() } : {}),
      },
      include: {
        customer: true,
        technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
        invoice: true,
        items: true,
      },
    });

    // Technician completion notification to the dispatcher only.
    // No customer notification is sent from the technician device.
    let dispatcherNotification = null;
    if (job.dispatcher?.phone && !job.isManual) {
      const methodLabel = paymentMethod === 'CASH' ? 'Cash' : 'Interac';
      dispatcherNotification = await sendSMS({
        to: job.dispatcher.phone,
        body: `Job #${job.jobNumber} is complete. ${job.technician?.name || 'Technician'} received $${calcBreakdown.grandTotal.toFixed(2)} via ${methodLabel}.`,
      });
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
      invoice,
      breakdown: calcBreakdown,
      settlement,
      stripeLink: null,
      dispatcherNotification,
    });
  } catch (err: any) {
    console.error('Invoice creation error:', err);
    return NextResponse.json({ success: false, error: 'Unable to complete invoice' }, { status: 500 });
  }
}
