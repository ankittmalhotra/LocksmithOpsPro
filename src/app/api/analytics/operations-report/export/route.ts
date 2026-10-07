import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { getCurrentUser } from '@/lib/auth';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import {
  buildCompletedJobsWhere,
  buildPaidInvoiceWhere,
  OPERATIONS_CSV_SELECT,
  isJobInDateRange,
  parseOperationsReportQuery,
  serializeOperationsReportCsv,
  type DateKeyRange,
  type ReportingJob,
} from '@/lib/operations-reporting';

const EXPORT_CHUNK_SIZE = 250;

function csvHeader(csv: string) {
  const separator = csv.indexOf('\r\n');
  return separator < 0 ? csv : csv.slice(0, separator);
}

function csvData(csv: string) {
  const separator = csv.indexOf('\r\n');
  return separator < 0 ? '' : csv.slice(separator + 2);
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
    const dateSuffix = filters.range?.end || new Date().toISOString().slice(0, 10);
    const where = filters.basis === 'completed-jobs'
      ? buildCompletedJobsWhere(filters.range)
      : buildPaidInvoiceWhere(filters.range, filters.status);
    const encoder = new TextEncoder();
    let cancelled = false;
    let cursorId: string | undefined;
    let firstChunk = true;
    let done = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (!cancelled && !done) {
            const rows = await prisma.job.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
              take: EXPORT_CHUNK_SIZE,
              select: OPERATIONS_CSV_SELECT,
            });
            if (rows.length === 0) {
              done = true;
              if (firstChunk) controller.enqueue(encoder.encode(`\uFEFF${csvHeader(serializeOperationsReportCsv([], filters.basis))}`));
              controller.close();
              return;
            }
            cursorId = rows.at(-1)!.id;
            const jobs = rows.map(normalizeManualJobInvoice).filter((job) => (
              isJobInDateRange(job as ReportingJob, filters.range, filters.basis)
            )) as ReportingJob[];
            if (jobs.length) {
              const csv = serializeOperationsReportCsv(jobs, filters.basis);
              const chunk = firstChunk
                ? `\uFEFF${csv}`
                : `\r\n${csvData(csv)}`;
              if (chunk) controller.enqueue(encoder.encode(chunk));
              firstChunk = false;
              if (rows.length < EXPORT_CHUNK_SIZE) {
                done = true;
                controller.close();
              }
              return;
            }
            if (rows.length < EXPORT_CHUNK_SIZE) {
              done = true;
              if (firstChunk) controller.enqueue(encoder.encode(`\uFEFF${csvHeader(serializeOperationsReportCsv([], filters.basis))}`));
              controller.close();
              return;
            }
          }
          if (!cancelled && !done) {
            done = true;
            controller.close();
          }
        } catch (error) {
          logCaughtRequestError(request, '/api/analytics/operations-report/export', error);
          controller.error(error);
        }
      },
      cancel() { cancelled = true; },
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="LockOps_Operations_Report_${dateSuffix}.csv"`,
        'X-Report-Entity-Code': filters.entityCode,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error: any) {
    logCaughtRequestError(request, '/api/analytics/operations-report/export', error);
    return NextResponse.json(
      { success: false, error: getApiErrorMessage(error, 'Unable to export the operations report') },
      { status: 500 },
    );
  }
}

export const GET = withRequestLogging('/api/analytics/operations-report/export', handleGET);
