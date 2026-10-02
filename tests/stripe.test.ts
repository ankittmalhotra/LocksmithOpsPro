import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import {
  createStripePaymentLink,
  expireStripeCheckoutSession,
  toStripeCents,
  verifyStripeWebhookSignature,
} from '../src/lib/stripe.ts';

const originalFetch = globalThis.fetch;
const originalStripeKey = process.env.STRIPE_SECRET_KEY;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalStripeKey;
});

test('converts server invoice amounts to integer CAD cents', () => {
  assert.equal(toStripeCents(123.456, 'amount'), 12346);
  assert.throws(() => toStripeCents(Number.NaN, 'amount'));
});

test('expires an open Checkout Session before a quote edit', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_backend_unit';
  const calls: Array<{ method: string; url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const method = String(init?.method || 'GET');
    const url = String(input);
    const body = String(init?.body || '');
    calls.push({ method, url, body });
    if (method === 'GET') {
      return new Response(JSON.stringify({ id: 'cs_test_to_expire', status: 'open', payment_status: 'unpaid' }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'cs_test_to_expire', status: 'expired' }), { status: 200 });
  };

  await expireStripeCheckoutSession('cs_test_to_expire');

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[1]?.method, 'POST');
  assert.equal(calls[1]?.url, 'https://api.stripe.com/v1/checkout/sessions/cs_test_to_expire/expire');
});

test('creates hosted Checkout without prefilled customer email and with idempotency', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_backend_unit';
  const calls: Array<{ url: string; headers: Headers; encodedBody: string; body: URLSearchParams }> = [];
  globalThis.fetch = async (input, init) => {
    const body = String(init?.body || '');
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      encodedBody: body,
      body: new URLSearchParams(body),
    });
    return new Response(JSON.stringify({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      status: 'open',
      created: 1_700_000_000,
      expires_at: 1_700_086_400,
      invoice: 'in_test_123',
      payment_intent: 'pi_test_123',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await createStripePaymentLink({
    invoiceId: 'invoice-local-1',
    customerId: 'customer-local-1',
    jobId: 'job-local-1',
    jobNumber: '1001',
    customerName: 'Customer One',
    customerPhone: '+14165550101',
    customerAddress: '1 Main Street, Toronto, ON',
    stripeCustomerId: 'cus_existing_123',
    grandTotal: 113.00,
    subtotal: 100,
    taxAmount: 13,
    cardSurchargeAmount: 0,
    returnUrl: 'https://portal.example.test/dispatch/jobs/job-local-1',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  const bodyHash = createHash('sha256').update(`/checkout/sessions\n${calls[0].encodedBody}`).digest('hex');
  assert.equal(calls[0].headers.get('Idempotency-Key'), `locksmith-checkout-invoice-local-1-v2-${bodyHash}`);
  assert.equal(calls[0].body.get('mode'), 'payment');
  assert.equal(calls[0].body.get('ui_mode'), null);
  assert.equal(calls[0].body.get('customer'), 'cus_existing_123');
  assert.equal(calls[0].body.get('customer_creation'), null);
  assert.equal(calls[0].body.get('customer_email'), null);
  assert.equal(calls[0].body.get('invoice_creation[enabled]'), 'true');
  assert.equal(calls[0].body.get('client_reference_id'), 'invoice-local-1');
  assert.equal(calls[0].body.get('line_items[0][price_data][unit_amount]'), '10000');
  assert.equal(calls[0].body.get('line_items[1][price_data][unit_amount]'), '1300');
  assert.equal(result.sessionId, 'cs_test_123');
  assert.equal(result.stripeInvoiceId, 'in_test_123');
  assert.equal(result.stripePaymentIntentId, 'pi_test_123');
});

test('retries identical Checkout bodies and uses a fresh key after an amount edit', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_backend_unit';
  const calls: Array<{ key: string | null; body: URLSearchParams }> = [];
  globalThis.fetch = async (_input, init) => {
    calls.push({
      key: new Headers(init?.headers).get('Idempotency-Key'),
      body: new URLSearchParams(String(init?.body || '')),
    });
    return new Response(JSON.stringify({ id: 'cs_test_retry', url: 'https://checkout.stripe.com/retry' }), { status: 200 });
  };

  const params = {
    invoiceId: 'invoice-local-edited',
    customerId: 'customer-local-edited',
    jobId: 'job-local-edited',
    jobNumber: '1004',
    customerName: 'Customer Four',
    customerPhone: '+14165550104',
    customerAddress: '4 Main Street, Toronto, ON',
    stripeCustomerId: 'cus_existing_456',
    grandTotal: 104,
    subtotal: 100,
    taxAmount: 0,
    cardSurchargeAmount: 4,
    automaticTax: true,
    returnUrl: 'https://portal.example.test/dispatch/jobs/job-local-edited',
    requestRevision: '2026-09-23T14:00:00.000Z',
  };
  await createStripePaymentLink(params);
  await createStripePaymentLink(params);
  await createStripePaymentLink({ ...params, grandTotal: 124.8, subtotal: 120, cardSurchargeAmount: 4.8 });
  await createStripePaymentLink({ ...params, requestRevision: '2026-09-23T14:01:00.000Z' });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].key, calls[1].key);
  assert.notEqual(calls[0].key, calls[2].key);
  assert.notEqual(calls[0].key, calls[3].key);
  assert.equal(calls[0].body.get('line_items[0][price_data][unit_amount]'), '10000');
  assert.equal(calls[2].body.get('line_items[0][price_data][unit_amount]'), '12000');
  assert.equal(calls[3].body.get('line_items[0][price_data][unit_amount]'), '10000');
});

test('falls back to Checkout customer creation when pre-creating a customer fails', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_backend_unit';
  const bodies: URLSearchParams[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = new URLSearchParams(String(init?.body || ''));
    bodies.push(body);
    if (bodies.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'invalid address' } }), { status: 400 });
    }
    return new Response(JSON.stringify({ id: 'cs_test_fallback', url: 'https://checkout.stripe.com/fallback' }), { status: 200 });
  };

  await createStripePaymentLink({
    invoiceId: 'invoice-local-2',
    customerId: 'customer-local-2',
    jobId: 'job-local-2',
    jobNumber: '1002',
    customerName: 'Customer Two',
    customerPhone: '+14165550102',
    customerAddress: '2 Main Street, Toronto, ON',
    grandTotal: 10,
    subtotal: 10,
    taxAmount: 0,
    cardSurchargeAmount: 0,
    returnUrl: 'https://portal.example.test/dispatch/jobs/job-local-2',
  });

  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].get('customer_creation'), 'always');
  assert.equal(bodies[1].get('customer_email'), null);
});

test('uses Stripe Tax and itemizes the service plus configurable card fee', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_backend_unit';
  const checkoutBodies: URLSearchParams[] = [];
  globalThis.fetch = async (_input, init) => {
    checkoutBodies.push(new URLSearchParams(String(init?.body || '')));
    return new Response(JSON.stringify({
      id: 'cs_test_automatic_tax',
      url: 'https://checkout.stripe.com/automatic-tax',
      status: 'open',
    }), { status: 200 });
  };

  await createStripePaymentLink({
    invoiceId: 'invoice-local-tax',
    customerId: 'customer-local-tax',
    jobId: 'job-local-tax',
    jobNumber: '1003',
    customerName: 'Tax Customer',
    customerPhone: '+14165550103',
    customerAddress: '3 Main Street, Toronto, ON',
    stripeCustomerId: 'cus_existing_tax',
    grandTotal: 104,
    subtotal: 100,
    taxAmount: 0,
    cardSurchargeAmount: 4,
    automaticTax: true,
    returnUrl: 'https://portal.example.test/dispatch/jobs/job-local-tax',
  });

  const body = checkoutBodies[0];
  if (!body) throw new Error('Checkout request body was not captured');
  assert.equal(body.get('automatic_tax[enabled]'), 'true');
  assert.equal(body.get('billing_address_collection'), 'required');
  assert.equal(body.get('invoice_creation[invoice_data][rendering_options][amount_tax_display]'), 'exclude_tax');
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), '10000');
  assert.equal(body.get('line_items[0][price_data][product_data][name]'), 'Locksmith Service - Job #1003');
  assert.equal(body.get('line_items[0][price_data][product_data][tax_code]'), 'txcd_20030000');
  assert.equal(body.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.equal(body.get('line_items[1][price_data][unit_amount]'), '400');
  assert.equal(body.get('line_items[1][price_data][product_data][name]'), 'Card Processing Fee');
  assert.equal(body.get('line_items[1][price_data][product_data][tax_code]'), 'txcd_20030000');
});

test('dual-price Checkout sends only the accepted card service price and reconciles its exact quote metadata', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_backend_unit';
  const checkoutBodies: URLSearchParams[] = [];
  globalThis.fetch = async (_input, init) => {
    checkoutBodies.push(new URLSearchParams(String(init?.body || '')));
    return new Response(JSON.stringify({
      id: 'cs_test_dual_price',
      url: 'https://checkout.stripe.com/dual-price',
      status: 'open',
      amount_subtotal: 10400,
      amount_total: 11752,
      total_details: { amount_tax: 1352 },
    }), { status: 200 });
  };

  const params = {
    invoiceId: 'invoice-dual-price',
    customerId: 'customer-dual-price',
    jobId: 'job-dual-price',
    jobNumber: '1042',
    customerName: 'Dual Price Customer',
    customerPhone: '+14165551042',
    customerAddress: '42 Main Street, Toronto, ON',
    stripeCustomerId: 'cus_dual_price',
    grandTotal: 104,
    subtotal: 104,
    taxAmount: 0,
    cardSurchargeAmount: 0,
    pricingModel: 'DUAL_PRICE_V1',
    automaticTax: true,
    returnUrl: 'https://portal.example.test/dispatch/jobs/job-dual-price',
    requestRevision: 'quote-revision-1',
  };
  const result = await createStripePaymentLink(params);

  assert.equal(checkoutBodies.length, 1);
  const body = checkoutBodies[0];
  if (!body) throw new Error('Checkout request body was not captured');
  assert.equal(body.get('automatic_tax[enabled]'), 'true');
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), '10400');
  assert.equal(body.get('line_items[0][price_data][product_data][name]'), 'Locksmith Service - Job #1042');
  assert.equal(body.get('line_items[0][price_data][product_data][tax_code]'), 'txcd_20030000');
  assert.equal(body.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.equal(body.get('line_items[1][price_data][unit_amount]'), null);
  assert.doesNotMatch(body.toString(), /Card Processing|Surcharge|Admin Fee/i);
  assert.equal(body.get('metadata[pricingModel]'), 'DUAL_PRICE_V1');
  assert.equal(body.get('metadata[acceptedPriceOption]'), 'CARD');
  assert.equal(body.get('metadata[cardPriceCents]'), '10400');
  assert.equal(body.get('invoice_creation[invoice_data][metadata][pricingModel]'), 'DUAL_PRICE_V1');
  assert.equal(body.get('invoice_creation[invoice_data][metadata][acceptedPriceOption]'), 'CARD');
  assert.equal(body.get('invoice_creation[invoice_data][metadata][cardPriceCents]'), '10400');
  assert.equal(result.amountTotal, 117.52);
  assert.equal(result.amountTax, 13.52);

  await assert.rejects(
    createStripePaymentLink({ ...params, grandTotal: 105 }),
    /accepted card service price as its only pre-tax amount/,
    'A mismatched pre-tax total must not be sent to Stripe',
  );
  assert.equal(checkoutBodies.length, 1, 'Invalid quote totals fail before a second Stripe request');
});

test('verifies Stripe raw webhook signatures and rejects stale or altered payloads', () => {
  const payload = '{"id":"evt_123","type":"invoice.paid"}';
  const secret = 'whsec_backend_unit';
  const timestamp = 1_700_000_000;
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const signature = `t=${timestamp},v1=${digest}`;

  assert.doesNotThrow(() => verifyStripeWebhookSignature(payload, signature, secret, 300, timestamp));
  assert.throws(() => verifyStripeWebhookSignature(`${payload} `, signature, secret, 300, timestamp));
  assert.throws(() => verifyStripeWebhookSignature(payload, signature, secret, 300, timestamp + 301));
});
