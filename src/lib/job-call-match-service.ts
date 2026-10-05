import { prisma } from '@/lib/prisma';
import {
  canonicalizePhone,
  generateJobCallCandidates,
  isJobCallMatchPhoneStale,
  rawCallerPhone,
  type MatchCall,
} from '@/lib/job-call-matching';
import { getCachedTargetNumbers } from '@/lib/ringcentral-call-cache';

function callFields(row: any): MatchCall {
  return {
    id: row.id,
    direction: row.direction,
    result: row.result,
    reason: row.reason,
    type: row.type,
    durationSeconds: row.durationSeconds,
    durationMs: row.durationMs,
    startTime: row.startTime,
    isVoicemail: row.isVoicemail,
    voicemailMessageId: row.voicemailMessageId,
    callerPhoneNumber: row.callerPhoneNumber,
    destinationPhoneNumber: row.destinationPhoneNumber,
  };
}

type SearchWindow = { from: Date; to: Date };
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CALLS_TOTAL_PER_DIRECTION = 2000;
const MAX_HISTORY_JOBS = 100;
const MAX_SUGGESTION_ROWS = 300;

export type HistoricalJobCursor = { createdAt: string; id: string };

function mergeWindows(windows: SearchWindow[]): SearchWindow[] {
  const sorted = windows.sort((a, b) => a.from.getTime() - b.from.getTime());
  const merged: SearchWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.from.getTime() <= last.to.getTime()) {
      if (window.to.getTime() > last.to.getTime()) last.to = window.to;
    } else merged.push({ ...window });
  }
  return merged;
}

async function readCallWindows(windows: SearchWindow[], direction: 'Inbound' | 'Outbound') {
  const rows: any[] = [];
  let truncated = false;
  for (let index = 0; index < windows.length && rows.length < MAX_CALLS_TOTAL_PER_DIRECTION; index += 25) {
    const batch = windows.slice(index, index + 25);
    const remaining = MAX_CALLS_TOTAL_PER_DIRECTION - rows.length;
    const found = await prisma.ringCentralCallLog.findMany({
      where: {
        direction: { equals: direction, mode: 'insensitive' },
        OR: batch.map((window) => ({ startTime: { gte: window.from, lte: window.to } })),
      },
      orderBy: { startTime: 'asc' },
      take: remaining,
      select: {
        id: true, direction: true, result: true, reason: true, type: true, durationSeconds: true, durationMs: true,
        startTime: true, isVoicemail: true, voicemailMessageId: true, callerPhoneNumber: true,
        destinationPhoneNumber: true,
      },
    });
    if (found.length === remaining) truncated = true;
    rows.push(...found);
    if (truncated) break;
  }
  const unique = new Map(rows.map((row) => [row.id, row]));
  return { rows: Array.from(unique.values()), truncated };
}

export async function refreshHistoricalJobCallSuggestions(cursor: HistoricalJobCursor | null = null) {
  const cursorDate = cursor ? new Date(cursor.createdAt) : null;
  const jobWhere = {
    callMatches: { none: { status: 'CONFIRMED' as const, role: 'ORIGINATING_INBOUND' as const } },
    ...(cursorDate && Number.isFinite(cursorDate.getTime()) ? {
      OR: [
        { createdAt: { lt: cursorDate } },
        { createdAt: cursorDate, id: { lt: cursor!.id } },
      ],
    } : {}),
  };
  const [jobPage, targetNumbers] = await Promise.all([prisma.job.findMany({
      where: jobWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_HISTORY_JOBS + 1,
      select: { id: true, customerId: true, createdAt: true, isManual: true, customer: { select: { name: true, phone: true } } },
  }), getCachedTargetNumbers()]);
  const hasMoreJobs = jobPage.length > MAX_HISTORY_JOBS;
  const jobs = jobPage.slice(0, MAX_HISTORY_JOBS);
  const lastJob = jobs[jobs.length - 1];
  const nextCursor: HistoricalJobCursor | null = hasMoreJobs && lastJob
    ? { createdAt: lastJob.createdAt.toISOString(), id: lastJob.id }
    : null;
  const inboundWindows = jobs.map((job) => ({
    from: new Date(job.createdAt.getTime() - DAY_MS),
    to: job.isManual ? new Date(job.createdAt.getTime() + DAY_MS) : job.createdAt,
  }));
  const callbackWindows = jobs.map((job) => ({
    from: new Date(job.createdAt.getTime() - DAY_MS),
    to: new Date(job.createdAt.getTime() + 31 * DAY_MS),
  }));
  const [inboundResult, callbackResult] = await Promise.all([
    readCallWindows(mergeWindows(inboundWindows), 'Inbound'),
    readCallWindows(mergeWindows(callbackWindows), 'Outbound'),
  ]);
  const calls = inboundResult.rows;
  const callbackRows = callbackResult.rows;
  const truncated = inboundResult.truncated || callbackResult.truncated;
  const callsById = new Map([...calls, ...callbackRows].map((row) => [row.id, callFields(row)]));

  const confirmedMatches = calls.length
    ? await prisma.jobCallMatch.findMany({
      where: { ringCentralCallLogId: { in: calls.map((call) => call.id) }, status: 'CONFIRMED', role: 'ORIGINATING_INBOUND' },
      take: MAX_CALLS_TOTAL_PER_DIRECTION,
      select: { ringCentralCallLogId: true },
    })
    : [];
  const confirmedCallIds = new Set(confirmedMatches.map((row) => row.ringCentralCallLogId));
  const candidates = generateJobCallCandidates({
    jobs,
    calls: calls.map(callFields),
    callbackCalls: callbackRows.map(callFields),
    targetPhoneNumbers: targetNumbers.map((target) => target.phoneNumber),
    confirmedCallIds,
  });

  if (truncated || candidates.length > MAX_SUGGESTION_ROWS) {
    return {
      created: 0,
      ringCentralAvailable: calls.length > 0 || callbackRows.length > 0,
      scannedJobs: jobs.length,
      generatedCandidates: candidates.length,
      truncated: true,
      nextCursor: cursor,
      hasMoreJobs: true,
    };
  }

  const createRows = candidates.flatMap((candidate) => {
    const call = callsById.get(candidate.callId);
    if (!call || !rawCallerPhone(call) || !canonicalizePhone(rawCallerPhone(call)).ok) return [];
    return [{
      jobId: candidate.jobId,
      ringCentralCallLogId: candidate.callId,
      status: 'SUGGESTED' as const,
      method: candidate.method,
      role: candidate.role,
      candidatePhoneCanonical: candidate.phoneCanonical,
      rationale: candidate.rationale,
    }];
  });
  const { count: created } = createRows.length
    ? await prisma.jobCallMatch.createMany({ data: createRows, skipDuplicates: true })
    : { count: 0 };

  return {
    created,
    ringCentralAvailable: calls.length > 0 || callbackRows.length > 0,
    scannedJobs: jobs.length,
    generatedCandidates: candidates.length,
    truncated: false,
    nextCursor,
    hasMoreJobs,
  };
}

export function isMatchPhoneStale(customerPhone: string, call: MatchCall, candidatePhoneCanonical?: string | null) {
  return isJobCallMatchPhoneStale(customerPhone, call, candidatePhoneCanonical);
}

export { callFields };
