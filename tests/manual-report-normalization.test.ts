import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { isJobInDateRange, getPaidActivityDateKey } from '../src/lib/operations-reporting.ts';

const manualJobUrl = new URL('../src/lib/manual-job.ts', import.meta.url).href;
const calculationsUrl = new URL('../src/lib/calculations.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './calculations' && context.parentURL === manualJobUrl) {
      return { url: calculationsUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { normalizeManualJobInvoice } = await import('../src/lib/manual-job.ts');

test('manual paid invoice normalizes totals and retains its historical completion date as activity date', () => {
  const job = normalizeManualJobInvoice({
    id: 'manual-backdated-1',
    jobNumber: '900001',
    status: 'COMPLETED',
    isManual: true,
    createdAt: '2026-10-07T15:00:00.000Z',
    completedAt: '2026-09-25T14:00:00.000Z',
    workerCommission: 10,
    items: [{ isPart: true, unitCost: 5, quantity: 1 }],
    invoice: {
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      paymentProvider: null,
      paidAt: null,
      totalAmountCollected: 113,
      grandTotal: 113,
      subtotal: 0,
      taxAmount: 0,
      taxCollected: true,
      cogsAmount: 0,
    },
  });

  assert.equal(job.invoice?.grandTotal, 113);
  assert.equal(job.invoice?.taxAmount, 13);
  assert.equal(getPaidActivityDateKey(job), '2026-09-25');
  assert.equal(isJobInDateRange(job, { start: '2026-09-25', end: '2026-09-25' }), true);
  assert.equal(isJobInDateRange(job, { start: '2026-10-07', end: '2026-10-07' }), false);
});

test.after(() => hooks.deregister());
