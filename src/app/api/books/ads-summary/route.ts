import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getPartnerBillingPeriod } from '@/lib/accounting';
import { BOOKS_ADS_SUMMARY_METRIC_READ_LIMIT, BOOKS_ADS_SUMMARY_PERIOD_LIMIT, BOOKS_ADS_SUMMARY_ROW_LIMIT } from '@/lib/books-window';
import { formatTorontoDateInput } from '@/lib/timezone';

/** Bounded, cache-only ad spend context. It is never a mutable expense row. */
async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    const access = await getAccountingEntityAccess('IT_MARKETING', user);
    if (!access?.canView || access.user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden: Admin access required for Google Ads spend' }, { status: 403 });

    const current = getPartnerBillingPeriod(formatTorontoDateInput(new Date()));
    const startsAt = new Date(`${current.periodStart}T00:00:00.000Z`);
    startsAt.setUTCDate(startsAt.getUTCDate() - (BOOKS_ADS_SUMMARY_PERIOD_LIMIT - 1) * 14);
    const endExclusiveAt = new Date(`${current.periodEnd}T00:00:00.000Z`);
    endExclusiveAt.setUTCDate(endExclusiveAt.getUTCDate() + 1);
    const metrics = await prisma.googleAdsDailyMetric.findMany({
      where: { date: { gte: startsAt, lt: endExclusiveAt } },
      select: { customerId: true, date: true, spend: true },
      orderBy: [{ date: 'desc' }, { customerId: 'asc' }],
      // Fetch one extra cache row so truncation is accurate without an
      // unbounded provider/cache read.
      take: BOOKS_ADS_SUMMARY_METRIC_READ_LIMIT + 1,
    });
    const grouped = new Map<string, { customerId: string; periodStart: string; periodEnd: string; spendCents: number }>();
    const sourceTruncated = metrics.length > BOOKS_ADS_SUMMARY_METRIC_READ_LIMIT;
    for (const metric of metrics.slice(0, BOOKS_ADS_SUMMARY_METRIC_READ_LIMIT)) {
      const period = getPartnerBillingPeriod(metric.date.toISOString().slice(0, 10));
      if (period.periodIndex < 0 || metric.spend <= 0) continue;
      const key = `${metric.customerId}:${period.periodStart}`;
      const row = grouped.get(key) || { customerId: metric.customerId, periodStart: period.periodStart, periodEnd: period.periodEnd, spendCents: 0 };
      row.spendCents += Math.round(metric.spend * 100);
      grouped.set(key, row);
    }
    const groupedPeriods = [...grouped.values()].sort((left, right) => right.periodEnd.localeCompare(left.periodEnd) || left.customerId.localeCompare(right.customerId));
    return NextResponse.json({
      success: true,
      window: { dateFrom: startsAt.toISOString().slice(0, 10), dateTo: current.periodEnd, periodLimit: BOOKS_ADS_SUMMARY_PERIOD_LIMIT, rowLimit: BOOKS_ADS_SUMMARY_ROW_LIMIT },
      periods: groupedPeriods.slice(0, BOOKS_ADS_SUMMARY_ROW_LIMIT),
      truncated: sourceTruncated || groupedPeriods.length > BOOKS_ADS_SUMMARY_ROW_LIMIT,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/ads-summary', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load recent Google Ads spend') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/books/ads-summary', handleGET);
