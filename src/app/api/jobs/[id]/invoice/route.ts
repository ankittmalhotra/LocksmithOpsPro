import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateForwardInvoice,
  calculateReverseInvoice,
  calculateJobSettlementPosition,
  isCardPaymentMethod,
  SupportedPaymentMethod,
} from '@/lib/calculations';
import { createStripePaymentLink } from '@/lib/stripe';
import { sendSMS } from '@/lib/twilio';
import { sendEmail, buildInvoiceReceiptEmail } from '@/lib/resend';
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
      preWorkSignature,
      customerSignature,
      proofPhotoUrl,
      customerEmail,
    } = body;

    const job = await findJobByIdOrNumber(id);

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const isCard = isCardPaymentMethod(paymentMethod);
    const isPaid = paymentMethod === 'CASH' || paymentMethod === 'INTERAC';

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

    // 3. Compute cash ledger settlement position
    const settlement = calculateJobSettlementPosition({
      paymentMethod: paymentMethod as SupportedPaymentMethod,
      grandTotal: calcBreakdown.grandTotal,
      workerCommission: job.workerCommission,
    });

    // 4. Handle Stripe Payment Link generation if Card (Credit or Debit)
    let stripeLink = null;
    let stripeSessionId = null;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    if (isCard) {
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

    // 5. Handle Notifications:
    // If Debit / Credit Card: Stripe sends SMS link to user for payment.
    // If Cash / Interac: System enters cash received, client gets settlement SMS, and Owner gets completion notification.
    let smsResult = null;
    if (job.customer?.phone) {
      if (isCard && stripeLink) {
        const fullUrl = stripeLink.startsWith('http') ? stripeLink : `${appUrl}${stripeLink}`;
        const cardTypeLabel = paymentMethod === 'DEBIT_CARD' ? 'Debit Card' : 'Credit Card';
        const smsBody = `Hello ${job.customer.name}, your payment link for Locksmith Job #${job.jobNumber} ($${calcBreakdown.grandTotal.toFixed(2)}) is ready.
Please complete your ${cardTypeLabel} payment securely here: ${fullUrl}`;
        smsResult = await sendSMS({ to: job.customer.phone, body: smsBody });
      } else if (isPaid) {
        const methodStr = paymentMethod === 'CASH' ? 'Cash' : 'Interac e-Transfer';
        const clientSms = `Thank you ${job.customer.name}! Your payment of $${calcBreakdown.grandTotal.toFixed(2)} received via ${methodStr} for Job #${job.jobNumber} has been settled.`;
        smsResult = await sendSMS({ to: job.customer.phone, body: clientSms });
      }
    }

    // Notify Owner / Dispatcher when Cash / Interac job is completed
    if (isPaid) {
      const methodStr = paymentMethod === 'CASH' ? 'Cash' : 'Interac e-Transfer';
      const dispatcherOrOwner = job.dispatcher?.phone
        ? job.dispatcher
        : await prisma.user.findFirst({
            where: { role: { in: ['OWNER', 'SUPER_ADMIN', 'DISPATCHER'] }, active: true },
          });

      if (dispatcherOrOwner?.phone) {
        const ownerSms = `Job #${job.jobNumber} has been completed by ${job.technician?.name || 'Technician'}. Payment: $${calcBreakdown.grandTotal.toFixed(2)} received via ${methodStr}.`;
        await sendSMS({ to: dispatcherOrOwner.phone, body: ownerSms });
      }
    }

    // 6. Handle Resend Email Invoice / Receipt
    let emailResult = null;
    const recipientEmail = customerEmail || (job.customer as any).email;
    if (recipientEmail) {
      try {
        const isPaid = paymentMethod === 'CASH' || paymentMethod === 'INTERAC';
        const emailData = buildInvoiceReceiptEmail({
          customerName: job.customer.name,
          jobNumber: job.jobNumber,
          serviceType: job.serviceType,
          subtotal: calcBreakdown.subtotal,
          taxAmount: calcBreakdown.taxAmount,
          grandTotal: calcBreakdown.grandTotal,
          paymentMethod,
          paymentStatus: isPaid ? 'PAID' : 'PENDING',
          paymentUrl: stripeLink ? (stripeLink.startsWith('http') ? stripeLink : `${appUrl}${stripeLink}`) : undefined,
          technicianName: job.technician?.name,
        });

        emailResult = await sendEmail({
          to: recipientEmail,
          subject: emailData.subject,
          html: emailData.html,
        });
      } catch (emailErr) {
        console.error('Failed to send invoice email via Resend:', emailErr);
      }
    }

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

    // 7. Upsert Invoice
    const dbPaymentMethod = isCard ? 'STRIPE_CARD' : (paymentMethod as 'CASH' | 'INTERAC');
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
        smsSent: true,
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
        paymentMethod: dbPaymentMethod,
        cashOwedToCompany: settlement.cashOwedToCompany,
        smsSent: true,
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
        preWorkSignature: preWorkSignature !== undefined ? preWorkSignature : (job as any).preWorkSignature,
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

    // 9. Send Google Review Booster SMS if customer requested receipt and job is paid
    if (isPaid && sendSms && job.customer?.phone) {
      const googleReviewUrl = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/locksmith-toronto/review';
      const reviewSms = `Hi ${job.customer.name}, thank you for choosing LockOps! If you were pleased with ${job.technician?.name || 'our service'}, please take a moment to leave us a 5-star Google review: ${googleReviewUrl}`;
      await sendSMS({ to: job.customer.phone, body: reviewSms });
    }

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
