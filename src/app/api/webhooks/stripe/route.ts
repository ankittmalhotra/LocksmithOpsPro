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
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value / 100
    : null;
}

function taxAmountFromStripeObject(object: StripeObject): number | null {
  const totalDetails = asRecord(object.total_details);
  const directTax = amountFromCents(totalDetails?.amount_tax);
  if (directTax !== null) return directTax;
  if (totalDetails?.amount_tax !== undefined && totalDetails.amount_tax !== null) {
    throw new Error('Invalid Stripe tax amount.');
  }

  // Invoice tax fields changed across Stripe API versions. An absent field
  // means unknown; an explicitly empty array means zero tax.
  const totalTaxes = Array.isArray(object.total_taxes)
    ? object.total_taxes
    : Array.isArray(object.total_tax_amounts) ? object.total_tax_amounts : null;
  if (totalTaxes !== null) {
    let cents = 0;
    for (const tax of totalTaxes) {
      const amount = asRecord(tax)?.amount;
      if (amountFromCents(amount) === null) throw new Error('Invalid Stripe tax amount.');
      cents += amount as number;
    }
    const total = amountFromCents(cents);
    if (total === null) throw new Error('Invalid Stripe tax total.');
    return total;
  }
  const legacyTax = amountFromCents(object.tax);
  if (legacyTax === null && object.tax !== undefined && object.tax !== null) {
    throw new Error('Invalid Stripe tax amount.');
  }
  return legacyTax;
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
  const stripeChargeId = object.object === 'charge' ? stringValue(object.id) : null;
  const paymentIntentId = providerId(object.payment_intent);
  const candidates: Prisma.InvoiceWhereInput[] = [];

  if (metadataInvoiceId) candidates.push({ id: metadataInvoiceId });
  if (metadataJobId) candidates.push({ jobId: metadataJobId });
  if (clientReferenceId) candidates.push({ id: clientReferenceId }, { jobId: clientReferenceId });
  if (sessionId) candidates.push({ stripeSessionId: sessionId });
  if (stripeChargeId) candidates.push({ stripeChargeId });
  if (paymentIntentId) candidates.push({ stripePaymentIntentId: paymentIntentId });
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

  const candidate = await findInvoiceForEvent(tx, object);
  if (!candidate) {
    if (event.type === 'charge.refunded') {
      // Roll back the event ledger row too, so Stripe can retry after the
      // corresponding invoice/payment identifiers have been persisted.
      throw new Error('Unmatched Stripe refund event; retry after the payment record is available.');
    }
    return;
  }

  // Serialize Stripe settlement with quote edits and payment-link creation.
  // The first lookup only identifies the row to lock; all decisions below use
  // a fresh invoice/job snapshot read after acquiring the same row lock used by
  // manual quote edits.
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${candidate.id} FOR UPDATE`;
  const invoice = await tx.invoice.findUnique({
    where: { id: candidate.id },
    include: { job: { include: { customer: true } } },
  });
  if (!invoice) return;

  const checkoutEvent = event.type.startsWith('checkout.session.');
  const invoiceEvent = event.type.startsWith('invoice.');
  const eventObjectId = providerId(object.id);
  if (checkoutEvent && invoice.stripeSessionId !== eventObjectId) {
    // A previous quote's Checkout URL may still be in a customer's browser.
    // Never attach that payment (or its failure/expiry state) to the new quote.
    // Throwing rolls back the event ledger row and asks Stripe to retry, which
    // also covers the short window before a newly-created session is persisted.
    if (event.type === 'checkout.session.completed'
      || event.type === 'checkout.session.async_payment_succeeded') {
      throw new Error('Stale Stripe Checkout session completed after its invoice quote changed. Payment requires manual reconciliation.');
    }
    return;
  }
  if (invoiceEvent && invoice.stripeInvoiceId !== eventObjectId) {
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      throw new Error('Stale Stripe invoice was paid after its invoice quote changed. Payment requires manual reconciliation.');
    }
    return;
  }

  const confirmedPayment =
    ((event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') && object.status === 'paid') ||
    ((event.type === 'checkout.session.async_payment_succeeded' || event.type === 'checkout.session.completed') && object.payment_status === 'paid');
  const settled = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(invoice.paymentStatus);

  // Expiry/failure and other lifecycle snapshots are not payment evidence.
  // Stripe delivers events out of order, including expiry of old unpaid links
  // after a successful payment. Freeze settled records against those events.
  if (settled && !confirmedPayment && event.type !== 'charge.refunded') return;
  if (confirmedPayment && !isCardPaymentMethod(invoice.paymentMethod)) return;
  if (confirmedPayment && ['PARTIALLY_REFUNDED', 'REFUNDED'].includes(invoice.paymentStatus)) return;
  if ((metadataValue(object, 'invoiceId') && metadataValue(object, 'invoiceId') !== invoice.id)
    || (metadataValue(object, 'jobId') && metadataValue(object, 'jobId') !== invoice.jobId)) {
    throw new Error('Stripe event metadata does not match the saved invoice.');
  }

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
  // Only a confirmed payment may change accounting amounts. Invoice totals
  // describe what was billed; amount_paid describes what was actually paid.
  const stripeTotal = confirmedPayment
    ? amountFromCents(checkoutEvent ? object.amount_total : object.amount_paid)
    : null;
  const stripeTaxAmount = confirmedPayment ? taxAmountFromStripeObject(object) : null;
  if (confirmedPayment) {
    if (object.currency !== 'cad' || stripeTotal === null || stripeTotal <= 0
      || object.paid_out_of_band === true
      || (invoiceEvent && amountFromCents(object.total) !== stripeTotal)
      || (stripeTaxAmount !== null && stripeTaxAmount > stripeTotal)) {
      throw new Error('Stripe payment has invalid or unsupported settlement amounts.');
    }
    if ((stripeInvoiceId && invoice.stripeInvoiceId && stripeInvoiceId !== invoice.stripeInvoiceId)
      || (settled && stripePaymentIntentId && invoice.stripePaymentIntentId && stripePaymentIntentId !== invoice.stripePaymentIntentId)
      || (settled && stripeChargeId && invoice.stripeChargeId && stripeChargeId !== invoice.stripeChargeId)) {
      throw new Error('Stripe payment identifiers conflict with the recorded settlement.');
    }
    if (settled && Math.round(invoice.totalAmountCollected * 100) !== Math.round(stripeTotal * 100)) {
      throw new Error('Stripe payment differs from the recorded collection; manual reconciliation is required.');
    }
  }

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
    ...(checkoutEvent && sessionStatus ? { stripeSessionStatus: sessionStatus } : {}),
    ...(sessionExpiresAt ? { stripeSessionExpiresAt: sessionExpiresAt, stripePaymentLinkExpiresAt: sessionExpiresAt } : {}),
    ...(customerEmail ? { customerEmailCollectedAt: invoice.customerEmailCollectedAt || now } : {}),
    ...(stripeTotal !== null ? { grandTotal: stripeTotal } : {}),
    ...(stripeTaxAmount !== null ? { taxAmount: stripeTaxAmount, taxCollected: stripeTaxAmount > 0 } : {}),
  };

  const sessionFailed = event.type === 'checkout.session.async_payment_failed';
  const sessionExpired = event.type === 'checkout.session.expired';
  const fullRefund = event.type === 'charge.refunded'
    && typeof object.amount === 'number'
    && typeof object.amount_refunded === 'number'
    && object.amount > 0
    && object.amount_refunded >= object.amount;
  const partialRefund = event.type === 'charge.refunded'
    && typeof object.amount === 'number'
    && typeof object.amount_refunded === 'number'
    && object.amount_refunded > 0
    && object.amount_refunded < object.amount;

  if (confirmedPayment && invoice.pricingModel === 'DUAL_PRICE_V1') {
    const metadata = asRecord(object.metadata);
    const observedSubtotalCents = typeof object.amount_subtotal === 'number'
      ? object.amount_subtotal
      : typeof object.subtotal === 'number' ? object.subtotal : null;
    const expectedCardPriceCents = Math.round(Number(invoice.cardPrice || 0) * 100);
    if (metadata?.pricingModel !== 'DUAL_PRICE_V1'
      || metadata?.acceptedPriceOption !== 'CARD'
      || metadata?.cardPriceCents !== String(expectedCardPriceCents)
      || observedSubtotalCents !== expectedCardPriceCents) {
      throw new Error('Stripe payment does not match the accepted dual-price card quote; settlement was not recorded. Reconcile this payment against the saved quote before marking it paid.');
    }
  }

  if (event.type === 'invoice.sent') {
    invoiceData.invoiceSentAt = invoice.invoiceSentAt || now;
  }
  if (event.type === 'invoice.payment_failed' || sessionFailed) {
    invoiceData.paymentFailedAt = now;
    if (sessionFailed) invoiceData.stripeSessionStatus = 'payment_failed';
  }
  if (sessionExpired) invoiceData.stripeSessionStatus = 'expired';
  if (fullRefund && invoice.paymentProvider === 'STRIPE') invoiceData.paymentStatus = 'REFUNDED';
  if (partialRefund && invoice.paymentProvider === 'STRIPE' && invoice.paymentStatus !== 'REFUNDED') invoiceData.paymentStatus = 'PARTIALLY_REFUNDED';

  // A Stripe confirmation can only settle a card invoice. Never let a
  // webhook change a cash/Interac invoice to PAID.
  if (confirmedPayment && isCardPaymentMethod(invoice.paymentMethod) && !['PARTIALLY_REFUNDED', 'REFUNDED'].includes(invoice.paymentStatus)) {
    invoiceData.paymentStatus = 'PAID';
    invoiceData.totalAmountCollected = stripeTotal!;
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
