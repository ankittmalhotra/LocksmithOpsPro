import { getPartnerBillingPeriod } from './accounting.ts';
import { parseTorontoDateOnly } from './timezone.ts';

/**
 * A stable accounting window for lightweight Books task pages. Dates are UTC
 * calendar boundaries because Books dates are stored as PostgreSQL DATEs.
 */
export function getBooksTaskWindow(dateKey: string) {
  const period = getPartnerBillingPeriod(dateKey);
  if (period.periodIndex < 0) throw new Error('Books task windows begin at the partner billing anchor');
  const startsAt = new Date(`${period.periodStart}T00:00:00.000Z`);
  const endsAt = new Date(`${period.periodEnd}T00:00:00.000Z`);
  const endExclusiveAt = new Date(endsAt);
  endExclusiveAt.setUTCDate(endExclusiveAt.getUTCDate() + 1);
  const invoiceStartsAt = parseTorontoDateOnly(period.periodStart);
  const invoiceEndExclusiveAt = parseTorontoDateOnly(endExclusiveAt.toISOString().slice(0, 10));
  if (!invoiceStartsAt || !invoiceEndExclusiveAt) throw new Error('Unable to resolve Toronto invoice timestamp bounds');
  return { ...period, startsAt, endsAt, endExclusiveAt, invoiceStartsAt, invoiceEndExclusiveAt, label: `${period.periodStart} to ${period.periodEnd}` };
}

export const BOOKS_TASK_MAX_PAGE = 200;
export const BOOKS_BILLING_SUMMARY_LIMIT = 12;
export const BOOKS_ADS_SUMMARY_PERIOD_LIMIT = 4;
export const BOOKS_ADS_SUMMARY_METRIC_READ_LIMIT = 1000;
export const BOOKS_ADS_SUMMARY_ROW_LIMIT = 24;
