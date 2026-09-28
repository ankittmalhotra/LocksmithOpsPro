import { getPartnerBillingPeriod } from './accounting.ts';
import { getRevenueActivityDate } from './revenue-period';
import { formatTorontoDateInput } from './timezone';

export const PERIOD_COMPARISON_MODES = ['week', 'biweekly'] as const;
export type PeriodComparisonMode = (typeof PERIOD_COMPARISON_MODES)[number];

export interface DateKeyRange {
  start: string;
  end: string;
}

export interface PeriodComparisonWindow extends DateKeyRange {
  revenue: number;
  completedJobs: number;
}

export interface PeriodComparisonMetric {
  current: number;
  previous: number;
  change: number;
  changePercent: number | null;
}

export interface PeriodComparison {
  current: PeriodComparisonWindow;
  previous: PeriodComparisonWindow;
  revenue: PeriodComparisonMetric;
  completedJobs: PeriodComparisonMetric;
}

export type PeriodComparisonJob = {
  status: string;
  completedAt?: string | Date | null;
  createdAt?: string | Date | null;
  invoice?: {
    paymentStatus?: string | null;
    grandTotal?: number | null;
    paidAt?: string | Date | null;
  } | null;
};

const DAY_MS = 86_400_000;

function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS) + 1;
}

function getWeekComparisonRanges(today: string): { current: DateKeyRange; previous: DateKeyRange } {
  const todayUtc = new Date(`${today}T00:00:00.000Z`);
  const daysSinceMonday = (todayUtc.getUTCDay() + 6) % 7;
  const currentStart = addDateKeyDays(today, -daysSinceMonday);
  return {
    current: { start: currentStart, end: today },
    previous: { start: addDateKeyDays(currentStart, -7), end: addDateKeyDays(today, -7) },
  };
}

function getBiweeklyComparisonRanges(today: string): { current: DateKeyRange; previous: DateKeyRange } {
  const currentPeriod = getPartnerBillingPeriod(today);
  const elapsedDays = daysBetweenInclusive(currentPeriod.periodStart, today);
  const previousEnd = addDateKeyDays(currentPeriod.periodStart, -1);
  const previousPeriod = getPartnerBillingPeriod(previousEnd);
  return {
    current: { start: currentPeriod.periodStart, end: today },
    previous: { start: previousPeriod.periodStart, end: addDateKeyDays(previousPeriod.periodStart, elapsedDays - 1) },
  };
}

/** Build matching, Toronto-calendar comparison windows for the requested mode. */
export function getPeriodComparisonRanges(mode: PeriodComparisonMode, now: Date = new Date()) {
  const today = formatTorontoDateInput(now);
  if (!today) throw new Error('Unable to determine the Toronto business date');
  return mode === 'week' ? getWeekComparisonRanges(today) : getBiweeklyComparisonRanges(today);
}

function dateKeyInRange(dateKey: string | null, range: DateKeyRange): boolean {
  return Boolean(dateKey && dateKey >= range.start && dateKey <= range.end);
}

function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(2));
}

/** Aggregate paid gross revenue by payment activity date and completed work by completion date. */
export function aggregatePeriodComparison(
  jobs: readonly PeriodComparisonJob[],
  ranges: { current: DateKeyRange; previous: DateKeyRange },
): PeriodComparison {
  const current: PeriodComparisonWindow = { ...ranges.current, revenue: 0, completedJobs: 0 };
  const previous: PeriodComparisonWindow = { ...ranges.previous, revenue: 0, completedJobs: 0 };

  for (const job of jobs) {
    const completedDate = job.completedAt ? formatTorontoDateInput(job.completedAt) : '';
    if (job.status === 'COMPLETED' && completedDate) {
      if (dateKeyInRange(completedDate, ranges.current)) current.completedJobs += 1;
      if (dateKeyInRange(completedDate, ranges.previous)) previous.completedJobs += 1;
    }

    if (job.invoice?.paymentStatus !== 'PAID') continue;
    const activityDate = getRevenueActivityDate(job);
    const paymentDate = activityDate ? formatTorontoDateInput(activityDate) : '';
    const amount = typeof job.invoice.grandTotal === 'number' && Number.isFinite(job.invoice.grandTotal)
      ? job.invoice.grandTotal
      : 0;
    if (dateKeyInRange(paymentDate, ranges.current)) current.revenue += amount;
    if (dateKeyInRange(paymentDate, ranges.previous)) previous.revenue += amount;
  }

  const revenueChange = current.revenue - previous.revenue;
  const jobsChange = current.completedJobs - previous.completedJobs;
  return {
    current,
    previous,
    revenue: {
      current: current.revenue,
      previous: previous.revenue,
      change: revenueChange,
      changePercent: percentChange(current.revenue, previous.revenue),
    },
    completedJobs: {
      current: current.completedJobs,
      previous: previous.completedJobs,
      change: jobsChange,
      changePercent: percentChange(current.completedJobs, previous.completedJobs),
    },
  };
}
