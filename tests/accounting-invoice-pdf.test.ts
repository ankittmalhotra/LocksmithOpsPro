import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildAccountingInvoicePdf } from '../src/lib/accounting-invoice-pdf.ts';

test('accounting invoice PDF is a single-page invoice with payment status', async () => {
  const bytes = await buildAccountingInvoicePdf({
    invoiceNumber: 'INV-000123',
    invoiceKind: 'CUSTOMER_SERVICE',
    paymentStatus: 'RECEIVED',
    lineDescription: 'IT consulting and marketing services',
    quantity: 1,
    serviceAmount: '100.00',
    hstRate: '0.13',
    hstAmount: '13.00',
    totalAmount: '113.00',
    issuedAt: '2026-09-23T00:00:00.000Z',
    currency: 'CAD',
    issuerEntity: { legalName: '1001744934 ONTARIO INC.', hstRegistrationNumber: '752857771RT0001' },
    recipientSnapshot: { legalName: 'Example Business Inc.', email: 'billing@example.com' },
    paymentEvents: [{ toStatus: 'RECEIVED', paidAt: '2026-09-24T00:00:00.000Z' }],
  });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.ok(bytes.length > 2000);
});
