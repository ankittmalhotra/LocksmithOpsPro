import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { RingCentralCallRecord } from '../src/lib/ringcentral.ts';

// Run the actual grouping and cache-backed analytics without credentials,
// a production DB, or a Next request context. Also render every popup view.
const fixture = {
  records: [] as RingCentralCallRecord[],
  jobs: [] as Array<{ createdAt: Date }>,
  targets: ['+14162400593', '+14372954001'],
  uiStates: [] as unknown[],
  uiStateIndex: 0,
};
Object.assign(globalThis, { __ringCentralAnalyticsFixture: fixture });
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/ringcentral') {
      return { url: new URL('../src/lib/ringcentral.ts', import.meta.url).href, shortCircuit: true };
    }
    if (['@/lib/prisma', 'next/headers', '@/lib/job-helper', '@/lib/ringcentral-call-cache'].includes(specifier)
      || (specifier === 'react' && context.parentURL?.endsWith('/RingCentralCallAnalytics.tsx'))) {
      return { url: `analytics-test:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const mocks: Record<string, string> = {
      'analytics-test:@/lib/prisma': 'export const prisma = { ringCentralConnection: { async findUnique() { return null; } } };',
      'analytics-test:next/headers': 'export async function cookies() { return { get() { return undefined; } }; }',
      'analytics-test:@/lib/job-helper': `
        export async function findJobsWithDetails({where}) {
          return globalThis.__ringCentralAnalyticsFixture.jobs.filter(job => job.createdAt >= where.createdAt.gte && job.createdAt <= where.createdAt.lte);
        }
      `,
      'analytics-test:@/lib/ringcentral-call-cache': `
        const fixture = globalThis.__ringCentralAnalyticsFixture;
        export function cachedRowToCallRecord(row) { return row; }
        export async function getCachedTargetNumbers() { return fixture.targets.map(phoneNumber => ({phoneNumber})); }
        export async function readCachedRingCentralCalls(from, to) {
          return fixture.records.filter(record => new Date(record.startTime) >= from && new Date(record.startTime) <= to);
        }
        export async function readRingCentralSyncState() { return {lastSuccessAt: new Date(), rawPayload: {}}; }
      `,
      'analytics-test:react': `
        export function useState() {
          const fixture = globalThis.__ringCentralAnalyticsFixture;
          return [fixture.uiStates[fixture.uiStateIndex++], () => {}];
        }
        export function useEffect() {}
        export function useMemo(factory) { return factory(); }
      `,
    };
    if (mocks[url]) return { format: 'module', shortCircuit: true, source: mocks[url] };
    if (url.endsWith('/RingCentralCallAnalytics.tsx')) {
      return {
        format: 'module', shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});

const originalFetch = globalThis.fetch;
const originalDate = globalThis.Date;
const fixedNow = originalDate.parse('2026-10-02T16:00:00Z');
globalThis.Date = new Proxy(originalDate, {
  construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [fixedNow], newTarget); },
  apply() { return new originalDate(fixedNow).toString(); },
  get(target, property, receiver) {
    return property === 'now' ? () => fixedNow : Reflect.get(target, property, receiver);
  },
});
globalThis.fetch = async () => { throw new Error('Cache-only analytics must not call external APIs'); };

try {
  const { ringCentralTorontoRange, uniqueInboundCalls } = await import('../src/lib/ringcentral.ts');
  const { buildRingCentralCachedAnalytics } = await import('../src/lib/ringcentral-analytics.ts');
  const { default: Widget } = await import('../src/components/RingCentralCallAnalytics.tsx');
  const today = ringCentralTorontoRange('today');
  const yesterday = ringCentralTorontoRange('yesterday');
  const time = (seconds: number, previousDay = false) => new Date(new Date(previousDay ? yesterday.dateFrom : today.dateFrom).getTime() + seconds * 1000).toISOString();
  const call = (id: string, caller: string | undefined, overrides: Partial<RingCentralCallRecord> = {}): RingCentralCallRecord => ({
    id, telephonySessionId: id, startTime: time(3600), direction: 'Inbound',
    result: 'Accepted', duration: 90, from: { phoneNumber: caller },
    to: { phoneNumber: fixture.targets[0] }, ...overrides,
  });
  const checkCounts = async (range: 'today' | 'yesterday' | 'last-week') => {
    const data = (await buildRingCentralCachedAnalytics(range)).data;
    const received = data.callDetails!.filter(row => row.countsAsReceived);
    assert.equal(data.summary!.received, received.length, 'Card must equal qualifying popup rows');
    assert.equal(data.totalCalls, received.length);
    assert.equal(data.daily!.reduce((sum, day) => sum + day.received, 0), received.length);
    for (const day of data.daily!) {
      assert.equal(day.received, received.filter(row => row.date === day.date).length);
    }
    const bounds = ringCentralTorontoRange(range);
    const records = fixture.records.filter(row => new Date(row.startTime!) >= new Date(bounds.dateFrom) && new Date(row.startTime!) <= new Date(bounds.dateTo));
    assert.equal(
      uniqueInboundCalls(records, fixture.targets).length,
      received.filter(row => !row.callbackTime).length,
      'Directly answered calls must use the same qualification and grouping',
    );
    return data;
  };

  // Exact reported scenario: one known caller and two anonymous calls.
  fixture.records = [
    call('known', '+14165550001'),
    call('anonymous-1', undefined, { duration: 95, from: { name: 'Anonymous' } }),
    call('anonymous-2', undefined, { duration: 86, from: { name: 'Anonymous' } }),
  ];
  let data = await checkCounts('today');
  assert.equal(data.summary!.received, 3);
  assert.equal(data.callDetails!.length, 3);
  assert.equal(data.callDetails!.filter(row => row.callerNumber === 'Unknown number').length, 2);

  // Yesterday's separate missed lead must remain visible, but not counted.
  fixture.records = Array.from({ length: 9 }, (_, index) => call(`yesterday-${index}`, `416555${String(index).padStart(4, '0')}`, { startTime: time(3600 + index, true) }));
  fixture.records.push(call('missed-yesterday', '+14165550999', { startTime: time(3700, true), result: 'Missed', duration: 70 }));
  data = await checkCounts('yesterday');
  assert.equal(data.summary!.received, 9);
  assert.equal(data.callDetails!.length, 10);
  assert.equal(data.callDetails!.filter(row => !row.countsAsReceived).length, 1);
  assert.equal(data.summary!.missedOpportunities, 1);

  // Formatting, repeated calls to multiple tracked numbers, anonymous session
  // legs, duration boundary, missed ringing time, voicemail and exclusions.
  fixture.records = [
    call('first', '+1 (416) 555-1000'),
    call('repeat', '416-555-1000', { startTime: time(7200), to: { phoneNumber: fixture.targets[1] } }),
    call('same-caller-yesterday', '4165551000', { startTime: time(3600, true) }),
    call('unknown-session', undefined),
    call('unknown-leg', undefined, { telephonySessionId: 'unknown-session' }),
    call('unknown-distinct', undefined),
    call('short-number-a', '123'),
    call('short-number-b', '123'),
    call('short', '4165551001', { duration: 29 }),
    call('accepted-short-17s', '4165551012', { result: 'Accepted', duration: 17 }),
    call('boundary', '4165551002', { duration: 30 }),
    call('milliseconds-short', '4165551003', { duration: undefined, durationMs: 29999 }),
    call('milliseconds-boundary', '4165551004', { duration: undefined, durationMs: 30000 }),
    call('legacy-duration', '4165551005', { duration: undefined }),
    call('missed-long', '4165551006', { result: 'Missed', duration: 90 }),
    call('voicemail-long', '4165551007', { result: 'Voicemail', duration: 60 }),
    call('unknown-voicemail', undefined, { isVoicemail: true, voicemailMessageId: 'vm-unknown', voicemailTranscript: 'Need help with my lock.' }),
    call('outbound', '4165551008', { direction: 'Outbound' }),
    call('other-number', '4165551009', { to: { phoneNumber: '+14165559999' } }),
    call('invalid-time', '4165551010', { startTime: 'invalid' }),
    call('missing-time', '4165551011', { startTime: undefined }),
  ];
  data = await checkCounts('today');
  assert.equal(data.summary!.received, 8);
  assert.equal(data.callDetails!.filter(row => !row.countsAsReceived).length, 6);
  assert.equal(data.callDetails!.find(row => row.id === 'accepted-short-17s')!.activityKind, 'short');
  assert.equal(data.callDetails!.find(row => row.id === 'accepted-short-17s')!.missedOpportunity, false);
  fixture.uiStateIndex = 0;
  fixture.uiStates = [data, 'today', false, true, 'missed', null];
  assert.match(renderToStaticMarkup(Widget({})), /Brief call \(not a valid lead\)/);
  assert.equal(data.callDetails!.find(row => row.id === 'unknown-voicemail')!.voicemailTranscript, 'Need help with my lock.');
  assert.equal(data.callDetails!.find(row => row.id === 'unknown-voicemail')!.missedOpportunity, true);
  assert.equal(data.callDetails!.find(row => row.id === 'missed-long')!.countsAsReceived, false);
  assert.equal(data.callDetails!.filter(row => row.callerNumber.replace(/\D/g, '').endsWith('4165551000')).length, 1);
  assert.equal((await checkCounts('yesterday')).summary!.received, 1);
  assert.equal((await checkCounts('last-week')).summary!.received, 9);

  // Resolve a hidden caller on one session leg before deduplicating repeat
  // calls from the same identified caller. Never match anonymous callbacks.
  fixture.records = [
    call('hidden-leg', undefined, { telephonySessionId: 'identified-session' }),
    call('identified-leg', '4165552000', { telephonySessionId: 'identified-session' }),
    call('identified-repeat', '+14165552000'),
    call('missed', '4165552001', { result: 'Missed', duration: 80 }),
    call('callback', fixture.targets[0], { direction: 'Outbound', startTime: time(3700), to: { phoneNumber: '+14165552001' } }),
    call('unknown-missed', undefined, { result: 'Missed' }),
    call('unknown-outbound', fixture.targets[0], { direction: 'Outbound', startTime: time(3800), to: {} }),
    call('voicemail', '4165552002', { isVoicemail: true, voicemailMessageId: 'vm-known', voicemailTranscript: 'Lost my keys.' }),
    call('answered-later', '4165552002', { startTime: time(3900) }),
  ];
  fixture.jobs = [{ createdAt: new Date(time(4000)) }, { createdAt: new Date(time(4000, true)) }];
  data = await checkCounts('today');
  assert.equal(data.summary!.received, 3);
  assert.equal(data.summary!.converted, 1, 'All jobs count without phone matching');
  assert.equal(data.summary!.conversionRate, 33.3);
  assert.equal(data.callDetails!.find(row => row.id === 'missed')!.callbackTime, time(3700));
  assert.equal(data.callDetails!.find(row => row.id === 'missed')!.missedOpportunity, false);
  assert.equal(data.callDetails!.find(row => row.id === 'unknown-missed')!.callbackTime, null);
  assert.equal(data.callDetails!.find(row => row.id === 'unknown-missed')!.missedOpportunity, true);
  assert.equal(data.callDetails!.find(row => row.id === 'answered-later')!.voicemailTranscript, 'Lost my keys.');

  // Render popup categories with their real data; default received view must
  // exclude the extra missed/voicemail rows, which remain available separately.
  for (const view of ['received', 'missed', 'all'] as const) {
    fixture.uiStateIndex = 0;
    fixture.uiStates = [data, 'today', false, true, view, null];
    const html = renderToStaticMarkup(Widget({}));
    assert.match(html, /3 calls received · 1 other call activities · Toronto time/);
    const rowCount = (html.match(/<tr class=/g) || []).length;
    assert.equal(rowCount, view === 'all' ? 4 : view === 'received' ? 3 : 1);
    if (view === 'received') {
      assert.match(html, /Unknown number/);
      assert.match(html, /Called back/);
      assert.doesNotMatch(html, /Not included in received total/);
    } else if (view === 'missed') {
      assert.match(html, /Not included in received total/);
      assert.match(html, /Missed opportunity/);
      assert.doesNotMatch(html, /Called back/);
    }
  }
  console.log('ringcentral-analytics tests passed');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.Date = originalDate;
  hooks.deregister();
}
