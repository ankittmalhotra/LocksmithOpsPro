import assert from 'node:assert/strict';
import { ManualJobInputError, parseManualAmount, parseManualPercentage } from '../src/lib/manual-amount.ts';

assert.equal(parseManualAmount('12.345', 'Amount', false), 12.35);
assert.throws(
  () => parseManualAmount('0.001', 'Total amount collected', false),
  (error: unknown) => error instanceof ManualJobInputError,
);
assert.throws(
  () => parseManualAmount('-0.01', 'COGS'),
  (error: unknown) => error instanceof ManualJobInputError,
);
assert.equal(parseManualPercentage(4.01, 'Card price difference'), 0.0401);
assert.throws(() => parseManualPercentage(4.0001, 'Card price difference', 4), ManualJobInputError);

console.log('✅ Manual amount validation tests passed');
