import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiReceiptResponse } from '../src/lib/gemini-receipt.ts';

test('normalizes a structured Gemini receipt response', () => {
  const result = parseGeminiReceiptResponse({
    vendorName: 'Example Ads', expenseDate: '2026-09-08', currency: 'cad',
    subtotalAmount: '100.00', hstAmount: 13, hstRate: 13, totalAmount: 113,
    confidence: { vendorName: 'high' }, warnings: [],
  });
  assert.equal(result.vendorName, 'Example Ads');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.subtotalAmount, 100);
  assert.equal(result.totalAmount, 113);
});

test('adds warnings for invalid dates and arithmetic mismatch', () => {
  const result = parseGeminiReceiptResponse({ expenseDate: 'unknown', subtotalAmount: 10, hstAmount: 2, totalAmount: 20, currency: 'USD' });
  assert.equal(result.expenseDate, null);
  assert.ok(result.warnings.some((warning) => warning.includes('date')));
  assert.ok(result.warnings.some((warning) => warning.includes('does not match')));
  assert.ok(result.warnings.some((warning) => warning.includes('USD')));
});
