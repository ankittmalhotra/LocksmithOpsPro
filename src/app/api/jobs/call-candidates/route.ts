import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findRecentQualifyingCalls } from '@/lib/job-call-matching';
import { callFields } from '@/lib/job-call-match-service';
import { coverageIntervalsFromSyncMetadata } from '@/lib/ringcentral-demand';
import { getCachedTargetNumbers, readRingCentralSyncState } from '@/lib/ringcentral-call-cache';
import { withRequestLogging } from '@/lib/request-logger';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_SEARCH_ROWS = 2000;

async function handleGET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER') {
    return NextResponse.json({ success: false, error: 'Dispatcher access required' }, { status: 403 });
  }

  const phone = request.nextUrl.searchParams.get('phone') || '';
  const now = new Date();
  const since = new Date(now.getTime() - THREE_DAYS_MS);
  try {
    const [inboundRows, outboundRows, targetNumbers, syncState] = await Promise.all([
      prisma.ringCentralCallLog.findMany({
        where: { direction: { equals: 'Inbound', mode: 'insensitive' }, startTime: { gte: since, lte: now } },
        orderBy: { startTime: 'desc' },
        take: MAX_SEARCH_ROWS,
        select: {
          id: true, direction: true, result: true, reason: true, type: true, durationSeconds: true, durationMs: true,
          startTime: true, isVoicemail: true, voicemailMessageId: true, callerPhoneNumber: true, destinationPhoneNumber: true,
        },
      }),
      prisma.ringCentralCallLog.findMany({
        where: { direction: { equals: 'Outbound', mode: 'insensitive' }, startTime: { gte: since, lte: now } },
        orderBy: { startTime: 'asc' },
        take: MAX_SEARCH_ROWS,
        select: {
          id: true, direction: true, result: true, reason: true, type: true, durationSeconds: true, durationMs: true,
          startTime: true, isVoicemail: true, voicemailMessageId: true, callerPhoneNumber: true, destinationPhoneNumber: true,
        },
      }),
      getCachedTargetNumbers(),
      readRingCentralSyncState(),
    ]);
    const truncated = inboundRows.length === MAX_SEARCH_ROWS || outboundRows.length === MAX_SEARCH_ROWS;
    const filtered = findRecentQualifyingCalls({
      phone,
      calls: inboundRows.map(callFields),
      callbackCalls: outboundRows.map(callFields),
      targetPhoneNumbers: targetNumbers.map((target) => target.phoneNumber),
      now,
      windowMs: THREE_DAYS_MS,
    });
    const coverageIntervals = coverageIntervalsFromSyncMetadata(syncState?.rawPayload);
    const intervalCovered = coverageIntervals.some((interval) => Date.parse(interval.from) <= since.getTime() && Date.parse(interval.to) >= now.getTime());
    const lastSuccessfulSyncAt = syncState?.lastSuccessAt?.toISOString() || null;
    const syncFresh = Boolean(syncState?.lastSuccessAt && now.getTime() - syncState.lastSuccessAt.getTime() <= 30 * 60 * 1000);
    const searchCovered = intervalCovered && !truncated && syncFresh;
    const syncNote = `Last successful sync: ${lastSuccessfulSyncAt ? new Date(lastSuccessfulSyncAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) + ' Toronto time' : 'unknown'}. Full 72-hour coverage: ${searchCovered && !truncated ? 'verified' : 'not verified'}.`;
    return NextResponse.json({
      success: true,
      validPhone: filtered.validPhone,
      available: inboundRows.length + outboundRows.length > 0,
      searchComplete: !truncated,
      coverage: { since: since.toISOString(), through: now.toISOString(), covered: searchCovered && !truncated, lastSuccessfulSyncAt, syncFresh },
      candidates: truncated ? [] : filtered.candidates,
      message: truncated
        ? 'Call search reached its safety limit. You can continue without a call link.'
        : !searchCovered
          ? `The cached search is not verified as current for the full last 3 days. ${syncNote} You can continue without a call link; check RingCentral sync status.`
        : !filtered.validPhone
          ? 'Enter a valid full phone number to search recent calls.'
          : filtered.candidates.length
            ? ''
            : `No matching call in the last 3 days — continue without a call link. ${syncNote}`,
      syncNote,
    });
  } catch (error) {
    console.error('Failed to find recent call candidates:', error);
    return NextResponse.json({
      success: true,
      validPhone: false,
      available: false,
      searchComplete: false,
      coverage: { since: since.toISOString(), through: now.toISOString(), covered: false, lastSuccessfulSyncAt: null, syncFresh: false },
      candidates: [],
      message: 'Call data is unavailable. You can continue creating the job without a call link.',
    });
  }
}

export const GET = withRequestLogging('/api/jobs/call-candidates', handleGET);
