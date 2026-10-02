import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalendarActivity } from '../src/lib/calendar-activity.ts';

test('calendar counts completion and paid revenue on their separate Toronto dates', () => {
  const jobs = [
    {
      id: 'paid-later', status: 'COMPLETED',
      completedAt: '2026-09-21T03:59:59.000Z', // Sep 20 in Toronto
      createdAt: '2026-09-19T12:00:00.000Z',
      invoice: { paymentStatus: 'PAID', paidAt: '2026-09-21T04:00:00.000Z', grandTotal: 125.5 },
    },
    {
      id: 'unpaid', status: 'COMPLETED',
      completedAt: '2026-09-20T20:00:00.000Z',
      invoice: { paymentStatus: 'PENDING', paidAt: null, grandTotal: 80 },
    },
    {
      id: 'travel-fee', status: 'ABANDONED_TRAVEL_FEE',
      completedAt: '2026-09-21T14:00:00.000Z',
      invoice: { paymentStatus: 'PAID', paidAt: null, grandTotal: 25 },
    },
    {
      id: 'cancelled', status: 'CANCELLED',
      completedAt: '2026-09-20T20:00:00.000Z',
      invoice: null,
    },
  ];

  const activity = buildCalendarActivity(jobs);
  assert.deepEqual(activity.get('2026-09-20')?.completedJobs.map((job) => job.id), ['paid-later', 'unpaid']);
  assert.equal(activity.get('2026-09-20')?.revenue || 0, 0);
  assert.deepEqual(activity.get('2026-09-21')?.paidJobs.map((job) => job.id), ['paid-later', 'travel-fee']);
  assert.equal(activity.get('2026-09-21')?.revenue, 150.5);
  assert.equal(activity.get('2026-09-21')?.completedJobs.length || 0, 0);
});
