import { findJobsWithDetails } from '@/lib/job-helper';
import {
  getRingCentralConfig,
  getRingCentralConnectionStatus,
  listRingCentralInboundCalls,
  ringCentralDateKey,
  ringCentralTorontoRange,
  RingCentralAuthRequiredError,
  setRingCentralTokenCookie,
  uniqueInboundCalls,
} from '@/lib/ringcentral';

export type RingCentralCallAnalytics = {
  success: boolean;
  configured: boolean;
  connected: boolean;
  connectRequired?: boolean;
  targetPhoneNumber?: string | null;
  timezone?: string;
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
  error?: string;
};

const normalizePhone = (value?: string) => {
  const digits = (value || '').replace(/\D/g, '');
  // RingCentral commonly returns +1XXXXXXXXXX while LockOps intake may store
  // the same Canadian number as ten digits (or with an extension).
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const percent = (converted: number, received: number) => received > 0 ? Math.round((converted / received) * 1000) / 10 : 0;

export async function buildRingCentralCallAnalytics(): Promise<{
  data: RingCentralCallAnalytics;
  refreshedToken?: Parameters<typeof setRingCentralTokenCookie>[1];
}> {
  const config = getRingCentralConfig();
  const status = await getRingCentralConnectionStatus();
  if (!config) return { data: { success: true, ...status } };
  if (!status.connected) return { data: { success: true, ...status, connectRequired: true } };

  const range = ringCentralTorontoRange(7);
  const result = await listRingCentralInboundCalls(range.dateFrom, range.dateTo);
  const calls = uniqueInboundCalls(result.records, config.targetPhoneNumber);
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
    phone: normalizePhone(call.from?.phoneNumber),
    converted: false,
  }));

  // Match each job to one earlier inbound call from the same caller on the
  // same Toronto calendar day. Manual jobs use the calendar day because their
  // historical timestamp intentionally has no exact intake time.
  for (const job of jobs) {
    const jobDate = ringCentralDateKey(job.createdAt);
    const customerPhone = normalizePhone(job.customer?.phone);
    if (!customerPhone) continue;

    const candidate = callRows.find((row) => {
      if (row.converted || row.date !== jobDate || row.phone !== customerPhone) return false;
      if (job.isManual) return true;
      return Boolean(row.call.startTime && new Date(row.call.startTime) <= new Date(job.createdAt));
    });
    if (candidate) candidate.converted = true;
  }

  const dailyByDate = new Map<string, { received: number; converted: number }>();
  const days = Array.from({ length: 7 }, (_, index) => {
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
    if (row.converted) daily.converted += 1;
  }

  const daily = days.map((day) => {
    const counts = dailyByDate.get(day.date)!;
    return { ...day, ...counts, conversionRate: percent(counts.converted, counts.received) };
  });
  const today = dailyByDate.get(range.todayKey) || { received: 0, converted: 0 };

  return {
    data: {
      success: true,
      configured: true,
      connected: true,
      targetPhoneNumber: config.targetPhoneNumber || null,
      timezone: 'America/Toronto',
      today: { date: range.todayKey, ...today, conversionRate: percent(today.converted, today.received) },
      daily,
      totalCalls: callRows.length,
      totalConvertedCalls: callRows.filter((row) => row.converted).length,
      conversionRate: percent(callRows.filter((row) => row.converted).length, callRows.length),
      lastSyncedAt: new Date().toISOString(),
    },
    refreshedToken: result.refreshed ? result.token : undefined,
  };
}

export { RingCentralAuthRequiredError };
