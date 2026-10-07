import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOKS_ADS_SUMMARY_METRIC_READ_LIMIT, BOOKS_ADS_SUMMARY_PERIOD_LIMIT, BOOKS_ADS_SUMMARY_ROW_LIMIT, BOOKS_BILLING_SUMMARY_LIMIT, BOOKS_TASK_MAX_PAGE, getBooksTaskWindow } from '../src/lib/books-window.ts';

test('Books overview window is the current fixed partner-billing period', () => {
  const window = getBooksTaskWindow('2026-10-07');
  assert.equal(window.periodStart, '2026-10-05');
  assert.equal(window.periodEnd, '2026-10-18');
  assert.equal(window.startsAt.toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(window.endExclusiveAt.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(window.invoiceStartsAt.toISOString(), '2026-10-05T04:00:00.000Z');
  assert.equal(window.invoiceEndExclusiveAt.toISOString(), '2026-10-19T04:00:00.000Z');
});

test('invoice timestamp bounds keep Toronto midnights through DST end', () => {
  const window = getBooksTaskWindow('2026-11-01');
  assert.equal(window.periodStart, '2026-10-19');
  assert.equal(window.periodEnd, '2026-11-01');
  assert.equal(window.invoiceStartsAt.toISOString(), '2026-10-19T04:00:00.000Z');
  assert.equal(window.invoiceEndExclusiveAt.toISOString(), '2026-11-02T05:00:00.000Z');
});

test('focused Books endpoints have explicit bounded read limits', () => {
  assert.equal(BOOKS_TASK_MAX_PAGE, 200);
  assert.equal(BOOKS_BILLING_SUMMARY_LIMIT, 12);
  assert.equal(BOOKS_ADS_SUMMARY_PERIOD_LIMIT, 4);
  assert.equal(BOOKS_ADS_SUMMARY_METRIC_READ_LIMIT, 1000);
  assert.equal(BOOKS_ADS_SUMMARY_ROW_LIMIT, 24);
});
