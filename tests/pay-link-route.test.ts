import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const fixture = {
  invoice: null as Record<string, any> | null,
  jobUpdatedAt: new Date('2026-10-07T12:00:00Z'),
  updateCount: 1,
  created: [] as Record<string, any>[],
  expired: [] as string[],
  updates: [] as Record<string, any>[],
};
Object.assign(globalThis, { __payLinkFixture: fixture });

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['next/server', '@/lib/prisma', '@/lib/stripe', '@/lib/request-logger'].includes(specifier)) {
      return { url: `pay-link-test:${specifier}`, shortCircuit: true };
    }
    if (specifier === '@/lib/card-pay-link') return { url: new URL('../src/lib/card-pay-link.ts', import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const mocks: Record<string, string> = {
      'pay-link-test:next/server': `export class NextResponse { static json(body, init = {}) { return new Response(JSON.stringify(body), { status: init.status || 200 }); } }`,
      'pay-link-test:@/lib/request-logger': `export function withRequestLogging(_p, fn) { return fn; } export function logCaughtRequestError() {}`,
      'pay-link-test:@/lib/stripe': `
        const f = globalThis.__payLinkFixture;
        export class StripeApiError extends Error {}
        export class StripeConfigurationError extends Error {}
        export async function createStripePaymentLink(params) {
          f.created.push(params);
          return { paymentUrl: 'https://checkout.stripe.test/cs-new', sessionId: 'cs-new', customerId: 'cus-1', sessionStatus: 'open',
            expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(), stripeInvoiceId: null, stripePaymentIntentId: null };
        }
        export async function expireStripeCheckoutSession(id) { f.expired.push(id); }
      `,
      'pay-link-test:@/lib/prisma': `
        const f = globalThis.__payLinkFixture;
        const tx = {
          async $queryRaw() {},
          job: { async findUnique() { return { updatedAt: f.jobUpdatedAt }; } },
          customer: { async updateMany() { return { count: 1 }; } },
          invoice: { async updateMany(args) { f.updates.push(args); return { count: f.updateCount }; } },
        };
        export const prisma = {
          invoice: { async findUnique({ where }) { return f.invoice && f.invoice.payToken === where.payToken ? f.invoice : null; } },
          async $transaction(fn) { return fn(tx); },
        };
      `,
    };
    if (mocks[url]) return { format: 'module', source: mocks[url], shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { POST } = await import('../src/app/api/pay/[token]/route.ts');
hooks.deregister();

const TOKEN = 'A'.repeat(32);
function reset(overrides: Record<string, unknown> = {}) {
  fixture.invoice = {
    id: 'invoice-1', payToken: TOKEN, paymentStatus: 'PENDING', paymentMethod: 'CREDIT_CARD', pricingModel: 'CARD_TOTAL_V1',
    grandTotal: 117.52, subtotal: 104, taxAmount: 13.52, stripeSessionId: null, stripeSessionStatus: null,
    stripeSessionExpiresAt: null, stripePaymentUrl: null,
    job: { id: 'job-1', jobNumber: '42', serviceAddress: '1 Main St', updatedAt: fixture.jobUpdatedAt,
      customer: { id: 'customer-1', name: 'Pat Example', phone: '4165550100', address: '1 Main St', postalCode: null, stripeCustomerId: null } },
    ...overrides,
  };
  fixture.updateCount = 1; fixture.created = []; fixture.expired = []; fixture.updates = [];
}
async function pay(token = TOKEN) {
  const response = await POST(new Request(`https://portal.test/api/pay/${token}`, { method: 'POST' }), { params: Promise.resolve({ token }) });
  return { status: response.status, body: await response.json() };
}

test('unknown or malformed tokens are not found and never reach Stripe', async () => {
  reset();
  assert.equal((await pay('short')).status, 404);
  assert.equal((await pay('B'.repeat(32))).status, 404);
  assert.equal(fixture.created.length, 0);
});

test('paid jobs and jobs no longer on a card link do not create Checkout', async () => {
  reset({ paymentStatus: 'PAID' });
  const paid = await pay();
  assert.equal(paid.status, 409); assert.equal(paid.body.paid, true);
  reset({ paymentMethod: 'CASH' });
  assert.equal((await pay()).status, 410);
  assert.equal(fixture.created.length, 0);
});

test('opening the link creates Checkout for the exact saved total without Stripe Tax or fee lines', async () => {
  reset();
  const result = await pay();
  assert.equal(result.status, 200);
  assert.equal(result.body.checkoutUrl, 'https://checkout.stripe.test/cs-new');
  const params = fixture.created[0];
  assert.equal(params.grandTotal, 117.52); assert.equal(params.subtotal, 104); assert.equal(params.taxAmount, 13.52);
  assert.equal(params.cardSurchargeAmount, 0); assert.equal(params.automaticTax, false);
  assert.equal(params.returnUrl, `https://portal.test/pay/${TOKEN}`);
  assert.equal(fixture.updates[0].where.payToken, TOKEN);
  assert.equal(fixture.updates[0].data.stripeSessionId, 'cs-new');
});

test('an open unexpired session is reused instead of creating another', async () => {
  reset({ stripeSessionId: 'cs-old', stripeSessionStatus: 'open', stripePaymentUrl: 'https://checkout.stripe.test/cs-old', stripeSessionExpiresAt: new Date(Date.now() + 3600000) });
  const result = await pay();
  assert.equal(result.body.checkoutUrl, 'https://checkout.stripe.test/cs-old');
  assert.equal(fixture.created.length, 0);
});

test('a nearly expired session is closed first, and a new one is created', async () => {
  reset({ stripeSessionId: 'cs-old', stripeSessionStatus: 'open', stripePaymentUrl: 'https://checkout.stripe.test/cs-old', stripeSessionExpiresAt: new Date(Date.now() + 60000) });
  const result = await pay();
  assert.equal(result.status, 200);
  assert.deepEqual(fixture.expired, ['cs-old']);
  assert.match(fixture.created[0].requestRevision, /:cs-old$/);
});

test('if the bill changes while Stripe is creating the session, the new session is expired', async () => {
  reset();
  fixture.updateCount = 0;
  const result = await pay();
  assert.equal(result.status, 409);
  assert.deepEqual(fixture.expired, ['cs-new']);
});
