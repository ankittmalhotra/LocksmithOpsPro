import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import {
  dateKeyToUtcDate,
  getGoogleAdsAccountMetadata,
  getGoogleAdsDateKeys,
  getMissingGoogleAdsConfigVariables,
  GOOGLE_ADS_RANGE_LABELS,
  GOOGLE_ADS_RANGE_OPTIONS,
  type GoogleAdsRoiRange,
} from '@/lib/google-ads';
import { roundToTwo } from '@/lib/calculations';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

type Totals = { spend: number; clicks: number; impressions: number; conversionsValue: number };

function totalsFor(rows: Array<{ spend: number; clicks: number; impressions: number; conversionsValue: number }>): Totals {
  return {
    spend: roundToTwo(rows.reduce((sum, row) => sum + row.spend, 0)),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    conversionsValue: roundToTwo(rows.reduce((sum, row) => sum + row.conversionsValue, 0)),
  };
}

function derived(totals: Totals) {
  return {
    ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : null,
    averageCpc: totals.clicks > 0 ? totals.spend / totals.clicks : null,
  };
}

/** Admin-only cached account overview. Never calls Google; sync is a separate POST. */
async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });

    const requested = new URL(request.url).searchParams.get('range');
    const range: GoogleAdsRoiRange = GOOGLE_ADS_RANGE_OPTIONS.includes(requested as GoogleAdsRoiRange) ? requested as GoogleAdsRoiRange : 'last-week';
    const missingVariables = getMissingGoogleAdsConfigVariables();
    const configured = missingVariables.length === 0;
    const account = getGoogleAdsAccountMetadata();
    const base = {
      success: true,
      generatedAt: new Date().toISOString(),
      range,
      rangeLabel: GOOGLE_ADS_RANGE_LABELS[range],
      configured,
      missingVariables,
      metadataVerified: account.verified,
      currencyCode: account.currencyCode,
      timeZone: account.timeZone,
    };
    const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
    if (!configured || !account.verified) {
      return NextResponse.json({ ...base, status: configured ? 'metadata_unverified' : 'not_configured' }, { headers });
    }

    const keys = getGoogleAdsDateKeys(range, new Date(), account.timeZone!);
    const dateFrom = keys[0];
    const dateTo = keys[keys.length - 1];
    // Equal-length period immediately before the selected one. All-time has none.
    let priorKeys: string[] = [];
    if (range !== 'all-time') {
      const end = dateKeyToUtcDate(dateFrom);
      end.setUTCDate(end.getUTCDate() - 1);
      priorKeys = keys.map((_, index) => {
        const day = new Date(end);
        day.setUTCDate(end.getUTCDate() - (keys.length - 1 - index));
        return day.toISOString().slice(0, 10);
      });
    }
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/[-\s]/g, '');
    let storageReady = true;
    let rows: Array<{ date: Date; spend: number; clicks: number; impressions: number; conversionsValue: number; syncedAt: Date }> = [];
    try {
      rows = await prisma.googleAdsDailyMetric.findMany({
        where: { customerId, date: { gte: dateKeyToUtcDate(priorKeys[0] || dateFrom), lte: dateKeyToUtcDate(dateTo) } },
        orderBy: { date: 'asc' },
      });
    } catch (error: any) {
      if (error?.code === 'P2021') storageReady = false;
      else throw error;
    }
    const byDate = new Map(rows.map((row) => [row.date.toISOString().slice(0, 10), row]));
    const current = keys.map((key) => byDate.get(key)).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const prior = priorKeys.map((key) => byDate.get(key)).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const totals = totalsFor(current);
    const priorComplete = priorKeys.length > 0 && prior.length === priorKeys.length;
    const priorTotals = priorComplete ? totalsFor(prior) : null;
    const syncedAt = current.reduce<Date | null>((latest, row) => (!latest || row.syncedAt > latest ? row.syncedAt : latest), null);

    return NextResponse.json({
      ...base,
      status: !storageReady ? 'migration_required' : current.length === 0 ? 'not_synced' : current.length === keys.length ? 'synced' : 'partially_synced',
      storageReady,
      dateFrom,
      dateTo,
      expectedDays: keys.length,
      syncedDays: current.length,
      syncedAt,
      totals: current.length ? { ...totals, ...derived(totals) } : null,
      prior: priorTotals ? { dateFrom: priorKeys[0], dateTo: priorKeys[priorKeys.length - 1], ...priorTotals, ...derived(priorTotals) } : null,
      daily: keys.map((key) => {
        const row = byDate.get(key);
        return { date: key, synced: Boolean(row), spend: row?.spend ?? null, clicks: row?.clicks ?? null, impressions: row?.impressions ?? null };
      }),
    }, { headers });
  } catch (error) {
    logCaughtRequestError(request, '/api/owner/google-ads/analytics', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load Google Ads analytics') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/owner/google-ads/analytics', handleGET);
