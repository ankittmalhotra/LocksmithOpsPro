import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { buildPaidInvoiceWhere, getPaidActivityDateKey, getPaidInvoiceProfit, OPERATIONS_FINANCIAL_SELECT, type ReportingJob } from '@/lib/operations-reporting';
import {
  calculateGoogleAdsRoi,
  dateKeyToUtcDate,
  getGoogleAdsAccountMetadata,
  getGoogleAdsDateKeys,
  getMissingGoogleAdsConfigVariables,
  GOOGLE_ADS_RANGE_LABELS,
  GOOGLE_ADS_RANGE_OPTIONS,
  type GoogleAdsRoiRange,
} from '@/lib/google-ads';
import { roundToTwo } from '@/lib/calculations';

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const requestedRange = new URL(request.url).searchParams.get('range');
    const range: GoogleAdsRoiRange = GOOGLE_ADS_RANGE_OPTIONS.includes(requestedRange as GoogleAdsRoiRange)
      ? requestedRange as GoogleAdsRoiRange
      : 'today';
    const missingVariables = getMissingGoogleAdsConfigVariables();
    const configured = missingVariables.length === 0;
    const account = getGoogleAdsAccountMetadata();
    const metadataVerified = account.verified;
    const currencyCode = account.currencyCode;
    const timeZone = account.timeZone;
    const dateKeys = metadataVerified ? getGoogleAdsDateKeys(range, new Date(), timeZone!) : [];
    const dateFrom = dateKeys[0] ?? null;
    const dateTo = dateKeys.at(-1) ?? null;
    let storageReady = true;
    let metrics: Array<{ spend: number; conversionsValue: number; clicks: number; impressions: number; syncedAt: Date }> = [];

    if (configured && metadataVerified && dateFrom && dateTo) {
      try {
        metrics = await prisma.googleAdsDailyMetric.findMany({
          where: {
            customerId: process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/[-\s]/g, ''),
            date: { gte: dateKeyToUtcDate(dateFrom), lte: dateKeyToUtcDate(dateTo) },
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2021') storageReady = false;
        else throw error;
      }
    }

    const rawJobs = configured && metadataVerified && dateFrom && dateTo
      ? await prisma.job.findMany({
          where: buildPaidInvoiceWhere({ start: dateFrom, end: dateTo }),
          select: OPERATIONS_FINANCIAL_SELECT,
        })
      : [];
    const jobs = rawJobs.map(normalizeManualJobInvoice) as ReportingJob[];
    const profitByDate = new Map<string, number>();
    for (const job of jobs) {
      const dateKey = getPaidActivityDateKey(job);
      if (!dateKey || !dateKeys.includes(dateKey)) continue;
      profitByDate.set(dateKey, (profitByDate.get(dateKey) || 0) + getPaidInvoiceProfit(job));
    }

    const profit = metadataVerified
      ? roundToTwo(dateKeys.reduce((sum, dateKey) => sum + (profitByDate.get(dateKey) || 0), 0))
      : null;
    const spend = metrics.length > 0 ? roundToTwo(metrics.reduce((sum, metric) => sum + metric.spend, 0)) : null;
    const currenciesMatch = metadataVerified ? currencyCode === 'CAD' : false;
    const spendCoverageComplete = metadataVerified && configured && storageReady && metrics.length === dateKeys.length;
    const ratiosAvailable = spendCoverageComplete && currenciesMatch && spend !== null && spend > 0 && profit !== null;
    const ratioUnavailableReason = !configured ? 'not_configured'
      : !metadataVerified ? 'account_metadata_unverified'
        : !spendCoverageComplete ? 'partial_spend_coverage'
        : !currenciesMatch ? 'currency_mismatch'
          : spend === null || spend === 0 ? 'zero_spend' : null;
    const roi = ratiosAvailable
      ? calculateGoogleAdsRoi(profit!, spend)
      : { netReturn: null, roiPercent: null, roas: null };
    const syncedAt = metrics.reduce<Date | null>((latest, metric) => (
      !latest || metric.syncedAt > latest ? metric.syncedAt : latest
    ), null);

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      range,
      rangeLabel: GOOGLE_ADS_RANGE_LABELS[range],
      dateFrom,
      dateTo,
      timeZone,
      currencyCode,
      operatingCurrencyCode: 'CAD',
      currenciesMatch,
      metadataVerified,
      spendCoverageComplete,
      ratiosAvailable,
      ratioUnavailableReason,
      configured,
      missingVariables,
      storageReady,
      syncedAt,
      spend,
      operatingProfitBeforeAds: profit,
      netReturn: roi.netReturn,
      roiPercent: roi.roiPercent,
      conversionsValue: metrics.length > 0 ? roundToTwo(metrics.reduce((sum, metric) => sum + metric.conversionsValue, 0)) : null,
      clicks: metrics.length > 0 ? metrics.reduce((sum, metric) => sum + metric.clicks, 0) : null,
      impressions: metrics.length > 0 ? metrics.reduce((sum, metric) => sum + metric.impressions, 0) : null,
      syncedDays: metrics.length,
      expectedDays: dateKeys.length,
      status: !configured ? 'not_configured'
        : !metadataVerified ? 'metadata_unverified'
        : metrics.length === dateKeys.length ? 'synced'
          : metrics.length > 0 ? 'partially_synced'
            : storageReady ? 'not_synced' : 'migration_required',
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error: any) {
    logCaughtRequestError(request, '/api/dashboard/google-ads-summary', error);
    return NextResponse.json(
      { success: false, error: getApiErrorMessage(error, 'Unable to load Ads summary') },
      { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    );
  }
}

export const GET = withRequestLogging('/api/dashboard/google-ads-summary', handleGET);
