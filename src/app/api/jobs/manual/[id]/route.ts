import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import {
  calculateJobSettlementPosition,
  calculateManualInvoice,
  calculateDualPriceManualCardQuote,
  DEFAULT_CARD_PRICE_DIFFERENCE_RATE,
  MAX_CARD_PRICE_DIFFERENCE_RATE,
  isCardPaymentMethod,
  type SupportedPaymentMethod,
} from '@/lib/calculations';
import { MANUAL_JOB_RECEIVED_TIME_SLOTS, MANUAL_PAYMENT_METHODS, MANUAL_SERVICE_TYPES } from '@/lib/manual-job';
import { normalizeJobNumber } from '@/lib/job-number';
import { sendRevenueChangeEmail } from '@/lib/revenue-email';
import { torontoDateToMidnightIso } from '@/lib/timezone';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { expireStripeCheckoutSession } from '@/lib/stripe';
import { ManualJobInputError, parseManualAmount, parseManualPercentage } from '@/lib/manual-amount';

const MANUAL_PAYMENT_STATUSES = ['PENDING', 'PAID'] as const;
type ManualPaymentStatus = (typeof MANUAL_PAYMENT_STATUSES)[number];

class ManualJobConflictError extends Error {}

function isManualRole(role: string) {
  return role === 'ADMIN' || role === 'DISPATCHER';
}

function safeJobInclude() {
  return {
    customer: true,
    technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
    dispatcher: { select: { id: true, name: true, phone: true, email: true, active: true } },
    invoice: true,
  } as const;
}

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required' }, { status: 401 });
    }
    if (!isManualRole(currentUser.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Dispatcher access required' }, { status: 403 });
    }

    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job || !job.isManual) {
      return NextResponse.json({ success: false, error: 'Manual job entry not found' }, { status: 404 });
    }
    if (!job.invoice) {
      return NextResponse.json({ success: false, error: 'Manual job invoice is missing' }, { status: 409 });
    }
    const invoice = job.invoice;
    if (invoice.paymentProvider === 'STRIPE' && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(invoice.paymentStatus)) {
      return NextResponse.json({ success: false, error: 'Paid Stripe records are provider-authoritative and cannot be edited here.' }, { status: 409 });
    }
    const activeReceipt = await prisma.jobPaymentReceipt.findFirst({ where: { invoiceId: invoice.id, voidedAt: null }, select: { receiptNumber: true } });
    if (activeReceipt) {
      return NextResponse.json({ success: false, error: `Manual job has issued receipt ${activeReceipt.receiptNumber}. An Admin must void it with a reason before making changes; issue a new receipt after the correction.` }, { status: 409 });
    }

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid manual job update' }, { status: 400 });
    }

    const jobNumber = body.jobNumber === undefined ? job.jobNumber : normalizeJobNumber(body.jobNumber);
    const customerName = body.customerName === undefined ? job.customer.name : String(body.customerName).trim();
    const rawPhone = body.customerPhone === undefined ? job.customer.phone : String(body.customerPhone);
    const customerPhone = rawPhone.replace(/[^0-9]/g, '');
    const customerExtension = body.customerExtension === undefined
      ? (job.customer.extension || '')
      : String(body.customerExtension).trim();
    const serviceAddress = body.serviceAddress === undefined ? job.serviceAddress : String(body.serviceAddress).trim();
    const description = body.description === undefined ? job.problemDescription : String(body.description).trim();
    const existingTypeIsKnown = MANUAL_SERVICE_TYPES.includes(job.serviceType as (typeof MANUAL_SERVICE_TYPES)[number]);
    const selectedServiceType = body.serviceType === undefined
      ? (existingTypeIsKnown ? job.serviceType : 'Other')
      : String(body.serviceType).trim();
    const otherServiceType = body.otherServiceType === undefined
      ? (existingTypeIsKnown ? '' : job.serviceType)
      : String(body.otherServiceType).trim();
    const serviceType = selectedServiceType === 'Other' ? otherServiceType : selectedServiceType;
    const jobReceivedTimeSlot = body.jobReceivedTimeSlot === undefined
      ? (job.jobReceivedTimeSlot || '')
      : String(body.jobReceivedTimeSlot).trim();
    const paymentMethod = body.paymentMethod === undefined
      ? invoice.paymentMethod
      : body.paymentMethod;
    const requestedPaymentStatus = body.paymentStatus === undefined
      ? invoice.paymentStatus
      : body.paymentStatus;
    const technicianId = body.technicianId === undefined
      ? (job.technicianId || (job.technicianName ? 'OTHER' : ''))
      : String(body.technicianId).trim();
    const otherTechnicianName = body.otherTechnicianName === undefined
      ? (job.technicianName || '')
      : String(body.otherTechnicianName).trim();
    const isOtherTechnician = technicianId === 'OTHER';
    const taxCollected = body.taxCollected === undefined
      ? invoice.taxCollected !== false
      : body.taxCollected;
    const hasJobDate = body.jobDate !== undefined;
    const jobDateIso = hasJobDate ? torontoDateToMidnightIso(body.jobDate) : null;
    if (hasJobDate && !jobDateIso) {
      return NextResponse.json({ success: false, error: 'Job date must be a valid YYYY-MM-DD date' }, { status: 400 });
    }
    const manualTimestamp = jobDateIso ? new Date(jobDateIso) : null;

    if (!jobNumber) {
      return NextResponse.json({ success: false, error: 'Job number must be a positive whole number' }, { status: 400 });
    }
    if (!customerName || customerPhone.length < 7 || !serviceAddress || !description) {
      return NextResponse.json({ success: false, error: 'Customer name, valid phone, address, and description are required' }, { status: 400 });
    }
    if (!(MANUAL_SERVICE_TYPES as readonly string[]).includes(selectedServiceType) && selectedServiceType !== 'Other') {
      return NextResponse.json({ success: false, error: 'Invalid job type' }, { status: 400 });
    }
    if (!serviceType) {
      return NextResponse.json({ success: false, error: 'A job type is required when Other is selected' }, { status: 400 });
    }
    if (jobReceivedTimeSlot && !(MANUAL_JOB_RECEIVED_TIME_SLOTS as readonly string[]).includes(jobReceivedTimeSlot)) {
      return NextResponse.json({ success: false, error: 'Invalid job received time window' }, { status: 400 });
    }
    if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(paymentMethod as string)) {
      return NextResponse.json({ success: false, error: 'Invalid payment method' }, { status: 400 });
    }
    if (!(MANUAL_PAYMENT_STATUSES as readonly string[]).includes(requestedPaymentStatus as string)) {
      return NextResponse.json({ success: false, error: 'Invalid payment status' }, { status: 400 });
    }
    if (typeof taxCollected !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Tax collected must be Yes or No' }, { status: 400 });
    }

    const totalAmountCollected = parseManualAmount(
      body.totalAmountCollected === undefined ? invoice.totalAmountCollected || invoice.grandTotal : body.totalAmountCollected,
      'Total amount collected',
      false
    );
    const cogsAmount = parseManualAmount(
      body.cogsAmount === undefined ? invoice.cogsAmount : body.cogsAmount,
      'COGS (Parts, etc.) amount'
    );
    const technicianCommission = parseManualAmount(
      body.technicianCommission === undefined ? job.workerCommission : body.technicianCommission,
      'Technician commission'
    );
    const technician = isOtherTechnician || !technicianId
      ? null
      : await prisma.user.findUnique({
          where: { id: technicianId },
          select: { id: true, role: true, active: true },
        });
    if (isOtherTechnician && !otherTechnicianName) {
      return NextResponse.json({ success: false, error: 'A technician name is required when Other is selected' }, { status: 400 });
    }
    if (!isOtherTechnician && (!technician || technician.role !== 'TECHNICIAN' || !technician.active)) {
      return NextResponse.json({ success: false, error: 'Selected technician is not active' }, { status: 400 });
    }

    const payment = paymentMethod as SupportedPaymentMethod;
    const paymentStatus = requestedPaymentStatus as ManualPaymentStatus;
    const pendingCardPayment = paymentStatus === 'PENDING' && isCardPaymentMethod(payment);
    const cardPriceDifferenceRate = pendingCardPayment
      ? parseManualPercentage(
          body.cardPriceDifferenceRate === undefined
            ? (invoice.pricingModel === 'DUAL_PRICE_V1'
              ? Number(invoice.cardPriceDifferenceRate ?? DEFAULT_CARD_PRICE_DIFFERENCE_RATE) * 100
              : DEFAULT_CARD_PRICE_DIFFERENCE_RATE * 100)
            : body.cardPriceDifferenceRate,
          'Card price difference',
        )
      : 0;
    if (pendingCardPayment && cardPriceDifferenceRate > MAX_CARD_PRICE_DIFFERENCE_RATE * 100) {
      return NextResponse.json({ success: false, error: `Card-price difference cannot exceed ${MAX_CARD_PRICE_DIFFERENCE_RATE * 100}%.` }, { status: 400 });
    }
    if (pendingCardPayment && (body.customerAcceptedCardPrice !== true
      || !['VERBAL', 'WRITTEN'].includes(body.quoteAcceptanceMethod)
      || typeof body.quoteAcceptanceEvidence !== 'string'
      || !body.quoteAcceptanceEvidence.trim()
      || body.quoteAcceptanceEvidence.trim().length > 500)) {
      return NextResponse.json({ success: false, error: 'Record that the customer accepted the displayed card price, select verbal or written acceptance, and add an acceptance note before saving.' }, { status: 400 });
    }
    const dualPriceQuote = pendingCardPayment
      ? calculateDualPriceManualCardQuote({ nonCardPrice: totalAmountCollected, cardPriceDifferenceRate })
      : null;
    const manualCalculation = dualPriceQuote?.calculation
      || calculateManualInvoice({ amountCollected: totalAmountCollected, taxCollected });
    const settlement = calculateJobSettlementPosition({
      paymentMethod: payment,
      grandTotal: manualCalculation.grandTotal,
      workerCommission: technicianCommission,
    });

    const shouldInvalidatePaymentLink = Boolean(invoice.stripeSessionId || invoice.stripePaymentUrl)
      && (
        !pendingCardPayment
        || invoice.paymentMethod !== payment
        || invoice.paymentStatus !== paymentStatus
        || Number(invoice.totalAmountCollected || invoice.grandTotal || 0) !== totalAmountCollected
        || Number(invoice.cardPriceDifferenceRate || 0) !== cardPriceDifferenceRate
        || invoice.acceptedPriceOption !== (pendingCardPayment ? 'CARD' : null)
        || customerName !== job.customer.name
        || customerPhone !== job.customer.phone
        || serviceAddress !== job.serviceAddress
      );

    // The database reference alone does not revoke a Checkout URL already in
    // the customer's possession. Expire it at Stripe before changing its quote;
    // if payment won the race, Stripe refuses expiration and this edit stops.
    if (shouldInvalidatePaymentLink && invoice.stripeSessionId) {
      await expireStripeCheckoutSession(invoice.stripeSessionId);
    }

    const updatedJob = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoice.id} FOR UPDATE`;
      const fresh = await tx.job.findUnique({ where: { id: job.id }, include: { invoice: true } });
      if (!fresh || !fresh.invoice || fresh.updatedAt.getTime() !== job.updatedAt.getTime()) {
        throw new ManualJobConflictError('Manual job changed while this edit was being prepared. Reload and try again.');
      }
      const freshLinkWouldBeInvalidated = Boolean(fresh.invoice.stripeSessionId || fresh.invoice.stripePaymentUrl)
        && (
          !pendingCardPayment
          || fresh.invoice.paymentMethod !== payment
          || fresh.invoice.paymentStatus !== paymentStatus
          || Number(fresh.invoice.totalAmountCollected || fresh.invoice.grandTotal || 0) !== totalAmountCollected
          || Number(fresh.invoice.cardPriceDifferenceRate || 0) !== cardPriceDifferenceRate
          || fresh.invoice.acceptedPriceOption !== (pendingCardPayment ? 'CARD' : null)
          || customerName !== job.customer.name
          || customerPhone !== job.customer.phone
          || serviceAddress !== job.serviceAddress
        );
      const linkChangedDuringEdit = fresh.invoice.stripeSessionId !== invoice.stripeSessionId
        || fresh.invoice.stripePaymentUrl !== invoice.stripePaymentUrl;
      if (linkChangedDuringEdit && freshLinkWouldBeInvalidated) {
        throw new ManualJobConflictError('A Stripe payment link was created while this edit was being prepared. Reload and retry so the active link can be expired safely.');
      }
      if (fresh.invoice.paymentProvider === 'STRIPE' && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(fresh.invoice.paymentStatus)) {
        throw new ManualJobConflictError('Paid Stripe records are provider-authoritative and cannot be edited here.');
      }
      const issuedReceipt = await tx.jobPaymentReceipt.findFirst({ where: { invoiceId: invoice.id, voidedAt: null }, select: { receiptNumber: true } });
      if (issuedReceipt) throw new ManualJobConflictError(`Manual job has issued receipt ${issuedReceipt.receiptNumber}. An Admin must void it with a reason before making changes; issue a new receipt after the correction.`);
      let customerId = job.customerId;
      const customerChanged = customerName !== job.customer.name
        || customerPhone !== job.customer.phone
        || customerExtension !== (job.customer.extension || '')
        || serviceAddress !== job.serviceAddress;

      if (customerChanged) {
        const linkedJobCount = await tx.job.count({ where: { customerId: job.customerId } });
        if (linkedJobCount === 1) {
          await tx.customer.update({
            where: { id: job.customerId },
            data: { name: customerName, phone: customerPhone, extension: customerExtension || null, address: serviceAddress },
          });
        } else {
          const matchingCustomer = await tx.customer.findFirst({
            where: { phone: customerPhone, id: { not: job.customerId } },
          });
          if (matchingCustomer) {
            customerId = matchingCustomer.id;
          } else {
            const newCustomer = await tx.customer.create({
              data: { name: customerName, phone: customerPhone, extension: customerExtension || null, address: serviceAddress },
            });
            customerId = newCustomer.id;
          }
        }
      }

      await tx.invoice.update({
        where: { jobId: job.id },
        data: {
          calculationMode: 'MANUAL',
          subtotal: manualCalculation.subtotal,
          partsTotal: 0,
          laborTotal: manualCalculation.laborTotal,
          taxRate: manualCalculation.taxRate,
          taxAmount: manualCalculation.taxAmount,
          cardSurchargeRate: manualCalculation.cardSurchargeRate,
          cardSurchargeAmount: manualCalculation.cardSurchargeAmount,
          pricingModel: pendingCardPayment ? 'DUAL_PRICE_V1' : null,
          nonCardPrice: dualPriceQuote?.nonCardPrice ?? null,
          cardPrice: dualPriceQuote?.cardPrice ?? null,
          cardPriceDifferenceRate: dualPriceQuote?.cardPriceDifferenceRate ?? null,
          acceptedPriceOption: pendingCardPayment ? 'CARD' : null,
          quoteAcceptanceMethod: pendingCardPayment ? body.quoteAcceptanceMethod : null,
          quoteAcceptedAt: pendingCardPayment ? new Date() : null,
          quoteAcceptedById: pendingCardPayment ? currentUser.id : null,
          quoteAcceptanceEvidence: pendingCardPayment ? body.quoteAcceptanceEvidence.trim() : null,
          grandTotal: manualCalculation.grandTotal,
          totalAmountCollected,
          taxCollected: pendingCardPayment ? true : taxCollected,
          cogsAmount,
          paymentStatus,
          paymentMethod: payment,
          cashOwedToCompany: settlement.cashOwedToCompany,
          paidAt: paymentStatus === 'PAID'
            ? (manualTimestamp || invoice.paidAt || new Date())
            : null,
          ...(shouldInvalidatePaymentLink ? {
            paymentProvider: null,
            stripeSessionId: null,
            stripeSessionStatus: null,
            stripeSessionExpiresAt: null,
            stripePaymentUrl: null,
            stripePaymentLinkCreatedAt: null,
            stripePaymentLinkExpiresAt: null,
            stripeInvoiceId: null,
            stripePaymentIntentId: null,
            stripeChargeId: null,
          } : {}),
        },
      });

      return tx.job.update({
        where: { id: job.id },
        data: {
          jobNumber,
          customerId,
          technicianId: technician?.id || null,
          technicianName: isOtherTechnician ? otherTechnicianName : null,
          serviceType,
          problemDescription: description,
          serviceAddress,
          jobReceivedTimeSlot: jobReceivedTimeSlot || null,
          workerCommissionRate: 0,
          workerCommission: technicianCommission,
          status: 'COMPLETED',
          ...(manualTimestamp ? { createdAt: manualTimestamp, completedAt: manualTimestamp } : {}),
        },
        include: safeJobInclude(),
      });
    });

    const previousRevenue = {
      totalAmountCollected: Number(invoice.totalAmountCollected || invoice.grandTotal || 0),
      cogsAmount: Number(invoice.cogsAmount || 0),
      taxCollected: invoice.taxCollected !== false,
      paymentMethod: invoice.paymentMethod,
      technicianCommission: Number(job.workerCommission || 0),
    };
    const revenueChanged = previousRevenue.totalAmountCollected !== totalAmountCollected
      || previousRevenue.cogsAmount !== cogsAmount
      || previousRevenue.taxCollected !== taxCollected
      || previousRevenue.paymentMethod !== payment
      || previousRevenue.technicianCommission !== technicianCommission;
    let revenueEmail: { success: boolean; error?: string } | null = null;
    if (revenueChanged) {
      const result = await sendRevenueChangeEmail(updatedJob, 'UPDATED');
      revenueEmail = { success: result.success, error: result.error };
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
      message: `Manual Job #${updatedJob.jobNumber} updated successfully.`,
      revenueEmail,
    });
  } catch (err: any) {
    if (err instanceof ManualJobConflictError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    }
    if (err instanceof ManualJobInputError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ success: false, error: 'That job number already exists' }, { status: 409 });
    }
    logCaughtRequestError(request, '/api/jobs/manual/[id]', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Failed to update manual job') }, { status: 500 });
  }
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required' }, { status: 401 });
    }
    if (!isManualRole(currentUser.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Dispatcher access required' }, { status: 403 });
    }

    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job || !job.isManual) {
      return NextResponse.json({ success: false, error: 'Manual job entry not found' }, { status: 404 });
    }

    if (job.invoice) {
      const invoiceId = job.invoice.id;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
        const freshInvoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
        if (!freshInvoice) throw new ManualJobConflictError('Manual job invoice changed. Reload and try again.');
        if (freshInvoice.paymentProvider === 'STRIPE' && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(freshInvoice.paymentStatus)) {
          throw new ManualJobConflictError('Paid Stripe records are provider-authoritative and cannot be deleted.');
        }
        const issuedReceipt = await tx.jobPaymentReceipt.findFirst({ where: { invoiceId }, select: { receiptNumber: true } });
        if (issuedReceipt) throw new ManualJobConflictError(`Manual job has receipt history beginning with ${issuedReceipt.receiptNumber} and cannot be deleted.`);
        await tx.job.delete({ where: { id: job.id } });
      });
    } else {
      await prisma.job.delete({ where: { id: job.id } });
    }
    return NextResponse.json({
      success: true,
      message: `Manual Job #${job.jobNumber} deleted successfully.`,
    });
  } catch (err: any) {
    if (err instanceof ManualJobConflictError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    }
    logCaughtRequestError(request, '/api/jobs/manual/[id]', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Failed to delete manual job') }, { status: 500 });
  }
}

export const PATCH = withRequestLogging('/api/jobs/manual/[id]', handlePATCH);
export const DELETE = withRequestLogging('/api/jobs/manual/[id]', handleDELETE);
