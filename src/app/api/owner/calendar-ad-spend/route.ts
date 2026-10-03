import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { dateKeyToUtcDate } from '@/lib/google-ads';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

const isDateKey = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!isDateKey(from) || !isDateKey(to) || from > to) {
      return NextResponse.json({ success: false, error: 'Valid from and to dates are required.' }, { status: 400 });
    }

    const metrics = await prisma.googleAdsDailyMetric.findMany({
      where: { date: { gte: dateKeyToUtcDate(from), lte: dateKeyToUtcDate(to) } },
      select: { date: true, spend: true },
    });
    const spendByDate = Object.fromEntries(metrics.map((metric) => [metric.date.toISOString().slice(0, 10), metric.spend]));
    return NextResponse.json({ success: true, spendByDate });
  } catch (error) {
    logCaughtRequestError(request, '/api/owner/calendar-ad-spend', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load Google Ads spend.') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/owner/calendar-ad-spend', handleGET);
