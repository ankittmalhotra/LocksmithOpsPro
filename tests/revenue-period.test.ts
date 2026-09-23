import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getRevenuePeriodBounds,
  isInRevenuePeriod,
} from '../src/lib/revenue-period.ts';

test('revenue periods follow the anchored Toronto biweekly calendar', () => {
  const now = new Date('2026-09-23T16:00:00.000Z');

  assert.deepEqual(getRevenuePeriodBounds('current-biweekly', now), {
    start: '2026-09-21',
    end: '2026-09-23',
  });
  assert.deepEqual(getRevenuePeriodBounds('previous-biweekly', now), {
    start: '2026-09-07',
    end: '2026-09-20',
  });
  assert.deepEqual(getRevenuePeriodBounds('this-month', now), {
    start: '2026-09-01',
    end: '2026-09-23',
  });
  assert.equal(getRevenuePeriodBounds('all-time', now), null);
});

test('biweekly boundaries include both local dates and split at Toronto midnight', () => {
  const previousPaidJob = {
    createdAt: '2026-09-01T12:00:00.000Z',
    invoice: { paidAt: '2026-09-21T03:59:59.999Z' }, // Sep 20 in Toronto
  };
  const currentPaidJob = {
    createdAt: '2026-09-01T12:00:00.000Z',
    invoice: { paidAt: '2026-09-21T04:00:00.000Z' }, // Sep 21 in Toronto
  };
  const now = new Date('2026-09-23T16:00:00.000Z');

  assert.equal(isInRevenuePeriod(previousPaidJob, 'previous-biweekly', now), true);
  assert.equal(isInRevenuePeriod(previousPaidJob, 'current-biweekly', now), false);
  assert.equal(isInRevenuePeriod(currentPaidJob, 'current-biweekly', now), true);
  assert.equal(isInRevenuePeriod(currentPaidJob, 'previous-biweekly', now), false);
});

test('revenue period date falls back from payment date to completion and creation date', () => {
  const now = new Date('2026-09-23T16:00:00.000Z');

  assert.equal(isInRevenuePeriod({
    createdAt: '2026-09-01T12:00:00.000Z',
    completedAt: '2026-09-22T12:00:00.000Z',
    invoice: { paidAt: null },
  }, 'current-biweekly', now), true);
  assert.equal(isInRevenuePeriod({
    createdAt: '2026-09-22T12:00:00.000Z',
    invoice: { paidAt: null },
  }, 'current-biweekly', now), true);
  assert.equal(isInRevenuePeriod({ invoice: { paidAt: null } }, 'current-biweekly', now), false);
});
