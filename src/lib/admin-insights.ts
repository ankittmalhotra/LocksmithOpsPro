import { prisma } from '@/lib/prisma';
import { cachedRowToCallRecord, getCachedTargetNumbers, readCachedRingCentralCalls, readRingCentralSyncState } from '@/lib/ringcentral-call-cache';
import {
  getCallDurationSeconds,
  groupRingCentralInboundCalls,
  isCallForTarget,
  isQualifyingRingCentralInboundCall,
  isRingCentralMissedInboundCall,
  isRingCentralShortInboundCall,
  isRingCentralVoicemail,
} from '@/lib/ringcentral';
import { parseTorontoDateOnly } from '@/lib/timezone';
import {
  buildRingCentralDemandHeatmap,
  coverageIntervalsFromSyncMetadata,
  ringCentralCompleteDemandWindow,
} from '@/lib/ringcentral-demand';

const TORONTO = 'America/Toronto';

export type AdminInsightMetric = { id: string; label: string; value: number | string | null };
export type AdminDeterministicObservation = {
  id: string;
  title: string;
  detail: string;
  metricIds: string[];
  evidence: AdminInsightMetric[];
};

export type AdminInsightsSnapshot = {
  generatedAt: string;
  dataThrough: string | null;
  timezone: typeof TORONTO;
  window: { startDate: string; endDate: string; weeks: Array<{ startDate: string; endDate: string; coveredDays: number; leads: number | null }> };
  coverage: { coveredDays: number; totalDays: 28; complete: boolean };
  metrics: AdminInsightMetric[];
  recurringDemandCells: Array<{ id: string; day: string; hour: string; leadCount: number; coveredWeeks: number; weekCounts: Array<number | null> }>;
  observations: AdminDeterministicObservation[];
  ai: { configured: boolean; model: string | null };
};

function hourLabel(hour: number) {
  const start = new Date(Date.UTC(2020, 0, 1, hour));
  const end = new Date(Date.UTC(2020, 0, 1, hour + 1));
  const format = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hour: 'numeric', hour12: true }).format(date);
  return `${format(start)}–${format(end)}`;
}

function sessionIdentity(record: ReturnType<typeof cachedRowToCallRecord>, index: number) {
  return record.telephonySessionId || record.sessionId || record.id || `anonymous-record-${index}`;
}

function successfulCallback(record: ReturnType<typeof cachedRowToCallRecord>) {
  if (record.direction?.toLowerCase() !== 'outbound') return false;
  const outcome = `${record.result || ''} ${record.reason || ''}`.toLowerCase();
  if (/missed|no[ -]?answer|busy|failed|cancelled|voicemail/.test(outcome)) return false;
  const duration = getCallDurationSeconds(record);
  return outcome.includes('accept') || outcome.includes('connect') || outcome.includes('answer') || (duration !== null && duration > 0);
}

function normalizedPhone(value?: string | null) {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const torontoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TORONTO, year: 'numeric', month: '2-digit', day: '2-digit',
});

function coveredDateKeys(startDate: string, endDateExclusive: string, intervals: Array<{ from: string; to: string }>) {
  const covered = new Set<string>();
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDateExclusive}T00:00:00.000Z`);
  while (cursor < end) {
    const key = cursor.toISOString().slice(0, 10);
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 1);
    const localStart = parseTorontoDateOnly(key)?.getTime();
    const localEnd = parseTorontoDateOnly(next.toISOString().slice(0, 10))?.getTime();
    if (localStart !== undefined && localEnd !== undefined && intervals.some((interval) =>
      Date.parse(interval.from) <= localStart && Date.parse(interval.to) >= localEnd)) covered.add(key);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return covered;
}

function isOnCoveredDate(record: ReturnType<typeof cachedRowToCallRecord>, covered: Set<string>) {
  const timestamp = Date.parse(record.startTime || '');
  return Number.isFinite(timestamp) && covered.has(torontoDateFormatter.format(new Date(timestamp)));
}

function countActivity(records: ReturnType<typeof cachedRowToCallRecord>[], callbacks: ReturnType<typeof cachedRowToCallRecord>[], targets: string[]) {
  const bySession = new Map<string, ReturnType<typeof cachedRowToCallRecord>[]>();
  records.forEach((record, index) => {
    if (record.direction?.toLowerCase() !== 'inbound' || !isCallForTarget(record, targets)) return;
    const key = sessionIdentity(record, index);
    bySession.set(key, [...(bySession.get(key) || []), record]);
  });

  const sessions = Array.from(bySession.values());
  const counts = { inboundSessions: sessions.length, answeredQualifiedSessions: 0, shortSessions: 0, voicemailSessions: 0, missedSessions: 0, callbackRecoveredCallerDays: 0 };
  for (const session of sessions) {
    if (session.some(isQualifyingRingCentralInboundCall)) counts.answeredQualifiedSessions += 1;
    else if (session.some(isRingCentralVoicemail)) counts.voicemailSessions += 1;
    else if (session.some(isRingCentralMissedInboundCall)) counts.missedSessions += 1;
    else if (session.some(isRingCentralShortInboundCall)) counts.shortSessions += 1;
  }

  // Match the call analytics' same-caller/Toronto-day grouping and recovered
  // missed-call rule. Only the aggregate count leaves this function.
  const leadGroups = groupRingCentralInboundCalls(records, targets);
  for (const group of leadGroups) {
    if (group.some(isQualifyingRingCentralInboundCall)) continue;
    const missed = group.filter((record) => isRingCentralMissedInboundCall(record) || isRingCentralVoicemail(record));
    const primary = missed[0] || group[0];
    const caller = normalizedPhone(primary?.from?.phoneNumber);
    const missedAt = missed.reduce((latest, record) => Math.max(latest, Date.parse(record.startTime || '') || 0), 0);
    if (!caller || !missedAt) continue;
    const recovered = callbacks.some((callback) => successfulCallback(callback)
      && isCallForTarget(callback, targets)
      && normalizedPhone(callback.to?.phoneNumber) === caller
      && (Date.parse(callback.startTime || '') || 0) > missedAt);
    if (recovered) counts.callbackRecoveredCallerDays += 1;
  }
  return { ...counts, missedSessions: Math.max(0, counts.missedSessions) };
}

async function optionalMatchCount(query: Promise<number>) {
  try {
    return await query;
  } catch (error) {
    const candidate = error as { code?: string; message?: string };
    if (candidate?.code === 'P2021' || /JobCallMatch/i.test(candidate?.message || '')) return null;
    throw error;
  }
}

function buildObservations(snapshot: Omit<AdminInsightsSnapshot, 'observations'>): AdminDeterministicObservation[] {
  const metrics = new Map(snapshot.metrics.map((metric) => [metric.id, metric]));
  const evidence = (...ids: string[]) => ids.flatMap((id) => metrics.has(id) ? [metrics.get(id)!] : []);
  const observations: AdminDeterministicObservation[] = [{
    id: 'coverage',
    title: snapshot.coverage.complete ? 'Four-week call coverage is complete' : 'Call history has coverage gaps',
    detail: `${snapshot.coverage.coveredDays} of 28 days have verified RingCentral sync coverage. An uncovered day is unknown, not zero demand.`,
    metricIds: ['coverage.days'],
    evidence: evidence('coverage.days'),
  }];

  const topCell = snapshot.recurringDemandCells[0];
  if (topCell && snapshot.coverage.coveredDays >= 24) {
    const metricId = `demand.${topCell.id}`;
    observations.push({
      id: 'recurring-demand',
      title: `Repeated demand observed: ${topCell.day} ${topCell.hour}`,
      detail: `This day-and-hour cell contains ${topCell.leadCount} caller-day leads across ${topCell.coveredWeeks} covered weeks; individual weekly counts are shown with the cell. This is a short operational pattern, not evidence of seasonality or ad performance.`,
      metricIds: [metricId, 'coverage.days'],
      evidence: [...evidence('coverage.days'), { id: metricId, label: `${topCell.day} ${topCell.hour} caller-day leads`, value: topCell.leadCount }],
    });
  } else {
    observations.push({
      id: 'insufficient-recurring-demand',
      title: 'No recurring time window meets the sample threshold',
      detail: snapshot.coverage.coveredDays < 24
        ? 'At least 24 of 28 days need verified coverage before this dashboard labels a repeating demand window.'
        : 'No weekday-and-hour cell reached the displayed lead-count and repeat-week thresholds.',
      metricIds: ['coverage.days'], evidence: evidence('coverage.days'),
    });
  }

  observations.push({
    id: 'job-call-links',
    title: 'Reviewed call links are tracked separately',
    detail: metrics.get('links.confirmed')?.value === null
      ? 'Call-link review data is not available yet. Apply the JobCallMatch database migration to show its counts.'
      : 'Confirmed and suggested links are displayed as workflow counts. They are not used as call attribution or campaign-performance evidence.',
    metricIds: ['links.confirmed', 'links.suggested'],
    evidence: evidence('links.confirmed', 'links.suggested'),
  });
  return observations;
}

export function isAdminInsightsGeminiConfigured() {
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_CLOUD_API_KEY);
  const hasVertex = Boolean(process.env.VERTEX_AI_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
  return hasApiKey || hasVertex;
}

export function getAdminInsightsModel() {
  return process.env.GEMINI_ADMIN_INSIGHTS_MODEL || process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash';
}

export async function buildAdminInsightsSnapshot(now = new Date()): Promise<AdminInsightsSnapshot> {
  const window = ringCentralCompleteDemandWindow(now);
  const from = parseTorontoDateOnly(window.startDate);
  const to = parseTorontoDateOnly(window.endDateExclusive);
  if (!from || !to) throw new Error('Unable to create Toronto demand date range.');

  const [rows, targets, sync, confirmedLinks, suggestedLinks] = await Promise.all([
    readCachedRingCentralCalls(from, now),
    getCachedTargetNumbers(),
    readRingCentralSyncState(),
    optionalMatchCount(prisma.jobCallMatch.count({ where: { role: 'ORIGINATING_INBOUND', status: 'CONFIRMED', call: { startTime: { gte: from, lt: to } } } })),
    optionalMatchCount(prisma.jobCallMatch.count({ where: { role: 'ORIGINATING_INBOUND', status: 'SUGGESTED', call: { startTime: { gte: from, lt: to } } } })),
  ]);
  const allRecords = rows.map(cachedRowToCallRecord);
  const coverageIntervals = coverageIntervalsFromSyncMetadata(sync?.rawPayload);
  const coveredDates = coveredDateKeys(window.startDate, window.endDateExclusive, coverageIntervals);
  // Count inbound activity only on fully verified Toronto dates. A cached
  // outbound callback on a later date is still valid positive evidence that a
  // missed call was recovered, even if that later date lacks full coverage.
  const inboundRecords = allRecords.filter((record) => record.direction?.toLowerCase() === 'inbound' && isOnCoveredDate(record, coveredDates));
  const callbackEvidenceRecords = allRecords.filter((record) => record.direction?.toLowerCase() === 'outbound');
  const targetNumbers = targets.map((target) => target.phoneNumber);
  const activity = countActivity(inboundRecords, callbackEvidenceRecords, targetNumbers);
  const leadGroups = groupRingCentralInboundCalls(inboundRecords, targetNumbers).map((group) => {
    const realCall = group.find(isQualifyingRingCentralInboundCall);
    const missed = group.filter((record) => isRingCentralMissedInboundCall(record) || isRingCentralVoicemail(record));
    const primary = realCall || missed[0] || group[0];
    const caller = normalizedPhone(primary?.from?.phoneNumber);
    const missedAt = missed.reduce((latest, record) => Math.max(latest, Date.parse(record.startTime || '') || 0), 0);
    const callback = !realCall && caller && missedAt && callbackEvidenceRecords.some((record) => successfulCallback(record)
      && isCallForTarget(record, targetNumbers)
      && normalizedPhone(record.to?.phoneNumber) === caller
      && (Date.parse(record.startTime || '') || 0) > missedAt);
    return { time: primary?.startTime || '', countsAsReceived: Boolean(realCall || callback) };
  });
  const heatmap = buildRingCentralDemandHeatmap(
    leadGroups,
    coverageIntervals,
    sync?.lastSuccessAt || null,
    now,
  );

  const recurringDemandCells = heatmap.cells
    .filter((cell) => cell.recurring)
    .sort((left, right) => right.observedLeads - left.observedLeads)
    .slice(0, 12)
    .map((cell) => ({
      id: `${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][cell.weekday]}-${String(cell.hour).padStart(2, '0')}`,
      day: heatmap.weekdays[cell.weekday],
      hour: hourLabel(cell.hour),
      leadCount: cell.observedLeads,
      coveredWeeks: cell.coveredWeeks,
      weekCounts: cell.weekCounts,
    }));

  const metrics: AdminInsightMetric[] = [
    { id: 'coverage.days', label: 'Verified coverage days', value: heatmap.coverage.coveredDays },
    { id: 'leads.caller-days', label: 'Qualified caller-day leads', value: heatmap.totalLeads },
    { id: 'calls.inbound-sessions', label: 'Inbound call sessions on covered days', value: activity.inboundSessions },
    { id: 'calls.answered-qualified', label: 'Answered qualifying sessions on covered days', value: activity.answeredQualifiedSessions },
    { id: 'calls.short', label: 'Brief call sessions on covered days', value: activity.shortSessions },
    { id: 'calls.voicemail', label: 'Voicemail sessions on covered days', value: activity.voicemailSessions },
    { id: 'calls.missed', label: 'Missed call sessions on covered days', value: activity.missedSessions },
    { id: 'calls.callback-recovered', label: 'Callback-recovered caller-days on covered days', value: activity.callbackRecoveredCallerDays },
    { id: 'links.confirmed', label: 'Confirmed originating call links', value: confirmedLinks },
    { id: 'links.suggested', label: 'Suggested originating call links', value: suggestedLinks },
    ...heatmap.weeks.map((week, index) => ({ id: `leads.week-${index + 1}`, label: `Caller-day leads, week ${index + 1}`, value: week.leads })),
  ];
  const base = {
    generatedAt: now.toISOString(),
    dataThrough: sync?.lastSuccessAt?.toISOString() || null,
    timezone: TORONTO,
    window: { startDate: heatmap.startDate, endDate: heatmap.endDate, weeks: heatmap.weeks },
    coverage: { ...heatmap.coverage, totalDays: 28 as const },
    metrics,
    recurringDemandCells,
    ai: { configured: isAdminInsightsGeminiConfigured(), model: isAdminInsightsGeminiConfigured() ? getAdminInsightsModel() : null },
  } satisfies Omit<AdminInsightsSnapshot, 'observations'>;
  return { ...base, observations: buildObservations(base) };
}

export function getAdminInsightsAiPayload(snapshot: AdminInsightsSnapshot) {
  // Deliberately allow-list only numeric aggregates and time-bucket counts.
  // No call records, job rows, identifiers, phone data, or text enter the model.
  return {
    timezone: snapshot.timezone,
    window: snapshot.window,
    coverage: snapshot.coverage,
    metrics: snapshot.metrics,
    recurringDemandCells: snapshot.recurringDemandCells,
  };
}
