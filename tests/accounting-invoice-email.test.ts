import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountingInvoiceEmail } from '../src/lib/resend.ts';

const baseInvoice = {
  invoiceNumber: 'INV-000123',
  recipientName: 'Example <Business>',
  recipientEmail: 'billing@example.com',
  issuerName: '1001744934 ONTARIO INC.',
  description: 'IT consulting',
  quantity: 1,
  serviceAmount: 100,
  hstRate: 0.13,
  hstAmount: 13,
  totalAmount: 113,
  issuedAt: '2026-09-21T00:00:00.000Z',
};

test('accounting invoice email shows payment pending without changing invoice number', () => {
  const email = buildAccountingInvoiceEmail({ ...baseInvoice, paymentStatus: 'PENDING' });
  assert.equal(email.subject, 'Invoice INV-000123 from 1001744934 ONTARIO INC.');
  assert.match(email.html, /Payment pending/);
  assert.match(email.html, /Example &lt;Business&gt;/);
  assert.match(email.text, /Invoice INV-000123/);
});

test('paid accounting invoice email keeps the same number and shows paid date', () => {
  const email = buildAccountingInvoiceEmail({ ...baseInvoice, paymentStatus: 'RECEIVED', paidAt: '2026-09-25T00:00:00.000Z' });
  assert.equal(email.subject, 'Payment received — invoice INV-000123');
  assert.match(email.html, /Paid/);
  assert.match(email.text, /Payment status: Paid/);
  assert.match(email.text, /INV-000123/);
});
