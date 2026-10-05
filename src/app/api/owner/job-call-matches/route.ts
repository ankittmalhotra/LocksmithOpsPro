import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  canReviewJobCallMatch,
  canonicalizePhone,
  isMissedInboundMatchCall,
  isInboundCallForTrackedTarget,
  qualifiesAsOriginatingCall,
  rawCallerPhone,
  type MatchCall,
} from '@/lib/job-call-matching';
import { callFields, isMatchPhoneStale, refreshHistoricalJobCallSuggestions } from '@/lib/job-call-match-service';
import { withRequestLogging } from '@/lib/request-logger';
import { getCachedTargetNumbers } from '@/lib/ringcentral-call-cache';

export const dynamic = 'force-dynamic';

function adminOnly(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return user?.role === 'ADMIN';
}

async function handleGET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!adminOnly(currentUser)) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });

    const cursor = request.nextUrl.searchParams.get('cursor');
    if (cursor && cursor.length > 100) return NextResponse.json({ success: false, error: 'Invalid review queue cursor.' }, { status: 400 });
    const [matchPage, cachedCallCount] = await Promise.all([
      prisma.jobCallMatch.findMany({
      where: { role: 'ORIGINATING_INBOUND' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        job: { select: { id: true, jobNumber: true, createdAt: true, serviceType: true, customer: { select: { name: true, phone: true } } } },
        call: { select: { id: true, startTime: true, callerPhoneNumber: true, callerName: true, direction: true, result: true, durationSeconds: true, durationMs: true, isVoicemail: true, voicemailMessageId: true, type: true } },
        reviewedBy: { select: { name: true, role: true } },
      },
      }),
      prisma.ringCentralCallLog.count({ where: { startTime: { not: null } } }),
    ]);
    const hasMore = matchPage.length > 100;
    const matches = matchPage.slice(0, 100);
    const data = matches.map((match) => {
      const call = callFields(match.call);
      const callerPhone = rawCallerPhone(call);
      return {
        id: match.id,
        jobId: match.jobId,
        ringCentralCallLogId: match.ringCentralCallLogId,
        status: match.status,
        method: match.method,
        role: match.role,
        rationale: match.rationale,
        candidatePhoneCanonical: match.candidatePhoneCanonical,
        reviewedById: match.reviewedById,
        reviewedByName: match.reviewedByName,
        reviewedByRole: match.reviewedByRole,
        reviewedAt: match.reviewedAt,
        createdAt: match.createdAt,
        reviewedBy: match.reviewedBy,
        callTime: match.call.startTime?.toISOString() || null,
        callerPhoneMasked: callerPhone ? `••• ••• ${callerPhone.replace(/\D/g, '').slice(-4)}` : 'Unknown number',
        stalePhone: isMatchPhoneStale(match.job.customer.phone, call, match.candidatePhoneCanonical),
        call: {
          id: match.call.id,
          direction: match.call.direction,
          durationSeconds: match.call.durationSeconds ?? (match.call.durationMs === null ? null : Math.round(match.call.durationMs / 1000)),
          result: match.call.result,
        },
        job: {
          ...match.job,
          customer: { name: match.job.customer.name },
        },
      };
    });
    return NextResponse.json({
      success: true,
      ringCentralAvailable: cachedCallCount > 0,
      matches: data,
      nextCursor: hasMore ? matches[matches.length - 1]?.id || null : null,
      hasMore,
    });
  } catch (error) {
    console.error('Failed to load historical call match review queue:', error);
    return NextResponse.json({ success: false, error: 'Unable to load the call review queue. Confirm the JobCallMatch migration has been applied.' }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!adminOnly(currentUser)) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    const body = await request.json() as { matchId?: string; jobId?: string; callId?: string; action?: string };
    if (body.action === 'generate') {
      const rawCursor = (body as { cursor?: unknown }).cursor;
      let cursor: { createdAt: string; id: string } | null = null;
      if (rawCursor !== undefined && rawCursor !== null) {
        if (!rawCursor || typeof rawCursor !== 'object' || typeof (rawCursor as any).id !== 'string'
          || typeof (rawCursor as any).createdAt !== 'string' || !Number.isFinite(Date.parse((rawCursor as any).createdAt))) {
          return NextResponse.json({ success: false, error: 'Invalid historical scan cursor.' }, { status: 400 });
        }
        cursor = { id: (rawCursor as any).id, createdAt: (rawCursor as any).createdAt };
      }
      const generation = await refreshHistoricalJobCallSuggestions(cursor);
      return NextResponse.json({ success: true, generation });
    }
    if (!body.matchId || !body.jobId || !body.callId || !['confirm', 'reject'].includes(body.action || '')) {
      return NextResponse.json({ success: false, error: 'A match, job, call, and valid review action are required.' }, { status: 400 });
    }

    const match = await prisma.jobCallMatch.findUnique({
      where: { id: body.matchId },
      include: { job: { include: { customer: true } }, call: true },
    });
    if (!match || !canReviewJobCallMatch(currentUser.role, match, body.jobId, body.callId)) {
      return NextResponse.json({ success: false, error: 'The selected call does not belong to this job suggestion.' }, { status: 404 });
    }
    if (match.status !== 'SUGGESTED' || match.role !== 'ORIGINATING_INBOUND') {
      return NextResponse.json({ success: false, error: 'Only an unreviewed originating-call suggestion can be reviewed.' }, { status: 409 });
    }

    const call = callFields(match.call);
    const targetNumbers = body.action === 'confirm' ? await getCachedTargetNumbers() : [];
    let callbacks: MatchCall[] = [];
    if (body.action === 'confirm') {
      const customerPhone = canonicalizePhone(match.job.customer.phone);
      const callerPhone = canonicalizePhone(rawCallerPhone(call));
      if (!customerPhone.ok || !callerPhone.ok || customerPhone.value !== callerPhone.value) {
        return NextResponse.json({ success: false, error: 'The customer phone has changed or is invalid. This candidate needs a fresh review.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      }
      if (!isInboundCallForTrackedTarget(call, targetNumbers.map((target) => target.phoneNumber))) {
        return NextResponse.json({ success: false, error: 'This inbound call was not received by a configured RingCentral business number.' }, { status: 409 });
      }
      if (isMissedInboundMatchCall(call)) {
        const missedAt = match.call.startTime || new Date(0);
        const callbackRows = await prisma.ringCentralCallLog.findMany({
          where: {
            direction: { equals: 'Outbound', mode: 'insensitive' },
            startTime: { gt: missedAt, lte: new Date(missedAt.getTime() + 31 * 24 * 60 * 60 * 1000) },
          },
          orderBy: { startTime: 'asc' },
          take: 2000,
          select: {
            id: true, direction: true, result: true, reason: true, type: true, durationSeconds: true, durationMs: true,
            startTime: true, isVoicemail: true, voicemailMessageId: true, callerPhoneNumber: true, destinationPhoneNumber: true,
          },
        });
        if (callbackRows.length === 2000) {
          return NextResponse.json({ success: false, error: 'Callback search reached its safety limit. The call was not confirmed.' }, { status: 409 });
        }
        callbacks = callbackRows.map(callFields);
      }
      if (!qualifiesAsOriginatingCall(call, callbacks)) {
        return NextResponse.json({ success: false, error: 'Only a qualifying answered inbound call or successfully recovered missed inbound call can be confirmed.' }, { status: 409 });
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.jobCallMatch.findUnique({
          where: { id: match.id },
          include: { job: { include: { customer: true } }, call: true },
        });
        if (current?.status !== 'SUGGESTED') throw new Error('This suggestion has already been reviewed.');
        if (body.action === 'confirm') {
          if (!current) throw new Error('This suggestion no longer exists.');
          const currentCall = callFields(current.call);
          const currentCustomerPhone = canonicalizePhone(current.job.customer.phone);
          const currentCallerPhone = canonicalizePhone(rawCallerPhone(currentCall));
          if (!currentCustomerPhone.ok || !currentCallerPhone.ok || currentCustomerPhone.value !== currentCallerPhone.value) {
            throw new Error('The customer phone changed while this review was being saved. Refresh the queue before confirming.');
          }
          if (!isInboundCallForTrackedTarget(currentCall, targetNumbers.map((target => target.phoneNumber)))) {
            throw new Error('The call destination is no longer a configured RingCentral business number.');
          }
          if (!qualifiesAsOriginatingCall(currentCall, callbacks)) {
            throw new Error('The selected call no longer meets originating-call qualification rules.');
          }
          const existingOrigin = await tx.jobCallMatch.findFirst({
            where: {
              status: 'CONFIRMED', role: 'ORIGINATING_INBOUND',
              OR: [{ jobId: match.jobId }, { ringCentralCallLogId: match.ringCentralCallLogId }],
              id: { not: match.id },
            },
            select: { id: true },
          });
          if (existingOrigin) throw new Error('This job or call already has a confirmed originating call.');
        }
        const changed = await tx.jobCallMatch.updateMany({
          where: { id: match.id, status: 'SUGGESTED' },
          data: {
            status: body.action === 'confirm' ? 'CONFIRMED' : 'REJECTED',
            reviewedById: currentUser.id,
            reviewedByName: currentUser.name,
            reviewedByRole: currentUser.role,
            reviewedAt: new Date(),
          },
        });
        if (changed.count !== 1) throw new Error('This suggestion was reviewed by another Admin. Refresh the queue.');
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The review could not be saved.';
      return NextResponse.json({ success: false, error: message }, { status: 409 });
    }
    return NextResponse.json({ success: true, status: body.action === 'confirm' ? 'CONFIRMED' : 'REJECTED' });
  } catch (error) {
    console.error('Failed to review historical call match:', error);
    return NextResponse.json({ success: false, error: 'Unable to save this call review.' }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/owner/job-call-matches', handleGET);
export const POST = withRequestLogging('/api/owner/job-call-matches', handlePOST);
