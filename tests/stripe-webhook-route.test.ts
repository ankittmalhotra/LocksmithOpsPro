import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const fixture = { invoice: {} as Record<string, any>, ledger: new Set<string>(), updates: 0, locks: 0 };
Object.assign(globalThis, { __stripeWebhookFixture: fixture });
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['next/server', '@/lib/prisma', '@/lib/stripe', '@/lib/api-error', '@/lib/request-logger'].includes(specifier)) {
      return { url: `webhook-test:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const mocks: Record<string, string> = {
      'webhook-test:next/server': `export class NextResponse { static json(body, init = {}) { return new Response(JSON.stringify(body), { status: init.status || 200 }); } }`,
      'webhook-test:@/lib/stripe': `export function verifyStripeWebhookSignature() {}`,
      'webhook-test:@/lib/api-error': `export function getApiErrorMessage(e) { return e.message; }`,
      'webhook-test:@/lib/request-logger': `export function withRequestLogging(path, fn) { return fn; } export function logCaughtRequestError() {}`,
      'webhook-test:@/lib/prisma': `
        const f = globalThis.__stripeWebhookFixture;
        const tx = {
          stripeWebhookEvent: { async create({data}) { if(f.ledger.has(data.eventId)) throw {code:'P2002'}; f.ledger.add(data.eventId); } },
          async $queryRaw() { f.locks++; },
          invoice: {
            async findFirst() { return f.invoice; }, async findUnique() { return f.invoice; },
            async update({data}) { f.updates++; Object.assign(f.invoice, data); return f.invoice; }
          },
          customer: { async findUnique() { return null; } }
        };
        export const prisma = { async $transaction(fn) {
          const before = structuredClone(f.invoice), ledger = new Set(f.ledger);
          try { return await fn(tx); } catch(e) { f.invoice = before; f.ledger = ledger; throw e; }
        }};
      `,
    };
    if (mocks[url]) return { format: 'module', source: mocks[url], shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { POST } = await import('../src/app/api/webhooks/stripe/route.ts');
hooks.deregister();
process.env.STRIPE_WEBHOOK_SECRET = 'test-secret';
function reset(overrides: Record<string, unknown> = {}) {
  fixture.invoice = {
    id: 'invoice-1', jobId: 'job-1', job: { customerId: 'customer-1' },
    paymentMethod: 'CREDIT_CARD', paymentProvider: 'STRIPE', paymentStatus: 'PENDING',
    grandTotal: 988, taxAmount: 0, taxCollected: true, totalAmountCollected: 0,
    stripeSessionId: 'cs-1', stripeSessionStatus: 'open', stripeInvoiceId: 'in-1',
    paidAt: null, paymentFailedAt: null, pricingModel: null, ...overrides,
  };
  fixture.ledger = new Set(); fixture.updates = 0; fixture.locks = 0;
}
async function deliver(type: string, object: Record<string, unknown>, id = 'evt-1') {
  return POST(new Request('https://portal.test/api/webhooks/stripe', {
    method: 'POST', body: JSON.stringify({ id, type, data: { object } }),
  }));
}
function session(extra: Record<string, unknown> = {}) {
  return { object: 'checkout.session', id: 'cs-1', currency: 'cad', status: 'complete', payment_status: 'paid', amount_total: 98717, total_details: { amount_tax: 11357 }, metadata: { invoiceId: 'invoice-1', jobId: 'job-1' }, ...extra };
}
function paidInvoice(extra: Record<string, unknown> = {}) {
  return { object: 'invoice', id: 'in-1', status: 'paid', currency: 'cad', amount_paid: 98717, total: 98717, total_taxes: [{ amount: 11357 }], ...extra };
}

test('paid Checkout records actual collection and Stripe HST, then ignores same-session expiration', async () => {
  reset(); assert.equal((await deliver('checkout.session.completed', session())).status, 200);
  assert.equal(fixture.invoice.grandTotal, 987.17); assert.equal(fixture.invoice.taxAmount, 113.57);
  assert.equal(fixture.invoice.totalAmountCollected, 987.17); assert.equal(fixture.invoice.paymentStatus, 'PAID');
  const before = structuredClone(fixture.invoice);
  assert.equal((await deliver('checkout.session.expired', session({ status: 'expired', payment_status: 'unpaid', amount_total: 98800, total_details: { amount_tax: 0 } }), 'evt-expired')).status, 200);
  assert.deepEqual(fixture.invoice, before); assert.equal(fixture.locks, 2);
});
test('all unpaid lifecycle events preserve settled money, provider identifiers and payment state', async () => {
  for (const type of ['checkout.session.async_payment_failed', 'checkout.session.completed', 'invoice.finalized', 'invoice.sent', 'invoice.payment_failed']) {
    reset({ paymentStatus: 'PAID', grandTotal: 998.92, taxAmount: 114.92, totalAmountCollected: 998.92 });
    const before = structuredClone(fixture.invoice);
    const obj = type.startsWith('invoice.') ? paidInvoice({ status: 'open', amount_paid: 0, total: 62400, total_taxes: [] }) : session({ payment_status: 'unpaid', amount_total: 62400, total_details: { amount_tax: 0 } });
    assert.equal((await deliver(type, obj)).status, 200); assert.deepEqual(fixture.invoice, before);
  }
});
test('unpaid pending session may expire but never changes quoted accounting amounts', async () => {
  reset({ grandTotal: 998.92, taxAmount: 114.92 });
  assert.equal((await deliver('checkout.session.expired', session({ status: 'expired', payment_status: 'unpaid', amount_total: 62400, total_details: { amount_tax: 0 } }))).status, 200);
  assert.equal(fixture.invoice.grandTotal, 998.92); assert.equal(fixture.invoice.taxAmount, 114.92);
  assert.equal(fixture.invoice.stripeSessionStatus, 'expired'); assert.equal(fixture.invoice.paymentStatus, 'PENDING');
});
test('invoice.paid and invoice.payment_succeeded accept current and legacy tax arrays', async () => {
  for (const type of ['invoice.paid', 'invoice.payment_succeeded']) {
    for (const taxes of [{ total_taxes: [{ amount: 10920 }, { amount: 437 }] }, { total_taxes: undefined, total_tax_amounts: [{ amount: 11357 }] }]) {
      reset(); assert.equal((await deliver(type, paidInvoice(taxes))).status, 200);
      assert.equal(fixture.invoice.taxAmount, 113.57); assert.equal(fixture.invoice.grandTotal, 987.17);
      assert.equal(fixture.invoice.stripeSessionStatus, 'open'); // Invoice status is not Checkout status.
    }
  }
});
test('unknown tax preserves saved tax; explicit zero clears tax', async () => {
  reset({ taxAmount: 12 }); await deliver('invoice.paid', paidInvoice({ total_taxes: undefined }));
  assert.equal(fixture.invoice.taxAmount, 12);
  reset({ taxAmount: 12 }); await deliver('invoice.paid', paidInvoice({ total_taxes: [] }));
  assert.equal(fixture.invoice.taxAmount, 0); assert.equal(fixture.invoice.taxCollected, false);
});
test('invalid amounts, foreign currency, out-of-band and mismatched metadata roll back the ledger', async () => {
  for (const extra of [{ currency: 'usd' }, { amount_paid: 98716 }, { amount_paid: null }, { total: 98717.5 }, { total_taxes: [{ amount: -1 }] }, { total_taxes: [{ amount: '11357' }] }, { total_taxes: [{ amount: 99800 }] }, { paid_out_of_band: true }, { metadata: { invoiceId: 'another-invoice' } }]) {
    reset(); const before = structuredClone(fixture.invoice);
    assert.equal((await deliver('invoice.paid', paidInvoice(extra))).status, 500);
    assert.deepEqual(fixture.invoice, before); assert.equal(fixture.ledger.size, 0);
  }
});
test('settled collection disagreement requires reconciliation, while matching paid event repairs tax', async () => {
  reset({ paymentStatus: 'PAID', totalAmountCollected: 998.92 });
  assert.equal((await deliver('invoice.paid', paidInvoice())).status, 500);
  reset({ paymentStatus: 'PAID', totalAmountCollected: 987.17 });
  assert.equal((await deliver('invoice.paid', paidInvoice())).status, 200);
  assert.equal(fixture.invoice.taxAmount, 113.57); assert.equal(fixture.invoice.grandTotal, 987.17);
});
test('stale expiry is ignored and stale paid session/invoice requires reconciliation', async () => {
  reset(); const before = structuredClone(fixture.invoice);
  assert.equal((await deliver('checkout.session.expired', session({ id: 'cs-old', payment_status: 'unpaid' }))).status, 200);
  assert.deepEqual(fixture.invoice, before);
  assert.equal((await deliver('checkout.session.completed', session({ id: 'cs-old' }), 'evt-paid')).status, 500);
  assert.equal((await deliver('invoice.payment_succeeded', paidInvoice({ id: 'in-old' }), 'evt-invoice')).status, 500);
});
test('cash invoice cannot have financials changed by card confirmation', async () => {
  reset({ paymentMethod: 'CASH' }); const before = structuredClone(fixture.invoice);
  assert.equal((await deliver('checkout.session.completed', session())).status, 200);
  assert.deepEqual(fixture.invoice, before);
});
test('refund and late successful payment preserve original paid financials and refund status', async () => {
  reset({ paymentStatus: 'PAID', grandTotal: 987.17, taxAmount: 113.57, totalAmountCollected: 987.17 });
  await deliver('charge.refunded', { object: 'charge', id: 'ch-1', amount: 98717, amount_refunded: 10000 });
  assert.equal(fixture.invoice.paymentStatus, 'PARTIALLY_REFUNDED');
  const before = structuredClone(fixture.invoice);
  await deliver('invoice.paid', paidInvoice(), 'evt-late'); assert.deepEqual(fixture.invoice, before);
  await deliver('charge.refunded', { object: 'charge', id: 'ch-1', amount: 98717, amount_refunded: 98717 }, 'evt-full');
  assert.equal(fixture.invoice.paymentStatus, 'REFUNDED'); assert.equal(fixture.invoice.grandTotal, 987.17);
});
test('duplicate events do not repeat updates', async () => {
  reset(); await deliver('invoice.paid', paidInvoice());
  const response = await deliver('invoice.paid', paidInvoice());
  assert.equal((await response.json()).duplicate, true); assert.equal(fixture.updates, 1);
});
test('accepted dual price quote must match Stripe pre-tax subtotal and metadata', async () => {
  reset({ pricingModel: 'DUAL_PRICE_V1', cardPrice: 873.6 });
  assert.equal((await deliver('invoice.paid', paidInvoice())).status, 500);
  assert.equal((await deliver('invoice.paid', paidInvoice({ subtotal: 87360, metadata: { pricingModel: 'DUAL_PRICE_V1', acceptedPriceOption: 'CARD', cardPriceCents: '87360' } }))).status, 200);
});

test('Checkout validates integer cents, tax and existing paid provider identity', async () => {
  for (const extra of [{ amount_total: -1 }, { amount_total: 98717.2 }, { amount_total: null }, { total_details: { amount_tax: -1 } }, { total_details: { amount_tax: '11357' } }, { invoice: 'in-other' }]) {
    reset(); assert.equal((await deliver('checkout.session.completed', session(extra))).status, 500);
    assert.equal(fixture.ledger.size, 0);
  }
  reset({ paymentStatus: 'PAID', totalAmountCollected: 987.17, stripePaymentIntentId: 'pi-original' });
  assert.equal((await deliver('checkout.session.completed', session({ payment_intent: 'pi-other' }))).status, 500);
});
test('async paid Checkout settles, while legacy scalar invoice tax is accepted', async () => {
  reset(); await deliver('checkout.session.async_payment_succeeded', session());
  assert.equal(fixture.invoice.paymentStatus, 'PAID'); assert.equal(fixture.invoice.taxAmount, 113.57);
  reset(); await deliver('invoice.paid', paidInvoice({ total_taxes: undefined, tax: 11357 }));
  assert.equal(fixture.invoice.taxAmount, 113.57);
});
