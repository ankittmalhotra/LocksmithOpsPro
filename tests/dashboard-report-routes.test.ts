import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const fixture: {
  role: 'ADMIN' | 'DISPATCHER' | 'ACCOUNTANT';
  paidJobs: Array<Record<string, any>>;
  completedJobsCount: number;
  findCalls: Array<Record<string, any>>;
  prismaFindCalls: Array<Record<string, any>>;
  rawQueries: Array<any>;
  completedActivityRows: Array<{ id: string; completedAt: string | Date | null }>;
  adsMetrics: Array<Record<string, any>>;
  ledgerTechnicians: Array<Record<string, any>>;
} = { role: 'DISPATCHER', paidJobs: [], completedJobsCount: 0, findCalls: [], prismaFindCalls: [], rawQueries: [], completedActivityRows: [], adsMetrics: [], ledgerTechnicians: [] };
Object.assign(globalThis, { __dashboardReportFixture: fixture });

const actual = (path: string) => new URL(path, import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, _context, nextResolve) {
    const files: Record<string, string> = {
      '@/lib/operations-reporting': '../src/lib/operations-reporting.ts',
      '@/lib/revenue-period': '../src/lib/revenue-period.ts',
      '@/lib/timezone': '../src/lib/timezone.ts',
      '@/lib/calculations': '../src/lib/calculations.ts',
    };
    if (files[specifier]) return { url: actual(files[specifier]), shortCircuit: true };
    const mocks = ['next/server', '@/lib/auth', '@/lib/prisma', '@/lib/job-helper', '@/lib/manual-job', '@/lib/request-logger', '@/lib/api-error', '@/lib/google-ads'];
    if (mocks.includes(specifier)) return { url: `dashboard-report-test:${specifier}`, shortCircuit: true };
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    const mocks: Record<string, string> = {
      'dashboard-report-test:next/server': `
        export class NextResponse extends Response {
          static json(body, init = {}) {
            const headers = new Headers(init.headers || {});
            headers.set('content-type', 'application/json');
            return new Response(JSON.stringify(body), { status: init.status || 200, headers });
          }
        }
      `,
      'dashboard-report-test:@/lib/auth': `export async function getCurrentUser() { return { id: 'user-1', role: globalThis.__dashboardReportFixture.role }; }`,
      'dashboard-report-test:@/lib/prisma': `
        const f = globalThis.__dashboardReportFixture;
        export const prisma = {
          job: {
            async count() { return f.completedJobsCount; },
            async findMany(args = {}) {
              f.prismaFindCalls.push(args);
              if (args.where?.id?.in) return f.paidJobs.filter((job) => args.where.id.in.includes(job.id));
              if (args.select?.id && args.select?.completedAt && Object.keys(args.select).length === 2) {
                const cursorIndex = args.cursor ? f.completedActivityRows.findIndex((job) => job.id === args.cursor.id) : -1;
                const start = args.cursor ? cursorIndex + (args.skip || 1) : (args.skip || 0);
                return f.completedActivityRows.slice(start, start + (args.take || f.completedActivityRows.length));
              }
              if (args.select?.items && args.take) {
                const cursorIndex = args.cursor ? f.paidJobs.findIndex((job) => job.id === args.cursor.id) : -1;
                const start = args.cursor ? cursorIndex + (args.skip || 1) : (args.skip || 0);
                return f.paidJobs.slice(start, start + args.take);
              }
              if (args.select?.jobNumber && args.take) return f.paidJobs.slice(0, args.take);
              return f.paidJobs;
            },
          },
          async $queryRaw(query) {
            f.rawQueries.push(query);
            const isCompleted = !query.sql.includes('COALESCE');
            const rows = [...f.paidJobs].sort((left, right) => {
              const leftDate = isCompleted ? left.completedAt : left.invoice?.paidAt || left.completedAt || left.createdAt;
              const rightDate = isCompleted ? right.completedAt : right.invoice?.paidAt || right.completedAt || right.createdAt;
              return new Date(rightDate).getTime() - new Date(leftDate).getTime() || right.id.localeCompare(left.id);
            });
            const [take, offset] = query.values.slice(-2);
            return rows.slice(offset, offset + take).map((row) => ({ id: row.id }));
          },
          googleAdsDailyMetric: { async findMany() { return f.adsMetrics; } },
        };
      `,
      'dashboard-report-test:@/lib/job-helper': `
        const f = globalThis.__dashboardReportFixture;
        export async function findJobsWithDetails(args = {}) {
          f.findCalls.push(args);
          if (args.where?.id?.in) return f.paidJobs.filter((job) => args.where.id.in.includes(job.id));
          if (args.take) return f.paidJobs.slice(0, args.take);
          return f.paidJobs;
        }
        export async function findTechniciansWithSettlements() { return f.ledgerTechnicians; }
      `,
      'dashboard-report-test:@/lib/manual-job': 'export function normalizeManualJobInvoice(job) { return job; }',
      'dashboard-report-test:@/lib/request-logger': 'export function logCaughtRequestError() {} export function withRequestLogging(_route, handler) { return handler; }',
      'dashboard-report-test:@/lib/api-error': 'export function getApiErrorMessage(error, fallback) { return error?.message || fallback; }',
      'dashboard-report-test:@/lib/google-ads': `
        export function calculateGoogleAdsRoi(profit, spend) { return spend === null ? { netReturn: null, roiPercent: null, roas: null } : { netReturn: profit - spend, roiPercent: ((profit - spend) / spend) * 100, roas: profit / spend }; }
        export function dateKeyToUtcDate(key) { return new Date(key + 'T00:00:00.000Z'); }
        export function getGoogleAdsDateKeys() { return ['2026-10-05']; }
        export function getMissingGoogleAdsConfigVariables() { return []; }
        export function getGoogleAdsAccountMetadata() {
          const currencyCode = process.env.GOOGLE_ADS_CURRENCY_CODE?.trim().toUpperCase() || '';
          const timeZone = process.env.GOOGLE_ADS_TIME_ZONE?.trim() || '';
          const verified = process.env.GOOGLE_ADS_METADATA_VERIFIED?.trim().toLowerCase() === 'true' && /^[A-Z]{3}$/.test(currencyCode) && Boolean(timeZone);
          return { verified, currencyCode: verified ? currencyCode : null, timeZone: verified ? timeZone : null };
        }
        export const GOOGLE_ADS_RANGE_LABELS = { today: 'Today' };
        export const GOOGLE_ADS_RANGE_OPTIONS = ['today'];
        export const GOOGLE_ADS_TIME_ZONE = 'America/Toronto';
      `,
    };
    if (mocks[url]) return { format: 'module', shortCircuit: true, source: mocks[url] };
    return nextLoad(url, context);
  },
});

const [dashboardModule, reportModule, exportModule, adsModule, cashLedgerModule] = await Promise.all([
  import('../src/app/api/dashboard/summary/route.ts'),
  import('../src/app/api/analytics/operations-report/route.ts'),
  import('../src/app/api/analytics/operations-report/export/route.ts'),
  import('../src/app/api/dashboard/google-ads-summary/route.ts'),
  import('../src/app/api/admin/cash-ledger/route.ts'),
]);

function job(index: number): Record<string, any> {
  return {
    id: `job-${String(index).padStart(3, '0')}`,
    jobNumber: String(900000 + index),
    status: 'COMPLETED',
    isManual: false,
    createdAt: '2026-10-05T15:00:00.000Z',
    completedAt: '2026-10-05T15:00:00.000Z',
    technicianName: 'Technician One',
    serviceType: 'Lock change',
    serviceAddress: 'Private address',
    problemDescription: 'Private job notes',
    vehicleVin: 'SENSITIVE-VIN',
    preWorkSignature: 'SENSITIVE-SIGNATURE',
    intakeMessage: 'Private dispatcher message',
    customer: { name: `Customer ${index}`, phone: '4165550100' },
    technician: { id: 'tech-1', name: 'Technician One', phone: '4165550101' },
    invoice: {
      paymentStatus: 'PAID', paymentMethod: 'CASH', paidAt: '2026-10-05T15:00:00.000Z',
      grandTotal: 100, totalAmountCollected: 100, subtotal: 88.5, taxAmount: 11.5,
      taxCollected: true, cogsAmount: 0, cardSurchargeAmount: 0,
    },
    workerCommission: 10,
    items: [{ isPart: true, unitCost: 5, quantity: 1 }],
  };
}

test('Dispatcher Dashboard is minimal, uncached, and separates ten-row preview from whole-period totals', async () => {
  fixture.role = 'DISPATCHER';
  fixture.paidJobs = Array.from({ length: 12 }, (_, index) => job(index + 1));
  fixture.completedJobsCount = 14;
  fixture.findCalls = [];

  const response = await dashboardModule.GET(new Request('https://portal.test/api/dashboard/summary?period=all-time'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /private, no-store/);
  assert.equal(body.summary.paidInvoiceCount, 12);
  assert.equal(body.summary.totalGrossRevenue, 1200);
  assert.equal(body.summary.completedJobsCount, 14);
  assert.equal(body.recentActivity.length, 10);
  assert.equal(body.last7DaysSummary.paidInvoiceCount, 12);
  assert.equal(body.last7DaysSummary.completedJobsCount, 0);
  assert.equal(body.last7DaysSummary.todayIsPartial, true);
  assert.equal(fixture.prismaFindCalls.find((args) => args.take === 10 && args.select?.jobNumber && !args.select?.items)?.take, 10);
  assert.equal('googleAds' in body, false);
  assert.doesNotMatch(JSON.stringify(body.recentActivity), /4165550100|Private address|Private job notes|SENSITIVE|Private dispatcher/);
  assert.deepEqual(Object.keys(body.recentActivity[0]).sort(), [
    'completedAt', 'createdAt', 'customer', 'id', 'invoice', 'isManual', 'jobNumber', 'serviceType', 'status', 'technician', 'technicianName',
  ].sort());
});

test('Dashboard summary defaults to the current biweekly period', async () => {
  fixture.role = 'DISPATCHER';
  fixture.paidJobs = [];
  const response = await dashboardModule.GET(new Request('https://portal.test/api/dashboard/summary'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.financialPeriod.key, 'current-biweekly');
});

test('all-time Dashboard totals and Last 7 Days aggregate through bounded chunks', async () => {
  fixture.role = 'DISPATCHER';
  fixture.paidJobs = Array.from({ length: 530 }, (_, index) => job(index + 1));
  fixture.completedJobsCount = 530;
  fixture.completedActivityRows = fixture.paidJobs.map((row) => ({ id: row.id, completedAt: row.completedAt }));
  fixture.prismaFindCalls = [];
  const response = await dashboardModule.GET(new Request('https://portal.test/api/dashboard/summary?period=all-time'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.summary.paidInvoiceCount, 530);
  assert.equal(body.summary.totalGrossRevenue, 53000);
  assert.equal(body.last7DaysSummary.paidInvoiceCount, 530);
  assert.equal(body.recentActivity.length, 10);
  const paidChunks = fixture.prismaFindCalls.filter((args) => args.select?.items && args.take);
  const completedChunks = fixture.prismaFindCalls.filter((args) => Object.keys(args.select || {}).length === 2 && args.select?.completedAt && args.take);
  assert.equal(paidChunks.length, 3);
  assert.equal(completedChunks.length, 3);
  assert.ok([...paidChunks, ...completedChunks].every((args) => args.take <= 250));
});

test('Dispatcher report JSON is minimal and its authorized CSV exports all matching rows', async () => {
  fixture.role = 'DISPATCHER';
  fixture.paidJobs = Array.from({ length: 12 }, (_, index) => job(index + 1));
  fixture.findCalls = [];
  const query = 'period=custom&basis=paid-invoices&dateFrom=2026-10-05&dateTo=2026-10-05&status=ALL';

  const reportResponse = await reportModule.GET(new Request(`https://portal.test/api/analytics/operations-report?${query}`));
  const report = await reportResponse.json();
  assert.equal(reportResponse.status, 200);
  assert.equal(report.summary.totalGrossRevenue, 1200);
  assert.equal(report.pagination.totalRows, 12);
  assert.equal(report.rows.length, 12);
  assert.equal(report.rows[0].resolvedPartsCogs, 5);
  assert.equal(report.rows[0].workerCommission, 10);
  const aggregateQuery = fixture.prismaFindCalls.find((args) => args.select?.items && args.select?.invoice);
  assert.ok(aggregateQuery, 'full-range totals use the narrow aggregate projection');
  assert.equal('customer' in aggregateQuery.select, false);
  const pageQuery = fixture.prismaFindCalls.find((args) => args.where?.id?.in);
  assert.ok(pageQuery);
  assert.equal(pageQuery.where.id.in.length, 12, 'only the selected page loads broad job details');
  assert.equal('phone' in pageQuery.select.customer.select, false);
  assert.match(reportResponse.headers.get('cache-control') || '', /private, no-store/);
  assert.doesNotMatch(JSON.stringify(report.rows), /4165550100|Private address|Private job notes|SENSITIVE|Private dispatcher/);

  const exportResponse = await exportModule.GET(new Request(`https://portal.test/api/analytics/operations-report/export?${query}`));
  const csv = await exportResponse.text();
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get('x-report-entity-code'), 'LOCKSMITH');
  assert.equal(csv.split('\r\n').length, 13, 'the export contains every match, not just the preview or page');
  assert.match(csv, /900012/);
  assert.doesNotMatch(csv, /4165550100|Private address|Private job notes|SENSITIVE|Private dispatcher/);
  const exportQueries = fixture.prismaFindCalls.filter((args) => args.orderBy && args.select?.jobNumber && args.select?.items);
  assert.ok(exportQueries.length > 0, 'CSV is read through narrow database chunks');
  assert.ok(exportQueries.every((args) => args.take <= 250), 'CSV query memory is bounded to 250 rows per page');
  assert.equal(exportQueries[0].select.customer.select.name, true);
  assert.equal('phone' in exportQueries[0].select.customer.select, false);
});

test('report page 2 reads no more than 25 detail rows while full-range summary and CSV cover more than 25 jobs', async () => {
  fixture.role = 'DISPATCHER';
  fixture.paidJobs = Array.from({ length: 530 }, (_, index) => job(index + 1));
  fixture.findCalls = [];
  fixture.prismaFindCalls = [];
  const query = 'period=custom&basis=paid-invoices&dateFrom=2026-10-05&dateTo=2026-10-05&status=ALL&page=2';

  const reportResponse = await reportModule.GET(new Request(`https://portal.test/api/analytics/operations-report?${query}`));
  const report = await reportResponse.json();
  assert.equal(reportResponse.status, 200);
  assert.equal(report.summary.paidInvoiceCount, 530);
  assert.equal(report.summary.totalGrossRevenue, 53000);
  assert.equal(report.pagination.totalRows, 530);
  assert.equal(report.pagination.page, 2);
  assert.equal(report.rows.length, 25);
  assert.equal(report.rows[0].id, 'job-505');
  assert.equal(report.rows[24].id, 'job-481');
  const detailQuery = fixture.prismaFindCalls.find((args) => args.where?.id?.in);
  assert.ok(detailQuery);
  assert.equal(detailQuery.where.id.in.length, 25, 'page two loads no more than its twenty-five detail records');

  const exportResponse = await exportModule.GET(new Request(`https://portal.test/api/analytics/operations-report/export?${query}`));
  const csv = await exportResponse.text();
  assert.equal(exportResponse.status, 200);
  assert.equal(csv.split('\r\n').length, 531, 'CSV includes its header and every matching row across database chunks');
  assert.match(csv, /900530/);
  assert.match(csv, /900001/);
  const exportQueries = fixture.prismaFindCalls.filter((args) => args.orderBy && args.select?.jobNumber && args.select?.items);
  assert.ok(exportQueries.length >= 3, 'the complete export reads multiple bounded database pages');
  assert.ok(exportQueries.every((args) => args.take <= 250));
  const aggregateChunks = fixture.prismaFindCalls.filter((args) => args.select?.items && !args.select?.jobNumber && args.take);
  assert.ok(aggregateChunks.length >= 3, 'full-range report totals are accumulated across bounded database chunks');
  assert.ok(aggregateChunks.every((args) => args.take <= 250));
  assert.ok(aggregateChunks.slice(1).every((args) => args.cursor && args.skip === 1));
  assert.match(fixture.rawQueries.at(-1).sql, /COALESCE\(i\."paidAt", j\."completedAt", j\."createdAt"\)/);
});

test('report page ordering applies the same paidAt, completion, then received-date fallback', async () => {
  fixture.role = 'DISPATCHER';
  const earlyPaid = job(1);
  earlyPaid.invoice.paidAt = '2026-10-04T12:00:00.000Z';
  earlyPaid.completedAt = '2026-10-08T12:00:00.000Z';
  earlyPaid.createdAt = '2026-10-09T12:00:00.000Z';
  const backdated = job(2);
  backdated.invoice.paidAt = null;
  backdated.completedAt = '2026-10-06T12:00:00.000Z';
  backdated.createdAt = '2026-10-09T13:00:00.000Z';
  const receivedDateFallback = job(3);
  receivedDateFallback.invoice.paidAt = null;
  receivedDateFallback.completedAt = null;
  receivedDateFallback.createdAt = '2026-10-05T12:00:00.000Z';
  fixture.paidJobs = [earlyPaid, receivedDateFallback, backdated];
  const response = await reportModule.GET(new Request('https://portal.test/api/analytics/operations-report?period=all-time&basis=paid-invoices'));
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(report.rows.map((row: any) => row.id), ['job-002', 'job-003', 'job-001']);
  assert.match(fixture.rawQueries.at(-1).sql, /ORDER BY COALESCE\(i\."paidAt", j\."completedAt", j\."createdAt"\) DESC, j\."id" DESC/);
});

test('operations report rejects other entities and returns no cross-entity data', async () => {
  fixture.role = 'DISPATCHER';
  const query = 'period=all-time&basis=paid-invoices&entityCode=OTHER';
  const report = await reportModule.GET(new Request(`https://portal.test/api/analytics/operations-report?${query}`));
  const exportResponse = await exportModule.GET(new Request(`https://portal.test/api/analytics/operations-report/export?${query}`));
  assert.equal(report.status, 400);
  assert.equal(exportResponse.status, 400);
});

test('Accountant is denied both operations report reads and export', async () => {
  fixture.role = 'ACCOUNTANT';
  const query = 'period=all-time&basis=paid-invoices&status=ALL';
  const report = await reportModule.GET(new Request(`https://portal.test/api/analytics/operations-report?${query}`));
  const exportResponse = await exportModule.GET(new Request(`https://portal.test/api/analytics/operations-report/export?${query}`));
  assert.equal(report.status, 403);
  assert.equal(exportResponse.status, 403);
});

test('Google Ads summary is Admin-only, separate from shared Dashboard data, and withholds cross-currency return ratios', async () => {
  fixture.role = 'DISPATCHER';
  const forbidden = await adsModule.GET(new Request('https://portal.test/api/dashboard/google-ads-summary?range=today'));
  assert.equal(forbidden.status, 403);

  const originalCustomerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const originalCurrencyCode = process.env.GOOGLE_ADS_CURRENCY_CODE;
  const originalMetadataVerified = process.env.GOOGLE_ADS_METADATA_VERIFIED;
  const originalTimeZone = process.env.GOOGLE_ADS_TIME_ZONE;
  process.env.GOOGLE_ADS_CUSTOMER_ID = '123-456-7890';
  process.env.GOOGLE_ADS_CURRENCY_CODE = 'USD';
  process.env.GOOGLE_ADS_METADATA_VERIFIED = 'true';
  process.env.GOOGLE_ADS_TIME_ZONE = 'America/Toronto';
  fixture.adsMetrics = [{ date: new Date('2026-10-05T00:00:00.000Z'), spend: 25, conversionsValue: 40, clicks: 5, impressions: 50, syncedAt: new Date('2026-10-06T12:00:00.000Z') }];
  try {
    fixture.role = 'ADMIN';
    fixture.paidJobs = Array.from({ length: 12 }, (_, index) => job(index + 1));
    const response = await adsModule.GET(new Request('https://portal.test/api/dashboard/google-ads-summary?range=today'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') || '', /private, no-store/);
    assert.equal(body.spend, 25);
    assert.equal(body.operatingCurrencyCode, 'CAD');
    assert.equal(body.currencyCode, 'USD');
    assert.equal(body.currenciesMatch, false);
    assert.equal(body.spendCoverageComplete, true);
    assert.equal(body.ratiosAvailable, false);
    assert.equal(body.ratioUnavailableReason, 'currency_mismatch');
    assert.equal(body.roiPercent, null);
    assert.equal(body.netReturn, null);
    assert.equal('recentActivity' in body, false);
    assert.doesNotMatch(JSON.stringify(body), /4165550100|Private address|SENSITIVE/);
  } finally {
    if (originalCustomerId === undefined) delete process.env.GOOGLE_ADS_CUSTOMER_ID;
    else process.env.GOOGLE_ADS_CUSTOMER_ID = originalCustomerId;
    if (originalCurrencyCode === undefined) delete process.env.GOOGLE_ADS_CURRENCY_CODE;
    else process.env.GOOGLE_ADS_CURRENCY_CODE = originalCurrencyCode;
    if (originalMetadataVerified === undefined) delete process.env.GOOGLE_ADS_METADATA_VERIFIED;
    else process.env.GOOGLE_ADS_METADATA_VERIFIED = originalMetadataVerified;
    if (originalTimeZone === undefined) delete process.env.GOOGLE_ADS_TIME_ZONE;
    else process.env.GOOGLE_ADS_TIME_ZONE = originalTimeZone;
  }
});

test('Admin Ads return ratios stay unavailable for incomplete spend coverage', async () => {
  const originalCustomerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const originalCurrencyCode = process.env.GOOGLE_ADS_CURRENCY_CODE;
  const originalMetadataVerified = process.env.GOOGLE_ADS_METADATA_VERIFIED;
  const originalTimeZone = process.env.GOOGLE_ADS_TIME_ZONE;
  process.env.GOOGLE_ADS_CUSTOMER_ID = '123-456-7890';
  process.env.GOOGLE_ADS_CURRENCY_CODE = 'CAD';
  process.env.GOOGLE_ADS_METADATA_VERIFIED = 'true';
  process.env.GOOGLE_ADS_TIME_ZONE = 'America/Toronto';
  fixture.adsMetrics = [];
  fixture.role = 'ADMIN';
  try {
    const response = await adsModule.GET(new Request('https://portal.test/api/dashboard/google-ads-summary?range=today'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.spendCoverageComplete, false);
    assert.equal(body.ratiosAvailable, false);
    assert.equal(body.ratioUnavailableReason, 'partial_spend_coverage');
    assert.equal(body.netReturn, null);
    assert.equal(body.roiPercent, null);

    fixture.paidJobs = [job(1)];
    fixture.adsMetrics = [{ date: new Date('2026-10-05T00:00:00.000Z'), spend: 25, conversionsValue: 0, clicks: 1, impressions: 10, syncedAt: new Date('2026-10-06T12:00:00.000Z') }];
    const completeResponse = await adsModule.GET(new Request('https://portal.test/api/dashboard/google-ads-summary?range=today'));
    const complete = await completeResponse.json();
    assert.equal(complete.spendCoverageComplete, true);
    assert.equal(complete.ratiosAvailable, true);
    assert.equal(complete.netReturn, 48.5);
    assert.equal(complete.ratioUnavailableReason, null);
  } finally {
    if (originalCustomerId === undefined) delete process.env.GOOGLE_ADS_CUSTOMER_ID;
    else process.env.GOOGLE_ADS_CUSTOMER_ID = originalCustomerId;
    if (originalCurrencyCode === undefined) delete process.env.GOOGLE_ADS_CURRENCY_CODE;
    else process.env.GOOGLE_ADS_CURRENCY_CODE = originalCurrencyCode;
    if (originalMetadataVerified === undefined) delete process.env.GOOGLE_ADS_METADATA_VERIFIED;
    else process.env.GOOGLE_ADS_METADATA_VERIFIED = originalMetadataVerified;
    if (originalTimeZone === undefined) delete process.env.GOOGLE_ADS_TIME_ZONE;
    else process.env.GOOGLE_ADS_TIME_ZONE = originalTimeZone;
  }
});

test('Ads values and ratios are withheld until currency and timezone metadata are verified', async () => {
  const names = ['GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CURRENCY_CODE', 'GOOGLE_ADS_METADATA_VERIFIED', 'GOOGLE_ADS_TIME_ZONE'] as const;
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.GOOGLE_ADS_CUSTOMER_ID = '123-456-7890';
  fixture.role = 'ADMIN';
  fixture.adsMetrics = [{ date: new Date('2026-10-05T00:00:00.000Z'), spend: 25, conversionsValue: 40, clicks: 5, impressions: 50, syncedAt: new Date('2026-10-06T12:00:00.000Z') }];
  try {
    const response = await adsModule.GET(new Request('https://portal.test/api/dashboard/google-ads-summary?range=today'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.metadataVerified, false);
    assert.equal(body.dateFrom, null);
    assert.equal(body.dateTo, null);
    assert.equal(body.currencyCode, null);
    assert.equal(body.timeZone, null);
    assert.equal(body.spend, null);
    assert.equal(body.operatingProfitBeforeAds, null);
    assert.equal(body.ratiosAvailable, false);
    assert.equal(body.ratioUnavailableReason, 'account_metadata_unverified');
    assert.equal(body.roiPercent, null);
    assert.equal(body.netReturn, null);
    assert.equal(body.expectedDays, 0);
  } finally {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
});

test('cash ledger remains reachable to Admin and denied to Dispatcher', async () => {
  fixture.paidJobs = Array.from({ length: 12 }, (_, index) => job(index + 1));
  fixture.ledgerTechnicians = [{
    id: 'tech-1', name: 'Technician One', phone: '4165550101', active: true, commissionRate: 10,
    settlements: [{ id: 'settlement-1', amountSettled: 50, settledAt: '2026-10-06T12:00:00.000Z' }],
  }];
  fixture.role = 'DISPATCHER';
  const forbidden = await cashLedgerModule.GET(new Request('https://portal.test/api/admin/cash-ledger'));
  assert.equal(forbidden.status, 403);

  fixture.role = 'ADMIN';
  const response = await cashLedgerModule.GET(new Request('https://portal.test/api/admin/cash-ledger'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /private, no-store/);
  assert.equal(body.ledger[0].cashCollected, 1200);
  assert.equal(body.ledger[0].commissionsEarned, 120);
  assert.equal(body.ledger[0].netCashOwedToCompany, 1030);
  assert.equal(body.ledger[0].settlements.length, 1);
});

test.after(() => hooks.deregister());
