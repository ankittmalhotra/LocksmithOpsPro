import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const fixture: {
  canManageExpenses: boolean;
  expense: null | { id: string; entityId: string; vendorName: string; totalAmount: { toString(): string }; voidedAt: Date | null };
  activeAllocations: number;
  updates: Array<Record<string, any>>;
  audits: Array<Record<string, any>>;
  transactionOptions: any;
} = {
  canManageExpenses: true,
  expense: { id: 'expense-1', entityId: 'entity-1', vendorName: 'Parts Store', totalAmount: { toString: () => '25.50' }, voidedAt: null },
  activeAllocations: 0,
  updates: [],
  audits: [],
  transactionOptions: null,
};
Object.assign(globalThis, { __expenseVoidFixture: fixture });

const actual = (path: string) => new URL(path, import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, _context, nextResolve) {
    const mocked = ['next/server', '@prisma/client', '@/lib/prisma', '@/lib/accounting-auth', '@/lib/request-logger', '@/lib/api-error', '@/lib/books-api', '@/lib/accounting-receipts'];
    return mocked.includes(specifier) ? { url: `expense-void-test:${specifier}`, shortCircuit: true } : nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    const mocks: Record<string, string> = {
      'expense-void-test:next/server': `export class NextResponse extends Response { static json(body, init = {}) { return new Response(JSON.stringify(body), { status: init.status || 200, headers: { 'content-type': 'application/json' } }); } }`,
      'expense-void-test:@prisma/client': `export const Prisma = { TransactionIsolationLevel: { Serializable: 'Serializable' } };`,
      'expense-void-test:@/lib/prisma': `
        const f = globalThis.__expenseVoidFixture;
        const tx = {
          accountingExpense: {
            async findFirst({ where }) { return f.expense?.id === where.id && f.expense.entityId === where.entityId ? f.expense : null; },
            async update({ where, data }) { f.updates.push({ where, data }); if (f.expense) f.expense.voidedAt = data.voidedAt; return f.expense; },
          },
          accountingReimbursementAllocation: { async count() { return f.activeAllocations; } },
          accountingAuditEvent: { async create({ data }) { f.audits.push(data); } },
        };
        export const prisma = { accountingExpense: tx.accountingExpense, async $transaction(callback, options) { f.transactionOptions = options; return callback(tx); } };
      `,
      'expense-void-test:@/lib/accounting-auth': `export async function getAccountingEntityAccess() { const f = globalThis.__expenseVoidFixture; return { canManageExpenses: f.canManageExpenses, entity: { id: 'entity-1' }, user: { id: 'user-1' } }; }`,
      'expense-void-test:@/lib/request-logger': `export function logCaughtRequestError() {} export function withRequestLogging(_route, handler) { return handler; }`,
      'expense-void-test:@/lib/api-error': `export function getApiErrorMessage(error, fallback) { return error?.message || fallback; }`,
      'expense-void-test:@/lib/books-api': `export function isBooksEntityCode(value) { return value === 'IT_MARKETING' || value === 'LOCKSMITH'; } export function centsToDecimal() {} export function decimalToCents() {} export function normalizeTaxRate() {} export function parseCents() {} export function parseDateOnly() {} export function serializeDecimal() {}`,
      'expense-void-test:@/lib/accounting-receipts': `export async function deleteAccountingReceipt() {} export async function uploadAccountingReceipt() {}`,
    };
    if (mocks[url]) return { format: 'module', shortCircuit: true, source: mocks[url] };
    return nextLoad(url, context);
  },
});

const { DELETE, PATCH } = await import('../src/app/api/books/expenses/[id]/route.ts');

function reset() {
  fixture.canManageExpenses = true;
  fixture.expense = { id: 'expense-1', entityId: 'entity-1', vendorName: 'Parts Store', totalAmount: { toString: () => '25.50' }, voidedAt: null };
  fixture.activeAllocations = 0;
  fixture.updates.length = 0;
  fixture.audits.length = 0;
  fixture.transactionOptions = null;
}

function request(body?: unknown, method = 'DELETE') {
  return new Request('http://localhost/api/books/expenses/expense-1?entityCode=LOCKSMITH', {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

test('PATCH rejects a soft-voided expense with a conflict response', async () => {
  reset();
  fixture.expense!.voidedAt = new Date('2026-10-01T00:00:00.000Z');
  const response = await PATCH(request({ entityCode: 'LOCKSMITH' }, 'PATCH'), { params: Promise.resolve({ id: 'expense-1' }) });
  const body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.error, 'Removed expenses cannot be edited');
  assert.equal(fixture.updates.length, 0);
  assert.equal(fixture.audits.length, 0);
});

test('soft-void requires expense management and an audit reason', async () => {
  reset();
  fixture.canManageExpenses = false;
  const denied = await DELETE(request({ reason: 'Duplicate entry' }), { params: Promise.resolve({ id: 'expense-1' }) });
  assert.equal(denied.status, 403);
  fixture.canManageExpenses = true;
  const noReason = await DELETE(request(), { params: Promise.resolve({ id: 'expense-1' }) });
  assert.equal(noReason.status, 400);
  assert.equal(fixture.updates.length, 0);
});

test('soft-void blocks expenses with active reimbursement allocations', async () => {
  reset();
  fixture.activeAllocations = 1;
  const response = await DELETE(request({ reason: 'Duplicate entry' }), { params: Promise.resolve({ id: 'expense-1' }) });
  assert.equal(response.status, 409);
  assert.equal(fixture.updates.length, 0);
  assert.equal(fixture.audits.length, 0);
});

test('soft-void preserves the record and audits the authorized actor and reason transactionally', async () => {
  reset();
  const response = await DELETE(request({ reason: 'Duplicate entry from receipt import' }), { params: Promise.resolve({ id: 'expense-1' }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(fixture.updates.length, 1);
  assert.ok(fixture.updates[0].data.voidedAt instanceof Date);
  assert.equal(fixture.updates[0].data.updatedById, 'user-1');
  assert.equal(fixture.audits.length, 1);
  assert.equal(fixture.audits[0].action, 'VOIDED');
  assert.equal(fixture.audits[0].resourceId, 'expense-1');
  assert.equal(fixture.audits[0].metadata.reason, 'Duplicate entry from receipt import');
  assert.equal(fixture.transactionOptions.isolationLevel, 'Serializable');
  assert.equal(fixture.expense?.voidedAt?.toISOString(), body.expense.voidedAt);
});

hooks.deregister();
