import { formatTorontoDateInput } from './timezone.ts';
import { getRevenueActivityDate } from './revenue-period.ts';

export type CalendarActivityJob = {
  status: string;
  workerCommission?: number | string | null;
  completedAt?: string | Date | null;
  createdAt?: string | Date | null;
  items?: Array<{ isPart?: boolean; unitCost?: number | string | null; quantity?: number | string | null }>;
  invoice?: {
    paymentStatus?: string | null;
    paidAt?: string | Date | null;
    grandTotal?: number | string | null;
    taxAmount?: number | string | null;
    taxCollected?: boolean | null;
    cogsAmount?: number | string | null;
  } | null;
};

export type CalendarDayActivity<T> = {
  completedJobs: T[];
  paidJobs: T[];
  revenue: number;
  /** Per-partner profit after subtracting the full synced Google Ads spend for this date. */
  profit: number | null;
};

const cents = (value: unknown) => {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

/** Match the dashboard: completed work by completion day, paid revenue/profit by payment activity day. */
export function buildCalendarActivity<T extends CalendarActivityJob>(
  jobs: readonly T[],
  adSpendByDate: ReadonlyMap<string, number> = new Map(),
) {
  const days = new Map<string, CalendarDayActivity<T>>();
  const getDay = (key: string) => {
    let day = days.get(key);
    if (!day) {
      day = { completedJobs: [], paidJobs: [], revenue: 0, profit: 0 };
      days.set(key, day);
    }
    return day;
  };

  for (const job of jobs) {
    if (job.status === 'COMPLETED' && job.completedAt) {
      const key = formatTorontoDateInput(job.completedAt);
      if (key) getDay(key).completedJobs.push(job);
    }

    if (job.invoice?.paymentStatus !== 'PAID') continue;
    const activityDate = getRevenueActivityDate(job);
    const key = activityDate ? formatTorontoDateInput(activityDate) : '';
    if (!key) continue;
    const day = getDay(key);
    day.paidJobs.push(job);
    const gross = Number(job.invoice.grandTotal);
    if (Number.isFinite(gross)) {
      day.revenue += gross;
    }

    const invoice = job.invoice;
    const cogs = Number(invoice.cogsAmount) > 0
      ? cents(invoice.cogsAmount)
      : (job.items || []).reduce((sum, item) => item.isPart
        ? sum + cents(Number(item.unitCost) * (Number(item.quantity) || 1))
        : sum, 0);
    const tax = invoice.taxCollected !== false ? cents(invoice.taxAmount) : 0;
    day.profit = (day.profit || 0) + (cents(gross) - tax - cogs - cents(job.workerCommission)) / 100;
  }

  for (const key of adSpendByDate.keys()) getDay(key);
  for (const [key, day] of days) {
    const adSpend = adSpendByDate.get(key);
    day.profit = typeof adSpend === 'number' && Number.isFinite(adSpend)
      ? Math.round(((day.profit || 0) / 2 - adSpend) * 100) / 100
      : null;
  }

  return days;
}
