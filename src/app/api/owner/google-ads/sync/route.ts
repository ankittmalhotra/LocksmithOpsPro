import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import {
  dateKeyToUtcDate,
  fetchGoogleAdsDailyMetrics,
  getYesterdayDateKey,
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

    const date = getYesterdayDateKey();
    const metrics = await fetchGoogleAdsDailyMetrics(date);
    const metric = await prisma.googleAdsDailyMetric.upsert({
      where: {
        customerId_date: {
          customerId: metrics.customerId,
          date: dateKeyToUtcDate(date),
        },
      },
      create: {
        clicks: metrics.clicks,
        conversionsValue: metrics.conversionsValue,
        customerId: metrics.customerId,
        date: dateKeyToUtcDate(date),
        impressions: metrics.impressions,
        spend: metrics.costMicros / 1_000_000,
      },
      update: {
        clicks: metrics.clicks,
        conversionsValue: metrics.conversionsValue,
        impressions: metrics.impressions,
        spend: metrics.costMicros / 1_000_000,
        syncedAt: new Date(),
      },
    });

    return NextResponse.json({
      data: {
        clicks: metric.clicks,
        conversionsValue: metric.conversionsValue,
        date,
        impressions: metric.impressions,
        spend: metric.spend,
        syncedAt: metric.syncedAt,
      },
      success: true,
    });
  } catch (error) {
    logCaughtRequestError(request, '/api/owner/google-ads/sync', error);
    const storageMigrationRequired = (error as any)?.code === 'P2021';
    const message = storageMigrationRequired
      ? 'Google Ads storage is not ready. Apply prisma/google-ads-daily-metric-migration.sql, then try again.'
      : googleAdsErrorMessage(error);
    const status = error instanceof Error && error.name === 'GoogleAdsConfigurationError'
      ? 503
      : storageMigrationRequired ? 503 : 500;
    return NextResponse.json(
      { success: false, error: storageMigrationRequired ? message : getApiErrorMessage(error, message) },
      { status },
    );
  }
}

export const POST = withRequestLogging('/api/owner/google-ads/sync', handlePOST);
