import { Prisma } from '@prisma/client';
import { formatTorontoDateInput } from '@/lib/timezone';
import { findJobsWithDetails } from '@/lib/job-helper';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import {
  PARTNER_BILLING_ANCHOR,
  PARTNER_BILLING_PERIOD_DAYS,
  calculatePartnerBilling,
  getPartnerBillingPeriod,
} from '@/lib/accounting';

export const ACCOUNTING_ENTITY_CODES = ['IT_MARKETING', 'LOCKSMITH'] as const;
export type BooksEntityCode = (typeof ACCOUNTING_ENTITY_CODES)[number];

export function isBooksEntityCode(value: unknown): value is BooksEntityCode {
  return value === 'IT_MARKETING' || value === 'LOCKSMITH';
}

/** Parse a user-supplied monetary amount into exact integer cents. */
export function parseCents(value: unknown, label: string, allowZero = true): number {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${label} must be a valid amount`);
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`${label} must be a non-negative amount with up to 2 decimals`);
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || (!allowZero && cents <= 0)) throw new Error(`${label} is out of range`);
  return cents;
}

export function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

export function decimalToCents(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value) * 100);
}

export function serializeDecimal(value: Prisma.Decimal | number | string | null | undefined): number {
  return decimalToCents(value) / 100;
}

/**
 * Normalize a tax rate to the fractional representation used by Prisma
 * Decimal(5,4) fields. Accept both 0.13 and the user-friendly 13 percent.
 */
export function normalizeTaxRate(value: unknown, label = 'hstRate'): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw new Error(`${label} must be a percentage between 0 and 100`);
  }
  const fractional = numeric > 1 ? numeric / 100 : numeric;
  return Math.round(fractional * 10_000) / 10_000;
}

export function parseDateOnly(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  return value;
}

export function periodDates(periodStart: string, periodEnd?: string) {
  const start = parseDateOnly(periodStart, 'periodStart');
  const calculated = getPartnerBillingPeriod(start, PARTNER_BILLING_ANCHOR);
  if (calculated.periodIndex < 0) {
    throw new Error(`Billing periods cannot begin before ${PARTNER_BILLING_ANCHOR}`);
  }
  const end = periodEnd ? parseDateOnly(periodEnd, 'periodEnd') : calculated.periodEnd;
  if (calculated.periodStart !== start || end !== calculated.periodEnd) {
    throw new Error(`Billing periods must be fixed ${PARTNER_BILLING_PERIOD_DAYS}-day windows anchored on ${PARTNER_BILLING_ANCHOR}`);
  }
  return { periodStart: start, periodEnd: end, periodIndex: calculated.periodIndex };
}

/**
 * Read-only operational snapshot. This intentionally lives outside the Books
 * Prisma models so an issued period remains immutable if jobs are edited.
 */
export async function calculateOperationalPeriodSnapshot(periodStart: string, periodEnd: string) {
  const rawJobs = await findJobsWithDetails({ orderBy: { createdAt: 'asc' } });
  const jobs = rawJobs.map(normalizeManualJobInvoice);
  const contributions: Array<Record<string, unknown>> = [];
  let revenueCents = 0;
  let hstCents = 0;
  let cogsCents = 0;
  let commissionCents = 0;

  for (const job of jobs) {
    if (!job.invoice || job.invoice.paymentStatus !== 'PAID') continue;
    const activityDate = job.invoice.paidAt || job.completedAt || job.createdAt;
    const dateKey = formatTorontoDateInput(activityDate);
    if (dateKey < periodStart || dateKey > periodEnd) continue;

    const revenue = Math.round((job.invoice.grandTotal || 0) * 100);
    const hst = job.invoice.taxCollected !== false ? Math.round((job.invoice.taxAmount || 0) * 100) : 0;
    const cogs = job.invoice.cogsAmount > 0
      ? Math.round(job.invoice.cogsAmount * 100)
      : (job.items || []).reduce((sum, item) => sum + (item.isPart ? Math.round((item.unitCost || 0) * (item.quantity || 1) * 100) : 0), 0);
    const commission = Math.round((job.workerCommission || 0) * 100);

    revenueCents += revenue;
    hstCents += hst;
    cogsCents += cogs;
    commissionCents += commission;
    contributions.push({
      jobId: job.id,
      jobNumber: job.jobNumber,
      activityDate: dateKey,
      revenue: revenue / 100,
      hst: hst / 100,
      cogs: cogs / 100,
      technicianCommission: commission / 100,
    });
  }

  return { revenueCents, hstCents, cogsCents, commissionCents, contributions };
}

export function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, current) => {
    if (current instanceof Prisma.Decimal) return current.toString();
    if (current instanceof Date) return current.toISOString();
    return current;
  })) as T;
}
