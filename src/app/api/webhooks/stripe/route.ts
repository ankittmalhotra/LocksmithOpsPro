import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyStripeWebhookSignature } from '@/lib/stripe';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

export const runtime = 'nodejs';

type StripeObject = Record<string, unknown>;
type StripeEvent = {
  id: string;
  type: string;
  data?: { object?: unknown };
};

const CARD_PAYMENT_METHODS = ['STRIPE_CARD', 'DEBIT_CARD', 'CREDIT_CARD'] as const;

function asRecord(value: unknown): StripeObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as StripeObject
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function providerId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  const record = asRecord(value);
  return record ? stringValue(record.id) : null;
}

function metadataValue(object: StripeObject, key: string): string | null {
  return stringValue(asRecord(object.metadata)?.[key]);
}

function emailValue(value: unknown): string | null {
  const email = stringValue(value)?.trim().toLowerCase() || null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function amountFromCents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value) / 100
    : null;
}

function taxAmountFromStripeObject(object: StripeObject): number | null {
  const totalDetails = asRecord(object.total_details);
  const directTax = amountFromCents(totalDetails?.amount_tax);
  if (directTax !== null) return directTax;

  const totalTaxes = Array.isArray(object.total_taxes) ? object.total_taxes : [];
  const taxTotal = totalTaxes.reduce((sum, tax) => {
    const taxRecord = asRecord(tax);
    return sum + (typeof taxRecord?.amount === 'number' ? taxRecord.amount : 0);
  }, 0);
  return taxTotal > 0 ? amountFromCents(taxTotal) : null;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

function isCardPaymentMethod(value: string | null): boolean {
  return Boolean(value && (CARD_PAYMENT_METHODS as readonly string[]).includes(value));
}

async function findInvoiceForEvent(tx: Prisma.TransactionClient, object: StripeObject) {
  const metadataInvoiceId = metadataValue(object, 'invoiceId');
  const metadataJobId = metadataValue(object, 'jobId');
  const clientReferenceId = stringValue(object.client_reference_id);
  const sessionId = stringValue(object.id);
  const stripeInvoiceId = providerId(object.id);
  const candidates: Prisma.InvoiceWhereInput[] = [];

  if (metadataInvoiceId) candidates.push({ id: metadataInvoiceId });
  if (metadataJobId) candidates.push({ jobId: metadataJobId });
  if (clientReferenceId) candidates.push({ id: clientReferenceId }, { jobId: clientReferenceId });
  if (sessionId) candidates.push({ stripeSessionId: sessionId });
  if (stripeInvoiceId && object.object === 'invoice') candidates.push({ stripeInvoiceId });
  if (candidates.length === 0) return null;

  return tx.invoice.findFirst({
    where: { OR: candidates },
    include: { job: { include: { customer: true } } },
  });
}

async function applyStripeEvent(tx: Prisma.TransactionClient, event: StripeEvent) {
  const object = asRecord(event.data?.object);
  if (!object) return;

  const invoice = await findInvoiceForEvent(tx, object);
  if (!invoice) return;

  const now = new Date();
  const customerDetails = asRecord(object.customer_details);
  const invoiceEmail = emailValue(object.customer_email);
  const sessionEmail = emailValue(customerDetails?.email);
  const customerEmail = sessionEmail || invoiceEmail;
  const stripeCustomerId = providerId(object.customer);
  const stripeInvoiceId = event.type.startsWith('invoice.') ? providerId(object.id) : providerId(object.invoice);
  const stripePaymentIntentId = providerId(object.payment_intent);
  const stripeChargeId = providerId(object.charge);
  const stripeSessionId = event.type.startsWith('checkout.session.') ? providerId(object.id) : null;
  const sessionExpiresAt = typeof object.expires_at === 'number'
    ? new Date(object.expires_at * 1000)
    : undefined;
  const sessionStatus = stringValue(object.status);
  const stripeTotal = amountFromCents(object.amount_total)
    ?? amountFromCents(object.amount_paid)
    ?? amountFromCents(object.total);
  const stripeTaxAmount = taxAmountFromStripeObject(object);

  const customer = await tx.customer.findUnique({
    where: { id: invoice.job.customerId },
    select: { id: true, email: true, stripeCustomerId: true },
  });
  if (customer && (customerEmail || stripeCustomerId)) {
    const customerData: { email?: string; stripeCustomerId?: string; } = {};
    if (customerEmail) customerData.email = customerEmail;
    // Never move a Stripe customer identity from one local customer to another.
    if (stripeCustomerId && !customer.stripeCustomerId) {
      const existingOwner = await tx.customer.findUnique({
        where: { stripeCustomerId },
        select: { id: true },
      });
      if (!existingOwner) customerData.stripeCustomerId = stripeCustomerId;
    }
    if (Object.keys(customerData).length > 0) {
      await tx.customer.update({ where: { id: customer.id }, data: customerData });
    }
  }

  const invoiceData: Prisma.InvoiceUpdateInput = {
    ...(stripeInvoiceId ? { stripeInvoiceId } : {}),
    ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
    ...(stripeChargeId ? { stripeChargeId } : {}),
    ...(stripeSessionId ? { stripeSessionId } : {}),
    ...(sessionStatus ? { stripeSessionStatus: sessionStatus } : {}),
    ...(sessionExpiresAt ? { stripeSessionExpiresAt: sessionExpiresAt, stripePaymentLinkExpiresAt: sessionExpiresAt } : {}),
    ...(customerEmail ? { customerEmailCollectedAt: invoice.customerEmailCollectedAt || now } : {}),
    ...(stripeTotal !== null ? { grandTotal: stripeTotal } : {}),
    ...(stripeTaxAmount !== null ? { taxAmount: stripeTaxAmount } : {}),
  };

  const confirmedPayment =
    event.type === 'invoice.paid' ||
    event.type === 'checkout.session.async_payment_succeeded' ||
    (event.type === 'checkout.session.completed' && object.payment_status === 'paid');
  const sessionFailed = event.type === 'checkout.session.async_payment_failed';
  const sessionExpired = event.type === 'checkout.session.expired';

  if (event.type === 'invoice.sent') {
    invoiceData.invoiceSentAt = invoice.invoiceSentAt || now;
  }
  if (event.type === 'invoice.payment_failed' || sessionFailed) {
    invoiceData.paymentFailedAt = now;
    if (sessionFailed) invoiceData.stripeSessionStatus = 'payment_failed';
  }
  if (sessionExpired) invoiceData.stripeSessionStatus = 'expired';

  // A Stripe confirmation can only settle a card invoice. Never let a
  // webhook change a cash/Interac invoice to PAID.
  if (confirmedPayment && isCardPaymentMethod(invoice.paymentMethod)) {
    invoiceData.paymentStatus = 'PAID';
    invoiceData.totalAmountCollected = stripeTotal ?? invoice.grandTotal;
    invoiceData.paidAt = invoice.paidAt || now;
    invoiceData.paymentProvider = 'STRIPE';
    invoiceData.paymentFailedAt = null;
  }

  if (Object.keys(invoiceData).length === 0) return;
  await tx.invoice.update({ where: { id: invoice.id }, data: invoiceData });
}

async function handlePOST(request: Request) {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!endpointSecret) {
    return NextResponse.json({ success: false, error: 'Stripe webhook is not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  try {
    verifyStripeWebhookSignature(rawBody, request.headers.get('stripe-signature'), endpointSecret);
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid Stripe webhook signature' }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    const parsed = JSON.parse(rawBody) as Partial<StripeEvent>;
    if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') throw new Error('Invalid Stripe event');
    event = { id: parsed.id, type: parsed.type, data: parsed.data };
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid Stripe webhook payload' }, { status: 400 });
  }

  let duplicate = false;
  try {
    await prisma.$transaction(async (tx) => {
      try {
        await tx.stripeWebhookEvent.create({
          data: { eventId: event.id, eventType: event.type },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        duplicate = true;
        return;
      }

      await applyStripeEvent(tx, event);
    });
  } catch (error) {
    logCaughtRequestError(request, '/api/webhooks/stripe', error);
    return NextResponse.json(
      { success: false, error: getApiErrorMessage(error, 'Unable to process Stripe webhook') },
      { status: 500 },
    );
  }

  // Processing is deliberately limited to one short DB transaction after raw
  // signature verification: Stripe gets a 2xx without any provider API calls.
  return NextResponse.json({ received: true, duplicate });
}

export const POST = withRequestLogging('/api/webhooks/stripe', handlePOST);
