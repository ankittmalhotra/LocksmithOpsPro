import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { getCurrentUser } from '@/lib/auth';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import {
  OPERATIONS_FINANCIAL_SELECT,
  OPERATIONS_REPORT_ROW_SELECT,
  addPaidRevenueToAccumulator,
  buildCompletedJobsWhere,
  buildPaidInvoiceWhere,
  createPaidRevenueAccumulator,
  finalizePaidRevenueAccumulator,
  getTorontoDateTimeBounds,
  isJobInDateRange,
  parseOperationsReportQuery,
  projectOperationsReportRow,
  type ReportingJob,
} from '@/lib/operations-reporting';

const REPORT_SCAN_CHUNK_SIZE = 250;
type ReportFilters = {
  basis: 'paid-invoices' | 'completed-jobs';
  status: 'ALL' | 'COMPLETED' | 'INVOICED' | 'ABANDONED_TRAVEL_FEE';
  range: { start: string; end: string } | null;
  pageSize: number;
};

function reportPageIdsQuery(filters: ReportFilters, offset: number) {
  const clauses: Prisma.Sql[] = [];
  const isCompletedBasis = filters.basis === 'completed-jobs';
  if (isCompletedBasis) {
    clauses.push(Prisma.sql`j."status"::text = 'COMPLETED'`);
  } else {
    clauses.push(Prisma.sql`i."paymentStatus"::text = 'PAID'`);
    if (filters.status !== 'ALL') clauses.push(Prisma.sql`j."status"::text = ${filters.status}`);
  }
  if (filters.range) {
    const bounds = getTorontoDateTimeBounds(filters.range);
    const dateExpression = isCompletedBasis
      ? Prisma.sql`j."completedAt"`
      : Prisma.sql`COALESCE(i."paidAt", j."completedAt", j."createdAt")`;
    clauses.push(Prisma.sql`${dateExpression} >= ${bounds.gte} AND ${dateExpression} < ${bounds.lt}`);
  }
  const orderExpression = isCompletedBasis
    ? Prisma.sql`j."completedAt"`
    : Prisma.sql`COALESCE(i."paidAt", j."completedAt", j."createdAt")`;
  return Prisma.sql`
    SELECT j."id"
    FROM "Job" AS j
    LEFT JOIN "Invoice" AS i ON i."jobId" = j."id"
    WHERE ${Prisma.join(clauses, ' AND ')}
    ORDER BY ${orderExpression} DESC, j."id" DESC
    LIMIT ${filters.pageSize} OFFSET ${offset}
  `;
}

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') {
      return NextResponse.json({ success: false, error: 'Admin or Dispatcher access required' }, { status: 403 });
    }

    const parsed = parseOperationsReportQuery(new URL(request.url).searchParams);
    if ('error' in parsed) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    const { filters } = parsed;
    const where = filters.basis === 'completed-jobs'
      ? buildCompletedJobsWhere(filters.range)
      : buildPaidInvoiceWhere(filters.range, filters.status);
    // Scan exact totals in bounded stable chunks. The eventual visible page is
    // ordered by activity date in SQL, since Prisma cannot express the paidAt →
    // completedAt → createdAt COALESCE order across all matching jobs.
    const paidTotals = createPaidRevenueAccumulator();
    let totalRows = 0;
    let completedJobsPaidInvoiceCount = 0;
    let cursorId: string | undefined;
    while (true) {
      const chunk = await prisma.job.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        take: REPORT_SCAN_CHUNK_SIZE,
        select: OPERATIONS_FINANCIAL_SELECT,
      });
      if (!chunk.length) break;
      cursorId = chunk.at(-1)!.id;
      for (const rawJob of chunk) {
        const job = normalizeManualJobInvoice(rawJob) as ReportingJob;
        if (!isJobInDateRange(job, filters.range, filters.basis)) continue;
        totalRows += 1;
        if (filters.basis === 'paid-invoices') addPaidRevenueToAccumulator(paidTotals, job, filters.range);
        else if (job.invoice?.paymentStatus === 'PAID') completedJobsPaidInvoiceCount += 1;
      }
      if (chunk.length < REPORT_SCAN_CHUNK_SIZE) break;
    }
    const pageCount = Math.max(1, Math.ceil(totalRows / filters.pageSize));
    const page = Math.min(filters.page, pageCount);
    const start = (page - 1) * filters.pageSize;
    const pageRows = await prisma.$queryRaw<Array<{ id: string }>>(reportPageIdsQuery(filters, start));
    const pageIds = pageRows.map((row) => row.id);
    const rawPageJobs = pageIds.length
      ? await prisma.job.findMany({ where: { id: { in: pageIds } }, select: OPERATIONS_REPORT_ROW_SELECT })
      : [];
    const pageJobsById = new Map(rawPageJobs.map((job) => {
      const normalized = normalizeManualJobInvoice(job);
      return [normalized.id, normalized as ReportingJob] as const;
    }));
    const pageJobs = pageIds.flatMap((id) => {
      const job = pageJobsById.get(id);
      return job ? [job] : [];
    });

    const summary = filters.basis === 'completed-jobs'
      ? {
          completedJobsCount: totalRows,
          paidInvoiceCount: completedJobsPaidInvoiceCount,
        }
      : finalizePaidRevenueAccumulator(paidTotals);

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      currencyCode: 'CAD',
      filters: { period: filters.period, basis: filters.basis, status: filters.status, entityCode: filters.entityCode, dateFrom: filters.range?.start ?? null, dateTo: filters.range?.end ?? null, timeZone: 'America/Toronto' },
      summary,
      rows: pageJobs.map((job) => projectOperationsReportRow(job)),
      pagination: { page, pageSize: filters.pageSize, totalRows, pageCount },
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error: any) {
    logCaughtRequestError(request, '/api/analytics/operations-report', error);
    return NextResponse.json(
      { success: false, error: getApiErrorMessage(error, 'Unable to load the operations report') },
      { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    );
  }
}

export const GET = withRequestLogging('/api/analytics/operations-report', handleGET);
