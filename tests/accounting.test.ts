import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PARTNER_BILLING_ANCHOR,
  buildPartnerInvoiceDescription,
  calculatePartnerBilling,
  getPartnerBillingPeriod,
} from '../src/lib/accounting.ts';

test('partner billing calculates 50% fee plus 13% HST', () => {
  const result = calculatePartnerBilling({
    revenueCents: 10000,
    hstDeductedCents: 0,
    cogsCents: 0,
    technicianCommissionsCents: 0,
  });

  assert.equal(result.operationalProfitCents, 10000);
  assert.equal(result.partnerFeeCents, 5000);
  assert.equal(result.hstCents, 650);
  assert.equal(result.invoiceTotalCents, 5650);
});

test('negative adjusted profit carries forward and prevents an invoice', () => {
  const loss = calculatePartnerBilling({
    revenueCents: 10000,
    hstDeductedCents: 0,
    cogsCents: 12000,
    technicianCommissionsCents: 0,
  });
  assert.equal(loss.negativeCarryForwardCents, 2000);
  assert.equal(loss.partnerFeeCents, 0);

  const recovery = calculatePartnerBilling({
    revenueCents: 10000,
    hstDeductedCents: 0,
    cogsCents: 0,
    technicianCommissionsCents: 0,
    priorNegativeCarryForwardCents: loss.negativeCarryForwardCents,
  });
  assert.equal(recovery.adjustedProfitCents, 8000);
  assert.equal(recovery.partnerFeeCents, 4000);
});

test('billing periods use the configured September 7 anchor', () => {
  assert.deepEqual(getPartnerBillingPeriod(PARTNER_BILLING_ANCHOR), {
    periodIndex: 0,
    periodStart: '2026-09-07',
    periodEnd: '2026-09-20',
  });
  assert.deepEqual(getPartnerBillingPeriod('2026-09-21'), {
    periodIndex: 1,
    periodStart: '2026-09-21',
    periodEnd: '2026-10-04',
  });
  assert.throws(() => getPartnerBillingPeriod('2026-02-31'), /Invalid ISO date/);
});

test('partner invoice uses the required single-line description', () => {
  assert.equal(buildPartnerInvoiceDescription(5000), 'IT Services for Locksmith - C$ 50.00');
});
