import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getRingCentralConfig,
  listRingCentralInboundCalls,
  ringCentralTorontoRange,
  ringCentralTorontoWeekToDateRange,
  RingCentralCallRecord,
  RingCentralTokenData,
} from '@/lib/ringcentral';
import { normalizeRingCentralPhone, sourceKeyForRecord } from '@/lib/ringcentral-call-cache-utils';

const SYNC_SOURCE_KEY = 'account-call-log';
const LEASE_MINUTES = 5;
const INITIAL_SYNC_MARKER = 'monday-to-today-v1';

export type CachedTargetNumber = {
  id?: string;
  phoneNumber: string;
  phoneNumberNormalized: string;
  name?: string | null;
};

function jsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function environmentTargetNumbers() {
  const configured = (process.env.RC_TARGET_PHONE_NUMBERS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const fallback = getRingCentralConfig()?.targetPhoneNumber;
  if (fallback && !configured.includes(fallback)) configured.push(fallback);
  return Array.from(new Set(configured.map((phoneNumber) => ({
    phoneNumber,
    phoneNumberNormalized: normalizeRingCentralPhone(phoneNumber),
  })).filter((item) => item.phoneNumberNormalized.length >= 7)));
}

export async function getCachedTargetNumbers(): Promise<CachedTargetNumber[]> {
  const rows = await prisma.ringCentralPhoneNumber.findMany({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length > 0) return rows;
  return environmentTargetNumbers();
}

async function ensureTargetNumbers() {
  const configured = environmentTargetNumbers();
  for (const target of configured) {
    await prisma.ringCentralPhoneNumber.upsert({
      where: { sourceKey: `environment:${target.phoneNumberNormalized}` },
      create: {
        sourceKey: `environment:${target.phoneNumberNormalized}`,
        accountId: 'default',
        phoneNumber: target.phoneNumber,
        phoneNumberNormalized: target.phoneNumberNormalized,
        name: 'Configured RingCentral number',
        active: true,
        rawPayload: jsonValue({ source: 'environment', phoneNumber: target.phoneNumber }),
      },
      update: {
        accountId: 'default',
        phoneNumber: target.phoneNumber,
        phoneNumberNormalized: target.phoneNumberNormalized,
        active: true,
        lastSeenAt: new Date(),
        rawPayload: jsonValue({ source: 'environment', phoneNumber: target.phoneNumber }),
      },
    });
  }
  return getCachedTargetNumbers();
}

function dateOrNull(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function numberOrNull(value?: number | string) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchingTargetId(destination: string | undefined, targets: CachedTargetNumber[]) {
  const normalized = normalizeRingCentralPhone(destination);
  return targets.find((target) => target.phoneNumberNormalized === normalized)?.id || null;
}

function callLogData(record: RingCentralCallRecord, targets: CachedTargetNumber[]) {
  const sourceKey = sourceKeyForRecord(record);
  if (!sourceKey) return null;
  const duration = numberOrNull(record.duration);
  const durationMs = numberOrNull(record.durationMs);
  return {
    sourceKey,
    sourceId: record.id || null,
    accountId: 'default',
    sessionId: record.sessionId || null,
    telephonySessionId: record.telephonySessionId || null,
    direction: record.direction || null,
    type: record.type || null,
    action: typeof record.action === 'string' ? record.action : null,
    result: record.result || null,
    reason: typeof record.reason === 'string' ? record.reason : null,
    transport: typeof record.transport === 'string' ? record.transport : null,
    startTime: dateOrNull(record.startTime),
    lastModifiedTime: dateOrNull(typeof record.lastModifiedTime === 'string' ? record.lastModifiedTime : undefined),
    durationSeconds: duration === null ? (durationMs === null ? null : Math.round(durationMs / 1000)) : Math.round(duration),
    durationMs: durationMs === null ? (duration === null ? null : Math.round(duration * 1000)) : Math.round(durationMs),
    callerPhoneNumber: record.from?.phoneNumber || null,
    callerPhoneNumberNormalized: normalizeRingCentralPhone(record.from?.phoneNumber) || null,
    callerExtensionNumber: record.from?.extensionNumber || null,
    callerName: record.from?.name || null,
    destinationPhoneNumber: record.to?.phoneNumber || null,
    destinationPhoneNumberNormalized: normalizeRingCentralPhone(record.to?.phoneNumber) || null,
    destinationExtensionNumber: record.to?.extensionNumber || null,
    destinationName: record.to?.name || null,
    trackedDestinationId: matchingTargetId(record.to?.phoneNumber, targets),
    rawPayload: jsonValue(record),
    syncedAt: new Date(),
  };
}

async function claimRefresh() {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60 * 1000);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.ringCentralCallSyncState.findUnique({ where: { sourceKey: SYNC_SOURCE_KEY } });
      if (existing?.leaseUntil && existing.leaseUntil > now) return null;
      return tx.ringCentralCallSyncState.upsert({
        where: { sourceKey: SYNC_SOURCE_KEY },
        create: {
          sourceKey: SYNC_SOURCE_KEY,
          status: 'RUNNING',
          lastAttemptAt: now,
          leaseUntil,
        },
        update: {
          status: 'RUNNING',
          lastAttemptAt: now,
          leaseUntil,
          lastError: null,
        },
      });
    });
  } catch (error: any) {
    if (error?.code === 'P2002') return null;
    throw error;
  }
}

export async function readRingCentralSyncState() {
  return prisma.ringCentralCallSyncState.findUnique({ where: { sourceKey: SYNC_SOURCE_KEY } });
}

async function readLatestCachedCallStartTime() {
  const latest = await prisma.ringCentralCallLog.findFirst({
    where: { startTime: { not: null } },
    orderBy: { startTime: 'desc' },
    select: { startTime: true },
  });
  return latest?.startTime || null;
}

function completedInitialSync(state: Awaited<ReturnType<typeof readRingCentralSyncState>>) {
  if (!state?.rawPayload || typeof state.rawPayload !== 'object' || Array.isArray(state.rawPayload)) return false;
  return (state.rawPayload as { initialSyncMarker?: string }).initialSyncMarker === INITIAL_SYNC_MARKER;
}

export async function readCachedRingCentralCalls(dateFrom: Date, dateTo: Date) {
  return prisma.ringCentralCallLog.findMany({
    where: {
      startTime: { gte: dateFrom, lte: dateTo },
    },
    orderBy: { startTime: 'asc' },
  });
}

export function cachedRowToCallRecord(row: Awaited<ReturnType<typeof readCachedRingCentralCalls>>[number]): RingCentralCallRecord {
  const raw = (row.rawPayload && typeof row.rawPayload === 'object' ? row.rawPayload : {}) as RingCentralCallRecord;
  return {
    ...raw,
    id: row.sourceId || raw.id,
    sessionId: row.sessionId || raw.sessionId,
    telephonySessionId: row.telephonySessionId || raw.telephonySessionId,
    direction: row.direction || raw.direction,
    type: row.type || raw.type,
    result: row.result || raw.result,
    startTime: row.startTime?.toISOString() || raw.startTime,
    duration: row.durationSeconds ?? raw.duration,
    durationMs: row.durationMs ?? raw.durationMs,
    from: {
      ...(raw.from || {}),
      phoneNumber: row.callerPhoneNumber || raw.from?.phoneNumber,
      extensionNumber: row.callerExtensionNumber || raw.from?.extensionNumber,
      name: row.callerName || raw.from?.name,
    },
    to: {
      ...(raw.to || {}),
      phoneNumber: row.destinationPhoneNumber || raw.to?.phoneNumber,
      extensionNumber: row.destinationExtensionNumber || raw.to?.extensionNumber,
      name: row.destinationName || raw.to?.name,
    },
  };
}

export async function refreshRingCentralCallCache() {
  const config = getRingCentralConfig();
  if (!config) throw new Error('RingCentral API credentials are not configured.');
  const state = await claimRefresh();
  if (!state) return { busy: true as const };

  try {
    const targets = await ensureTargetNumbers();
    const latestCachedCallStartTime = await readLatestCachedCallStartTime();
    const initialSyncRequired = !state.lastSuccessAt || !completedInitialSync(state);
    const todayRange = ringCentralTorontoRange('today');
    const initialRange = ringCentralTorontoWeekToDateRange();
    const range = initialSyncRequired
      ? initialRange
      : latestCachedCallStartTime
        ? {
            dateFrom: new Date(latestCachedCallStartTime.getTime() - 1000).toISOString(),
            dateTo: todayRange.dateTo,
          }
        : initialRange;
    const syncMode = initialSyncRequired ? 'monday-to-today' : 'after-last-call';
    const result = await listRingCentralInboundCalls(range.dateFrom, range.dateTo);
    const writes = result.records.map((record) => callLogData(record, targets)).filter(Boolean);
    let upserted = 0;
    for (let index = 0; index < writes.length; index += 200) {
      const batch = writes.slice(index, index + 200);
      await prisma.$transaction(batch.map((data) => prisma.ringCentralCallLog.upsert({
        where: { sourceKey: data!.sourceKey },
        create: data!,
        update: data!,
      })));
      upserted += batch.length;
    }

    await prisma.ringCentralCallSyncState.update({
      where: { sourceKey: SYNC_SOURCE_KEY },
      data: {
        status: 'IDLE',
        cursor: null,
        windowStart: new Date(range.dateFrom),
        windowEnd: new Date(range.dateTo),
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        lastError: null,
        recordsFetched: result.records.length,
        leaseUntil: null,
        rawPayload: jsonValue({
          targetNumbers: targets.map((target) => target.phoneNumberNormalized),
          upserted,
          syncMode,
          initialSyncMarker: INITIAL_SYNC_MARKER,
          latestCachedCallStartTime: latestCachedCallStartTime?.toISOString() || null,
        }),
      },
    });

    return { busy: false as const, refreshedToken: result.refreshed ? result.token : undefined, fetched: result.records.length, upserted, syncMode };
  } catch (error: any) {
    await prisma.ringCentralCallSyncState.update({
      where: { sourceKey: SYNC_SOURCE_KEY },
      data: {
        status: 'ERROR',
        lastFailureAt: new Date(),
        lastError: String(error?.message || 'RingCentral refresh failed').slice(0, 1000),
        leaseUntil: null,
      },
    });
    throw error;
  }
}

export { SYNC_SOURCE_KEY };
