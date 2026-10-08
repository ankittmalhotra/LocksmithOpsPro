import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const fixture: { transactionCalls: number; createdInvoice: Record<string, any> | null } = {
  transactionCalls: 0, createdInvoice: null,
};
Object.assign(globalThis, { __manualCardLinkFixture: fixture });

const actual = (path: string) => new URL(path, import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, _context, nextResolve) {
    const files: Record<string, string> = {
      '@/lib/calculations': '../src/lib/calculations.ts',
      '@/lib/job-number': '../src/lib/job-number.ts',
      '@/lib/manual-amount': '../src/lib/manual-amount.ts',
      '@/lib/timezone': '../src/lib/timezone.ts',
      '@/lib/card-pay-link': '../src/lib/card-pay-link.ts',
    };
    if (files[specifier]) return { url: actual(files[specifier]), shortCircuit: true };
    const mocks = ['next/server', '@/lib/prisma', '@/lib/auth', '@/lib/manual-job', '@/lib/revenue-email', '@/lib/request-logger', '@/lib/api-error', '@/lib/partner-billing-snapshot-refresh'];
    if (mocks.includes(specifier)) return { url: `manual-card-link-test:${specifier}`, shortCircuit: true };
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    const mocks: Record<string, string> = {
      'manual-card-link-test:next/server': `
        export class NextResponse extends Response {
          static json(body, init = {}) { return new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } }); }
        }
      `,
      'manual-card-link-test:@/lib/prisma': `
        const fixture = globalThis.__manualCardLinkFixture;
        const tx = {
          customer: { async findFirst() { return { id: 'customer-1', name: 'Example Customer' }; } },
          job: { async create({ data }) {
            fixture.createdInvoice = data.invoice.create;
            return { id: 'job-1', jobNumber: data.jobNumber, ...data, customer: { id: 'customer-1', name: 'Example Customer', phone: '4165550100' }, invoice: data.invoice.create };
          } },
        };
        export const prisma = {
          job: { async findUnique() { return null; } },
          user: { async findUnique() { return { id: 'tech-1', name: 'Technician', role: 'TECHNICIAN', active: true }; } },
          async $transaction(callback) { fixture.transactionCalls += 1; return callback(tx); },
        };
      `,
      'manual-card-link-test:@/lib/auth': 'export async function getCurrentUser() { return { id: "dispatcher-1", role: "DISPATCHER" }; }',
      'manual-card-link-test:@/lib/manual-job': `
        export const MANUAL_JOB_RECEIVED_TIME_SLOTS = [];
        export const MANUAL_PAYMENT_METHODS = ['CASH', 'INTERAC', 'DEBIT_CARD', 'CREDIT_CARD'];
        export const MANUAL_SERVICE_TYPES = ['Residential Lockout'];
      `,
      'manual-card-link-test:@/lib/revenue-email': 'export async function sendRevenueChangeEmail() { return { success: true, error: null }; }',
      'manual-card-link-test:@/lib/request-logger': 'export function logCaughtRequestError() {} export function withRequestLogging(_route, handler) { return handler; }',
      'manual-card-link-test:@/lib/partner-billing-snapshot-refresh': 'export async function refreshUnissuedPartnerBillingSnapshots() {}',
      'manual-card-link-test:@/lib/api-error': 'export function getApiErrorMessage(error, fallback) { return error?.message || fallback; }',
    };
    if (mocks[url]) return { format: 'module', shortCircuit: true, source: mocks[url] };
    return nextLoad(url, context);
  },
});

const { POST } = await import('../src/app/api/jobs/manual/route.ts');
const basePayload = {
  jobNumber: '900001', jobDate: '2026-09-30', customerName: 'Example Customer', customerPhone: '4165550100',
  serviceAddress: '1 Main Street, Toronto, ON', serviceType: 'Residential Lockout', description: 'Lockout service',
  paymentMethod: 'CREDIT_CARD', paymentStatus: 'PENDING', totalAmountCollected: 117.52, cogsAmount: 0,
  technicianCommission: 0, technicianId: 'tech-1', taxCollected: false,
};

function post(payload: Record<string, unknown>) {
  return POST(new Request('https://portal.example.test/api/jobs/manual', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }));
}

test('card link job charges exactly the entered total with HST extracted and no fee line', async () => {
  fixture.transactionCalls = 0;
  fixture.createdInvoice = null;
  const response = await post(basePayload);
  assert.equal(response.status, 201);
  const data = await response.json();
  const saved: any = fixture.createdInvoice;
  assert.equal(saved?.pricingModel, 'CARD_TOTAL_V1');
  assert.equal(saved?.grandTotal, 117.52);
  assert.equal(saved?.totalAmountCollected, 117.52);
  assert.equal(saved?.subtotal, 104);
  assert.equal(saved?.taxAmount, 13.52);
  assert.equal(saved?.taxCollected, true, 'a card link total always includes HST');
  assert.equal(saved?.cardSurchargeAmount, 0);
  assert.equal(saved?.paymentStatus, 'PENDING');
  assert.match(saved?.payToken, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(data.payLinkCreated, true);
  assert.equal(data.payUrl, `https://portal.example.test/pay/${saved.payToken}`);
});

test('card link job needs no dispatcher-entered quote acceptance', async () => {
  const response = await post({ ...basePayload, jobNumber: '900002', customerAcceptedCardPrice: false });
  assert.equal(response.status, 201);
});

test('paid jobs get no pay token or pricing model', async () => {
  fixture.createdInvoice = null;
  const response = await post({ ...basePayload, jobNumber: '900003', paymentMethod: 'CASH', paymentStatus: 'PAID', taxCollected: true });
  assert.equal(response.status, 201);
  const data = await response.json();
  const saved: any = fixture.createdInvoice;
  assert.equal(saved?.pricingModel, null);
  assert.equal(saved?.payToken, null);
  assert.equal(data.payUrl, null);
});

test('card link total must be positive', async () => {
  fixture.transactionCalls = 0;
  const response = await post({ ...basePayload, jobNumber: '900004', totalAmountCollected: 0 });
  assert.equal(response.status, 400);
  assert.equal(fixture.transactionCalls, 0);
});

test.after(() => hooks.deregister());
