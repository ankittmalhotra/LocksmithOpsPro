import assert from 'node:assert/strict';
import { appendRingCentralCoverageInterval, buildRingCentralDemandHeatmap, buildRingCentralJobCreationHeatmap } from '../src/lib/ringcentral-demand.ts';
import { parseTorontoDateOnly, parseTorontoDateTime } from '../src/lib/timezone.ts';

const now = new Date('2026-10-05T16:00:00.000Z'); // Monday in Toronto.
const coverageStart = parseTorontoDateOnly('2026-09-07')!;
const coverageEnd = parseTorontoDateOnly('2026-10-05')!;
const coverage = [{ from: coverageStart.toISOString(), to: coverageEnd.toISOString() }];
const callAt = (date: string, time: string, countsAsReceived = true) => ({
  time: parseTorontoDateTime(`${date}T${time}`)!.toISOString(),
  countsAsReceived,
});

const calls = [
  callAt('2026-09-07', '09:00'),
  callAt('2026-09-14', '09:00'),
  callAt('2026-09-21', '09:00'),
  callAt('2026-09-28', '09:00'),
  callAt('2026-09-13', '09:00'),
  callAt('2026-09-20', '09:00'),
  callAt('2026-09-27', '09:00'),
  callAt('2026-10-04', '09:00'),
  callAt('2026-09-21', '09:00', false), // Unqualified activity is excluded.
];
const result = buildRingCentralDemandHeatmap(calls, coverage, now, now);
const cell = (weekday: number, hour: number) => result.cells.find((item) => item.weekday === weekday && item.hour === hour)!;

assert.equal(result.startDate, '2026-09-07');
assert.equal(result.endDate, '2026-10-04');
assert.equal(result.coverage.coveredDays, 28);
assert.equal(result.coverage.complete, true);
assert.equal(result.weeks.length, 4);
assert.equal(result.totalLeads, 8);
assert.deepEqual(cell(0, 9).weekCounts, [1, 1, 1, 1], 'Monday morning is bucketed independently');
assert.deepEqual(cell(6, 9).weekCounts, [1, 1, 1, 1], 'Sunday morning has its own cell');
const fridaySaturday = buildRingCentralDemandHeatmap([
  callAt('2026-09-11', '09:00'),
  callAt('2026-09-12', '09:00'),
  callAt('2026-09-12', '09:00'),
], coverage, now, now);
assert.deepEqual(fridaySaturday.cells.find((item) => item.weekday === 4 && item.hour === 9)!.weekCounts, [1, 0, 0, 0], 'Friday has its own row');
assert.deepEqual(fridaySaturday.cells.find((item) => item.weekday === 5 && item.hour === 9)!.weekCounts, [2, 0, 0, 0], 'Saturday has its own row');
assert.notEqual(cell(0, 9), cell(6, 9));
assert.equal(cell(0, 9).recurring, true);
const oneWeekSpike = buildRingCentralDemandHeatmap(Array.from({ length: 4 }, () => callAt('2026-09-07', '10:00')), coverage, now, now);
const spikeCell = oneWeekSpike.cells.find((item) => item.weekday === 0 && item.hour === 10)!;
assert.deepEqual(spikeCell.weekCounts, [4, 0, 0, 0]);
assert.equal(spikeCell.recurring, false, 'Four leads in one week alone do not count as recurring demand');
const lowGlobalCoverage = appendRingCentralCoverageInterval([], coverageStart, parseTorontoDateOnly('2026-09-28')!);
const recurringPatternWithOnlyThreeCoveredWeeks = buildRingCentralDemandHeatmap([
  callAt('2026-09-13', '11:00'), callAt('2026-09-13', '11:00'),
  callAt('2026-09-20', '11:00'), callAt('2026-09-27', '11:00'),
], lowGlobalCoverage, now, now);
assert.equal(recurringPatternWithOnlyThreeCoveredWeeks.coverage.coveredDays, 21);
assert.equal(recurringPatternWithOnlyThreeCoveredWeeks.cells.find((item) => item.weekday === 6 && item.hour === 11)!.recurring, false,
  'Recurring stars require at least 24 covered days overall');

const uncovered = buildRingCentralDemandHeatmap(calls, [], null, now);
assert.equal(uncovered.coverage.coveredDays, 0);
assert.equal(uncovered.cells.find((item) => item.weekday === 0 && item.hour === 10)!.weekCounts.every((value) => value === null), true,
  'Uncovered dates are null, never represented as zero leads');
assert.equal(uncovered.weeks.every((week) => week.leads === null), true);

const partialCoverage = appendRingCentralCoverageInterval([], coverageStart, parseTorontoDateOnly('2026-09-10')!);
const partial = buildRingCentralDemandHeatmap(calls, partialCoverage, now, now);
assert.equal(partial.coverage.coveredDays, 3);
assert.equal(partial.weeks[0].leads, null, 'Partial-week totals remain unavailable');
assert.equal(partial.cells.find((item) => item.weekday === 0 && item.hour === 10)!.weekCounts[0], 0,
  'A covered zero-demand hour is distinct from an uncovered hour');
assert.equal(partial.cells.find((item) => item.weekday === 3 && item.hour === 10)!.weekCounts[0], null);

const dstCall = callAt('2026-09-21', '09:00'); // EDT (UTC-4) in Toronto.
const dstResult = buildRingCentralDemandHeatmap([dstCall], coverage, now, now);
assert.deepEqual(dstResult.cells.find((item) => item.weekday === 0 && item.hour === 9)!.weekCounts, [0, 0, 1, 0],
  'Toronto-local hour remains correct after the DST offset change');

const jobs = buildRingCentralJobCreationHeatmap([
  { createdAt: callAt('2026-09-07', '09:00').time, isManual: false },
  { createdAt: callAt('2026-09-13', '09:00').time, isManual: false },
  { createdAt: callAt('2026-09-07', '00:00').time, isManual: true },
], now);
assert.equal(jobs.totalLeads, 2);
assert.equal(jobs.manualExcluded, 1, 'Historical manual timestamps stay out of hourly job activity');
assert.deepEqual(jobs.cells.find((item) => item.weekday === 0 && item.hour === 9)!.weekCounts, [1, 0, 0, 0]);
assert.deepEqual(jobs.cells.find((item) => item.weekday === 6 && item.hour === 9)!.weekCounts, [1, 0, 0, 0]);

const merged = appendRingCentralCoverageInterval([
  { from: '2026-09-07T04:00:00.000Z', to: '2026-09-10T04:00:00.000Z' },
], '2026-09-10T04:00:00.000Z', '2026-09-14T04:00:00.000Z');
assert.deepEqual(merged, [{ from: '2026-09-07T04:00:00.000Z', to: '2026-09-14T04:00:00.000Z' }],
  'Touching successful sync ranges merge into continuous coverage');

console.log('ringcentral-demand tests passed');
