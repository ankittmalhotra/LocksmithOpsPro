import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import {
  createStripePaymentLink,
  StripeApiError,
  StripeConfigurationError,
} from '@/lib/stripe';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import {
  buildPayLinkSmsBody,
  buildPayUrl,
  CARD_TOTAL_PRICING_MODEL,
  generatePayToken,
  getAppBaseUrl,
} from '@/lib/card-pay-link';

const CARD_PAYMENT_METHODS = ['CREDIT_CARD', 'DEBIT_CARD'] as const;

class PaymentLinkStateChangedError extends Error {}

function isActiveCheckoutSession(invoice: {
  stripeSessionId: string | null;
  stripePaymentUrl: string | null;
  stripeSessionStatus: string | null;
  stripeSessionExpiresAt: Date | null;
}, now: Date): boolean {
  return Boolean(
    invoice.stripeSessionId &&
    invoice.stripePaymentUrl &&
    invoice.stripeSessionStatus === 'open' &&
    invoice.stripeSessionExpiresAt &&
    invoice.stripeSessionExpiresAt.getTime() > now.getTime(),
  );
}

function getReturnUrl(request: Request, jobId: string): string {
  const configuredBase = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = configuredBase || new URL(request.url).origin;
  return new URL(`/dispatch/jobs/${encodeURIComponent(jobId)}`, base).toString();
}

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 },
      );
    }
    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Dispatcher or admin access required' },
        { status: 403 },
      );
    }

    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });

    const invoice = job.invoice;
    if (!invoice) {
      return NextResponse.json({ success: false, error: 'A pending invoice is required before creating a payment link' }, { status: 409 });
    }
    if (
      invoice.paymentStatus !== 'PENDING' ||
      !(CARD_PAYMENT_METHODS as readonly string[]).includes(invoice.paymentMethod || '')
    ) {
      return NextResponse.json(
        { success: false, error: 'Only pending credit-card or debit-card invoices can receive a payment link' },
        { status: 409 },
      );
    }

    // Card-total jobs use the stable customer pay page. Stripe Checkout is
    // created only when the customer opens it, so nothing can fail here.
    if (invoice.pricingModel === CARD_TOTAL_PRICING_MODEL) {
      let payToken = invoice.payToken;
      if (!payToken) {
        payToken = generatePayToken();
        const updated = await prisma.invoice.updateMany({
          where: { id: invoice.id, payToken: null, paymentStatus: 'PENDING' },
          data: { payToken },
        });
        if (updated.count !== 1) throw new PaymentLinkStateChangedError();
      }
      const paymentUrl = buildPayUrl(getAppBaseUrl(request), payToken);
      return NextResponse.json({
        success: true,
        reused: Boolean(invoice.payToken),
        paymentUrl,
        smsBody: buildPayLinkSmsBody({
          customerName: job.customer.name,
          jobNumber: String(job.jobNumber),
          total: Number(invoice.grandTotal),
          payUrl: paymentUrl,
        }),
      });
    }

    if (invoice.pricingModel !== 'DUAL_PRICE_V1'
      || invoice.acceptedPriceOption !== 'CARD'
      || !invoice.quoteAcceptedAt
      || !invoice.quoteAcceptedById
      || !invoice.quoteAcceptanceMethod
      || !invoice.quoteAcceptanceEvidence) {
      return NextResponse.json(
        { success: false, error: 'This job was saved before card links used a single total. Edit the job, confirm the card total (HST included), and save to get a payment link.' },
        { status: 409 },
      );
    }

    if (process.env.LOCKSMITH_DUAL_PRICING_APPROVED !== 'true') {
      return NextResponse.json(
        { success: false, error: 'Payment links for the dual-price quote are disabled until Locksmith’s payment processor and accountant approve the customer pricing and HST treatment.' },
        { status: 503 },
      );
    }

    const now = new Date();
    if (isActiveCheckoutSession(invoice, now)) {
      return NextResponse.json({
        success: true,
        reused: true,
        paymentUrl: invoice.stripePaymentUrl,
        sessionId: invoice.stripeSessionId,
      });
    }

    const paymentParams = {
      invoiceId: invoice.id,
      customerId: job.customer.id,
      jobId: job.id,
      jobNumber: job.jobNumber,
      customerName: job.customer.name,
      customerPhone: job.customer.phone,
      customerAddress: job.customer.address || job.serviceAddress,
      customerPostalCode: job.customer.postalCode,
      stripeCustomerId: job.customer.stripeCustomerId,
      grandTotal: invoice.grandTotal,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      cardSurchargeAmount: invoice.cardSurchargeAmount,
      pricingModel: invoice.pricingModel,
      automaticTax: true,
      returnUrl: getReturnUrl(request, job.id),
      requestRevision: job.updatedAt.toISOString(),
    };
    const result = await createStripePaymentLink(paymentParams);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoice.id} FOR UPDATE`;
      const currentJob = await tx.job.findUnique({ where: { id: job.id }, select: { updatedAt: true } });
      if (!currentJob || currentJob.updatedAt.toISOString() !== paymentParams.requestRevision) {
        throw new PaymentLinkStateChangedError();
      }

      if (result.customerId) {
        const customerUpdate = await tx.customer.updateMany({
          where: {
            id: job.customer.id,
            OR: [{ stripeCustomerId: null }, { stripeCustomerId: result.customerId }],
          },
          data: { stripeCustomerId: result.customerId },
        });
        if (customerUpdate.count !== 1) throw new PaymentLinkStateChangedError();
      }

      const invoiceUpdate = await tx.invoice.updateMany({
        where: {
          id: invoice.id,
          paymentStatus: 'PENDING',
          paymentMethod: { in: [...CARD_PAYMENT_METHODS] },
          grandTotal: invoice.grandTotal,
          subtotal: invoice.subtotal,
          taxAmount: invoice.taxAmount,
          cardSurchargeAmount: invoice.cardSurchargeAmount,
          pricingModel: invoice.pricingModel,
          cardPrice: invoice.cardPrice,
          acceptedPriceOption: invoice.acceptedPriceOption,
          quoteAcceptedAt: invoice.quoteAcceptedAt,
          totalAmountCollected: invoice.totalAmountCollected,
          stripeSessionId: invoice.stripeSessionId,
        },
        data: {
          paymentProvider: 'STRIPE',
          stripeSessionId: result.sessionId,
          stripeSessionStatus: result.sessionStatus,
          stripeSessionExpiresAt: result.expiresAt,
          stripePaymentUrl: result.paymentUrl,
          stripePaymentLinkCreatedAt: result.createdAt,
          stripePaymentLinkExpiresAt: result.expiresAt,
          stripeInvoiceId: result.stripeInvoiceId,
          stripePaymentIntentId: result.stripePaymentIntentId,
          // Keep the accepted service price as the pre-tax quote until the
          // verified paid webhook records Stripe's final tax-inclusive total.
        },
      });
      if (invoiceUpdate.count !== 1) throw new PaymentLinkStateChangedError();
    });

    return NextResponse.json({
      success: true,
      reused: false,
      paymentUrl: result.paymentUrl,
      sessionId: result.sessionId,
    });
  } catch (error) {
    if (error instanceof PaymentLinkStateChangedError) {
      return NextResponse.json(
        { success: false, error: 'Invoice changed while creating the payment link. Reload and try again.' },
        { status: 409 },
      );
    }
    if (error instanceof StripeConfigurationError) {
      return NextResponse.json({ success: false, error: 'Stripe payments are not configured' }, { status: 503 });
    }
    if (error instanceof StripeApiError) {
      logCaughtRequestError(request, '/api/jobs/[id]/payment-link', error);
      const providerMessage = error.message.trim();
      return NextResponse.json({
        success: false,
        error: providerMessage
          ? `Stripe rejected the payment link request: ${providerMessage}`
          : 'Stripe could not create the payment link',
      }, { status: 502 });
    }
    logCaughtRequestError(request, '/api/jobs/[id]/payment-link', error);
    return NextResponse.json(
      { success: false, error: getApiErrorMessage(error, 'Unable to create payment link') },
      { status: 500 },
    );
  }
}

export const POST = withRequestLogging('/api/jobs/[id]/payment-link', handlePOST);
