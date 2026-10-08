import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  createStripePaymentLink,
  expireStripeCheckoutSession,
  StripeApiError,
  StripeConfigurationError,
} from '@/lib/stripe';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { buildPayUrl, getAppBaseUrl, isPendingCardLinkInvoice, isValidPayTokenFormat } from '@/lib/card-pay-link';

export const runtime = 'nodejs';

class PayLinkStateChangedError extends Error {}

/**
 * Public customer endpoint behind /pay/<token>. It never exposes job data; it
 * only starts (or reuses) a Stripe Checkout session for the exact saved card
 * total and returns its hosted URL.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isValidPayTokenFormat(token)) {
    return NextResponse.json({ success: false, error: 'This payment link is not valid.' }, { status: 404 });
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { payToken: token },
      include: { job: { include: { customer: true } } },
    });
    if (!invoice) {
      return NextResponse.json({ success: false, error: 'This payment link is not valid.' }, { status: 404 });
    }
    if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(invoice.paymentStatus)) {
      return NextResponse.json({ success: false, paid: true, error: 'This job is already paid. Thank you.' }, { status: 409 });
    }
    if (!isPendingCardLinkInvoice(invoice)) {
      return NextResponse.json({ success: false, error: 'This payment link is no longer active. Please contact us.' }, { status: 410 });
    }

    const now = new Date();
    if (invoice.stripeSessionId
      && invoice.stripePaymentUrl
      && invoice.stripeSessionStatus === 'open'
      && invoice.stripeSessionExpiresAt
      && invoice.stripeSessionExpiresAt.getTime() > now.getTime() + 5 * 60 * 1000) {
      return NextResponse.json({ success: true, checkoutUrl: invoice.stripePaymentUrl });
    }

    // Close a nearly-expired previous session first so only one payable
    // session exists. Stripe refuses if it was paid in the meantime.
    if (invoice.stripeSessionId && invoice.stripeSessionStatus === 'open') {
      try {
        await expireStripeCheckoutSession(invoice.stripeSessionId);
      } catch (error) {
        if (error instanceof StripeApiError) {
          return NextResponse.json({ success: false, error: 'A payment for this job is already being processed. Please wait a minute and reload.' }, { status: 409 });
        }
        throw error;
      }
    }

    const job = invoice.job;
    const result = await createStripePaymentLink({
      invoiceId: invoice.id,
      customerId: job.customer.id,
      jobId: job.id,
      jobNumber: String(job.jobNumber),
      customerName: job.customer.name,
      customerPhone: job.customer.phone,
      customerAddress: job.customer.address || job.serviceAddress,
      customerPostalCode: job.customer.postalCode,
      stripeCustomerId: job.customer.stripeCustomerId,
      grandTotal: invoice.grandTotal,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      cardSurchargeAmount: 0,
      pricingModel: invoice.pricingModel,
      automaticTax: false,
      returnUrl: buildPayUrl(getAppBaseUrl(request), token),
      // Including the previous session makes a retry after expiry a new
      // Stripe request, while simultaneous opens still share one session.
      requestRevision: `${job.updatedAt.toISOString()}:${invoice.stripeSessionId || 'none'}`,
    });

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoice.id} FOR UPDATE`;
        const currentJob = await tx.job.findUnique({ where: { id: job.id }, select: { updatedAt: true } });
        if (!currentJob || currentJob.updatedAt.getTime() !== job.updatedAt.getTime()) {
          throw new PayLinkStateChangedError();
        }
        if (result.customerId) {
          await tx.customer.updateMany({
            where: { id: job.customer.id, stripeCustomerId: null },
            data: { stripeCustomerId: result.customerId },
          });
        }
        const updated = await tx.invoice.updateMany({
          where: {
            id: invoice.id,
            payToken: token,
            paymentStatus: 'PENDING',
            pricingModel: invoice.pricingModel,
            grandTotal: invoice.grandTotal,
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
          },
        });
        if (updated.count !== 1) throw new PayLinkStateChangedError();
      });
    } catch (error) {
      if (error instanceof PayLinkStateChangedError && result.sessionId !== invoice.stripeSessionId) {
        // The quote changed while Stripe was creating this session; never leave
        // a payable session for a superseded amount.
        await expireStripeCheckoutSession(result.sessionId).catch(() => undefined);
      }
      throw error;
    }

    return NextResponse.json({ success: true, checkoutUrl: result.paymentUrl });
  } catch (error) {
    if (error instanceof PayLinkStateChangedError) {
      return NextResponse.json({ success: false, error: 'This bill was just updated. Please reload the page and try again.' }, { status: 409 });
    }
    if (error instanceof StripeConfigurationError) {
      return NextResponse.json({ success: false, error: 'Card payments are temporarily unavailable. Please contact us.' }, { status: 503 });
    }
    logCaughtRequestError(request, '/api/pay/[token]', error);
    if (error instanceof StripeApiError) {
      return NextResponse.json({ success: false, error: 'The card payment page could not be opened. Please try again in a moment.' }, { status: 502 });
    }
    return NextResponse.json({ success: false, error: 'The card payment page could not be opened. Please try again in a moment.' }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/pay/[token]', handlePOST);
