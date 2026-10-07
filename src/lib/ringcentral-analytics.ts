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
import { buildRingCentralDemandHeatmap, buildRingCentralJobCompletionHeatmap, coverageIntervalsFromSyncMetadata, isRingCentralDateCovered, ringCentralCompleteDemandWindow } from '@/lib/ringcentral-demand';
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
  definitions?: { leadGrain: 'caller-day'; missedOpportunityGrain: 'inbound-sessions'; jobsLoggedLabel: 'Jobs logged'; linkedSessionCohort: 'inbound-sessions'; observationCutoff: string };
  dataWindow?: { rowLimit: number; truncated: boolean };
  linkedConversion?: { eligibleSessions: number; linkedSessions: number; completedLinkedSessions: number; conversionRate: number | null; completedConversionRate: number | null; unlinkedJobs: number };
  linkedJobs?: Array<{ jobId: string; jobNumber: string | null; jobStatus: string; callTime: string | null; callerNumber: string; sessionId: string | null }>;
  durationSummary?: { grain: 'qualifying inbound sessions'; averageSeconds: number | null; knownSessions: number; unknownDurationSessions: number };
  coverage?: { available: boolean; coveredDays: number; totalDays: number; complete: boolean; lastSyncedAt: string | null; lastError: string | null };
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
  jobCompletionHeatmap?: ReturnType<typeof buildRingCentralJobCompletionHeatmap>;
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
    linkedJobs?: Array<{ jobId: string; jobNumber: string | null; jobStatus: string }>;
  }>;
  activityRows?: RingCentralCallAnalytics['callDetails'];
  totalCalls?: number;
  totalConvertedCalls?: number;
  conversionRate?: number;
  lastSyncedAt?: string;
  voicemailPermissionDenied?: boolean;
  syncError?: string;
  error?: string;
};

const percent = (converted: number, received: number) => received > 0 ? Math.round((converted / received) * 1000) / 10 : 0;
const MAX_ANALYTICS_SOURCE_ROWS = 5_000;
const ANALYTICS_QUERY_TAKE = MAX_ANALYTICS_SOURCE_ROWS + 1;

function boundedRows<T>(rows: T[]) {
  return { rows: rows.slice(0, MAX_ANALYTICS_SOURCE_ROWS), truncated: rows.length > MAX_ANALYTICS_SOURCE_ROWS };
}

const rangeLabels: Record<RingCentralAnalyticsRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'last-week': 'Last week',
  custom: 'Custom dates',
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

function groupInboundSessions(records: ReturnType<typeof cachedRowToCallRecord>[], targetPhoneNumbers: string[]) {
  const groups: ReturnType<typeof cachedRowToCallRecord>[][] = [];
  const groupIndexByKey = new Map<string, number>();
  records.filter((record) => record.direction?.toLowerCase() === 'inbound'
    && isCallForTarget(record, targetPhoneNumbers)
    && record.startTime && Number.isFinite(new Date(record.startTime).getTime()))
    .forEach((record, index) => {
      const day = ringCentralDateKey(record.startTime!);
      const id = record.telephonySessionId || record.sessionId || record.id || `anonymous:${index}`;
      const key = `${day}:${id}`;
      let groupIndex = groupIndexByKey.get(key);
      if (groupIndex === undefined) {
        groupIndex = groups.length;
        groups.push([]);
        groupIndexByKey.set(key, groupIndex);
      }
      const group = groups[groupIndex];
      group.push(record);
    });
  return groups.map((group) => group.sort((left, right) => new Date(left.startTime!).getTime() - new Date(right.startTime!).getTime()));
}

function buildCallDetails(records: ReturnType<typeof cachedRowToCallRecord>[], callbackRecords: ReturnType<typeof cachedRowToCallRecord>[], targetPhoneNumbers: string[], grain: 'caller-day' | 'session' = 'caller-day') {
  const groups = grain === 'session' ? groupInboundSessions(records, targetPhoneNumbers) : groupRingCentralInboundCalls(records, targetPhoneNumbers);
  return groups.map((ordered) => {
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
      linkedJobs: [] as Array<{ jobId: string; jobNumber: string | null; jobStatus: string }>,
    };
  }).sort((left, right) => new Date(right.time || 0).getTime() - new Date(left.time || 0).getTime());
}

export async function buildRingCentralCachedAnalytics(selectedRange: RingCentralAnalyticsRange = 'today', customBounds?: { from: string; to: string }, options: { section?: 'overview' | 'activity' | 'demand' | 'linked-jobs'; summaryOnly?: boolean } = {}): Promise<{
  data: RingCentralCallAnalytics;
  refreshedToken?: Parameters<typeof setRingCentralTokenCookie>[1];
}> {
  const section = options.section || 'overview';
  const summaryOnly = Boolean(options.summaryOnly);
  const needsOverview = section === 'overview' && !summaryOnly;
  const needsCalls = section === 'overview' || section === 'activity';
  const needsCallbacks = section === 'overview' || section === 'activity';
  const needsDemand = section === 'demand';
  const needsJobList = (section === 'overview' || section === 'linked-jobs') && !summaryOnly;
  const needsLinks = !summaryOnly && section !== 'demand';
  const status = await getRingCentralConnectionStatus();
  const range = selectedRange === 'custom' && customBounds
    ? (() => {
      const startUtc = new Date(`${customBounds.from}T00:00:00.000Z`);
      const endUtc = new Date(`${customBounds.to}T00:00:00.000Z`);
      const nextDate = new Date(endUtc);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const offsetForDate = (date: Date) => {
        const rawOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'longOffset' })
          .formatToParts(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)))
          .find((part) => part.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00';
        return /^[-+]\d$/.test(rawOffset) ? `${rawOffset[0]}0${rawOffset.slice(1)}:00` : rawOffset;
      };
      return {
        startUtc, endUtc,
        dateFrom: `${customBounds.from}T00:00:00.000${offsetForDate(startUtc)}`,
        dateTo: `${customBounds.to}T23:59:59.999${offsetForDate(endUtc)}`,
        todayKey: customBounds.to,
      };
    })()
    : ringCentralTorontoRange(selectedRange === 'custom' ? 'last-week' : selectedRange);
  const demandWindow = ringCentralCompleteDemandWindow();
  const demandFrom = parseTorontoDateOnly(demandWindow.startDate)!;
  const demandTo = parseTorontoDateOnly(demandWindow.endDateExclusive)!;
  const now = new Date();
  const [targetNumbers, cachedRead, callbackRead, demandRead, demandJobsRead, syncState] = await Promise.all([
    getCachedTargetNumbers(),
    readCachedRingCentralCalls(new Date(range.dateFrom), new Date(range.dateTo), { take: ANALYTICS_QUERY_TAKE }),
    needsCallbacks ? readCachedRingCentralCalls(new Date(range.dateFrom), new Date(), { take: ANALYTICS_QUERY_TAKE }) : Promise.resolve([]),
    needsDemand ? readCachedRingCentralCalls(demandFrom, now, { take: ANALYTICS_QUERY_TAKE }) : Promise.resolve([]),
    needsDemand ? prisma.job.findMany({
      where: { status: 'COMPLETED', completedAt: { gte: demandFrom, lt: demandTo } },
      orderBy: { completedAt: 'asc' },
      take: ANALYTICS_QUERY_TAKE,
      select: { id: true, completedAt: true, isManual: true, jobReceivedTimeSlot: true },
    }) : Promise.resolve([]),
    readRingCentralSyncState(),
  ]);
  const cachedBound = boundedRows(cachedRead);
  const callbackBound = boundedRows(callbackRead);
  const demandBound = boundedRows(demandRead);
  const demandJobsBound = boundedRows(demandJobsRead);
  const cachedRows = cachedBound.rows;
  const callbackRows = callbackBound.rows;
  const demandRows = demandBound.rows;
  const demandJobs = demandJobsBound.rows;
  const targetPhoneNumbers = targetNumbers.map((target) => target.phoneNumber);
  const syncMetadata = syncState?.rawPayload && typeof syncState.rawPayload === 'object' && !Array.isArray(syncState.rawPayload)
    ? syncState.rawPayload as { voicemailPermissionDenied?: boolean }
    : {};
  const selectedDateKeys = Array.from({ length: Math.round((range.endUtc.getTime() - range.startUtc.getTime()) / 86400000) + 1 }, (_, index) => {
    const date = new Date(range.startUtc);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const coveredDateCount = selectedDateKeys.filter((key) => isRingCentralDateCovered(key, coverageIntervalsFromSyncMetadata(syncState?.rawPayload), now)).length;
  const cachedRecords = cachedRows.map(cachedRowToCallRecord);
  const callbackRecords = callbackRows.map(cachedRowToCallRecord);
  const demandRecords = demandRows.map(cachedRowToCallRecord);
  const jobRead = needsJobList ? await prisma.job.findMany({
    where: {
      createdAt: {
        gte: new Date(range.dateFrom),
        lte: new Date(range.dateTo),
      },
    },
    orderBy: { createdAt: 'asc' },
    take: ANALYTICS_QUERY_TAKE,
    select: { id: true, createdAt: true },
  }) : [];
  const jobsBound = boundedRows(jobRead);
  const jobs = jobsBound.rows;

  const callDetails = needsCalls ? buildCallDetails(cachedRecords, callbackRecords, targetPhoneNumbers) : [];
  const activityRows = section === 'activity' ? buildCallDetails(cachedRecords, callbackRecords, targetPhoneNumbers, 'session') : [];
  const demandCallDetails = needsDemand ? buildCallDetails(demandRecords, demandRecords, targetPhoneNumbers) : [];
  const demandHeatmap = needsDemand ? buildRingCentralDemandHeatmap(
    demandCallDetails.map((call) => ({ time: call.time, countsAsReceived: call.countsAsReceived })),
    coverageIntervalsFromSyncMetadata(syncState?.rawPayload),
    syncState?.lastSuccessAt || null,
  ) : undefined;
  let demandMatchReadTruncated = false;
  const jobCompletionHeatmap = needsDemand ? buildRingCentralJobCompletionHeatmap(
    await (async () => {
      const linkedJobs = demandJobs.length ? await prisma.jobCallMatch.findMany({
        where: { jobId: { in: demandJobs.map((job) => job.id) }, status: 'CONFIRMED', role: 'ORIGINATING_INBOUND' },
        select: { jobId: true, call: { select: { startTime: true } } },
        take: ANALYTICS_QUERY_TAKE,
      }) : [];
      demandMatchReadTruncated = linkedJobs.length > MAX_ANALYTICS_SOURCE_ROWS;
      const callTimeByJobId = new Map(linkedJobs.map((match) => [match.jobId, match.call.startTime]));
      return demandJobs.map((job) => ({
        completedAt: job.completedAt,
        isManual: job.isManual,
        jobReceivedTimeSlot: job.jobReceivedTimeSlot,
        linkedCallTime: callTimeByJobId.get(job.id),
      }));
    })(),
    now,
  ) : undefined;
  // The card, graph and popup must all count the same daily lead rows.
  const receivedCalls = callDetails.filter((call) => call.countsAsReceived);
  const missedOpportunityRows = section === 'activity' ? activityRows : buildCallDetails(cachedRecords, callbackRecords, targetPhoneNumbers, 'session');
  const missedOpportunities = missedOpportunityRows
    .filter((call) => call.missedOpportunity).length;

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

  // Confirmed originating matches are the only evidence used for call-linked
  // conversion. Follow-up matches and phone similarity never count here.
  const callLogIds = cachedRows.map((row) => row.id);
  const confirmedMatches = needsLinks && callLogIds.length && prisma.jobCallMatch?.findMany
    ? await prisma.jobCallMatch.findMany({
      where: { status: 'CONFIRMED', role: 'ORIGINATING_INBOUND', ringCentralCallLogId: { in: callLogIds } },
      take: ANALYTICS_QUERY_TAKE,
      select: {
        jobId: true,
        call: { select: { id: true, sessionId: true, telephonySessionId: true } },
        job: { select: { id: true, jobNumber: true, status: true } },
      },
    })
    : [];
  const sessionKey = (record: ReturnType<typeof cachedRowToCallRecord>) =>
    record.telephonySessionId || record.sessionId || record.id || null;
  const eligibleSessions = new Set((needsLinks ? cachedRecords : [])
    .filter((record) => isCallForTarget(record, targetPhoneNumbers)
      && record.direction?.toLowerCase() === 'inbound'
      && Boolean(record.startTime)
      && new Date(record.startTime!).getTime() >= new Date(range.dateFrom).getTime()
      && new Date(record.startTime!).getTime() <= new Date(range.dateTo).getTime())
    .map(sessionKey).filter((key): key is string => Boolean(key)));
  const durationByEligibleSession = new Map<string, number | null>();
  for (const record of needsOverview ? cachedRecords : []) {
    const key = sessionKey(record);
    if (!key || !eligibleSessions.has(key) || !isQualifyingRingCentralInboundCall(record)) continue;
    const duration = getCallDurationSeconds(record);
    if (!durationByEligibleSession.has(key) || (durationByEligibleSession.get(key) === null && duration !== null)) {
      durationByEligibleSession.set(key, duration);
    }
  }
  const knownDurations: number[] = [];
  durationByEligibleSession.forEach((value) => { if (value !== null) knownDurations.push(value); });
  const durationSummary = {
    grain: 'qualifying inbound sessions' as const,
    averageSeconds: knownDurations.length ? Math.round(knownDurations.reduce((sum, value) => sum + value, 0) / knownDurations.length) : null,
    knownSessions: knownDurations.length,
    unknownDurationSessions: durationByEligibleSession.size - knownDurations.length,
  };
  const linkedBySession = new Map<string, { jobIds: Set<string>; completedJobIds: Set<string> }>();
  for (const match of confirmedMatches) {
    const key = match.call.telephonySessionId || match.call.sessionId || match.call.id;
    if (!key || !eligibleSessions.has(key)) continue;
    const entry = linkedBySession.get(key) || { jobIds: new Set<string>(), completedJobIds: new Set<string>() };
    entry.jobIds.add(match.jobId);
    if (match.job.status === 'COMPLETED') entry.completedJobIds.add(match.jobId);
    linkedBySession.set(key, entry);
  }
  const linkedSessions = linkedBySession.size;
  let completedLinkedSessions = 0;
  linkedBySession.forEach((entry) => { if (entry.completedJobIds.size > 0) completedLinkedSessions += 1; });
  const allConfirmedLinkedJobIds = new Set(confirmedMatches.map((match) => match.jobId));
  const linkedConversion = needsLinks ? {
    eligibleSessions: eligibleSessions.size,
    linkedSessions,
    completedLinkedSessions,
    conversionRate: eligibleSessions.size ? percent(linkedSessions, eligibleSessions.size) : null,
    completedConversionRate: eligibleSessions.size ? percent(completedLinkedSessions, eligibleSessions.size) : null,
    unlinkedJobs: jobs.filter((job) => !allConfirmedLinkedJobIds.has(job.id)).length,
  } : undefined;
  const cachedRowsById = new Map(cachedRows.map((row) => [row.id, row]));
  const recordsBySourceId = new Map(cachedRecords.map((record) => [record.id || '', record]));
  const recordForMatch = (match: (typeof confirmedMatches)[number]) => {
    const row = cachedRowsById.get(match.call.id);
    return { row, record: row?.sourceId ? recordsBySourceId.get(row.sourceId) : undefined };
  };
  const linkedJobs = section === 'linked-jobs' ? confirmedMatches.map((match) => {
    const matchedRecord = recordForMatch(match).record;
    return {
      jobId: match.jobId,
      jobNumber: match.job.jobNumber,
      jobStatus: match.job.status,
      callTime: matchedRecord?.startTime || null,
      callerNumber: matchedRecord?.from?.phoneNumber || 'Unknown number',
      sessionId: match.call.telephonySessionId || match.call.sessionId || null,
    };
  }).sort((left, right) => new Date(right.callTime || 0).getTime() - new Date(left.callTime || 0).getTime()) : [];
  const confirmedBySessionKey = new Map<string, Array<{ jobId: string; jobNumber: string | null; jobStatus: string }>>();
  for (const match of confirmedMatches) {
    const { row, record } = recordForMatch(match);
    const key = match.call.telephonySessionId || match.call.sessionId || record?.telephonySessionId || record?.sessionId || row?.sourceId;
    if (!key) continue;
    const current = confirmedBySessionKey.get(key) || [];
    current.push({ jobId: match.jobId, jobNumber: match.job.jobNumber, jobStatus: match.job.status });
    confirmedBySessionKey.set(key, current);
  }
  for (const call of activityRows) call.linkedJobs = confirmedBySessionKey.get(call.telephonySessionId || call.sessionId || call.id || '') || [];

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
      definitions: { leadGrain: 'caller-day', missedOpportunityGrain: 'inbound-sessions', jobsLoggedLabel: 'Jobs logged', linkedSessionCohort: 'inbound-sessions', observationCutoff: now.toISOString() },
      dataWindow: {
        rowLimit: MAX_ANALYTICS_SOURCE_ROWS,
        truncated: cachedBound.truncated || callbackBound.truncated || demandBound.truncated || demandJobsBound.truncated || demandMatchReadTruncated || jobsBound.truncated || confirmedMatches.length > MAX_ANALYTICS_SOURCE_ROWS,
      },
      linkedConversion,
      linkedJobs,
      durationSummary: needsOverview ? durationSummary : undefined,
      coverage: { available: coveredDateCount > 0, coveredDays: coveredDateCount, totalDays: selectedDateKeys.length, complete: coveredDateCount === selectedDateKeys.length, lastSyncedAt: syncState?.lastSuccessAt?.toISOString() || null, lastError: syncState?.lastError || null },
      daily,
      demandHeatmap,
      jobCompletionHeatmap,
      callDetails,
      activityRows,
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
export async function buildRingCentralCallAnalytics(selectedRange: RingCentralAnalyticsRange = 'today', customBounds?: { from: string; to: string }, options?: { section?: 'overview' | 'activity' | 'demand' | 'linked-jobs'; summaryOnly?: boolean }) {
  return buildRingCentralCachedAnalytics(selectedRange, customBounds, options);
}

export { RingCentralAuthRequiredError };
