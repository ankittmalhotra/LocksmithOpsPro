import { formatTorontoDateInput } from './timezone.ts';
import { getRevenueActivityDate } from './revenue-period.ts';

export type CalendarActivityJob = {
  status: string;
  completedAt?: string | Date | null;
  createdAt?: string | Date | null;
  invoice?: {
    paymentStatus?: string | null;
    paidAt?: string | Date | null;
    grandTotal?: number | null;
  } | null;
};

export type CalendarDayActivity<T> = {
  completedJobs: T[];
  paidJobs: T[];
  revenue: number;
};

/** Match the dashboard: completed work by completion day, paid revenue by payment activity day. */
export function buildCalendarActivity<T extends CalendarActivityJob>(jobs: readonly T[]) {
  const days = new Map<string, CalendarDayActivity<T>>();
  const getDay = (key: string) => {
    let day = days.get(key);
    if (!day) {
      day = { completedJobs: [], paidJobs: [], revenue: 0 };
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
    if (typeof job.invoice.grandTotal === 'number' && Number.isFinite(job.invoice.grandTotal)) {
      day.revenue += job.invoice.grandTotal;
    }
  }

  return days;
}
