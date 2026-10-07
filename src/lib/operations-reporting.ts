import type { Prisma } from '@prisma/client';
import { roundToTwo } from './calculations.ts';
import { getRevenueActivityDate, getRevenuePeriodBounds, isRevenuePeriod, type RevenuePeriod } from './revenue-period.ts';
import { formatTorontoDateInput, torontoDateToMidnightIso } from './timezone.ts';

export const OPERATIONS_REPORT_PERIODS = [
  ...(['all-time', 'current-biweekly', 'previous-biweekly', 'this-month'] as const),
  'last-7-days',
  'custom',
] as const;

export type OperationsReportPeriod = (typeof OPERATIONS_REPORT_PERIODS)[number];
export type DateKeyRange = { start: string; end: string };
export const OPERATIONS_REPORT_BASES = ['paid-invoices', 'completed-jobs'] as const;
export type OperationsReportBasis = (typeof OPERATIONS_REPORT_BASES)[number];
export const OPERATIONS_REPORT_ENTITY_CODE = 'LOCKSMITH' as const;

/** Minimal operational fields needed to normalize and sum paid invoices. */
export const OPERATIONS_FINANCIAL_SELECT = {
  id: true,
  status: true,
  isManual: true,
  createdAt: true,
  completedAt: true,
  workerCommission: true,
  items: { select: { isPart: true, unitCost: true, quantity: true } },
  invoice: { select: {
    paymentStatus: true,
    paymentMethod: true,
    paymentProvider: true,
    paidAt: true,
    grandTotal: true,
    totalAmountCollected: true,
    subtotal: true,
    taxAmount: true,
    taxCollected: true,
    cogsAmount: true,
    cardSurchargeAmount: true,
  } },
} satisfies Prisma.JobSelect;

/** Minimal named fields needed to stream the complete operations CSV. */
export const OPERATIONS_CSV_SELECT = {
  ...OPERATIONS_FINANCIAL_SELECT,
  jobNumber: true,
  serviceType: true,
  technicianName: true,
  customer: { select: { name: true } },
  technician: { select: { name: true } },
} satisfies Prisma.JobSelect;

/** Fields displayed on one paginated report page, without export-only data. */
export const OPERATIONS_REPORT_ROW_SELECT = {
  ...OPERATIONS_FINANCIAL_SELECT,
  jobNumber: true,
  serviceType: true,
  technicianName: true,
  customer: { select: { name: true } },
  technician: { select: { name: true } },
} satisfies Prisma.JobSelect;

export type ReportingJob = {
  id: string;
  jobNumber: string;
  status: string;
  isManual?: boolean;
  createdAt: string | Date;
  completedAt?: string | Date | null;
  workerCommission?: number | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  technician?: { id?: string; name?: string | null; phone?: string | null } | null;
  technicianName?: string | null;
  serviceType?: string | null;
  serviceAddress?: string | null;
  items?: Array<{ isPart?: boolean; unitCost?: number | null; quantity?: number | null }>;
  invoice?: {
    paymentStatus?: string | null;
    paymentMethod?: string | null;
    paidAt?: string | Date | null;
    grandTotal?: number | null;
    totalAmountCollected?: number | null;
    subtotal?: number | null;
    taxAmount?: number | null;
    taxCollected?: boolean | null;
    cogsAmount?: number | null;
    cardSurchargeAmount?: number | null;
  } | null;
};

export type PaidRevenueSummary = {
  paidInvoiceCount: number;
  totalGrossRevenue: number;
  totalCashRevenue: number;
  totalInteracRevenue: number;
  totalCardRevenue: number;
  totalTaxHST: number;
  totalCommissionsEarned: number;
  totalPartsCost: number;
  netCompanyProfit: number;
};

export type PaidRevenueAccumulator = Omit<PaidRevenueSummary, 'netCompanyProfit'>;

export function createPaidRevenueAccumulator(): PaidRevenueAccumulator {
  return {
    paidInvoiceCount: 0,
    totalGrossRevenue: 0,
    totalCashRevenue: 0,
    totalInteracRevenue: 0,
    totalCardRevenue: 0,
    totalTaxHST: 0,
    totalCommissionsEarned: 0,
    totalPartsCost: 0,
  };
}

export function addPaidRevenueToAccumulator(
  totals: PaidRevenueAccumulator,
  job: ReportingJob,
  range: DateKeyRange | null = null,
) {
  const invoice = job.invoice;
  if (!invoice || invoice.paymentStatus !== 'PAID' || !isJobInDateRange(job, range)) return;
  const amount = Number(invoice.grandTotal || 0);
  totals.paidInvoiceCount += 1;
  totals.totalGrossRevenue += amount;
  if (invoice.taxCollected !== false) totals.totalTaxHST += Number(invoice.taxAmount || 0);
  totals.totalCommissionsEarned += Number(job.workerCommission || 0);
  totals.totalPartsCost += getPaidInvoicePartsCost(job);
  if (invoice.paymentMethod === 'CASH') totals.totalCashRevenue += amount;
  else if (invoice.paymentMethod === 'INTERAC') totals.totalInteracRevenue += amount;
  else if (['STRIPE_CARD', 'DEBIT_CARD', 'CREDIT_CARD'].includes(invoice.paymentMethod || '')) {
    totals.totalCardRevenue += amount;
  }
}

export function finalizePaidRevenueAccumulator(totals: PaidRevenueAccumulator): PaidRevenueSummary {
  const totalGrossRevenue = roundToTwo(totals.totalGrossRevenue);
  const totalTaxHST = roundToTwo(totals.totalTaxHST);
  const totalCommissionsEarned = roundToTwo(totals.totalCommissionsEarned);
  const totalPartsCost = roundToTwo(totals.totalPartsCost);
  return {
    paidInvoiceCount: totals.paidInvoiceCount,
    totalGrossRevenue,
    totalCashRevenue: roundToTwo(totals.totalCashRevenue),
    totalInteracRevenue: roundToTwo(totals.totalInteracRevenue),
    totalCardRevenue: roundToTwo(totals.totalCardRevenue),
    totalTaxHST,
    totalCommissionsEarned,
    totalPartsCost,
    netCompanyProfit: roundToTwo(totalGrossRevenue - totalTaxHST - totalCommissionsEarned - totalPartsCost),
  };
}

export const OPERATIONS_REPORT_STATUSES = ['ALL', 'COMPLETED', 'INVOICED', 'ABANDONED_TRAVEL_FEE'] as const;
export type OperationsReportStatus = (typeof OPERATIONS_REPORT_STATUSES)[number];

export function parseOperationsReportQuery(params: URLSearchParams) {
  const hasCustomDates = params.has('dateFrom') || params.has('dateTo');
  const requestedPeriod = params.get('period');
  const period = requestedPeriod || (hasCustomDates ? 'custom' : 'all-time');
  if (!(OPERATIONS_REPORT_PERIODS as readonly string[]).includes(period)) {
    return { error: 'Choose a supported report period.' } as const;
  }
  const requestedBasis = params.get('basis') || 'paid-invoices';
  if (!(OPERATIONS_REPORT_BASES as readonly string[]).includes(requestedBasis)) {
    return { error: 'Choose a supported report basis.' } as const;
  }
  const entityCode = params.get('entityCode') ?? OPERATIONS_REPORT_ENTITY_CODE;
  if (entityCode !== OPERATIONS_REPORT_ENTITY_CODE) {
    return { error: 'Operations reports are available only for the Locksmith operating entity.' } as const;
  }
  const requestedStatus = params.get('status') || 'ALL';
  if (!(OPERATIONS_REPORT_STATUSES as readonly string[]).includes(requestedStatus)) {
    return { error: 'Choose a supported job status.' } as const;
  }
  if (requestedBasis === 'completed-jobs' && requestedStatus !== 'ALL') {
    return { error: 'Job status filters are only available for paid invoice reports.' } as const;
  }
  try {
    const range = resolveOperationsReportRange(period as OperationsReportPeriod, {
      dateFrom: params.get('dateFrom'),
      dateTo: params.get('dateTo'),
    });
    const pageValue = Number(params.get('page') || 1);
    const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
    if (!Number.isSafeInteger((page - 1) * 25)) return { error: 'Choose a lower report page number.' } as const;
    return {
      filters: {
        period: period as OperationsReportPeriod,
        basis: requestedBasis as OperationsReportBasis,
        entityCode: OPERATIONS_REPORT_ENTITY_CODE,
        status: requestedStatus as OperationsReportStatus,
        range,
        page,
        pageSize: 25,
      },
    } as const;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid report filters.' } as const;
  }
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function buildOperationsReportHref(options: {
  period: OperationsReportPeriod;
  basis?: OperationsReportBasis;
  status?: OperationsReportStatus;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  const dateFrom = isDateKey(options.dateFrom) ? options.dateFrom : undefined;
  const dateTo = isDateKey(options.dateTo) ? options.dateTo : undefined;
  const hasFixedDates = Boolean(dateFrom && dateTo);
  const params = new URLSearchParams({
    period: hasFixedDates ? 'custom' : options.period,
    basis: options.basis || 'paid-invoices',
    status: options.status || 'ALL',
    entityCode: OPERATIONS_REPORT_ENTITY_CODE,
  });
  if (hasFixedDates) {
    params.set('dateFrom', dateFrom!);
    params.set('dateTo', dateTo!);
  }
  return `/books/reports/operations?${params.toString()}`;
}

function addDateKeyDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveOperationsReportRange(
  period: OperationsReportPeriod,
  options: { dateFrom?: string | null; dateTo?: string | null } = {},
  now: Date = new Date(),
): DateKeyRange | null {
  if (period === 'custom') {
    if (!isDateKey(options.dateFrom) || !isDateKey(options.dateTo) || options.dateFrom > options.dateTo) {
      throw new Error('Choose a valid custom start and end date.');
    }
    return { start: options.dateFrom, end: options.dateTo };
  }
  if (period === 'last-7-days') {
    const today = formatTorontoDateInput(now);
    if (!today) throw new Error('Unable to determine the Toronto business date.');
    return { start: addDateKeyDays(today, -6), end: today };
  }
  if (!isRevenuePeriod(period)) throw new Error('Choose a supported report period.');
  return getRevenuePeriodBounds(period as RevenuePeriod, now);
}

export type PaidActivityJob = {
  invoice?: ReportingJob['invoice'];
  completedAt?: ReportingJob['completedAt'];
  createdAt?: ReportingJob['createdAt'] | null;
};

export function getPaidActivityDateKey(job: PaidActivityJob) {
  const activityDate = getRevenueActivityDate(job);
  return activityDate ? formatTorontoDateInput(activityDate) : null;
}

export function getCompletedActivityDateKey(job: Pick<ReportingJob, 'completedAt'>) {
  return job.completedAt ? formatTorontoDateInput(job.completedAt) : null;
}

export function isJobInDateRange(
  job: PaidActivityJob,
  range: DateKeyRange | null,
  basis: OperationsReportBasis = 'paid-invoices',
) {
  if (!range) return true;
  const key = basis === 'completed-jobs' ? getCompletedActivityDateKey(job) : getPaidActivityDateKey(job);
  return Boolean(key && key >= range.start && key <= range.end);
}

/** Gross revenue for a Toronto date range, shared with comparison charts. */
export function calculatePaidGrossRevenueInRange(jobs: readonly PaidActivityJob[], range: DateKeyRange) {
  const grossRevenue = jobs.reduce((total, job) => {
    if (job.invoice?.paymentStatus !== 'PAID' || !isJobInDateRange(job, range, 'paid-invoices')) return total;
    return total + Number(job.invoice.grandTotal || 0);
  }, 0);
  return roundToTwo(grossRevenue);
}

export function getPaidInvoicePartsCost(job: ReportingJob) {
  const recordedCogs = Number(job.invoice?.cogsAmount || 0);
  if (recordedCogs > 0) return recordedCogs;
  return (job.items || []).reduce((sum, item) => (
    item.isPart ? sum + Number(item.unitCost || 0) * Number(item.quantity || 1) : sum
  ), 0);
}

export function getPaidInvoiceProfit(job: ReportingJob) {
  const invoice = job.invoice;
  if (!invoice || invoice.paymentStatus !== 'PAID') return 0;
  return Number(invoice.grandTotal || 0)
    - (invoice.taxCollected !== false ? Number(invoice.taxAmount || 0) : 0)
    - Number(job.workerCommission || 0)
    - getPaidInvoicePartsCost(job);
}

/**
 * Shared financial definition for Dashboard, reports, Ads ROI and the
 * Dispatch summary: paid invoices only, activity date = paidAt → completedAt
 * → createdAt, off-books tax excluded from HST, and stored COGS preferred over
 * reconstructed line-item parts cost.
 */
export function calculatePaidRevenueSummary(
  jobs: readonly ReportingJob[],
  range: DateKeyRange | null = null,
): PaidRevenueSummary {
  const totals = createPaidRevenueAccumulator();
  for (const job of jobs) addPaidRevenueToAccumulator(totals, job, range);
  return finalizePaidRevenueAccumulator(totals);
}

export type Last7DaysPaidAccumulator = {
  today: string;
  days: Array<{ date: string; label: string; dateLabel: string; paidInvoiceCount: number; revenue: number; tax: number; profit: number }>;
};

export function createLast7DaysPaidAccumulator(now: Date = new Date()): Last7DaysPaidAccumulator {
  const today = formatTorontoDateInput(now);
  if (!today) throw new Error('Unable to determine the Toronto business date.');
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDateKeyDays(today, index - 6);
    return {
      date,
      label: new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' }),
      dateLabel: new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      paidInvoiceCount: 0,
      revenue: 0,
      tax: 0,
      profit: 0,
    };
  });
  return { today, days };
}

export function addLast7DaysPaidJob(totals: Last7DaysPaidAccumulator, job: ReportingJob) {
  if (!job.invoice || job.invoice.paymentStatus !== 'PAID') return;
  const activityDate = getPaidActivityDateKey(job);
  const day = activityDate ? totals.days.find((item) => item.date === activityDate) : undefined;
  if (!day) return;
  day.paidInvoiceCount += 1;
  day.revenue += Number(job.invoice.grandTotal || 0);
  if (job.invoice.taxCollected !== false) day.tax += Number(job.invoice.taxAmount || 0);
  day.profit += getPaidInvoiceProfit(job);
}

export function finalizeLast7DaysPaidAccumulator(totals: Last7DaysPaidAccumulator) {
  return totals.days.map((day) => ({
    ...day,
    isPartial: day.date === totals.today,
    revenue: roundToTwo(day.revenue),
    tax: roundToTwo(day.tax),
    profit: roundToTwo(day.profit),
  }));
}

export function calculateLast7DaysPaidSeries(jobs: readonly ReportingJob[], now: Date = new Date()) {
  const totals = createLast7DaysPaidAccumulator(now);
  for (const job of jobs) addLast7DaysPaidJob(totals, job);
  return finalizeLast7DaysPaidAccumulator(totals);
}

export function calculateLast7DaysCompletedJobCounts(
  jobs: readonly Pick<ReportingJob, 'completedAt'>[],
  now: Date = new Date(),
) {
  const today = formatTorontoDateInput(now);
  if (!today) throw new Error('Unable to determine the Toronto business date.');
  const counts = new Map<string, number>();
  for (let offset = -6; offset <= 0; offset += 1) counts.set(addDateKeyDays(today, offset), 0);
  for (const job of jobs) {
    const key = getCompletedActivityDateKey(job);
    if (key && counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function getTorontoDateTimeBounds(range: DateKeyRange) {
  const start = torontoDateToMidnightIso(range.start);
  const endExclusive = torontoDateToMidnightIso(addDateKeyDays(range.end, 1));
  if (!start || !endExclusive) throw new Error('Unable to build Toronto date-time bounds.');
  return { gte: new Date(start), lt: new Date(endExclusive) };
}

/** Prisma where clause for the same paidAt → completedAt → createdAt rule. */
export function buildPaidInvoiceWhere(range: DateKeyRange | null, status?: OperationsReportStatus): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [{ invoice: { is: { paymentStatus: 'PAID' } } }];
  if (status && status !== 'ALL') and.push({ status: status as any });
  if (range) {
    const bounds = getTorontoDateTimeBounds(range);
    and.push({
      OR: [
        { invoice: { is: { paymentStatus: 'PAID', paidAt: bounds } } },
        { invoice: { is: { paymentStatus: 'PAID', paidAt: null } }, completedAt: bounds },
        { invoice: { is: { paymentStatus: 'PAID', paidAt: null } }, completedAt: null, createdAt: bounds },
      ],
    });
  }
  return { AND: and };
}

/** Completion-date report basis includes completed work whether paid or unpaid. */
export function buildCompletedJobsWhere(range: DateKeyRange | null): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [{ status: 'COMPLETED' }];
  if (range) and.push({ completedAt: getTorontoDateTimeBounds(range) });
  return { AND: and };
}

/** Dashboard table needs only these fields; never serialize the full job record. */
export function projectDashboardRecentActivity(jobs: readonly ReportingJob[]) {
  return jobs.slice(0, 10).map((job) => ({
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status,
    isManual: Boolean(job.isManual),
    createdAt: job.createdAt,
    completedAt: job.completedAt ?? null,
    serviceType: job.serviceType ?? null,
    customer: job.customer ? { name: job.customer.name ?? null } : null,
    technician: job.technician ? { name: job.technician.name ?? null } : null,
    technicianName: job.technicianName ?? null,
    invoice: job.invoice ? {
      paymentStatus: job.invoice.paymentStatus ?? null,
      paymentMethod: job.invoice.paymentMethod ?? null,
      grandTotal: job.invoice.grandTotal ?? null,
    } : null,
  }));
}

/** Narrow report rows to fields used by the paginated report table. */
export function projectOperationsReportRow(job: ReportingJob) {
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status,
    isManual: Boolean(job.isManual),
    createdAt: job.createdAt,
    completedAt: job.completedAt ?? null,
    serviceType: job.serviceType ?? null,
    customer: job.customer ? { name: job.customer.name ?? null } : null,
    technician: job.technician ? { name: job.technician.name ?? null } : null,
    technicianName: job.technicianName ?? null,
    workerCommission: roundToTwo(Number(job.workerCommission || 0)),
    resolvedPartsCogs: roundToTwo(getPaidInvoicePartsCost(job)),
    invoice: job.invoice ? {
      paymentStatus: job.invoice.paymentStatus ?? null,
      paymentMethod: job.invoice.paymentMethod ?? null,
      paidAt: job.invoice.paidAt ?? null,
      grandTotal: job.invoice.grandTotal ?? null,
      taxAmount: job.invoice.taxAmount ?? null,
      taxCollected: job.invoice.taxCollected ?? null,
      cogsAmount: job.invoice.cogsAmount ?? null,
      subtotal: job.invoice.subtotal ?? null,
      totalAmountCollected: job.invoice.totalAmountCollected ?? null,
    } : null,
  };
}

export function calculateTechnicianCashLedger(
  jobs: readonly ReportingJob[],
  technicians: ReadonlyArray<{
    id: string;
    name: string;
    phone: string;
    active?: boolean;
    commissionRate?: number;
    createdAt?: Date | string;
    settlements?: ReadonlyArray<{ amountSettled: number; [key: string]: unknown }>;
  }>,
) {
  return technicians.map((tech) => {
    const technicianJobs = jobs.filter((job) => job.technician?.id === tech.id);
    let cashCollected = 0;
    let commissionsEarned = 0;
    for (const job of technicianJobs) {
      if (job.invoice?.paymentStatus !== 'PAID') continue;
      commissionsEarned += Number(job.workerCommission || 0);
      if (job.invoice.paymentMethod === 'CASH') {
        cashCollected += Number(job.invoice.totalAmountCollected || job.invoice.grandTotal || 0);
      }
    }
    const totalSettled = (tech.settlements || []).reduce((sum, settlement) => sum + Number(settlement.amountSettled || 0), 0);
    return {
      id: tech.id,
      name: tech.name,
      phone: tech.phone,
      active: tech.active,
      commissionRate: tech.commissionRate,
      createdAt: tech.createdAt,
      cashCollected: roundToTwo(cashCollected),
      commissionsEarned: roundToTwo(commissionsEarned),
      totalSettled: roundToTwo(totalSettled),
      netCashOwedToCompany: roundToTwo(cashCollected - commissionsEarned - totalSettled),
      jobsCount: technicianJobs.length,
      settlements: tech.settlements || [],
    };
  });
}

function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** All rows supplied are serialized; callers must not pass a paginated page. */
export function serializeOperationsReportCsv(
  jobs: readonly ReportingJob[],
  basis: OperationsReportBasis = 'paid-invoices',
) {
  const headers = [
    'Job Number', 'Activity Date (Toronto)', 'Customer',
    'Technician', 'Service', 'Status', 'Payment Status', 'Payment Method', 'Paid Subtotal', 'Paid HST',
    'Paid Tax Status', 'Paid Card Surcharge', 'Paid Total Collected', 'Paid Gross Revenue', 'Paid Parts COGS', 'Paid Commission',
  ];
  const rows = jobs.map((job) => {
    const invoice = job.invoice;
    const hasPaidActuals = invoice?.paymentStatus === 'PAID';
    return [
      job.jobNumber,
      (basis === 'completed-jobs' ? getCompletedActivityDateKey(job) : getPaidActivityDateKey(job)) || '',
      job.customer?.name || '',
      job.technician?.name || job.technicianName || 'Unassigned',
      job.serviceType || '',
      job.status,
      invoice?.paymentStatus || 'NO_INVOICE',
      invoice?.paymentMethod || '',
      hasPaidActuals ? Number(invoice?.subtotal || 0).toFixed(2) : '',
      hasPaidActuals ? Number(invoice?.taxAmount || 0).toFixed(2) : '',
      hasPaidActuals ? (invoice?.taxCollected === false ? 'Off books' : 'On books') : '',
      hasPaidActuals ? Number(invoice?.cardSurchargeAmount || 0).toFixed(2) : '',
      hasPaidActuals ? Number(invoice?.totalAmountCollected || invoice?.grandTotal || 0).toFixed(2) : '',
      hasPaidActuals ? Number(invoice?.grandTotal || 0).toFixed(2) : '',
      hasPaidActuals ? getPaidInvoicePartsCost(job).toFixed(2) : '',
      hasPaidActuals ? Number(job.workerCommission || 0).toFixed(2) : '',
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
