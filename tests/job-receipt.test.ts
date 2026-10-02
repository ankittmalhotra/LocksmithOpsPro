import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  getJobReceiptState,
  isPaymentDateOnOrAfterEffectiveDate,
  requiresCurrentStripeIssuerVerification,
  requireLocksmithReceiptIssuer,
} from '../src/lib/job-receipt-policy.ts';

test('receipt eligibility distinguishes paid local, Stripe, pending, off-books, and refunded jobs', () => {
  const job = (invoice: Record<string, unknown> | null, status = 'COMPLETED') => ({ status, invoice });
  const base = { paymentStatus: 'PAID', taxCollected: true };

  assert.equal(getJobReceiptState(job(null)), 'ineligible');
  assert.equal(getJobReceiptState(job({ ...base, paymentMethod: 'CASH' }, 'IN_PROGRESS')), 'ineligible');
  assert.equal(getJobReceiptState(job({ ...base, paymentStatus: 'PENDING', paymentMethod: 'CASH' })), 'payment_pending');
  assert.equal(getJobReceiptState(job({ ...base, taxCollected: false, paymentMethod: 'CASH' })), 'off_books');
  assert.equal(getJobReceiptState(job({ ...base, paymentMethod: 'CASH' })), 'local_ready');
  assert.equal(getJobReceiptState(job({ ...base, paymentMethod: 'INTERAC' })), 'local_ready');
  assert.equal(getJobReceiptState(job({ ...base, paymentMethod: 'CREDIT_CARD' })), 'provider_missing');
  assert.equal(getJobReceiptState(job({ ...base, paymentProvider: 'STRIPE', paymentMethod: 'CREDIT_CARD' })), 'stripe_ready');
  assert.equal(getJobReceiptState(job({ ...base, paymentProvider: 'STRIPE', paymentMethod: 'DEBIT_CARD' })), 'stripe_ready');
  assert.equal(getJobReceiptState(job({ ...base, paymentProvider: 'STRIPE', paymentMethod: 'CASH' })), 'provider_missing');
  assert.equal(getJobReceiptState(job({ ...base, paymentStatus: 'PARTIALLY_REFUNDED', paymentProvider: 'STRIPE', paymentMethod: 'CREDIT_CARD' })), 'stripe_partial_refund');
  assert.equal(getJobReceiptState(job({ ...base, paymentStatus: 'REFUNDED', paymentProvider: 'STRIPE', paymentMethod: 'CREDIT_CARD' })), 'refunded');
});

test('HST effective date compares the Toronto payment date to the registered calendar date', () => {
  const effective = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(isPaymentDateOnOrAfterEffectiveDate('2026-01-01T04:59:59.999Z', effective), false);
  assert.equal(isPaymentDateOnOrAfterEffectiveDate('2026-01-01T05:00:00.000Z', effective), true);
  assert.equal(isPaymentDateOnOrAfterEffectiveDate('2025-12-31T23:59:59.999Z', effective), false);
  assert.equal(isPaymentDateOnOrAfterEffectiveDate('invalid-date', effective), false);
});

test('receipt issuer validation requires Locksmith identity and a valid HST registration', () => {
  const issuer = {
    code: 'LOCKSMITH', legalName: 'Better Call Locksmith Inc.', corporationNumber: '1001348245', email: 'bcltoronto1@gmail.com',
    addressLine1: '222 Spadina Avenue, Unit 114', city: 'Toronto', province: 'Ontario', postalCode: 'M5T 3B3', country: 'Canada',
    hstRegistrationNumber: '70229 1725 RT0001', hstEffectiveDate: new Date('2026-01-01T00:00:00.000Z'), hstEnabled: true,
  };
  assert.equal(requireLocksmithReceiptIssuer(issuer).hstRegistrationNumber, '702291725RT0001');
  assert.throws(() => requireLocksmithReceiptIssuer({ ...issuer, code: 'IT_MARKETING' }), /issuer configuration/);
  assert.throws(() => requireLocksmithReceiptIssuer({ ...issuer, hstRegistrationNumber: 'not-an-hst-id' }), /issuer configuration/);
});

test('historical Stripe documents retain their original issuer and tax presentation', () => {
  assert.equal(requiresCurrentStripeIssuerVerification({ pricingModel: null }), false);
  assert.equal(requiresCurrentStripeIssuerVerification({ pricingModel: 'LEGACY_FEE' }), false);
  assert.equal(requiresCurrentStripeIssuerVerification({ pricingModel: 'DUAL_PRICE_V1' }), true);
});

const issuerFixture = {
  code: 'LOCKSMITH', legalName: 'Better Call Locksmith Inc.', corporationNumber: '1001348245', email: 'bcltoronto1@gmail.com',
  addressLine1: '222 Spadina Avenue, Unit 114', city: 'Toronto', province: 'Ontario', postalCode: 'M5T 3B3', country: 'Canada',
  hstRegistrationNumber: '702291725RT0001', hstEffectiveDate: new Date('2026-01-01T00:00:00.000Z'), hstEnabled: true,
};
const receiptFixture: { currentJob: any; receipts: any[]; issuer: any; prisma: any } = {
  currentJob: null, receipts: [], issuer: issuerFixture, prisma: null,
};
const tx = {
  async $queryRaw() { return []; },
  job: { async findUnique() { return receiptFixture.currentJob; } },
  accountingEntity: { async findUnique() { return receiptFixture.issuer; } },
  jobPaymentReceipt: {
    async findFirst({ where }: any) {
      return receiptFixture.receipts.find((receipt) => receipt.invoiceId === where.invoiceId
        && (where.voidedAt?.not === null ? receipt.voidedAt === null
          : where.voidedAt?.not !== undefined ? receipt.voidedAt !== null && receipt.replacementId === null
            : receipt.voidedAt === null)) || null;
    },
    async count({ where }: any) { return receiptFixture.receipts.filter((receipt) => receipt.invoiceId === where.invoiceId).length; },
    async create({ data }: any) {
      const created = { id: `receipt-${receiptFixture.receipts.length + 1}`, ...data, voidedAt: null, replacementId: null };
      receiptFixture.receipts.push(created);
      return created;
    },
    async update({ where, data }: any) {
      const receipt = receiptFixture.receipts.find((item) => item.id === where.id);
      Object.assign(receipt, data);
      return receipt;
    },
  },
};
receiptFixture.prisma = { async $transaction(callback: (client: any) => unknown) { return callback(tx); } };
Object.assign(globalThis, { __jobReceiptFixture: receiptFixture });
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/prisma') return { url: 'job-receipt-test:prisma', shortCircuit: true };
    if (specifier === '@/lib/job-receipt-policy') return { url: new URL('../src/lib/job-receipt-policy.ts', import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'job-receipt-test:prisma') return { format: 'module', shortCircuit: true, source: 'export const prisma = globalThis.__jobReceiptFixture.prisma;' };
    return nextLoad(url, context);
  },
});
const { buildJobPaymentReceiptPdf, createOrLoadJobPaymentReceipt } = await import('../src/lib/job-receipt.ts');

test('receipt PDF builder emits a readable single-page PDF', async () => {
  const bytes = await buildJobPaymentReceiptPdf({
    receiptNumber: 'LR-1001-01', revision: 1, issuedAt: '2026-09-30T16:00:00Z', paidAt: '2026-09-30T15:00:00Z',
    issuer: { legalName: 'Better Call Locksmith Inc.', corporationNumber: '1001348245', email: 'bcltoronto1@gmail.com', hstRegistrationNumber: '70229 1725 RT0001', address: '222 Spadina Avenue, Unit 114, Toronto, Ontario, M5T 3B3, Canada' },
    customer: { name: 'Example Customer' },
    job: { jobNumber: '1001', serviceType: 'Residential', description: 'Lock repair', serviceAddress: '1 Main Street', partsBreakdownReconciled: false, parts: [] },
    payment: { method: 'CASH' },
    amounts: { subtotal: 100, tax: 13, taxRate: 0.13, total: 113, partsTotal: 0, laborTotal: 100 },
  });
  assert.ok(bytes.byteLength > 1_000);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 612, height: 792 });
});

function paidLocalJob(paidAt: string) {
  const invoice = {
    id: 'invoice-local', paymentStatus: 'PAID', paymentMethod: 'CASH', taxCollected: true,
    paidAt: new Date(paidAt), totalAmountCollected: 113, grandTotal: 113, subtotal: 100,
    taxRate: 0.13, taxAmount: 13, partsTotal: 0, laborTotal: 100,
  };
  return {
    id: 'job-local', jobNumber: '1001', status: 'COMPLETED', serviceType: 'Residential Lockout',
    problemDescription: 'Lock repair', serviceAddress: '1 Main Street', customer: { name: 'Example Customer' },
    items: [], invoice,
  };
}

test('local receipt issuance verifies HST date, snapshots Locksmith identity, and is idempotent', async () => {
  receiptFixture.receipts = [];
  receiptFixture.currentJob = paidLocalJob('2026-01-01T05:00:00.000Z');
  const issued = await createOrLoadJobPaymentReceipt(receiptFixture.currentJob, 'admin-1');
  const snapshot = issued.snapshot as any;

  assert.equal(issued.receiptNumber, 'LR-1001-01');
  assert.equal(snapshot.issuer.legalName, 'Better Call Locksmith Inc.');
  assert.equal(snapshot.issuer.corporationNumber, '1001348245');
  assert.equal(snapshot.issuer.email, 'bcltoronto1@gmail.com');
  assert.equal(snapshot.issuer.hstRegistrationNumber, '70229 1725 RT0001');
  assert.equal(snapshot.amounts.total, 113);
  assert.ok(issued.pdfBytes.length > 1_000);
  assert.equal(await createOrLoadJobPaymentReceipt(receiptFixture.currentJob, 'admin-1'), issued);
  assert.equal(receiptFixture.receipts.length, 1);
});

test('local receipt issuance rejects payments before the Locksmith HST effective date', async () => {
  receiptFixture.receipts = [];
  receiptFixture.currentJob = paidLocalJob('2026-01-01T04:59:59.999Z');
  await assert.rejects(createOrLoadJobPaymentReceipt(receiptFixture.currentJob, 'admin-1'), /not effective on the payment date/);
  assert.equal(receiptFixture.receipts.length, 0);
});

test.after(() => hooks.deregister());
