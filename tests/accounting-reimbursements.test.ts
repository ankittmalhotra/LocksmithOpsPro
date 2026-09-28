import assert from 'node:assert/strict';
import test from 'node:test';
import { openReimbursementBalanceCents, validateReimbursementAllocations } from '../src/lib/accounting-reimbursements.ts';

test('one repayment can be allocated across multiple expenses in exact cents', () => {
  assert.equal(validateReimbursementAllocations(10_050, [
    { expenseId: 'a', amountCents: 5_000 },
    { expenseId: 'b', amountCents: 5_050 },
  ]), 10_050);
});

test('partial payments leave an exact open balance', () => {
  assert.equal(openReimbursementBalanceCents(33_900, 10_000), 23_900);
});

test('allocation validation rejects duplicates, mismatched totals, and overpayment', () => {
  assert.throws(() => validateReimbursementAllocations(300, [
    { expenseId: 'a', amountCents: 100 },
    { expenseId: 'a', amountCents: 200 },
  ]), /Each expense must appear once/);
  assert.throws(() => validateReimbursementAllocations(300, [{ expenseId: 'a', amountCents: 299 }]), /add up/);
  assert.throws(() => openReimbursementBalanceCents(200, 201), /cannot exceed/);
});
