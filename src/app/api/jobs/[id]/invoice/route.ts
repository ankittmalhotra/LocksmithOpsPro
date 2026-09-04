import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateForwardInvoice,
  calculateReverseInvoice,
  calculateJobSettlementPosition,
} from '@/lib/calculations';
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
      calculationMode = 'FORWARD',
      amountReceived,
      laborAmount,
      parts = [],
      paymentMethod = 'CASH',
      sendSms = false,
      keyBitting,
      doorDetails,
      customerSignature,
      proofPhotoUrl,
    } = body;

    const job = await findJobByIdOrNumber(id);

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

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
        paymentMethod,
      });
    } else {
      const labor = parseFloat(laborAmount || '0');
      calcBreakdown = calculateForwardInvoice({
        laborAmount: labor,
        partsTotal,
        paymentMethod,
      });
    }

    // 3. Compute cash ledger settlement position
    const settlement = calculateJobSettlementPosition({
      paymentMethod,
      grandTotal: calcBreakdown.grandTotal,
      workerCommission: job.workerCommission,
    });

    // 4. Handle Stripe Payment Link generation if Card
    let stripeLink = null;
    let stripeSessionId = null;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    if (paymentMethod === 'STRIPE_CARD') {
      const stripeRes = await createStripePaymentLink({
        jobId: job.id,
        jobNumber: job.jobNumber,
        customerName: job.customer.name,
        customerPhone: job.customer.phone,
        grandTotal: calcBreakdown.grandTotal,
        subtotal: calcBreakdown.subtotal,
        taxAmount: calcBreakdown.taxAmount,
        cardSurchargeAmount: calcBreakdown.cardSurchargeAmount,
        returnUrl: `${appUrl}/pay/${job.jobNumber}`,
      });
      stripeLink = stripeRes.paymentUrl;
      stripeSessionId = stripeRes.sessionId;
    }

    // 5. Handle Twilio SMS
    let smsResult = null;
    if (sendSms && job.customer?.phone) {
      if (paymentMethod === 'STRIPE_CARD' && stripeLink) {
        const fullUrl = stripeLink.startsWith('http') ? stripeLink : `${appUrl}${stripeLink}`;
        const smsBody = `Hello ${job.customer.name}, your invoice for Locksmith Job #${job.jobNumber} is ready.
Total: $${calcBreakdown.grandTotal.toFixed(2)} (inc. 13% HST & card fee).
Please complete your payment securely here: ${fullUrl}`;
        smsResult = await sendSMS({ to: job.customer.phone, body: smsBody });
      } else {
        const methodStr = paymentMethod === 'CASH' ? 'Cash' : 'Interac e-Transfer';
        const smsBody = `Thank you ${job.customer.name}! Payment of $${calcBreakdown.grandTotal.toFixed(2)} received via ${methodStr} for Job #${job.jobNumber}.
Subtotal: $${calcBreakdown.subtotal.toFixed(2)} | HST (13%): $${calcBreakdown.taxAmount.toFixed(2)}.`;
        smsResult = await sendSMS({ to: job.customer.phone, body: smsBody });
      }
    }

    // 6. Persist Job Items
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

    // 7. Upsert Invoice
    const isPaid = paymentMethod === 'CASH' || paymentMethod === 'INTERAC';
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
        paymentMethod,
        cashOwedToCompany: settlement.cashOwedToCompany,
        smsSent: sendSms,
        stripeSessionId,
        stripePaymentUrl: stripeLink,
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
        paymentMethod,
        cashOwedToCompany: settlement.cashOwedToCompany,
        smsSent: sendSms,
        stripeSessionId,
        stripePaymentUrl: stripeLink,
        paidAt: isPaid ? new Date() : null,
      },
    });

    // 8. Update Job Status
    const newStatus = isPaid ? 'COMPLETED' : 'INVOICED';
    const updatedJob = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: newStatus,
        keyBitting: keyBitting !== undefined ? keyBitting : job.keyBitting,
        doorDetails: doorDetails !== undefined ? doorDetails : job.doorDetails,
        customerSignature: customerSignature !== undefined ? customerSignature : job.customerSignature,
        proofPhotoUrl: proofPhotoUrl !== undefined ? proofPhotoUrl : job.proofPhotoUrl,
        ...(isPaid ? { completedAt: new Date() } : {}),
      },
      include: {
        customer: true,
        technician: true,
        invoice: true,
        items: true,
      },
    });

    return NextResponse.json({
      success: true,
      job: updatedJob,
      invoice,
      breakdown: calcBreakdown,
      settlement,
      stripeLink,
      smsResult,
    });
  } catch (err: any) {
    console.error('Invoice creation error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
