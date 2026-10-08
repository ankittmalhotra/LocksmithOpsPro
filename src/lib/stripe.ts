/**
 * Stripe REST helpers for one-time hosted Checkout payments.
 *
 * This project intentionally keeps the dependency surface small, so these
 * helpers use Stripe's documented form-encoded REST API rather than adding a
 * second SDK. No helper in this module falls back to a simulated payment URL.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1';

export interface CreatePaymentLinkParams {
  invoiceId: string;
  customerId: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerPostalCode?: string | null;
  stripeCustomerId?: string | null;
  grandTotal: number;
  subtotal: number;
  taxAmount: number;
  cardSurchargeAmount: number;
  /** New quotes send the accepted card price as a single service line. */
  pricingModel?: string | null;
  /** Enables Stripe Tax for the pending manual-card pricing path. */
  automaticTax?: boolean;
  returnUrl: string;
  /** Changes when the saved job is edited, even if an amount is later restored. */
  requestRevision?: string;
}

export interface PaymentLinkResult {
  paymentUrl: string;
  sessionId: string;
  customerId: string | null;
  sessionStatus: string;
  expiresAt: Date | null;
  createdAt: Date;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  amountTotal: number | null;
  amountTax: number | null;
}

interface StripeResponse {
  id?: unknown;
  url?: unknown;
  status?: unknown;
  expires_at?: unknown;
  created?: unknown;
  invoice?: unknown;
  payment_intent?: unknown;
  amount_total?: unknown;
  amount_subtotal?: unknown;
  total_details?: { amount_tax?: unknown };
  error?: { message?: unknown };
}

export class StripeConfigurationError extends Error {
  constructor(message = 'Stripe payments are not configured') {
    super(message);
    this.name = 'StripeConfigurationError';
  }
}

export class StripeApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'StripeApiError';
    this.status = status;
  }
}

export type StripeObjectResponse = Record<string, any>;

export async function stripeGet(path: string): Promise<StripeObjectResponse> {
  if (!path.startsWith('/') || path.includes('..')) throw new StripeApiError('Invalid Stripe API path', 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${STRIPE_API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${getStripeSecretKey()}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    let payload: StripeObjectResponse = {};
    try { payload = await response.json() as StripeObjectResponse; } catch { /* status error below */ }
    if (!response.ok) {
      throw new StripeApiError(getString(payload.error?.message) || `Stripe API request failed with status ${response.status}`, response.status);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeConfigurationError();
  return key;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function getProviderId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && 'id' in value) {
    return getString((value as { id?: unknown }).id);
  }
  return null;
}

export function toStripeCents(amount: number, label: string): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be a finite non-negative amount`);
  }
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`${label} is outside Stripe's supported amount range`);
  }
  return cents;
}

function appendQuery(urlString: string, values: Record<string, string>): string {
  const url = new URL(urlString);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.toString();
}

function addLineItem(
  params: URLSearchParams,
  index: number,
  amount: number,
  name: string,
  automaticTax = false,
) {
  const cents = toStripeCents(amount, name);
  // Zero-value line items are not useful in Checkout and can be rejected by
  // payment-method-specific validation, so omit them from the request.
  if (cents === 0) return false;
  params.set(`line_items[${index}][price_data][currency]`, 'cad');
  params.set(`line_items[${index}][price_data][unit_amount]`, String(cents));
  params.set(`line_items[${index}][price_data][product_data][name]`, name);
  if (automaticTax) {
    // General services makes both the locksmith service and the explicitly
    // disclosed card fee taxable, allowing Stripe Tax to calculate Ontario
    // HST from the customer's billing location.
    params.set(`line_items[${index}][price_data][product_data][tax_code]`, 'txcd_20030000');
    params.set(`line_items[${index}][price_data][tax_behavior]`, 'exclusive');
  }
  params.set(`line_items[${index}][quantity]`, '1');
  return true;
}

async function stripePost(
  path: string,
  body: URLSearchParams,
  scope: string,
): Promise<StripeResponse> {
  const secretKey = getStripeSecretKey();
  const encodedBody = body.toString();
  // Stripe rejects a reused key when any request parameter differs. Hash the
  // exact body being sent so code changes and customer fallbacks get new keys.
  // v2 also avoids keys cached by the previous invoice-field fingerprint.
  const fingerprint = createHash('sha256').update(`${path}\n${encodedBody}`).digest('hex');
  const idempotencyKey = `locksmith-${scope}-v2-${fingerprint}`;
  const response = await fetch(`${STRIPE_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: encodedBody,
  });

  let payload: StripeResponse = {};
  try {
    payload = await response.json() as StripeResponse;
  } catch {
    // Preserve a useful status-based error for a non-JSON upstream response.
  }
  if (!response.ok) {
    const providerMessage = getString(payload.error?.message);
    throw new StripeApiError(
      providerMessage || `Stripe API request failed with status ${response.status}`,
      response.status,
    );
  }
  return payload;
}

/** Expire a saved, open Checkout Session before its local quote is changed. */
export async function expireStripeCheckoutSession(sessionId: string): Promise<void> {
  if (!sessionId.trim() || sessionId.includes('/')) throw new StripeApiError('Invalid Stripe Checkout Session ID', 400);
  const current = await stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (current.id !== sessionId) throw new StripeApiError('Stripe returned a different Checkout Session.', 409);
  if (current.status === 'expired') return;
  if (current.status !== 'open' || current.payment_status === 'paid') {
    throw new StripeApiError('Checkout Session is no longer open. Reload the paid or completed job before editing its quote.', 409);
  }
  const response = await stripePost(
    `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    new URLSearchParams(),
    `expire-checkout-${sessionId}`,
  );
  if (response.status !== 'expired') {
    throw new StripeApiError('Stripe did not confirm Checkout Session expiration; the quote was not changed.', 409);
  }
}

async function createStripeCustomer(params: CreatePaymentLinkParams): Promise<string> {
  const body = new URLSearchParams({
    name: params.customerName,
    phone: params.customerPhone,
    'address[line1]': params.customerAddress,
    'address[country]': 'CA',
    'metadata[customerId]': params.customerId,
    'metadata[jobId]': params.jobId,
  });
  if (params.customerPostalCode?.trim()) {
    body.set('address[postal_code]', params.customerPostalCode.trim());
  }

  const response = await stripePost(
    '/customers',
    body,
    `customer-${params.customerId}`,
  );
  const customerId = getString(response.id);
  if (!customerId) throw new StripeApiError('Stripe did not return a customer ID', 502);
  return customerId;
}

/**
 * Creates one hosted Checkout Session. The caller is responsible for checking
 * for and reusing an unexpired open session before calling this function.
 */
export async function createStripePaymentLink(
  params: CreatePaymentLinkParams,
): Promise<PaymentLinkResult> {
  const subtotalCents = toStripeCents(params.subtotal, 'Subtotal');
  const taxCents = toStripeCents(params.taxAmount, 'Tax amount');
  const dualPriceQuote = params.pricingModel === 'DUAL_PRICE_V1';
  const surchargeCents = dualPriceQuote ? 0 : toStripeCents(params.cardSurchargeAmount, 'Card surcharge');
  const totalCents = toStripeCents(params.grandTotal, 'Grand total');
  const itemizedCents = subtotalCents + taxCents + surchargeCents;
  const automaticTax = params.automaticTax === true;

  if (dualPriceQuote && (!automaticTax || surchargeCents !== 0 || taxCents !== 0 || subtotalCents !== totalCents)) {
    throw new Error('Dual-price Checkout must use the accepted card service price as its only pre-tax amount; Stripe Tax supplies the final tax and total.');
  }

  // The invoice total is authoritative. Normally the rounded component sum
  // equals it; if legacy data has a one-cent drift, use one total line item so
  // Checkout can never charge a different amount than the server invoice.
  const useItemizedLines = itemizedCents === totalCents;
  if (totalCents === 0) {
    throw new Error('Grand total must be greater than zero');
  }

  let stripeCustomerId = params.stripeCustomerId?.trim() || null;
  if (!stripeCustomerId) {
    try {
      stripeCustomerId = await createStripeCustomer(params);
    } catch (error) {
      // A Checkout Session can still create a Customer and collect the email
      // when pre-creating one is not possible. Keep the payment path usable,
      // while preserving known identity fields whenever Stripe accepts them.
      if (!(error instanceof StripeApiError)) throw error;
    }
  }

  const successUrl = appendQuery(params.returnUrl, {
    payment: 'success',
    session_id: '{CHECKOUT_SESSION_ID}',
  });
  const cancelUrl = appendQuery(params.returnUrl, { payment: 'cancelled' });
  const body = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    success_url: successUrl,
    cancel_url: cancelUrl,
    billing_address_collection: 'auto',
    'invoice_creation[enabled]': 'true',
    'invoice_creation[invoice_data][metadata][invoiceId]': params.invoiceId,
    'invoice_creation[invoice_data][metadata][jobId]': params.jobId,
    'invoice_creation[invoice_data][metadata][customerId]': params.customerId,
    'invoice_creation[invoice_data][description]': `Locksmith invoice for Job #${params.jobNumber}`,
    client_reference_id: params.invoiceId,
    'metadata[invoiceId]': params.invoiceId,
    'metadata[jobId]': params.jobId,
    'metadata[jobNumber]': params.jobNumber,
    'metadata[customerId]': params.customerId,
    'payment_intent_data[metadata][invoiceId]': params.invoiceId,
    'payment_intent_data[metadata][jobId]': params.jobId,
  });
  if (params.requestRevision) body.set('metadata[jobRevision]', params.requestRevision);
  if (dualPriceQuote) {
    const acceptedCardPriceCents = String(subtotalCents);
    body.set('metadata[pricingModel]', 'DUAL_PRICE_V1');
    body.set('metadata[acceptedPriceOption]', 'CARD');
    body.set('metadata[cardPriceCents]', acceptedCardPriceCents);
    body.set('invoice_creation[invoice_data][metadata][pricingModel]', 'DUAL_PRICE_V1');
    body.set('invoice_creation[invoice_data][metadata][acceptedPriceOption]', 'CARD');
    body.set('invoice_creation[invoice_data][metadata][cardPriceCents]', acceptedCardPriceCents);
  } else if (params.pricingModel) {
    body.set('metadata[pricingModel]', params.pricingModel);
    body.set('invoice_creation[invoice_data][metadata][pricingModel]', params.pricingModel);
  }

  if (automaticTax) {
    body.set('automatic_tax[enabled]', 'true');
    body.set('billing_address_collection', 'required');
    body.set('invoice_creation[invoice_data][rendering_options][amount_tax_display]', 'exclude_tax');
  }

  if (stripeCustomerId) {
    body.set('customer', stripeCustomerId);
    body.set('customer_update[name]', 'auto');
    body.set('customer_update[address]', 'auto');
  } else {
    body.set('customer_creation', 'always');
  }

  if (useItemizedLines) {
    let index = 0;
    if (addLineItem(body, index, params.subtotal, `Locksmith Service - Job #${params.jobNumber}`, automaticTax)) index += 1;
    if (!automaticTax && addLineItem(body, index, params.taxAmount, 'Ontario HST (13%)')) index += 1;
    if (!dualPriceQuote) {
      addLineItem(body, index, params.cardSurchargeAmount, automaticTax ? 'Card Processing Fee' : 'Card Processing Surcharge', automaticTax);
    }
  } else {
    addLineItem(body, 0, params.grandTotal, `Locksmith Service - Job #${params.jobNumber}`, automaticTax);
  }

  const response = await stripePost(
    '/checkout/sessions',
    body,
    `checkout-${params.invoiceId}`,
  );
  const paymentUrl = getString(response.url);
  const sessionId = getString(response.id);
  if (!paymentUrl || !sessionId) {
    throw new StripeApiError('Stripe did not return a hosted Checkout URL', 502);
  }

  const createdAt = typeof response.created === 'number'
    ? new Date(response.created * 1000)
    : new Date();
  const expiresAt = typeof response.expires_at === 'number'
    ? new Date(response.expires_at * 1000)
    : null;

  return {
    paymentUrl,
    sessionId,
    customerId: stripeCustomerId,
    sessionStatus: getString(response.status) || 'open',
    expiresAt,
    createdAt,
    stripeInvoiceId: getProviderId(response.invoice),
    stripePaymentIntentId: getProviderId(response.payment_intent),
    amountTotal: typeof response.amount_total === 'number' ? response.amount_total / 100 : null,
    amountTax: typeof response.total_details?.amount_tax === 'number' ? response.total_details.amount_tax / 100 : null,
  };
}

/**
 * Verifies Stripe's documented raw-body signature format without parsing or
 * reserializing the request body before verification.
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  endpointSecret: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header');
  const parts = signatureHeader.split(',').map((part) => part.trim());
  const timestampValue = parts.find((part) => part.startsWith('t='))?.slice(2);
  const timestamp = Number(timestampValue);
  if (!timestampValue || !Number.isInteger(timestamp)) throw new Error('Invalid Stripe webhook timestamp');
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) throw new Error('Expired Stripe webhook signature');

  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3))
    .filter(Boolean);
  if (signatures.length === 0) throw new Error('Missing Stripe webhook v1 signature');

  const expected = createHmac('sha256', endpointSecret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest();
  const matches = signatures.some((candidate) => {
    try {
      const actual = Buffer.from(candidate, 'hex');
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  });
  if (!matches) throw new Error('Stripe webhook signature verification failed');
}
