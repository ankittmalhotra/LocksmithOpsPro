import { getPartnerBillingPeriod } from './accounting.ts';
import { formatTorontoDateInput } from './timezone.ts';

export const REVENUE_PERIOD_OPTIONS = [
  'all-time',
  'current-biweekly',
  'previous-biweekly',
  'this-month',
] as const;

export type RevenuePeriod = (typeof REVENUE_PERIOD_OPTIONS)[number];

export const REVENUE_PERIOD_LABELS: Record<RevenuePeriod, string> = {
  'all-time': 'All Time',
  'current-biweekly': 'Current Biweekly Period',
  'previous-biweekly': 'Previous Biweekly Period',
  'this-month': 'This Month',
};

export function isRevenuePeriod(value: unknown): value is RevenuePeriod {
  return typeof value === 'string' && (REVENUE_PERIOD_OPTIONS as readonly string[]).includes(value);
}

/** Date-key bounds for financial reporting, using the Toronto business calendar. */
export function getRevenuePeriodBounds(period: RevenuePeriod, now: Date = new Date()) {
  if (period === 'all-time') return null;

  const today = formatTorontoDateInput(now);
  if (!today) return null;

  if (period === 'this-month') {
    return { start: `${today.slice(0, 7)}-01`, end: today };
  }

  const current = getPartnerBillingPeriod(today);
  if (period === 'current-biweekly') {
    return { start: current.periodStart, end: today };
  }

  const previousDate = new Date(`${current.periodStart}T00:00:00.000Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const previous = getPartnerBillingPeriod(previousDate.toISOString().slice(0, 10));
  return { start: previous.periodStart, end: previous.periodEnd };
}

/** Choose the same business date used by revenue reporting for a paid invoice. */
export function getRevenueActivityDate(job: {
  invoice?: { paidAt?: string | Date | null } | null;
  completedAt?: string | Date | null;
  createdAt?: string | Date | null;
}) {
  return job.invoice?.paidAt || job.completedAt || job.createdAt || null;
}

export function isInRevenuePeriod(
  job: Parameters<typeof getRevenueActivityDate>[0],
  period: RevenuePeriod,
  now: Date = new Date(),
) {
  const bounds = getRevenuePeriodBounds(period, now);
  if (!bounds) return true;

  const activityDate = getRevenueActivityDate(job);
  if (!activityDate) return false;
  const dateKey = formatTorontoDateInput(activityDate);
  return !!dateKey && dateKey >= bounds.start && dateKey <= bounds.end;
}
