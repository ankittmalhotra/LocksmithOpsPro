import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  addLast7DaysPaidJob,
  createLast7DaysPaidAccumulator,
  finalizeLast7DaysPaidAccumulator,
  calculateLast7DaysCompletedJobCounts,
  addPaidRevenueToAccumulator,
  createPaidRevenueAccumulator,
  finalizePaidRevenueAccumulator,
  buildCompletedJobsWhere,
  buildPaidInvoiceWhere,
  OPERATIONS_FINANCIAL_SELECT,
  getTorontoDateTimeBounds,
  projectDashboardRecentActivity,
  resolveOperationsReportRange,
  type ReportingJob,
} from '@/lib/operations-reporting';
import { getRevenuePeriodBounds, isRevenuePeriod, REVENUE_PERIOD_LABELS, type RevenuePeriod } from '@/lib/revenue-period';
import { formatTorontoDateInput } from '@/lib/timezone';

const DASHBOARD_FINANCIAL_CHUNK_SIZE = 250;

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') {
      return NextResponse.json({ success: false, error: 'Admin or Dispatcher access required' }, { status: 403 });
    }

    const url = new URL(request.url);
    const requestedPeriod = url.searchParams.get('period');
    if (requestedPeriod && !isRevenuePeriod(requestedPeriod)) {
      return NextResponse.json({ success: false, error: 'Choose a supported financial period.' }, { status: 400 });
    }
    const period: RevenuePeriod = isRevenuePeriod(requestedPeriod) ? requestedPeriod : 'current-biweekly';
    const now = new Date();
    const range = getRevenuePeriodBounds(period, now);
    const last7Range = resolveOperationsReportRange('last-7-days', {}, now);
    const paidActivityWhere = range
      ? { OR: [buildPaidInvoiceWhere(range), buildPaidInvoiceWhere(last7Range)] }
      : buildPaidInvoiceWhere(null);
    const recentJobsPromise = prisma.job.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true,
        jobNumber: true,
        status: true,
        isManual: true,
        createdAt: true,
        completedAt: true,
        serviceType: true,
        technicianName: true,
        customer: { select: { name: true } },
        technician: { select: { name: true } },
        invoice: { select: {
          paymentStatus: true,
          paymentMethod: true,
          paymentProvider: true,
          totalAmountCollected: true,
          grandTotal: true,
          taxCollected: true,
        } },
      },
    });
    const completedWhere = range
      ? { status: 'COMPLETED' as const, completedAt: getTorontoDateTimeBounds(range) }
      : { status: 'COMPLETED' as const };

    const [rawRecentJobs, completedJobsCount] = await Promise.all([
      recentJobsPromise,
      prisma.job.count({ where: completedWhere }),
    ]);
    const recentJobs = rawRecentJobs.map(normalizeManualJobInvoice);
    const completedJobsByDay = calculateLast7DaysCompletedJobCounts([], now);
    let completedCursorId: string | undefined;
    while (true) {
      const completedChunk = await prisma.job.findMany({
        where: buildCompletedJobsWhere(last7Range),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(completedCursorId ? { cursor: { id: completedCursorId }, skip: 1 } : {}),
        take: DASHBOARD_FINANCIAL_CHUNK_SIZE,
        select: { id: true, completedAt: true },
      });
      if (!completedChunk.length) break;
      completedCursorId = completedChunk.at(-1)!.id;
      for (const { completedAt } of completedChunk) {
        const key = completedAt ? formatTorontoDateInput(completedAt) : null;
        if (key && completedJobsByDay.has(key)) completedJobsByDay.set(key, (completedJobsByDay.get(key) || 0) + 1);
      }
      if (completedChunk.length < DASHBOARD_FINANCIAL_CHUNK_SIZE) break;
    }
    const paidTotals = createPaidRevenueAccumulator();
    const last7PaidTotals = createLast7DaysPaidAccumulator(now);
    let cursorId: string | undefined;
    while (true) {
      const chunk = await prisma.job.findMany({
        where: paidActivityWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        take: DASHBOARD_FINANCIAL_CHUNK_SIZE,
        select: OPERATIONS_FINANCIAL_SELECT,
      });
      if (!chunk.length) break;
      cursorId = chunk.at(-1)!.id;
      for (const rawJob of chunk) {
        const job = normalizeManualJobInvoice(rawJob) as ReportingJob;
        addPaidRevenueToAccumulator(paidTotals, job, range);
        addLast7DaysPaidJob(last7PaidTotals, job);
      }
      if (chunk.length < DASHBOARD_FINANCIAL_CHUNK_SIZE) break;
    }
    const summary = finalizePaidRevenueAccumulator(paidTotals);
    const last7Days = finalizeLast7DaysPaidAccumulator(last7PaidTotals).map((day) => ({
      ...day,
      completedJobsCount: completedJobsByDay.get(day.date) || 0,
    }));
    const last7DaysRevenue = last7Days.reduce((sum, day) => sum + day.revenue, 0);
    const last7DaysPaidInvoices = last7Days.reduce((sum, day) => sum + day.paidInvoiceCount, 0);
    const last7DaysCompletedJobs = last7Days.reduce((sum, day) => sum + day.completedJobsCount, 0);
    const bestRevenueDay = last7DaysRevenue > 0
      ? last7Days.reduce((best, day) => day.revenue > best.revenue ? day : best, last7Days[0])
      : null;

    return NextResponse.json({
      success: true,
      generatedAt: now.toISOString(),
      currencyCode: 'CAD',
      financialPeriod: {
        key: period,
        label: REVENUE_PERIOD_LABELS[period],
        dateFrom: range?.start ?? null,
        dateTo: range?.end ?? null,
        timeZone: 'America/Toronto',
      },
      summary: {
        ...summary,
        completedJobsCount,
      },
      last7Days,
      last7DaysSummary: {
        paidInvoiceCount: last7DaysPaidInvoices,
        completedJobsCount: last7DaysCompletedJobs,
        revenue: Math.round(last7DaysRevenue * 100) / 100,
        averagePaidTicket: last7DaysPaidInvoices > 0 ? Math.round((last7DaysRevenue / last7DaysPaidInvoices) * 100) / 100 : 0,
        todayIsPartial: true,
        bestRevenueDay: bestRevenueDay
          ? { date: bestRevenueDay.date, label: bestRevenueDay.dateLabel, revenue: bestRevenueDay.revenue }
          : null,
        dateFrom: last7Days[0]?.date ?? null,
        dateTo: last7Days.at(-1)?.date ?? null,
        timeZone: 'America/Toronto',
      },
      recentActivity: projectDashboardRecentActivity(recentJobs as ReportingJob[]),
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error: any) {
    logCaughtRequestError(request, '/api/dashboard/summary', error);
    return NextResponse.json(
      { success: false, error: getApiErrorMessage(error, 'Unable to load Dashboard summary') },
      { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    );
  }
}

export const GET = withRequestLogging('/api/dashboard/summary', handleGET);
