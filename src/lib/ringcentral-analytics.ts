import { findJobsWithDetails } from '@/lib/job-helper';
import {
  getRingCentralConnectionStatus,
  getCallDurationSeconds,
  groupRingCentralInboundCalls,
  isCallForTarget,
  isQualifyingRingCentralInboundCall,
  isRingCentralMissedInboundCall,
  isRingCentralVoicemail,
  ringCentralDateKey,
  ringCentralTorontoRange,
  RingCentralAuthRequiredError,
  setRingCentralTokenCookie,
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
  summary?: { received: number; converted: number; conversionRate: number; missedOpportunities: number };
  today?: { date: string; received: number; converted: number; conversionRate: number };
  daily?: Array<{
    date: string;
    label: string;
    dateLabel: string;
    received: number;
    converted: number;
    conversionRate: number;
  }>;
  callDetails?: Array<{
    id: string | null;
    date: string;
    time: string;
    callerNumber: string;
    callerName: string | null;
    destinationNumber: string;
    destinationName: string | null;
    durationSeconds: number | null;
    direction: string | null;
    type: string | null;
    result: string | null;
    action: string | null;
    reason: string | null;
    transport: string | null;
    sessionId: string | null;
    telephonySessionId: string | null;
    activityKind: 'answered' | 'missed' | 'voicemail';
    countsAsReceived: boolean;
    missedOpportunity: boolean;
    callbackTime: string | null;
    voicemailTranscript: string | null;
    voicemailTranscriptionStatus: string | null;
    voicemailReadStatus: string | null;
    voicemailMessageId: string | null;
  }>;
  totalCalls?: number;
  totalConvertedCalls?: number;
  conversionRate?: number;
  lastSyncedAt?: string;
  voicemailPermissionDenied?: boolean;
  syncError?: string;
  error?: string;
};

const percent = (converted: number, received: number) => received > 0 ? Math.round((converted / received) * 1000) / 10 : 0;

const rangeLabels: Record<RingCentralAnalyticsRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'last-week': 'Last week',
};

function normalizePhone(value?: string | null) {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function isSuccessfulCallback(record: ReturnType<typeof cachedRowToCallRecord>) {
  if (record.direction?.toLowerCase() !== 'outbound') return false;
  const result = `${record.result || ''} ${record.reason || ''}`.toLowerCase();
  if (/missed|no[ -]?answer|busy|failed|cancelled|voicemail/.test(result)) return false;
  const duration = getCallDurationSeconds(record);
  return result.includes('accept') || result.includes('connect') || result.includes('answer') || (duration !== null && duration > 0);
}

function buildCallDetails(records: ReturnType<typeof cachedRowToCallRecord>[], callbackRecords: ReturnType<typeof cachedRowToCallRecord>[], targetPhoneNumbers: string[]) {
  return groupRingCentralInboundCalls(records, targetPhoneNumbers).map((ordered) => {
    const realCalls = ordered.filter(isQualifyingRingCentralInboundCall);
    const voicemailRecords = ordered.filter(isRingCentralVoicemail);
    const missedRecords = ordered.filter(isRingCentralMissedInboundCall);
    const primary = realCalls[0] || voicemailRecords[0] || missedRecords[0] || ordered[0];
    const missedActivity = [...missedRecords, ...voicemailRecords].sort((left, right) => new Date(right.startTime || 0).getTime() - new Date(left.startTime || 0).getTime())[0];
    const callerNumber = normalizePhone(primary.from?.phoneNumber);
    const missedAt = missedActivity?.startTime ? new Date(missedActivity.startTime).getTime() : 0;
    const callback = callerNumber.length >= 7 && missedAt
      ? callbackRecords
        .filter((record) => isSuccessfulCallback(record))
        .filter((record) => isCallForTarget(record, targetPhoneNumbers))
        .filter((record) => normalizePhone(record.to?.phoneNumber) === callerNumber)
        .filter((record) => new Date(record.startTime || 0).getTime() > missedAt)
        .sort((left, right) => new Date(left.startTime || 0).getTime() - new Date(right.startTime || 0).getTime())[0]
      : undefined;
    const voicemail = voicemailRecords.find((record) => record.voicemailTranscript || record.voicemailTranscriptionStatus) || voicemailRecords[0];
    const activityKind: 'answered' | 'missed' | 'voicemail' = realCalls.length > 0 ? 'answered' : voicemailRecords.length > 0 ? 'voicemail' : 'missed';

    return {
      id: primary.id || null,
      date: primary.startTime ? ringCentralDateKey(primary.startTime) : '',
      time: primary.startTime || '',
      callerNumber: primary.from?.phoneNumber || 'Unknown number',
      callerName: primary.from?.name || null,
      destinationNumber: primary.to?.phoneNumber || 'Unknown destination',
      destinationName: primary.to?.name || null,
      durationSeconds: getCallDurationSeconds(primary),
      direction: primary.direction || null,
      type: primary.type || null,
      result: primary.result || null,
      action: primary.action || null,
      reason: primary.reason || null,
      transport: primary.transport || null,
      sessionId: primary.sessionId || null,
      telephonySessionId: primary.telephonySessionId || null,
      activityKind,
      countsAsReceived: realCalls.length > 0,
      missedOpportunity: realCalls.length === 0 && Boolean(missedActivity) && !callback,
      callbackTime: callback?.startTime || null,
      voicemailTranscript: voicemail?.voicemailTranscript || null,
      voicemailTranscriptionStatus: voicemail?.voicemailTranscriptionStatus || null,
      voicemailReadStatus: voicemail?.voicemailReadStatus || null,
      voicemailMessageId: voicemail?.voicemailMessageId || null,
    };
  }).sort((left, right) => new Date(right.time || 0).getTime() - new Date(left.time || 0).getTime());
}

export async function buildRingCentralCachedAnalytics(selectedRange: RingCentralAnalyticsRange = 'today'): Promise<{
  data: RingCentralCallAnalytics;
  refreshedToken?: Parameters<typeof setRingCentralTokenCookie>[1];
}> {
  const status = await getRingCentralConnectionStatus();
  const range = ringCentralTorontoRange(selectedRange);
  const [targetNumbers, cachedRows, callbackRows, syncState] = await Promise.all([
    getCachedTargetNumbers(),
    readCachedRingCentralCalls(new Date(range.dateFrom), new Date(range.dateTo)),
    readCachedRingCentralCalls(new Date(range.dateFrom), new Date()),
    readRingCentralSyncState(),
  ]);
  const targetPhoneNumbers = targetNumbers.map((target) => target.phoneNumber);
  const syncMetadata = syncState?.rawPayload && typeof syncState.rawPayload === 'object' && !Array.isArray(syncState.rawPayload)
    ? syncState.rawPayload as { voicemailPermissionDenied?: boolean }
    : {};
  const cachedRecords = cachedRows.map(cachedRowToCallRecord);
  const callbackRecords = callbackRows.map(cachedRowToCallRecord);
  const jobs = await findJobsWithDetails({
    where: {
      createdAt: {
        gte: new Date(range.dateFrom),
        lte: new Date(range.dateTo),
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const callDetails = buildCallDetails(cachedRecords, callbackRecords, targetPhoneNumbers);
  // The card, graph and popup must all count the same daily lead rows.
  const receivedCalls = callDetails.filter((call) => call.countsAsReceived);
  const missedOpportunities = callDetails.filter((call) => call.missedOpportunity).length;

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

  for (const row of receivedCalls) {
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
      summary: { ...summary, conversionRate: percent(summary.converted, summary.received), missedOpportunities },
      daily,
      callDetails,
      totalCalls: receivedCalls.length,
      totalConvertedCalls,
      conversionRate: percent(totalConvertedCalls, receivedCalls.length),
      lastSyncedAt: syncState?.lastSuccessAt?.toISOString(),
      voicemailPermissionDenied: Boolean(syncMetadata.voicemailPermissionDenied),
      syncError: syncState?.lastError || undefined,
    },
  };
}

// Existing callers now receive cache-backed analytics. This function must not
// invoke RingCentral; the explicit refresh route owns all external syncing.
export async function buildRingCentralCallAnalytics(selectedRange: RingCentralAnalyticsRange = 'today') {
  return buildRingCentralCachedAnalytics(selectedRange);
}

export { RingCentralAuthRequiredError };
