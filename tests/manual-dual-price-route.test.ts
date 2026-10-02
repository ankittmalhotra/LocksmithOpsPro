import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const fixture: { transactionCalls: number; createdInvoice: Record<string, any> | null } = {
  transactionCalls: 0, createdInvoice: null,
};
Object.assign(globalThis, { __manualDualPriceFixture: fixture });

const actual = (path: string) => new URL(path, import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, _context, nextResolve) {
    const files: Record<string, string> = {
      '@/lib/calculations': '../src/lib/calculations.ts',
      '@/lib/job-number': '../src/lib/job-number.ts',
      '@/lib/manual-amount': '../src/lib/manual-amount.ts',
      '@/lib/timezone': '../src/lib/timezone.ts',
    };
    if (files[specifier]) return { url: actual(files[specifier]), shortCircuit: true };
    const mocks = ['next/server', '@/lib/prisma', '@/lib/auth', '@/lib/manual-job', '@/lib/revenue-email', '@/lib/request-logger', '@/lib/api-error'];
    if (mocks.includes(specifier)) return { url: `manual-dual-price-test:${specifier}`, shortCircuit: true };
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    const mocks: Record<string, string> = {
      'manual-dual-price-test:next/server': `
        export class NextResponse extends Response {
          static json(body, init = {}) { return new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } }); }
        }
      `,
      'manual-dual-price-test:@/lib/prisma': `
        const fixture = globalThis.__manualDualPriceFixture;
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
      'manual-dual-price-test:@/lib/auth': 'export async function getCurrentUser() { return { id: "dispatcher-1", role: "DISPATCHER" }; }',
      'manual-dual-price-test:@/lib/manual-job': `
        export const MANUAL_JOB_RECEIVED_TIME_SLOTS = [];
        export const MANUAL_PAYMENT_METHODS = ['CASH', 'INTERAC', 'DEBIT_CARD', 'CREDIT_CARD'];
        export const MANUAL_SERVICE_TYPES = ['Residential Lockout'];
      `,
      'manual-dual-price-test:@/lib/revenue-email': 'export async function sendRevenueChangeEmail() { return { success: true, error: null }; }',
      'manual-dual-price-test:@/lib/request-logger': 'export function logCaughtRequestError() {} export function withRequestLogging(_route, handler) { return handler; }',
      'manual-dual-price-test:@/lib/api-error': 'export function getApiErrorMessage(error, fallback) { return error?.message || fallback; }',
    };
    if (mocks[url]) return { format: 'module', shortCircuit: true, source: mocks[url] };
    return nextLoad(url, context);
  },
});

const { POST } = await import('../src/app/api/jobs/manual/route.ts');
const basePayload = {
  jobNumber: '900001', jobDate: '2026-09-30', customerName: 'Example Customer', customerPhone: '4165550100',
  serviceAddress: '1 Main Street, Toronto, ON', serviceType: 'Residential Lockout', description: 'Lockout service',
  paymentMethod: 'CREDIT_CARD', paymentStatus: 'PENDING', totalAmountCollected: 100, cogsAmount: 0,
  technicianCommission: 0, technicianId: 'tech-1', taxCollected: true, cardPriceDifferenceRate: 4,
  customerAcceptedCardPrice: true, quoteAcceptanceMethod: 'VERBAL', quoteAcceptanceEvidence: 'Approved by phone',
};

test('manual job API rejects a card-price difference above 4% before opening a write transaction', async () => {
  fixture.transactionCalls = 0;
  fixture.createdInvoice = null;
  const response = await POST(new Request('https://portal.example.test/api/jobs/manual', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...basePayload, cardPriceDifferenceRate: 4.01 }),
  }));

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /between 0% and 4%/);
  assert.equal(fixture.transactionCalls, 0);
  assert.equal(fixture.createdInvoice, null);
});

test('manual job API rejects percentages that exceed 4% by less than one displayed increment', async () => {
  fixture.transactionCalls = 0;
  const response = await POST(new Request('https://portal.example.test/api/jobs/manual', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...basePayload, cardPriceDifferenceRate: 4.0001 }),
  }));

  assert.equal(response.status, 400);
  assert.equal(fixture.transactionCalls, 0);
});

test('manual job API persists the accepted 4% two-price quote without a fee line', async () => {
  fixture.transactionCalls = 0;
  fixture.createdInvoice = null;
  const response = await POST(new Request('https://portal.example.test/api/jobs/manual', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(basePayload),
  }));

  assert.equal(response.status, 201);
  assert.equal(fixture.transactionCalls, 1);
  const savedInvoice: any = fixture.createdInvoice;
  assert.equal(savedInvoice?.pricingModel, 'DUAL_PRICE_V1');
  assert.equal(savedInvoice?.nonCardPrice, 100);
  assert.equal(savedInvoice?.cardPrice, 104);
  assert.equal(savedInvoice?.subtotal, 104);
  assert.equal(savedInvoice?.cardSurchargeRate, 0);
  assert.equal(savedInvoice?.cardSurchargeAmount, 0);
  assert.equal(savedInvoice?.acceptedPriceOption, 'CARD');
  assert.equal(savedInvoice?.quoteAcceptanceMethod, 'VERBAL');
  assert.equal(savedInvoice?.quoteAcceptanceEvidence, 'Approved by phone');
});

test.after(() => hooks.deregister());
