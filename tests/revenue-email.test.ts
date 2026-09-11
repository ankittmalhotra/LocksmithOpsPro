import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRevenueChangeEmail, REVENUE_NOTIFICATION_EMAIL } from '../src/lib/revenue-email.ts';

test('revenue email includes accounting fields and escapes user input', () => {
  assert.equal(REVENUE_NOTIFICATION_EMAIL, 'mail2mws@gmail.com');
  const email = buildRevenueChangeEmail({
    jobNumber: '1001',
    serviceType: '<Lockout>',
    status: 'COMPLETED',
    completedAt: '2026-09-11T15:00:00.000Z',
    customer: { name: '<Customer>', phone: '6475550100' },
    technician: { name: 'Tech & Co.' },
    workerCommission: 40,
    invoice: {
      totalAmountCollected: 200,
      grandTotal: 200,
      taxAmount: 23,
      taxCollected: true,
      cogsAmount: 20,
      paymentMethod: 'CASH',
    },
  }, 'UPDATED');

  assert.match(email.subject, /Job #1001/);
  assert.match(email.text, /Gross collected: \$200\.00/);
  assert.match(email.text, /Net before overhead: \$140\.00/);
  assert.match(email.html, /&lt;Lockout&gt;/);
  assert.doesNotMatch(email.html, /<Lockout>/);
});
