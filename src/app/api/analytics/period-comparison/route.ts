import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getApiErrorMessage } from '@/lib/api-error';
import { prisma } from '@/lib/prisma';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { OPERATIONS_FINANCIAL_SELECT } from '@/lib/operations-reporting';
import {
  aggregatePeriodComparison,
  getPeriodComparisonRanges,
  type PeriodComparisonJob,
  type DateKeyRange,
} from '@/lib/period-comparison';
import { torontoDateToMidnightIso } from '@/lib/timezone';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTorontoDateTimeBounds(range: DateKeyRange) {
  const start = torontoDateToMidnightIso(range.start);
  const endExclusive = torontoDateToMidnightIso(addDateKeyDays(range.end, 1));
  if (!start || !endExclusive) throw new Error('Unable to build Toronto date-time bounds');
  return { gte: new Date(start), lt: new Date(endExclusive) };
}

async function handleGET(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 },
      );
    }

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin or dispatcher access required' },
        { status: 403 },
      );
    }

    const now = new Date();
    const weekRanges = getPeriodComparisonRanges('week', now);
    const biweeklyRanges = getPeriodComparisonRanges('biweekly', now);
    const ranges = [
      weekRanges.current,
      weekRanges.previous,
      biweeklyRanges.current,
      biweeklyRanges.previous,
    ];

    // Restrict reads to records relevant to one of the four windows. Revenue
    // follows paidAt → completedAt → createdAt, so retain the null-date
    // branches required by that fallback while keeping the same date bounds.
    const jobs = (await prisma.job.findMany({
      where: {
        OR: ranges.flatMap((range) => {
          const dateTimeBounds = getTorontoDateTimeBounds(range);
          return [
            { status: 'COMPLETED', completedAt: dateTimeBounds },
            { invoice: { is: { paymentStatus: 'PAID', paidAt: dateTimeBounds } } },
            {
              invoice: { is: { paymentStatus: 'PAID', paidAt: null } },
              completedAt: dateTimeBounds,
            },
            {
              invoice: { is: { paymentStatus: 'PAID', paidAt: null } },
              completedAt: null,
              createdAt: dateTimeBounds,
            },
          ];
        }),
      },
      select: OPERATIONS_FINANCIAL_SELECT,
    })).map(normalizeManualJobInvoice) as PeriodComparisonJob[];

    return NextResponse.json({
      success: true,
      comparisons: {
        week: aggregatePeriodComparison(jobs, weekRanges),
        biweekly: aggregatePeriodComparison(jobs, biweeklyRanges),
      },
    });
  } catch (error: any) {
    logCaughtRequestError(request, '/api/analytics/period-comparison', error);
    const errorCode = typeof error?.code === 'string' ? ` (${error.code})` : '';
    return NextResponse.json(
      { success: false, error: getApiErrorMessage(error, `Unable to load period comparisons${errorCode}`) },
      { status: 500 },
    );
  }
}

export const GET = withRequestLogging('/api/analytics/period-comparison', handleGET);
