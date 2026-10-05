import { findJobsWithDetails } from '@/lib/job-helper';
import {
  getRingCentralConnectionStatus,
  getCallDurationSeconds,
  groupRingCentralInboundCalls,
  isCallForTarget,
  isQualifyingRingCentralInboundCall,
  isRingCentralMissedInboundCall,
  isRingCentralShortInboundCall,
  isRingCentralVoicemail,
  ringCentralDateKey,
  ringCentralTorontoRange,
  RingCentralAuthRequiredError,
  setRingCentralTokenCookie,
} from '@/lib/ringcentral';
import type { RingCentralAnalyticsRange } from '@/lib/ringcentral';
import { parseTorontoDateOnly } from '@/lib/timezone';
import { prisma } from '@/lib/prisma';
import { isInboundCallForTrackedTarget, type MatchCall } from '@/lib/job-call-matching';
import { buildRingCentralDemandHeatmap, buildRingCentralJobCreationHeatmap, coverageIntervalsFromSyncMetadata, ringCentralCompleteDemandWindow } from '@/lib/ringcentral-demand';
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
  demandHeatmap?: ReturnType<typeof buildRingCentralDemandHeatmap>;
  jobCreationHeatmap?: ReturnType<typeof buildRingCentralJobCreationHeatmap>;
  demandSummary?: {
    rawInboundSessions: number;
    callerDayLeads: number;
    confirmedOriginatingLinks: number;
    suggestedOriginatingLinks: number;
    jobsCreated: number;
    note: string;
  };
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
    activityKind: 'answered' | 'missed' | 'voicemail' | 'short';
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
    const activityKind: 'answered' | 'missed' | 'voicemail' | 'short' = realCalls.length > 0
      ? 'answered'
      : voicemailRecords.length > 0
        ? 'voicemail'
        : missedRecords.length > 0
          ? 'missed'
          : ordered.some(isRingCentralShortInboundCall) ? 'short' : 'missed';

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
      // A missed inbound lead that was successfully called back is still a
      // received lead for the daily total and conversion-rate denominator.
      countsAsReceived: realCalls.length > 0 || Boolean(callback),
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
  const demandWindow = ringCentralCompleteDemandWindow();
  const demandFrom = parseTorontoDateOnly(demandWindow.startDate)!;
  const demandTo = parseTorontoDateOnly(demandWindow.endDateExclusive)!;
  const now = new Date();
  const [targetNumbers, cachedRows, callbackRows, demandRows, demandJobs, syncState] = await Promise.all([
    getCachedTargetNumbers(),
    readCachedRingCentralCalls(new Date(range.dateFrom), new Date(range.dateTo)),
    readCachedRingCentralCalls(new Date(range.dateFrom), new Date()),
    readCachedRingCentralCalls(demandFrom, now),
    findJobsWithDetails({
      where: { createdAt: { gte: demandFrom, lt: demandTo } },
      orderBy: { createdAt: 'asc' },
    }),
    readRingCentralSyncState(),
  ]);
  const targetPhoneNumbers = targetNumbers.map((target) => target.phoneNumber);
  const syncMetadata = syncState?.rawPayload && typeof syncState.rawPayload === 'object' && !Array.isArray(syncState.rawPayload)
    ? syncState.rawPayload as { voicemailPermissionDenied?: boolean }
    : {};
  const cachedRecords = cachedRows.map(cachedRowToCallRecord);
  const callbackRecords = callbackRows.map(cachedRowToCallRecord);
  const demandRecords = demandRows.map(cachedRowToCallRecord);
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
  const demandCallDetails = buildCallDetails(demandRecords, demandRecords, targetPhoneNumbers);
  const demandHeatmap = buildRingCentralDemandHeatmap(
    demandCallDetails.map((call) => ({ time: call.time, countsAsReceived: call.countsAsReceived })),
    coverageIntervalsFromSyncMetadata(syncState?.rawPayload),
    syncState?.lastSuccessAt || null,
  );
  const jobCreationHeatmap = buildRingCentralJobCreationHeatmap(
    demandJobs.map((job) => ({ createdAt: job.createdAt, isManual: job.isManual })),
    now,
  );
  const demandLinkRows = await prisma.jobCallMatch.findMany({
    where: {
      role: 'ORIGINATING_INBOUND',
      status: { in: ['CONFIRMED', 'SUGGESTED'] },
      call: { startTime: { gte: demandFrom, lt: demandTo } },
    },
    select: {
      status: true,
      call: {
        select: {
          direction: true, result: true, reason: true, type: true, durationSeconds: true, durationMs: true,
          startTime: true, isVoicemail: true, voicemailMessageId: true, callerPhoneNumber: true,
          destinationPhoneNumber: true,
        },
      },
    },
  });
  const inWindow = (time: string | null | undefined) => {
    const value = time ? new Date(time).getTime() : Number.NaN;
    return Number.isFinite(value) && value >= demandFrom.getTime() && value < demandTo.getTime();
  };
  const inboundSessions = new Set<string>();
  for (const record of demandRecords) {
    if (!inWindow(record.startTime) || record.direction?.toLowerCase() !== 'inbound') continue;
    const matchCall: MatchCall = {
      id: record.id || '', direction: record.direction || null, result: record.result || null, reason: record.reason || null,
      type: record.type || null, durationSeconds: getCallDurationSeconds(record), durationMs: null,
      startTime: record.startTime || null, isVoicemail: Boolean(record.isVoicemail), voicemailMessageId: record.voicemailMessageId || null,
      callerPhoneNumber: record.from?.phoneNumber || null, destinationPhoneNumber: record.to?.phoneNumber || null,
    };
    if (!isInboundCallForTrackedTarget(matchCall, targetPhoneNumbers)) continue;
    inboundSessions.add(record.telephonySessionId || record.sessionId || record.id || `${record.from?.phoneNumber || 'unknown'}:${record.startTime || ''}`);
  }
  const targetNumbersForMatch = targetPhoneNumbers;
  const confirmedOriginatingLinks = demandLinkRows.filter((row) => row.status === 'CONFIRMED' && isInboundCallForTrackedTarget({
    id: '', direction: row.call.direction, result: row.call.result, reason: row.call.reason, type: row.call.type,
    durationSeconds: row.call.durationSeconds, durationMs: row.call.durationMs, startTime: row.call.startTime,
    isVoicemail: row.call.isVoicemail, voicemailMessageId: row.call.voicemailMessageId,
    callerPhoneNumber: row.call.callerPhoneNumber, destinationPhoneNumber: row.call.destinationPhoneNumber,
  }, targetNumbersForMatch)).length;
  const suggestedOriginatingLinks = demandLinkRows.filter((row) => row.status === 'SUGGESTED' && isInboundCallForTrackedTarget({
    id: '', direction: row.call.direction, result: row.call.result, reason: row.call.reason, type: row.call.type,
    durationSeconds: row.call.durationSeconds, durationMs: row.call.durationMs, startTime: row.call.startTime,
    isVoicemail: row.call.isVoicemail, voicemailMessageId: row.call.voicemailMessageId,
    callerPhoneNumber: row.call.callerPhoneNumber, destinationPhoneNumber: row.call.destinationPhoneNumber,
  }, targetNumbersForMatch)).length;
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
      demandHeatmap,
      jobCreationHeatmap,
      demandSummary: {
        rawInboundSessions: inboundSessions.size,
        callerDayLeads: demandHeatmap.totalLeads,
        confirmedOriginatingLinks,
        suggestedOriginatingLinks,
        jobsCreated: jobCreationHeatmap.totalLeads,
        note: 'Separate activity counts for the same four complete Toronto weeks. Suggestions are unreviewed; confirmed links are human-selected. These counts do not attribute jobs to calls.',
      },
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
