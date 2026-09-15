import { findJobsWithDetails } from '@/lib/job-helper';
import {
  getRingCentralConnectionStatus,
  ringCentralDateKey,
  ringCentralTorontoRange,
  RingCentralAuthRequiredError,
  setRingCentralTokenCookie,
  uniqueInboundCalls,
} from '@/lib/ringcentral';
import type { RingCentralAnalyticsRange } from '@/lib/ringcentral';
import {
  cachedRowToCallRecord,
  getCachedTargetNumbers,
  readCachedRingCentralCalls,
  readRingCentralSyncState,
} from '@/lib/ringcentral-call-cache';

export type RingCentralCallAnalytics = {
  success: boolean;
  configured: boolean;
  connected: boolean;
  connectRequired?: boolean;
  cacheAvailable?: boolean;
  dataSource?: 'cache';
  targetPhoneNumber?: string | null;
  targetPhoneNumbers?: string[];
  timezone?: string;
  range?: RingCentralAnalyticsRange;
  rangeLabel?: string;
  summary?: { received: number; converted: number; conversionRate: number };
  today?: { date: string; received: number; converted: number; conversionRate: number };
  daily?: Array<{
    date: string;
    label: string;
    dateLabel: string;
    received: number;
    converted: number;
    conversionRate: number;
  }>;
  totalCalls?: number;
  totalConvertedCalls?: number;
  conversionRate?: number;
  lastSyncedAt?: string;
  syncError?: string;
  error?: string;
};

const percent = (converted: number, received: number) => received > 0 ? Math.round((converted / received) * 1000) / 10 : 0;

const rangeLabels: Record<RingCentralAnalyticsRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'last-week': 'Last week',
};

export async function buildRingCentralCachedAnalytics(selectedRange: RingCentralAnalyticsRange = 'last-week'): Promise<{
  data: RingCentralCallAnalytics;
  refreshedToken?: Parameters<typeof setRingCentralTokenCookie>[1];
}> {
  const status = await getRingCentralConnectionStatus();
  const range = ringCentralTorontoRange(selectedRange);
  const [targetNumbers, cachedRows, syncState] = await Promise.all([
    getCachedTargetNumbers(),
    readCachedRingCentralCalls(new Date(range.dateFrom), new Date(range.dateTo)),
    readRingCentralSyncState(),
  ]);
  const targetPhoneNumbers = targetNumbers.map((target) => target.phoneNumber);
  const calls = uniqueInboundCalls(cachedRows.map(cachedRowToCallRecord), targetPhoneNumbers);
  const jobs = await findJobsWithDetails({
    where: {
      createdAt: {
        gte: new Date(range.dateFrom),
        lte: new Date(range.dateTo),
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const callRows = calls.map((call) => ({
    call,
    date: call.startTime ? ringCentralDateKey(call.startTime) : '',
  }));

  const dailyByDate = new Map<string, { received: number; converted: number }>();
  const dayCount = Math.round((range.endUtc.getTime() - range.startUtc.getTime()) / 86400000) + 1;
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(range.startUtc);
    date.setUTCDate(date.getUTCDate() + index);
    const dateKey = date.toISOString().slice(0, 10);
    dailyByDate.set(dateKey, { received: 0, converted: 0 });
    return {
      date: dateKey,
      label: date.toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' }),
      dateLabel: date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    };
  });

  for (const row of callRows) {
    const daily = dailyByDate.get(row.date);
    if (!daily) continue;
    daily.received += 1;
  }

  // Every job logged in the selected Toronto period counts as converted.
  // Phone matching is intentionally not required for this business metric.
  for (const job of jobs) {
    const daily = dailyByDate.get(ringCentralDateKey(job.createdAt));
    if (daily) daily.converted += 1;
  }

  const daily = days.map((day) => {
    const counts = dailyByDate.get(day.date)!;
    return { ...day, ...counts, conversionRate: percent(counts.converted, counts.received) };
  });
  const summary = daily.reduce(
    (totals, day) => ({ received: totals.received + day.received, converted: totals.converted + day.converted }),
    { received: 0, converted: 0 },
  );
  const totalConvertedCalls = jobs.length;

  return {
    data: {
      success: true,
      ...status,
      connectRequired: Boolean(status.configured && !status.connected),
      cacheAvailable: Boolean(syncState?.lastSuccessAt),
      dataSource: 'cache',
      targetPhoneNumber: targetPhoneNumbers[0] || status.targetPhoneNumber || null,
      targetPhoneNumbers,
      timezone: 'America/Toronto',
      range: selectedRange,
      rangeLabel: rangeLabels[selectedRange],
      summary: { ...summary, conversionRate: percent(summary.converted, summary.received) },
      daily,
      totalCalls: callRows.length,
      totalConvertedCalls,
      conversionRate: percent(totalConvertedCalls, callRows.length),
      lastSyncedAt: syncState?.lastSuccessAt?.toISOString(),
      syncError: syncState?.lastError || undefined,
    },
  };
}

// Existing callers now receive cache-backed analytics. This function must not
// invoke RingCentral; the explicit refresh route owns all external syncing.
export async function buildRingCentralCallAnalytics(selectedRange: RingCentralAnalyticsRange = 'last-week') {
  return buildRingCentralCachedAnalytics(selectedRange);
}

export { RingCentralAuthRequiredError };
