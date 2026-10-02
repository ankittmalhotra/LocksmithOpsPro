import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const fixture: { invoiceKind: 'receipt' | 'invoice'; issuerReads: number; stripeReads: string[] } = {
  invoiceKind: 'receipt', issuerReads: 0, stripeReads: [],
};
Object.assign(globalThis, { __stripeReceiptFixture: fixture });

const hooks = registerHooks({
  resolve(specifier, _context, nextResolve) {
    const mocks = [
      'next/server', '@/lib/auth', '@/lib/job-helper', '@/lib/job-receipt',
      '@/lib/job-receipt-policy', '@/lib/stripe', '@/lib/request-logger',
    ];
    if (mocks.includes(specifier)) return { url: `stripe-receipt-test:${specifier}`, shortCircuit: true };
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    const mocks: Record<string, string> = {
      'stripe-receipt-test:next/server': `
        export class NextResponse extends Response {
          static json(body, init = {}) { return new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } }); }
          static redirect(url, init = {}) { return new Response(null, { status: typeof init === 'number' ? init : (init.status || 302), headers: { location: String(url), ...(typeof init === 'object' ? init.headers || {} : {}) } }); }
        }
      `,
      'stripe-receipt-test:@/lib/auth': 'export async function getCurrentUser() { return { id: "dispatcher-1", role: "DISPATCHER" }; }',
      'stripe-receipt-test:@/lib/job-helper': `
        export async function findJobByIdOrNumber() {
          return { id: 'job-1', status: 'COMPLETED', invoice: {
            id: 'invoice-1', paymentStatus: 'PAID', taxCollected: true, paymentProvider: 'STRIPE', paymentMethod: 'CREDIT_CARD',
            totalAmountCollected: 113, grandTotal: 113, stripeChargeId: 'ch_legacy', stripePaymentIntentId: 'pi_legacy',
            stripeSessionId: null, stripeInvoiceId: 'in_legacy', pricingModel: null, paidAt: null,
          } };
        }
      `,
      'stripe-receipt-test:@/lib/job-receipt': `
        export function getJobReceiptState() { return 'stripe_ready'; }
        export async function getLocksmithReceiptIssuer() { globalThis.__stripeReceiptFixture.issuerReads += 1; throw new Error('Historical Stripe docs must not depend on the current Locksmith tax profile.'); }
      `,
      'stripe-receipt-test:@/lib/job-receipt-policy': 'export function requiresCurrentStripeIssuerVerification(invoice) { return invoice?.pricingModel === "DUAL_PRICE_V1"; }',
      'stripe-receipt-test:@/lib/stripe': `
        export class StripeApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
        export async function stripeGet(path) {
          const fixture = globalThis.__stripeReceiptFixture;
          fixture.stripeReads.push(path);
          if (path === '/account') return { id: 'acct_locksmith' };
          if (path === '/charges/ch_legacy') return {
            id: 'ch_legacy', paid: true, status: 'succeeded', currency: 'cad', amount: 11300, amount_refunded: 0,
            payment_intent: 'pi_legacy', receipt_url: 'https://pay.stripe.com/receipts/legacy-receipt',
          };
          if (path === '/payment_intents/pi_legacy?expand[]=latest_charge') return {
            id: 'pi_legacy', status: 'succeeded', amount_received: 11300, latest_charge: 'ch_legacy',
            metadata: { invoiceId: 'invoice-1', jobId: 'job-1' },
          };
          if (path === '/invoices/in_legacy?expand[]=account_tax_ids&expand[]=payment_intent') return {
            id: 'in_legacy', status: 'paid', currency: 'cad', amount_paid: 11300, payment_intent: 'pi_legacy',
            metadata: { invoiceId: 'invoice-1', jobId: 'job-1' },
            account_tax_ids: [], invoice_pdf: 'https://invoice.stripe.com/i/acct_locksmith/in_legacy.pdf',
          };
          throw new Error('Unexpected Stripe request: ' + path);
        }
      `,
      'stripe-receipt-test:@/lib/request-logger': `
        export function logCaughtRequestError() {}
        export function withRequestLogging(_route, handler) { return handler; }
      `,
    };
    if (mocks[url]) return { format: 'module', shortCircuit: true, source: mocks[url] };
    return nextLoad(url, context);
  },
});

const { GET } = await import('../src/app/api/jobs/[id]/receipt/stripe/route.ts');

test('historical Stripe receipt remains the original Stripe document without local paidAt or current issuer configuration', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://pay.stripe.com/receipts/legacy-receipt');
  assert.equal(fixture.issuerReads, 0);
  assert.ok(fixture.stripeReads.includes('/account'), 'configured account pin is checked');
});

test('historical paid Stripe invoice PDF is returned unchanged without revalidating its historical HST profile', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=invoice'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://invoice.stripe.com/i/acct_locksmith/in_legacy.pdf');
  assert.equal(fixture.issuerReads, 0);
  assert.equal(fixture.stripeReads.some((path) => path.startsWith('/tax_ids/')), false);
});

test.after(() => hooks.deregister());
