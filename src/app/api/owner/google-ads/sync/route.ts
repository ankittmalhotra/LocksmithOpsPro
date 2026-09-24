import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import {
  dateKeyToUtcDate,
  fetchGoogleAdsDailyMetrics,
  getGoogleAdsDateKeys,
  GOOGLE_ADS_RANGE_LABELS,
  GOOGLE_ADS_RANGE_OPTIONS,
  GoogleAdsReauthRequiredError,
  type GoogleAdsRoiRange,
  googleAdsErrorMessage,
} from '@/lib/google-ads';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Admin access required' },
        { status: 403 },
      );
    }

    const requestedRange = new URL(request.url).searchParams.get('range');
    const range: GoogleAdsRoiRange = GOOGLE_ADS_RANGE_OPTIONS.includes(requestedRange as GoogleAdsRoiRange)
      ? requestedRange as GoogleAdsRoiRange
      : 'today';
    const dates = getGoogleAdsDateKeys(range);
    const metrics = await Promise.all(dates.map((date) => fetchGoogleAdsDailyMetrics(date)));
    const savedMetrics = [];

    for (const dailyMetrics of metrics) {
      const metric = await prisma.googleAdsDailyMetric.upsert({
        where: {
          customerId_date: {
            customerId: dailyMetrics.customerId,
            date: dateKeyToUtcDate(dailyMetrics.date),
          },
        },
        create: {
          clicks: dailyMetrics.clicks,
          conversionsValue: dailyMetrics.conversionsValue,
          customerId: dailyMetrics.customerId,
          date: dateKeyToUtcDate(dailyMetrics.date),
          impressions: dailyMetrics.impressions,
          spend: dailyMetrics.costMicros / 1_000_000,
        },
        update: {
          clicks: dailyMetrics.clicks,
          conversionsValue: dailyMetrics.conversionsValue,
          impressions: dailyMetrics.impressions,
          spend: dailyMetrics.costMicros / 1_000_000,
          syncedAt: new Date(),
        },
      });
      savedMetrics.push(metric);
    }

    const spend = savedMetrics.reduce((sum, metric) => sum + metric.spend, 0);
    const lastSyncedAt = savedMetrics.reduce<Date | null>((latest, metric) => (
      !latest || metric.syncedAt > latest ? metric.syncedAt : latest
    ), null);

    return NextResponse.json({
      data: {
        clicks: savedMetrics.reduce((sum, metric) => sum + metric.clicks, 0),
        conversionsValue: savedMetrics.reduce((sum, metric) => sum + metric.conversionsValue, 0),
        dateFrom: dates[0],
        dateTo: dates[dates.length - 1],
        range,
        rangeLabel: GOOGLE_ADS_RANGE_LABELS[range],
        impressions: savedMetrics.reduce((sum, metric) => sum + metric.impressions, 0),
        spend,
        syncedAt: lastSyncedAt,
      },
      success: true,
    });
  } catch (error) {
    logCaughtRequestError(request, '/api/owner/google-ads/sync', error);
    const storageMigrationRequired = (error as any)?.code === 'P2021';
    const message = storageMigrationRequired
      ? 'Google Ads storage is not ready. Apply prisma/google-ads-daily-metric-migration.sql, then try again.'
      : googleAdsErrorMessage(error);
    const status = error instanceof GoogleAdsReauthRequiredError
      ? 401
      : error instanceof Error && error.name === 'GoogleAdsConfigurationError'
        ? 503
        : storageMigrationRequired ? 503 : 500;
    return NextResponse.json({
      success: false,
      error: storageMigrationRequired ? message : getApiErrorMessage(error, message),
      code: error instanceof GoogleAdsReauthRequiredError ? 'GOOGLE_ADS_REAUTH_REQUIRED' : undefined,
    }, { status });
  }
}

export const POST = withRequestLogging('/api/owner/google-ads/sync', handlePOST);
