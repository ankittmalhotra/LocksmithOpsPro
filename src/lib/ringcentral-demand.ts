import { parseTorontoDateOnly } from './timezone.ts';

export type RingCentralCoverageInterval = { from: string; to: string };

export type DemandCall = {
  time: string;
  countsAsReceived: boolean;
};

export type DemandJob = { createdAt: Date | string; isManual: boolean };

export type RingCentralDemandCell = {
  weekday: number;
  hour: number;
  observedLeads: number;
  coveredWeeks: number;
  weekCounts: Array<number | null>;
  recurring: boolean;
};

export const RINGCENTRAL_DEMAND_MIN_RECURRING_LEADS = 4;

const TORONTO = 'America/Toronto';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TORONTO,
  year: 'numeric', month: '2-digit', day: '2-digit',
});
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TORONTO, weekday: 'short' });
const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TORONTO, hour: '2-digit', hourCycle: 'h23' });
const weekdayIndexes: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function dateKey(value: Date) {
  return dateFormatter.format(value);
}

function nextDateKey(key: string) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dateKeys(from: string, toExclusive: string) {
  const keys: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${toExclusive}T00:00:00.000Z`);
  while (cursor < end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function localHour(value: Date) {
  return Number(hourFormatter.formatToParts(value).find((part) => part.type === 'hour')?.value ?? -1);
}

function mergeCoverageIntervals(intervals: RingCentralCoverageInterval[]) {
  const sorted = intervals
    .filter((interval) => Number.isFinite(Date.parse(interval.from)) && Number.isFinite(Date.parse(interval.to)) && interval.to > interval.from)
    .map((interval) => ({ from: new Date(interval.from).toISOString(), to: new Date(interval.to).toISOString() }))
    .sort((left, right) => left.from.localeCompare(right.from));
  const merged: RingCentralCoverageInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.from <= last.to) {
      if (interval.to > last.to) last.to = interval.to;
    } else merged.push(interval);
  }
  return merged;
}

export function appendRingCentralCoverageInterval(
  existing: RingCentralCoverageInterval[],
  from: Date | string,
  to: Date | string,
) {
  const next = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  return mergeCoverageIntervals([...existing, next]);
}

function isDateCovered(key: string, intervals: RingCentralCoverageInterval[]) {
  const localMidnight = parseTorontoDateOnly(key);
  const nextMidnight = parseTorontoDateOnly(nextDateKey(key));
  if (!localMidnight || !nextMidnight) return false;
  const dayStart = localMidnight.getTime();
  const dayEnd = nextMidnight.getTime();
  return intervals.some((interval) => Date.parse(interval.from) <= dayStart && Date.parse(interval.to) >= dayEnd);
}

export function buildRingCentralDemandHeatmap(
  calls: DemandCall[],
  coverageIntervals: RingCentralCoverageInterval[],
  lastSyncedAt: Date | string | null,
  now = new Date(),
) {
  const window = ringCentralCompleteDemandWindow(now);
  const { startDate, endDateExclusive, dates } = window;
  const mergedCoverage = mergeCoverageIntervals(coverageIntervals);
  const coveredDateSet = new Set(dates.filter((key) => isDateCovered(key, mergedCoverage)));
  const coveredDays = coveredDateSet.size;
  const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weekSummaries = Array.from({ length: 4 }, (_, index) => {
    const weekDates = dates.slice(index * 7, index * 7 + 7);
    const coveredDays = weekDates.filter((key) => coveredDateSet.has(key)).length;
    const leads = calls.filter((call) => {
      if (!call.countsAsReceived || !Number.isFinite(Date.parse(call.time))) return false;
      return weekDates.includes(dateKey(new Date(call.time)));
    }).length;
    return {
      startDate: weekDates[0],
      endDate: weekDates[6],
      coveredDays,
      complete: coveredDays === 7,
      leads: coveredDays === 7 ? leads : null,
    };
  });
  const cellCounts = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => Array<number | null>(4).fill(null)));

  for (let week = 0; week < 4; week += 1) {
    const weekDates = dates.slice(week * 7, week * 7 + 7);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const dayKey = weekDates[weekday];
      if (!coveredDateSet.has(dayKey)) continue;
      for (let hour = 0; hour < 24; hour += 1) cellCounts[weekday][hour][week] = 0;
    }
  }

  for (const call of calls) {
    if (!call.countsAsReceived || !Number.isFinite(Date.parse(call.time))) continue;
    const time = new Date(call.time);
    const key = dateKey(time);
    if (!coveredDateSet.has(key)) continue;
    const weekday = weekdayIndexes[weekdayFormatter.format(time)];
    const hour = localHour(time);
    const dateIndex = dates.indexOf(key);
    const week = dateIndex < 0 ? -1 : Math.floor(dateIndex / 7);
    if (weekday === undefined || hour < 0 || hour > 23 || week < 0 || week > 3) continue;
    cellCounts[weekday][hour][week] = (cellCounts[weekday][hour][week] ?? 0) + 1;
  }

  const cells: RingCentralDemandCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const weekCounts = cellCounts[weekday][hour];
      const coveredWeeks = weekCounts.filter((count) => count !== null).length;
      const observedLeads = weekCounts.reduce<number>((total, count) => total + (count ?? 0), 0);
      cells.push({
        weekday,
        hour,
        observedLeads,
        coveredWeeks,
        weekCounts,
        recurring: coveredDays >= 24
          && coveredWeeks >= 3
          && weekCounts.filter((count) => count !== null && count > 0).length >= 3
          && observedLeads >= RINGCENTRAL_DEMAND_MIN_RECURRING_LEADS,
      });
    }
  }

  const totalLeads = calls.filter((call) => call.countsAsReceived && Number.isFinite(Date.parse(call.time))
    && coveredDateSet.has(dateKey(new Date(call.time)))
    && dateKey(new Date(call.time)) >= startDate && dateKey(new Date(call.time)) < endDateExclusive).length;

  return {
    startDate,
    endDate: dates[dates.length - 1],
    weeks: weekSummaries,
    weekdays: weekdayNames,
    cells,
    coverage: { coveredDays, totalDays: 28, complete: coveredDays === 28 },
    totalLeads,
    minRecurringLeads: RINGCENTRAL_DEMAND_MIN_RECURRING_LEADS,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
  };
}

export function buildRingCentralJobCreationHeatmap(jobs: DemandJob[], now = new Date()) {
  const window = ringCentralCompleteDemandWindow(now);
  const dates = window.dates;
  const countsByWeekdayHour = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => Array<number>(4).fill(0)));
  const weekCounts = Array<number>(4).fill(0);
  let manualExcluded = 0;
  for (const job of jobs) {
    const createdAt = new Date(job.createdAt);
    if (!Number.isFinite(createdAt.getTime())) continue;
    const key = dateKey(createdAt);
    const dateIndex = dates.indexOf(key);
    if (dateIndex < 0) continue;
    if (job.isManual) {
      manualExcluded += 1;
      continue;
    }
    const weekday = weekdayIndexes[weekdayFormatter.format(createdAt)];
    const hour = localHour(createdAt);
    if (weekday === undefined || hour < 0 || hour > 23) continue;
    const week = Math.floor(dateIndex / 7);
    countsByWeekdayHour[weekday][hour][week] += 1;
    weekCounts[week] += 1;
  }

  const cells = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const counts = countsByWeekdayHour[weekday][hour];
      const observedLeads = counts.reduce((total, value) => total + value, 0);
      cells.push({
        weekday,
        hour,
        observedLeads,
        coveredWeeks: 4,
        weekCounts: counts,
        recurring: observedLeads >= RINGCENTRAL_DEMAND_MIN_RECURRING_LEADS && counts.filter((count) => count > 0).length >= 3,
      });
    }
  }

  return {
    startDate: window.startDate,
    endDate: dates[dates.length - 1],
    weeks: Array.from({ length: 4 }, (_, index) => ({
      startDate: dates[index * 7],
      endDate: dates[index * 7 + 6],
      coveredDays: 7,
      complete: true,
      leads: weekCounts[index],
    })),
    weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    cells,
    coverage: { coveredDays: 28, totalDays: 28, complete: true },
    totalLeads: weekCounts.reduce((total, value) => total + value, 0),
    minRecurringLeads: RINGCENTRAL_DEMAND_MIN_RECURRING_LEADS,
    manualExcluded,
  };
}

export function ringCentralCompleteDemandWindow(now = new Date()) {
  const todayKey = dateKey(now);
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const endDateExclusive = weekStart.toISOString().slice(0, 10);
  const start = new Date(weekStart);
  start.setUTCDate(start.getUTCDate() - 28);
  const startDate = start.toISOString().slice(0, 10);
  const dates = dateKeys(startDate, endDateExclusive);
  return {
    startDate,
    endDateExclusive,
    dates,
  };
}

export function coverageIntervalsFromSyncMetadata(rawPayload: unknown): RingCentralCoverageInterval[] {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return [];
  const intervals = (rawPayload as { coverageIntervals?: unknown }).coverageIntervals;
  if (!Array.isArray(intervals)) return [];
  return intervals.filter((item): item is RingCentralCoverageInterval => Boolean(item && typeof item === 'object'
    && typeof (item as any).from === 'string' && typeof (item as any).to === 'string'));
}
