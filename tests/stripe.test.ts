import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  createStripePaymentLink,
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

test('creates hosted Checkout without prefilled customer email and with idempotency', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_backend_unit';
  const calls: Array<{ url: string; headers: Headers; body: URLSearchParams }> = [];
  globalThis.fetch = async (input, init) => {
    const body = String(init?.body || '');
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
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
    idempotencyKey: 'locksmith-checkout-invoice-local-1-initial',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(calls[0].headers.get('Idempotency-Key'), 'locksmith-checkout-invoice-local-1-initial');
  assert.equal(calls[0].body.get('mode'), 'payment');
  assert.equal(calls[0].body.get('ui_mode'), 'hosted');
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
