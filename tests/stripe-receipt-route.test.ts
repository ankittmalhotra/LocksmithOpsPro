import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const initialFixture = {
  issuerReads: 0, stripeReads: [] as string[], emptyIntentMetadata: false, conflictingIntentMetadata: false,
  omitSessionMetadata: false, conflictingSessionMetadata: false, omitSavedPaymentIntent: false,
  omitSavedCharge: false, omitStripeInvoice: false, expiredSession: false, modernInvoice: false,
  invoicePaymentMismatch: false, invoiceMetadataMismatch: false,
  clientReferenceId: 'invoice-1', dualPrice: false, mismatchIssuerUnit: false,
};
const fixture = { ...initialFixture };
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
          const fixture = globalThis.__stripeReceiptFixture;
          return { id: 'job-1', status: 'COMPLETED', invoice: {
            id: 'invoice-1', paymentStatus: 'PAID', taxCollected: true, paymentProvider: 'STRIPE', paymentMethod: 'CREDIT_CARD',
            totalAmountCollected: 113, grandTotal: 113,
            stripeChargeId: fixture.omitSavedCharge ? null : 'ch_legacy',
            stripePaymentIntentId: fixture.omitSavedPaymentIntent ? null : 'pi_legacy',
            stripeSessionId: 'cs_legacy', stripeInvoiceId: fixture.omitStripeInvoice ? null : 'in_legacy', pricingModel: fixture.dualPrice ? 'DUAL_PRICE_V1' : null, paidAt: null,
          } };
        }
      `,
      'stripe-receipt-test:@/lib/job-receipt': `
        export function getJobReceiptState() { return 'stripe_ready'; }
        export async function getLocksmithReceiptIssuer() {
          const fixture = globalThis.__stripeReceiptFixture;
          fixture.issuerReads += 1;
          if (!fixture.dualPrice) throw new Error('Historical Stripe docs must not depend on the current Locksmith tax profile.');
          return {
            legalName: 'Better Call Locksmith Inc.', corporationNumber: '1001348245', email: 'bcltoronto1@gmail.com',
            addressLine1: '222 Spadina Avenue, Unit 114', city: 'Toronto', province: 'Ontario', postalCode: 'M5T 3B3', country: 'Canada',
            hstRegistrationNumber: '702291725RT0001', hstEnabled: true, hstEffectiveDate: new Date('2026-01-01T00:00:00.000Z'),
          };
        }
      `,
      'stripe-receipt-test:@/lib/job-receipt-policy': 'export function requiresCurrentStripeIssuerVerification(invoice) { return invoice?.pricingModel === "DUAL_PRICE_V1"; }',
      'stripe-receipt-test:@/lib/stripe': `
        export class StripeApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
        export async function stripeGet(path) {
          const fixture = globalThis.__stripeReceiptFixture;
          fixture.stripeReads.push(path);
          if (path === '/account') return {
            id: 'acct_locksmith', business_profile: { name: 'Better Call Locksmith Inc.' },
            company: { address: { line1: '222 Spadina Avenue', line2: fixture.mismatchIssuerUnit ? 'Unit 115' : 'Unit 114', city: 'Toronto', state: 'ON', postal_code: 'M5T 3B3', country: 'CA' } },
          };
          if (path === '/tax_ids?limit=100') return { data: [{ type: 'ca_gst_hst', value: '702291725RT0001' }] };
          if (path === '/charges/ch_legacy') return {
            id: 'ch_legacy', paid: true, status: 'succeeded', currency: 'cad', amount: 11300, amount_refunded: 0,
            payment_intent: 'pi_legacy', receipt_url: 'https://pay.stripe.com/receipts/legacy-receipt',
          };
          if (path === '/payment_intents/pi_legacy?expand[]=latest_charge') return {
            id: 'pi_legacy', status: 'succeeded', amount_received: 11300, latest_charge: 'ch_legacy',
            metadata: fixture.emptyIntentMetadata ? {} : {
              invoiceId: 'invoice-1', jobId: fixture.conflictingIntentMetadata ? 'another-job' : 'job-1',
            },
          };
          if (path === '/checkout/sessions/cs_legacy?expand[]=payment_intent') return fixture.omitSessionMetadata ? {
            id: 'cs_legacy', status: fixture.expiredSession ? 'expired' : 'complete', payment_status: fixture.expiredSession ? 'unpaid' : 'paid', payment_intent: fixture.expiredSession ? null : 'pi_legacy', client_reference_id: fixture.clientReferenceId,
          } : {
            id: 'cs_legacy', status: fixture.expiredSession ? 'expired' : 'complete', payment_status: fixture.expiredSession ? 'unpaid' : 'paid', payment_intent: fixture.expiredSession ? null : 'pi_legacy',
            client_reference_id: fixture.clientReferenceId,
            metadata: { invoiceId: 'invoice-1', jobId: fixture.conflictingSessionMetadata ? 'another-job' : 'job-1' },
          };
          if (path === '/invoices/in_legacy?expand[]=account_tax_ids') return {
            id: 'in_legacy', status: 'paid', currency: 'cad', amount_paid: 11300,
            ...(fixture.modernInvoice ? {} : { payment_intent: 'pi_legacy' }),
            metadata: { invoiceId: 'invoice-1', jobId: fixture.invoiceMetadataMismatch ? 'another-job' : 'job-1' },
            account_tax_ids: [], invoice_pdf: 'https://invoice.stripe.com/i/acct_locksmith/in_legacy.pdf',
          };
          if (path === '/invoice_payments?invoice=in_legacy&status=paid&limit=100') return {
            data: [{ id: 'inpay_legacy', invoice: 'in_legacy', status: 'paid', currency: 'cad', amount_paid: 11300,
              payment: { type: 'payment_intent', payment_intent: fixture.invoicePaymentMismatch ? 'pi_another' : 'pi_legacy' } }],
            has_more: false,
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
test.beforeEach(() => Object.assign(fixture, { ...initialFixture, stripeReads: [] }));

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

test('legacy paid Checkout Session can verify its stored payment intent when optional metadata is absent', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  fixture.emptyIntentMetadata = true;
  fixture.omitSessionMetadata = true;
  fixture.conflictingSessionMetadata = false;
  fixture.omitSavedPaymentIntent = true;
  fixture.omitStripeInvoice = true;
  fixture.clientReferenceId = 'job-1';
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://pay.stripe.com/receipts/legacy-receipt');
  assert.ok(fixture.stripeReads.includes('/checkout/sessions/cs_legacy?expand[]=payment_intent'));
  fixture.emptyIntentMetadata = false;
  fixture.conflictingIntentMetadata = false;
  fixture.omitSessionMetadata = false;
  fixture.omitSavedPaymentIntent = false;
  fixture.clientReferenceId = 'invoice-1';
});

test('legacy invoice with a saved successful charge and intent is not blocked by stale Checkout Session metadata', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  fixture.emptyIntentMetadata = true;
  fixture.omitSessionMetadata = false;
  fixture.conflictingSessionMetadata = true;
  fixture.omitSavedPaymentIntent = false;
  fixture.clientReferenceId = 'a-legacy-reference';
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://pay.stripe.com/receipts/legacy-receipt');
  assert.equal(fixture.stripeReads.some((path) => path.startsWith('/checkout/sessions/')), false, 'saved Stripe charge and intent IDs provide the legacy invoice binding');
  fixture.emptyIntentMetadata = false;
  fixture.conflictingSessionMetadata = false;
  fixture.conflictingIntentMetadata = false;
  fixture.clientReferenceId = 'invoice-1';
});

test('legacy payment intent with explicitly conflicting invoice metadata is rejected despite saved IDs', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  fixture.emptyIntentMetadata = false;
  fixture.conflictingIntentMetadata = true;
  fixture.omitSavedPaymentIntent = false;
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 409);
  assert.match(await response.text(), /payment intent metadata conflicts/);
  fixture.conflictingIntentMetadata = false;
});

test('saved Checkout Session with conflicting invoice metadata is rejected', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  fixture.emptyIntentMetadata = true;
  fixture.omitSessionMetadata = false;
  fixture.conflictingSessionMetadata = true;
  fixture.omitSavedPaymentIntent = true;
  fixture.omitStripeInvoice = true;
  fixture.clientReferenceId = 'invoice-1';
  // A legacy session without metadata is accepted above. Here Stripe does
  // return metadata, but it points to a different job and must fail closed.
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 409);
  assert.match(await response.text(), /saved Checkout Session does not verify/);
  fixture.conflictingSessionMetadata = false;
  fixture.omitSavedPaymentIntent = false;
  fixture.emptyIntentMetadata = false;
  fixture.clientReferenceId = 'invoice-1';
});

test('paid invoice verifies legacy receipt and PDF when its saved Session is expired and saved charge ID is absent', async () => {
  fixture.emptyIntentMetadata = true;
  fixture.omitSavedCharge = true;
  fixture.expiredSession = true;
  fixture.modernInvoice = true;
  for (const kind of ['receipt', 'invoice']) {
    fixture.stripeReads = [];
    const response = await GET(new Request(`https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=${kind}`), { params: Promise.resolve({ id: 'job-1' }) });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), kind === 'receipt'
      ? 'https://pay.stripe.com/receipts/legacy-receipt'
      : 'https://invoice.stripe.com/i/acct_locksmith/in_legacy.pdf');
    assert.ok(fixture.stripeReads.includes('/invoice_payments?invoice=in_legacy&status=paid&limit=100'));
    assert.equal(fixture.stripeReads.some(path => path.startsWith('/checkout/sessions/')), false);
    assert.equal(fixture.stripeReads.filter(path => path.startsWith('/invoices/')).length, 1, 'reuse the verified invoice for the PDF');
  }
});

test('modern invoice PDF verifies InvoicePayments when PaymentIntent metadata already matches', async () => {
  fixture.modernInvoice = true;
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=invoice'), { params: Promise.resolve({ id: 'job-1' }) });
  assert.equal(response.status, 302);
  assert.ok(fixture.stripeReads.includes('/invoice_payments?invoice=in_legacy&status=paid&limit=100'));
});

test('expired Session recovery rejects a paid invoice allocated to a different PaymentIntent', async () => {
  fixture.emptyIntentMetadata = true;
  fixture.omitSavedCharge = true;
  fixture.expiredSession = true;
  fixture.modernInvoice = true;
  fixture.invoicePaymentMismatch = true;
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /no paid invoice allocation matches/);
});

test('expired Session recovery rejects paid invoice metadata belonging to another job', async () => {
  fixture.emptyIntentMetadata = true;
  fixture.omitSavedCharge = true;
  fixture.expiredSession = true;
  fixture.modernInvoice = true;
  fixture.invoiceMetadataMismatch = true;
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /invoice metadata or payment intent/);
});

test('new Locksmith issuer details accept Stripe suite line and Ontario abbreviation', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  fixture.dualPrice = true;
  fixture.emptyIntentMetadata = false;
  fixture.mismatchIssuerUnit = false;
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 302);
  assert.equal(fixture.issuerReads, 1);
  fixture.dualPrice = false;
});

test('dual-price receipt still requires complete matching PaymentIntent metadata', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  fixture.dualPrice = true;
  fixture.emptyIntentMetadata = true;
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 409);
  assert.match(await response.text(), /accepted dual-price invoice/);
  fixture.emptyIntentMetadata = false;
  fixture.dualPrice = false;
});

test('new Locksmith issuer verification rejects an incorrect Stripe suite', async () => {
  fixture.issuerReads = 0;
  fixture.stripeReads = [];
  fixture.dualPrice = true;
  fixture.mismatchIssuerUnit = true;
  const response = await GET(new Request('https://portal.example.test/api/jobs/job-1/receipt/stripe?kind=receipt'), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 409);
  assert.match(await response.text(), /business address does not match/);
  fixture.dualPrice = false;
  fixture.mismatchIssuerUnit = false;
});

test.after(() => {
  fixture.emptyIntentMetadata = false;
  fixture.conflictingIntentMetadata = false;
  fixture.omitSessionMetadata = false;
  fixture.conflictingSessionMetadata = false;
  fixture.omitSavedPaymentIntent = false;
  fixture.clientReferenceId = 'invoice-1';
  hooks.deregister();
});
