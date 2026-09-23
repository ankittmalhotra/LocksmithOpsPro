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
      automaticTax: true,
      returnUrl: getReturnUrl(request, job.id),
      requestRevision: job.updatedAt.toISOString(),
    };
    const result = await createStripePaymentLink(paymentParams);

    await prisma.$transaction(async (tx) => {
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
          ...(result.amountTotal !== null ? { grandTotal: result.amountTotal } : {}),
          ...(result.amountTax !== null ? { taxAmount: result.amountTax } : {}),
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
