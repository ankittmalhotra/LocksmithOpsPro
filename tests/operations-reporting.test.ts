import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregatePeriodComparison } from '../src/lib/period-comparison.ts';
import {
  calculatePaidRevenueSummary,
  calculateLast7DaysCompletedJobCounts,
  calculateLast7DaysPaidSeries,
  buildOperationsReportHref,
  getTorontoDateTimeBounds,
  isJobInDateRange,
  parseOperationsReportQuery,
  projectDashboardRecentActivity,
  projectOperationsReportRow,
  serializeOperationsReportCsv,
  type ReportingJob,
} from '../src/lib/operations-reporting.ts';

function reportJob(index: number, overrides: Partial<ReportingJob> = {}): ReportingJob {
  return {
    id: `job-${index}`,
    jobNumber: String(900000 + index),
    status: 'COMPLETED',
    isManual: false,
    createdAt: '2026-03-08T12:00:00.000Z',
    completedAt: '2026-03-08T14:00:00.000Z',
    workerCommission: 10,
    customer: { name: `Customer ${index}`, phone: `4165550${String(index).padStart(3, '0')}` },
    technician: { id: 'tech-1', name: 'Technician One', phone: '4165550101' },
    technicianName: 'Technician One',
    serviceType: 'Lock change',
    serviceAddress: '11 Sensitive Address Road',
    items: [{ isPart: true, unitCost: 5, quantity: 1 }],
    invoice: {
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      paidAt: '2026-03-09T06:30:00.000Z',
      grandTotal: 100,
      totalAmountCollected: 100,
      subtotal: 88.5,
      taxAmount: 11.5,
      taxCollected: true,
      cogsAmount: 0,
    },
    ...overrides,
  };
}

test('Dashboard preview stays at ten while summary and CSV retain all matching invoices', () => {
  const jobs = Array.from({ length: 12 }, (_, index) => reportJob(index + 1));
  const preview = projectDashboardRecentActivity(jobs);
  const summary = calculatePaidRevenueSummary(jobs);
  const csv = serializeOperationsReportCsv(jobs);

  assert.equal(preview.length, 10);
  assert.equal(summary.paidInvoiceCount, 12);
  assert.equal(summary.totalGrossRevenue, 1200);
  assert.equal(summary.totalTaxHST, 138);
  assert.equal(summary.totalPartsCost, 60);
  assert.equal(summary.totalCommissionsEarned, 120);
  assert.equal(csv.split('\r\n').length, 13, 'CSV includes a header and all twelve matching rows');
  assert.match(csv, /900012/);
  assert.doesNotMatch(csv, /4165550|Sensitive Address/);
});

test('Dashboard and detail projections exclude fields their views do not need', () => {
  const job = reportJob(1, {
    ...(reportJob(1) as ReportingJob & Record<string, unknown>),
    problemDescription: 'Private intake note',
    vehicleVin: 'SENSITIVE-VIN',
    preWorkSignature: 'SENSITIVE-SIGNATURE',
    intakeMessage: 'Private dispatcher message',
  } as Partial<ReportingJob>);
  const dashboardRow = projectDashboardRecentActivity([job])[0] as Record<string, unknown>;
  const reportRow = projectOperationsReportRow(job) as Record<string, unknown>;

  assert.deepEqual(Object.keys(dashboardRow).sort(), [
    'completedAt', 'createdAt', 'customer', 'id', 'invoice', 'isManual', 'jobNumber', 'serviceType', 'status', 'technician', 'technicianName',
  ].sort());
  assert.deepEqual(Object.keys(reportRow).sort(), [
    'completedAt', 'createdAt', 'customer', 'id', 'invoice', 'isManual', 'jobNumber', 'resolvedPartsCogs', 'serviceType', 'status', 'technician', 'technicianName', 'workerCommission',
  ].sort());
  assert.doesNotMatch(JSON.stringify(dashboardRow), /4165550|Sensitive|SENSITIVE|Private/);
  assert.doesNotMatch(JSON.stringify(reportRow), /4165550|Sensitive|SENSITIVE|Private/);

  const manualActivity = projectDashboardRecentActivity([reportJob(2, {
    isManual: true,
    createdAt: '2026-10-07T15:00:00.000Z',
    completedAt: '2026-09-25T14:00:00.000Z',
  })])[0];
  assert.equal(manualActivity.isManual, true);
  assert.equal(manualActivity.completedAt, '2026-09-25T14:00:00.000Z');
  assert.equal(manualActivity.createdAt, '2026-10-07T15:00:00.000Z');
});

test('detail rows and CSV use the same commission and resolved parts COGS as summary calculations', () => {
  const job = reportJob(1, { invoice: { ...reportJob(1).invoice!, cogsAmount: 0 } });
  const row = projectOperationsReportRow(job);
  const summary = calculatePaidRevenueSummary([job]);
  const csv = serializeOperationsReportCsv([job]);
  const cells = csv.split('\r\n')[1].split(',').map((cell) => cell.replace(/^"|"$/g, ''));

  assert.equal(row.resolvedPartsCogs, 5);
  assert.equal(row.workerCommission, 10);
  assert.equal(summary.totalPartsCost, row.resolvedPartsCogs);
  assert.equal(summary.totalCommissionsEarned, row.workerCommission);
  assert.equal(cells[14], row.resolvedPartsCogs.toFixed(2));
  assert.equal(cells[15], row.workerCommission.toFixed(2));
});

test('completed-jobs CSV leaves unpaid invoice amounts blank and labels financial columns as paid actuals', () => {
  const unpaid = reportJob(2, {
    invoice: { ...reportJob(2).invoice!, paymentStatus: 'PENDING', grandTotal: 100, totalAmountCollected: 0 },
  });
  const csv = serializeOperationsReportCsv([unpaid], 'completed-jobs');
  const [headers, row] = csv.split('\r\n').map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '')));

  assert.equal(headers[12], 'Paid Total Collected');
  assert.equal(headers[13], 'Paid Gross Revenue');
  assert.deepEqual(row.slice(8), ['', '', '', '', '', '', '', ''], 'unpaid rows do not report face values as collected actuals');
});

test('Last 7 days keeps completed jobs separate from paid invoices and marks today partial', () => {
  const now = new Date('2026-03-10T16:00:00.000Z');
  const paidDays = calculateLast7DaysPaidSeries([reportJob(1, {
    invoice: { ...reportJob(1).invoice!, paidAt: '2026-03-10T12:00:00.000Z' },
  })], now);
  const completedCounts = calculateLast7DaysCompletedJobCounts([
    { completedAt: '2026-03-10T12:00:00.000Z' },
    { completedAt: '2026-03-10T13:00:00.000Z' },
  ], now);
  const today = paidDays.at(-1)!;

  assert.equal(today.date, '2026-03-10');
  assert.equal(today.isPartial, true);
  assert.equal(today.paidInvoiceCount, 1);
  assert.equal(completedCounts.get(today.date), 2);
});

test('report basis and date filters preserve the selected metric date', () => {
  const parsed = parseOperationsReportQuery(new URLSearchParams({
    basis: 'completed-jobs', period: 'custom', dateFrom: '2026-03-08', dateTo: '2026-03-08', status: 'ALL',
  }));
  assert.ok('filters' in parsed);
  if (!('filters' in parsed) || !parsed.filters) throw new Error('Expected valid completed-jobs filters');
  assert.equal(parsed.filters.basis, 'completed-jobs');
  const job = reportJob(1);
  assert.equal(isJobInDateRange(job, parsed.filters.range, 'completed-jobs'), true);
  assert.equal(isJobInDateRange(job, parsed.filters.range, 'paid-invoices'), false);
  assert.ok('error' in parseOperationsReportQuery(new URLSearchParams({ basis: 'completed-jobs', status: 'COMPLETED' })));
});

test('report drilldowns freeze resolved dates and carry the validated Locksmith entity', () => {
  const href = buildOperationsReportHref({
    period: 'current-biweekly',
    basis: 'paid-invoices',
    dateFrom: '2026-10-01',
    dateTo: '2026-10-14',
  });
  const parsed = parseOperationsReportQuery(new URLSearchParams(href.split('?')[1]));
  assert.ok('filters' in parsed);
  if (!('filters' in parsed) || !parsed.filters) throw new Error('Expected report filters');
  assert.equal(parsed.filters.period, 'custom');
  assert.equal(parsed.filters.entityCode, 'LOCKSMITH');
  assert.deepEqual(parsed.filters.range, { start: '2026-10-01', end: '2026-10-14' });
  assert.ok('error' in parseOperationsReportQuery(new URLSearchParams({ entityCode: 'IT_MARKETING' })));
});

test('period-comparison revenue uses the same date and rounding contract as Dashboard reports', () => {
  const jobs = Array.from({ length: 12 }, (_, index) => reportJob(index + 1));
  const range = { start: '2026-03-09', end: '2026-03-09' };
  const summary = calculatePaidRevenueSummary(jobs, range);
  const comparison = aggregatePeriodComparison(jobs, {
    current: range,
    previous: { start: '2026-03-02', end: '2026-03-02' },
  });

  assert.equal(comparison.current.revenue, summary.totalGrossRevenue);
  assert.equal(comparison.current.completedJobs, 0, 'completion counts stay on the completion-date basis');
});

test('Toronto report bounds handle the spring daylight-saving transition', () => {
  const bounds = getTorontoDateTimeBounds({ start: '2026-03-08', end: '2026-03-08' });
  assert.equal(bounds.gte.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(bounds.lt.toISOString(), '2026-03-09T04:00:00.000Z');
});

test('Toronto report bounds handle the fall daylight-saving transition', () => {
  const bounds = getTorontoDateTimeBounds({ start: '2026-11-01', end: '2026-11-01' });
  assert.equal(bounds.gte.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(bounds.lt.toISOString(), '2026-11-02T05:00:00.000Z');
});
