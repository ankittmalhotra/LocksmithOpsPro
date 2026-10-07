'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { clampRingCentralAnalyticsPage, normalizeRingCentralAnalyticsPage, ringCentralAnalyticsViewKey, type RingCentralAnalyticsView } from '@/lib/ringcentral-analytics-client';

type CallAnalytics = {
  section?: 'overview' | 'activity' | 'demand' | 'linked-jobs';
  configured: boolean;
  connected: boolean;
  authMethod?: 'jwt' | 'oauth' | null;
  connectRequired?: boolean;
  cacheAvailable?: boolean;
  dataSource?: 'cache';
  targetPhoneNumber?: string | null;
  targetPhoneNumbers?: string[];
  range?: 'today' | 'yesterday' | 'last-week';
  rangeLabel?: string;
  summary?: { received: number; converted: number; conversionRate: number; missedOpportunities: number };
  definitions?: { leadGrain: 'caller-day'; jobsLoggedLabel: 'Jobs logged'; linkedSessionCohort: 'inbound-sessions'; observationCutoff: string };
  linkedConversion?: { eligibleSessions: number; linkedSessions: number; completedLinkedSessions: number; conversionRate: number | null; completedConversionRate: number | null; unlinkedJobs: number };
  linkedJobs?: Array<{ jobId: string; jobNumber: string | null; jobStatus: string; callTime: string | null; callerNumber: string; sessionId: string | null }>;
  durationSummary?: { grain: 'qualifying inbound sessions'; averageSeconds: number | null; knownSessions: number; unknownDurationSessions: number };
  activityPagination?: { page: number; pageSize: number; total: number; totalPages: number };
  dataWindow?: { rowLimit: number; truncated: boolean };
  coverage?: { available: boolean; coveredDays: number; totalDays: number; complete: boolean; lastSyncedAt: string | null; lastError: string | null };
  today?: { date: string; received: number; converted: number; conversionRate: number };
  daily?: Array<{ date: string; label: string; dateLabel: string; received: number; converted: number; conversionRate: number }>;
  demandHeatmap?: {
    startDate: string;
    endDate: string;
    weeks: Array<{ startDate: string; endDate: string; coveredDays: number; complete: boolean; leads: number | null }>;
    weekdays: string[];
    cells: Array<{ weekday: number; hour: number; observedLeads: number; coveredWeeks: number; weekCounts: Array<number | null>; recurring: boolean }>;
    coverage: { coveredDays: number; totalDays: number; complete: boolean };
    totalLeads: number;
    minRecurringLeads: number;
    lastSyncedAt: string | null;
  };
  jobCompletionHeatmap?: {
    startDate: string;
    endDate: string;
    weeks: Array<{ startDate: string; endDate: string; coveredDays: number; complete: boolean; leads: number | null }>;
    weekdays: string[];
    cells: Array<{ weekday: number; hour: number; observedLeads: number; coveredWeeks: number; weekCounts: number[]; recurring: boolean }>;
    coverage: { coveredDays: number; totalDays: number; complete: boolean };
    totalLeads: number;
    minRecurringLeads: number;
    unknownTimeCount: number;
  };
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
  activityRows?: CallAnalytics['callDetails'];
  totalCalls?: number;
  totalConvertedCalls?: number;
  conversionRate?: number;
  lastSyncedAt?: string;
  voicemailPermissionDenied?: boolean;
  syncError?: string;
  error?: string;
};

function formatPhoneNumber(value?: string | null) {
  const digits = (value || '').replace(/\D/g, '');
  const localNumber = digits.length > 10 ? digits.slice(-10) : digits;
  if (localNumber.length === 10) {
    return `(${localNumber.slice(0, 3)}) ${localNumber.slice(3, 6)}-${localNumber.slice(6)}`;
  }
  return value || '(416) 240-0593';
}

function formatCallTime(value: string, includeDate = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    ...(includeDate ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s` : `${remainingSeconds}s`;
}

function displayValue(value: string | null) {
  return value?.trim() || '—';
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function hourLabel(hour: number) {
  return new Date(Date.UTC(2020, 0, 1, hour)).toLocaleTimeString('en-CA', { hour: 'numeric', hour12: true, timeZone: 'UTC' });
}

function demandCellColor(count: number, covered: boolean) {
  if (!covered) return 'bg-slate-100 text-slate-400';
  if (count === 0) return 'bg-white text-slate-500';
  if (count <= 1) return 'bg-blue-100 text-blue-900';
  if (count <= 3) return 'bg-blue-300 text-blue-950';
  return 'bg-blue-600 text-white';
}

const rangeOptions = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last-week', label: 'Last week' },
] as const;

type AnalyticsRange = (typeof rangeOptions)[number]['value'];

export default function RingCentralCallAnalytics({
  canManageConnection = false,
}: {
  canManageConnection?: boolean;
}) {
  const [analytics, setAnalytics] = useState<CallAnalytics | null>(null);
  const [selectedRange, setSelectedRange] = useState<AnalyticsRange | 'custom'>('today');
  const [selectedSection, setSelectedSection] = useState<'overview' | 'activity' | 'demand' | 'linked-jobs'>('overview');
  const [activityPage, setActivityPage] = useState(1);
  const [activitySearch, setActivitySearch] = useState('');
  const [activityOutcome, setActivityOutcome] = useState('all');
  const [receivingNumber, setReceivingNumber] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [activeDemandCell, setActiveDemandCell] = useState<string | null>(null);
  const [demandMetric, setDemandMetric] = useState<'calls' | 'jobs'>('jobs');
  const [demandView, setDemandView] = useState<'day-hour' | 'day' | 'hour'>('day-hour');
  const [activeDemandBucket, setActiveDemandBucket] = useState<string | null>(null);
  const analyticsRequestSequence = useRef(0);
  const analyticsAbortController = useRef<AbortController | null>(null);
  const analyticsViewRef = useRef<RingCentralAnalyticsView>({ range: selectedRange, section: selectedSection, page: activityPage, search: activitySearch, outcome: activityOutcome, receivingNumber, from: customFrom, to: customTo });
  analyticsViewRef.current = { range: selectedRange, section: selectedSection, page: activityPage, search: activitySearch, outcome: activityOutcome, receivingNumber, from: customFrom, to: customTo };

  const fetchAnalytics = async (range: AnalyticsRange | 'custom' = selectedRange, section = selectedSection, page = activityPage) => {
    const requestId = ++analyticsRequestSequence.current;
    analyticsAbortController.current?.abort();
    const controller = new AbortController();
    analyticsAbortController.current = controller;
    try {
      setLoading(true);
      const params = new URLSearchParams({ range, section, page: String(page), pageSize: '25', outcome: activityOutcome, search: activitySearch });
      if (receivingNumber !== 'all') params.set('receivingNumber', receivingNumber);
      if (range === 'custom' && customFrom && customTo) { params.set('from', customFrom); params.set('to', customTo); }
      const response = await fetch(`/api/ringcentral/call-analytics?${params}`, { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (requestId === analyticsRequestSequence.current) {
        if (data.success) {
          setAnalytics(data);
          const serverPage = data.activityPagination?.page;
          if (Number.isInteger(serverPage)) {
            const normalizedPage = clampRingCentralAnalyticsPage(serverPage, data.activityPagination.totalPages);
            if (normalizedPage !== page) {
              setActivityPage(normalizedPage);
              const urlParams = new URLSearchParams(window.location.search);
              urlParams.set('page', String(normalizedPage));
              window.history.replaceState(null, '', `${window.location.pathname}?${urlParams.toString()}`);
            }
          }
        }
        else if (analytics) setRefreshError(data.error || 'Unable to load call analytics.');
        else setAnalytics({ configured: true, connected: false, error: data.error || 'Unable to load call analytics.' });
      }
      return data;
    } catch (error: any) {
      if (requestId === analyticsRequestSequence.current) {
        if (analytics) setRefreshError(error.message || 'Unable to load call analytics.');
        else setAnalytics({ configured: true, connected: false, error: error.message || 'Unable to load call analytics.' });
      }
      return null;
    } finally {
      if (requestId === analyticsRequestSequence.current) setLoading(false);
    }
  };

  const refreshAnalytics = async () => {
    const requestedView = { ...analyticsViewRef.current };
    const requestedViewKey = ringCentralAnalyticsViewKey(requestedView);
    const isRequestedViewCurrent = () => ringCentralAnalyticsViewKey(analyticsViewRef.current) === requestedViewKey;
    try {
      setRefreshing(true);
      setRefreshError(null);
      const refreshParams = new URLSearchParams({ range: requestedView.range });
      if (requestedView.range === 'custom' && requestedView.from && requestedView.to) { refreshParams.set('from', requestedView.from); refreshParams.set('to', requestedView.to); }
      const response = await fetch(`/api/ringcentral/call-analytics/refresh?${refreshParams}`, { method: 'POST', cache: 'no-store' });
      const data = await response.json();
      if (!isRequestedViewCurrent()) return;
      if (response.ok && data.success) {
        await fetchAnalytics(requestedView.range as AnalyticsRange | 'custom', requestedView.section as typeof selectedSection, requestedView.page);
      } else if (data.connectRequired) {
        setAnalytics((current) => ({
          ...(current || {}),
          ...data,
          configured: true,
          connected: false,
          connectRequired: true,
          cacheAvailable: current?.cacheAvailable || false,
        }));
      } else {
        await fetchAnalytics(requestedView.range as AnalyticsRange | 'custom', requestedView.section as typeof selectedSection, requestedView.page);
        setRefreshError(data.error || 'Unable to refresh calls. Please try again shortly.');
      }
    } catch {
      if (isRequestedViewCurrent()) {
        await fetchAnalytics(requestedView.range as AnalyticsRange | 'custom', requestedView.section as typeof selectedSection, requestedView.page);
        setRefreshError('Unable to refresh calls. Please try again shortly.');
      }
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const readUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const section = params.get('section');
      if (section === 'overview' || section === 'activity' || section === 'demand' || section === 'linked-jobs') setSelectedSection(section);
      const range = params.get('range');
      if (range === 'today' || range === 'yesterday' || range === 'last-week' || range === 'custom') setSelectedRange(range);
      setActivitySearch(params.get('search') || '');
      setActivityOutcome(params.get('outcome') || 'all');
      setReceivingNumber(params.get('receivingNumber') || 'all');
      const requestedPage = Number(params.get('page') || 1);
      setActivityPage(normalizeRingCentralAnalyticsPage(requestedPage));
      setCustomFrom(params.get('from') || '');
      setCustomTo(params.get('to') || '');
    };
    readUrl();
    window.addEventListener('popstate', readUrl);
    return () => window.removeEventListener('popstate', readUrl);
  }, []);

  useEffect(() => {
    if (selectedRange === 'custom' && (!customFrom || !customTo)) {
      analyticsRequestSequence.current += 1;
      analyticsAbortController.current?.abort();
      setAnalytics(null);
      setLoading(false);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set('section', selectedSection);
    params.set('range', selectedRange);
    params.set('page', String(activityPage));
    params.set('search', activitySearch);
    params.set('outcome', activityOutcome);
    params.set('receivingNumber', receivingNumber);
    if (selectedRange === 'custom') { params.set('from', customFrom); params.set('to', customTo); }
    else { params.delete('from'); params.delete('to'); }
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    void fetchAnalytics(selectedRange, selectedSection, activityPage);
  }, [selectedSection, selectedRange, activityPage, activitySearch, activityOutcome, receivingNumber, customFrom, customTo]);



  const daily = analytics?.daily || [];
  const activeRange = analytics?.range || selectedRange;
  const activeRangeLabel = analytics?.rangeLabel || (activeRange === 'custom' ? 'Custom dates' : rangeOptions.find((option) => option.value === activeRange)?.label) || 'Today';
  const periodLabel = activeRange === 'last-week' ? 'last 7 days' : activeRange === 'yesterday' ? 'yesterday' : activeRange === 'custom' ? 'the selected dates' : 'today';
  const summary = analytics?.summary || { received: 0, converted: 0, conversionRate: 0, missedOpportunities: 0 };
  const maxDailyCalls = useMemo(() => Math.max(1, ...daily.map((day) => Math.max(day.received, day.converted))), [daily]);
  const activityRows = analytics?.activityRows || [];
  const demand = analytics?.demandHeatmap;
  const plot = demandMetric === 'calls' ? demand : analytics?.jobCompletionHeatmap;
  const selectedDemandCell = plot?.cells.find((cell) => `${cell.weekday}:${cell.hour}` === activeDemandCell) || null;
  const aggregateDemandBucket = (axis: 'day' | 'hour', index: number) => {
    if (!plot) return null;
    const cells = plot.cells.filter((cell) => axis === 'day' ? cell.weekday === index : cell.hour === index);
    const weekCounts = plot.weeks.map((_, weekIndex) => {
      if (!cells.length || cells.some((cell) => cell.weekCounts[weekIndex] === null)) return null;
      return cells.reduce((sum, cell) => sum + (cell.weekCounts[weekIndex] || 0), 0);
    });
    const verified = demandMetric === 'jobs'
      || (cells.length > 0 && cells.every((cell) => cell.coveredWeeks === 4) && weekCounts.every((count) => count !== null));
    const observedLeads = verified ? weekCounts.reduce<number>((sum, count) => sum + (count || 0), 0) : 0;
    const activeWeeks = weekCounts.filter((count): count is number => count !== null && count > 0).length;
    const recurring = verified
      && (demandMetric === 'jobs' || plot.coverage.coveredDays >= 24)
      && observedLeads >= plot.minRecurringLeads
      && activeWeeks >= 3;
    return { observedLeads, verified, recurring, weekCounts };
  };
  const selectedDemandBucket = (() => {
    if (!activeDemandBucket || demandView === 'day-hour') return null;
    const [axis, rawIndex] = activeDemandBucket.split(':');
    const index = Number(rawIndex);
    return (axis === 'day' || axis === 'hour') ? aggregateDemandBucket(axis, index) : null;
  })();

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm" aria-labelledby="call-analytics-title">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="call-analytics-title" className="flex items-center gap-2 text-base font-black">
            <span>📞</span> Call analytics
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Inbound calls received by {(analytics?.targetPhoneNumbers || [analytics?.targetPhoneNumber]).filter(Boolean).map((number) => formatPhoneNumber(number)).join(', ') || '(416) 240-0593'}, grouped by Toronto calendar day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageConnection && analytics?.authMethod !== 'jwt' && (analytics?.connectRequired || analytics?.connected === false) && (
            <button
              type="button"
              onClick={() => { window.location.href = '/api/ringcentral/connect'; }}
              className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100"
            >
              Reconnect RingCentral
            </button>
          )}
          <button
            type="button"
            onClick={() => { setActivityOutcome('all'); setActivityPage(1); setSelectedSection('activity'); }}
            disabled={loading}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            View call activity
          </button>
          <label className="sr-only" htmlFor="call-analytics-range">Call analytics period</label>
          <select
            id="call-analytics-range"
            value={selectedRange}
            onChange={(event) => {
              const nextRange = event.target.value as AnalyticsRange | 'custom';
              setSelectedRange(nextRange);
                      setActivityPage(1);
            }}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:opacity-70"
          >
            {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            <option value="custom">Custom dates</option>
          </select>
          {selectedRange === 'custom' && <><label className="sr-only" htmlFor="calls-from">From date</label><input id="calls-from" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs" /><label className="sr-only" htmlFor="calls-to">To date</label><input id="calls-to" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs" /></>}
          <button onClick={refreshAnalytics} disabled={refreshing} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-70">
            {refreshing ? 'Syncing…' : 'Refresh calls'}
          </button>
        </div>
      </div>

      <nav className="mt-4 flex flex-wrap gap-2 border-b border-slate-100 pb-3" aria-label="Call Analytics sections">
        {([
          ['overview', 'Overview'], ['activity', 'Activity'], ['demand', 'Demand Patterns'], ['linked-jobs', 'Linked Jobs'],
        ] as const).map(([key, label]) => <button key={key} type="button" aria-current={selectedSection === key ? 'page' : undefined} onClick={() => { setSelectedSection(key); setActivityPage(1); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${selectedSection === key ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{label}</button>)}
      </nav>

      {refreshError && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{refreshError}</div>}

      {!analytics ? (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">Loading call analytics…</div>
      ) : !analytics.configured && !analytics.cacheAvailable ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-black">Connect call tracking to see call volume.</p>
          <p className="mt-1 text-xs text-amber-700">Add the call-tracking app credentials to the server environment, then reload this dashboard.</p>
        </div>
      ) : !analytics.connected && !analytics.cacheAvailable ? (
        <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="font-black">Authorization needed</p>
            <p className="mt-1 text-xs text-slate-600">{analytics.authMethod === 'jwt' ? 'Automatic renewal could not restore access. An Admin should review the connection details below.' : canManageConnection ? 'Reconnect to resume call and voicemail syncing.' : 'An Admin must reconnect call tracking before new calls can sync.'}</p>
            {analytics.error && <p className="mt-1 text-xs text-rose-600">{analytics.error}</p>}
          </div>
        </div>
      ) : (
        <>
          {(analytics.connectRequired || !analytics.connected) && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {analytics.error || 'Call tracking authorization is needed to refresh calls.'} Cached analytics remain available.
              {!canManageConnection && ' Ask an Admin to review the connection.'}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <span>{analytics.coverage?.available ? `Cache coverage ${analytics.coverage.coveredDays}/${analytics.coverage.totalDays} selected Toronto dates${analytics.coverage.complete ? ' · complete' : ' · partial'}` : 'No verified sync coverage for the selected dates.'}{analytics.lastSyncedAt ? ` · last synced ${new Date(analytics.lastSyncedAt).toLocaleString()}` : ''}</span>
            {analytics.voicemailPermissionDenied ? (
              <span className="font-bold text-amber-700">Voicemail sync needs the Read Messages permission.</span>
            ) : analytics.syncError ? (
              <span className="font-bold text-rose-600">Last refresh failed: {analytics.syncError}</span>
            ) : null}
          </div>
          {analytics.dataWindow?.truncated && <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">This report reached its {analytics.dataWindow.rowLimit.toLocaleString()}-row safety limit. Counts and investigation results cover the bounded sample only.</p>}
          {selectedSection === 'overview' && <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex min-h-[132px] flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Calls received · {activeRangeLabel}</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-blue-700">{summary.received}</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">30+ sec answered calls and missed calls successfully called back; repeat callers counted once per day</p>
            </div>
            <div className="flex min-h-[132px] flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Jobs logged · {activeRangeLabel}</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-emerald-700">{summary.converted}</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">All jobs entered in this date range, whether call-linked or not</p>
            </div>
            <div className="flex min-h-[132px] flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Jobs logged / qualifying leads</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-amber-700">{summary.conversionRate.toFixed(1)}%</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">Jobs logged ÷ qualifying caller-day leads. Operational comparison, not call conversion.</p>
            </div>
            <div className="flex min-h-[132px] flex-col rounded-xl border border-blue-100 bg-blue-50/60 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Confirmed linked-session conversion</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-blue-800">{analytics.linkedConversion?.conversionRate == null ? 'Unavailable' : `${analytics.linkedConversion.conversionRate.toFixed(1)}%`}</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">{analytics.linkedConversion?.linkedSessions ?? 0} confirmed originating links / {analytics.linkedConversion?.eligibleSessions ?? 0} eligible inbound sessions. <button type="button" onClick={() => setSelectedSection('linked-jobs')} className="font-bold text-blue-700 underline">View cohort</button></p>
            </div>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">Average qualifying inbound session duration: {analytics.durationSummary?.averageSeconds === null || analytics.durationSummary?.averageSeconds === undefined ? 'unavailable' : formatDuration(analytics.durationSummary.averageSeconds)} across {analytics.durationSummary?.knownSessions || 0} sessions with a known duration; {analytics.durationSummary?.unknownDurationSessions || 0} qualifying sessions with unknown duration are excluded.</p>

          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900">Qualifying leads vs jobs logged</h3>
                <p className="text-[11px] text-slate-500">Jobs logged are an operational comparison and may exceed qualifying leads; no call match is implied.</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-slate-600 sm:justify-end">
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />Received</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Jobs logged</span>
                <span className="text-slate-400">{summary.received} total leads</span>
              </div>
            </div>
            {daily.length === 0 ? (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-sm text-slate-500">
                No call data available for this period.
              </div>
            ) : (
              <div className="flex h-48 items-end gap-1 border-b border-slate-200 px-1 pt-2 sm:gap-2">
                {daily.map((day) => {
                  const receivedHeight = day.received ? Math.max(8, (day.received / maxDailyCalls) * 100) : 2;
                  const convertedHeight = day.converted ? Math.max(8, (day.converted / maxDailyCalls) * 100) : 2;
                  return (
                    <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${day.dateLabel}: ${day.received} qualifying leads, ${day.converted} jobs logged`}>
                      <div className="flex h-36 w-full max-w-14 items-end justify-center gap-1">
                        <div className="flex h-full w-1/2 flex-col items-center justify-end">
                          <span className="mb-1 text-[10px] font-black text-blue-700">{day.received}</span>
                          <div className="w-full rounded-t-md bg-blue-500 transition-all hover:bg-blue-600" style={{ height: `${Math.max(6, receivedHeight * 0.82)}%` }} role="img" aria-label={`${day.dateLabel}: ${day.received} calls received`} />
                        </div>
                        <div className="flex h-full w-1/2 flex-col items-center justify-end">
                          <span className="mb-1 text-[10px] font-black text-emerald-700">{day.converted}</span>
                          <div className="w-full rounded-t-md bg-emerald-500 transition-all hover:bg-emerald-600" style={{ height: `${Math.max(6, convertedHeight * 0.82)}%` }} role="img" aria-label={`${day.dateLabel}: ${day.converted} jobs logged`} />
                        </div>
                      </div>
                      <span className="mt-2 text-[10px] font-bold text-slate-600">{day.label}</span>
                      <span className="text-[10px] font-semibold text-slate-400">{day.dateLabel}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {daily.length > 0 && (
              <div className="mt-3 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                <span>{daily[0]?.dateLabel || ''}</span>
                <span>{daily[daily.length - 1]?.dateLabel || ''}</span>
              </div>
            )}
          </div>

          </>}

          {selectedSection === 'demand' && <section className="mt-4 rounded-xl border border-slate-100 bg-white p-4" aria-labelledby="demand-heatmap-title">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="demand-heatmap-title" className="text-sm font-black text-slate-900">What happens on each day and hour?</h3>
                <div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Choose activity for four-week chart">
                  <button type="button" onClick={() => { setDemandMetric('jobs'); setActiveDemandCell(null); setActiveDemandBucket(null); }} aria-pressed={demandMetric === 'jobs'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandMetric === 'jobs' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Jobs completed</button>
                  <button type="button" onClick={() => { setDemandMetric('calls'); setActiveDemandCell(null); setActiveDemandBucket(null); }} aria-pressed={demandMetric === 'calls'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandMetric === 'calls' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Calls received</button>
                </div>
                <div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Choose heatmap view">
                  <button type="button" onClick={() => { setDemandView('day'); setActiveDemandBucket(null); setActiveDemandCell(null); }} aria-pressed={demandView === 'day'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandView === 'day' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Day</button>
                  <button type="button" onClick={() => { setDemandView('day-hour'); setActiveDemandBucket(null); }} aria-pressed={demandView === 'day-hour'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandView === 'day-hour' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Day &amp; Hour</button>
                  <button type="button" onClick={() => { setDemandView('hour'); setActiveDemandBucket(null); setActiveDemandCell(null); }} aria-pressed={demandView === 'hour'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandView === 'hour' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Hour</button>
                </div>
                {demandMetric === 'calls'
                  ? <p className="mt-1 text-[11px] text-slate-600">Includes answered calls of 30+ seconds and missed calls called back successfully. Repeat known callers count once per Toronto day.</p>
                  : <p className="mt-1 text-[11px] text-slate-600">Manual jobs use the exact linked call time when available; otherwise they use the recorded two-hour received-time window. Other jobs use completion time.</p>}
                {plot && <p className="mt-1 text-[11px] font-semibold text-slate-500">{shortDate(plot.startDate)}–{shortDate(plot.endDate)}{demandMetric === 'calls' ? ` · ${plot.coverage.coveredDays}/${plot.coverage.totalDays} days verified · ${demand?.lastSyncedAt ? `last synced ${new Date(demand.lastSyncedAt).toLocaleString()}` : 'no successful sync recorded'}` : ` · ${plot.totalLeads} jobs completed`}</p>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-600" aria-label={`${demandMetric === 'calls' ? 'Call lead' : 'Job creation'} heatmap legend`}>
                <span><i className="mr-1 inline-block h-3 w-3 rounded-sm border border-slate-200 bg-white" />0 {demandMetric === 'calls' ? 'leads' : 'jobs'}</span>
                <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-100" />1 {demandMetric === 'calls' ? 'lead' : 'job'}</span>
                <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-300" />2–3 {demandMetric === 'calls' ? 'leads' : 'jobs'}</span>
                <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-600" />4+ {demandMetric === 'calls' ? 'leads' : 'jobs'}</span>
                {demandMetric === 'calls' && <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-slate-100" />Unverified</span>}
              </div>
            </div>
            {!plot || (demandMetric === 'calls' && plot.coverage.coveredDays === 0) ? (
              <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{demandMetric === 'calls' ? 'No verified RingCentral coverage for these four complete weeks yet. Unverified periods are not counted as zero demand.' : 'Completed-job activity is not available for this period.'}</div>
            ) : (
              <>
                {demandMetric === 'calls' && !plot.coverage.complete && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">Only {plot.coverage.coveredDays} of 28 days have verified sync coverage. Unverified day/hour cells show a dash and are excluded from observed totals.</p>}
                {demandMetric === 'jobs' && (analytics?.jobCompletionHeatmap?.unknownTimeCount || 0) > 0 && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">{analytics?.jobCompletionHeatmap?.unknownTimeCount} completed jobs have no recorded hour and are not assigned to a heatmap cell.</p>}
                {demandView === 'day' && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Observed totals by Toronto weekday">
                  {plot.weekdays.map((weekday, index) => {
                    const bucket = aggregateDemandBucket('day', index)!;
                    const key = `day:${index}`;
                    const weeks = bucket.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)}: ${count === null ? 'unverified' : count}`).join('; ');
                    const label = `${weekday}: ${bucket.verified ? bucket.observedLeads : 'unverified'} ${demandMetric === 'calls' ? 'caller-day leads' : 'jobs completed'}. Weekly totals: ${weeks}`;
                    return <button key={weekday} type="button" onClick={() => setActiveDemandBucket(key)} onFocus={() => setActiveDemandBucket(key)} aria-label={label} title={label} className={`relative rounded-lg p-3 text-left outline-none focus:ring-2 focus:ring-blue-700 ${demandCellColor(bucket.observedLeads, bucket.verified)} ${activeDemandBucket === key ? 'ring-2 ring-blue-700' : ''}`}><span className="block text-[10px] font-bold">{weekday}</span><span className="mt-1 block text-lg font-black">{bucket.verified ? bucket.observedLeads : '—'}</span>{bucket.recurring && <span className="absolute right-2 top-1 text-xs text-amber-700" aria-hidden="true">★</span>}</button>;
                  })}
                </div>}
                {demandView === 'hour' && <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-8" aria-label="Observed totals by Toronto hour">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const bucket = aggregateDemandBucket('hour', hour)!;
                    const key = `hour:${hour}`;
                    const weeks = bucket.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)}: ${count === null ? 'unverified' : count}`).join('; ');
                    const label = `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}: ${bucket.verified ? bucket.observedLeads : 'unverified'} ${demandMetric === 'calls' ? 'caller-day leads' : 'jobs completed'}. Weekly totals: ${weeks}`;
                    return <button key={hour} type="button" onClick={() => setActiveDemandBucket(key)} onFocus={() => setActiveDemandBucket(key)} aria-label={label} title={label} className={`relative rounded-lg p-2 text-left outline-none focus:ring-2 focus:ring-blue-700 ${demandCellColor(bucket.observedLeads, bucket.verified)} ${activeDemandBucket === key ? 'ring-2 ring-blue-700' : ''}`}><span className="block text-[9px] font-bold">{hourLabel(hour)}</span><span className="mt-1 block text-base font-black">{bucket.verified ? bucket.observedLeads : '—'}</span>{bucket.recurring && <span className="absolute right-1 top-0 text-[10px] text-amber-700" aria-hidden="true">★</span>}</button>;
                  })}
                </div>}
                {demandView === 'day-hour' && <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-[920px] w-full border-collapse text-center text-[10px]" aria-label={`${demandMetric === 'calls' ? 'Qualified caller-day leads' : 'Jobs created'} by Toronto weekday and hour for the last four complete weeks`}>
                    <thead className="bg-slate-50 text-slate-500">
                      <tr><th scope="col" className="sticky left-0 z-10 min-w-20 bg-slate-50 px-2 py-2 text-left">Toronto time</th>{Array.from({ length: 24 }, (_, hour) => <th key={hour} scope="col" className="min-w-8 px-0.5 py-2 font-bold">{hourLabel(hour)}</th>)}</tr>
                    </thead>
                    <tbody>
                      {plot.weekdays.map((weekday, weekdayIndex) => (
                        <tr key={weekday} className="border-t border-slate-100">
                          <th scope="row" className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left font-bold text-slate-700">{weekday}</th>
                          {Array.from({ length: 24 }, (_, hour) => {
                            const cell = plot.cells.find((item) => item.weekday === weekdayIndex && item.hour === hour)!;
                            const verified = demandMetric === 'jobs' || cell.coveredWeeks > 0;
                            const key = `${weekdayIndex}:${hour}`;
                            const weekValues = cell.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)}: ${count === null ? 'unverified' : `${count} ${demandMetric === 'calls' ? 'leads' : 'jobs completed'}`}`).join('; ');
                            const metricLabel = demandMetric === 'calls' ? 'leads' : 'jobs completed';
                            const accessibleLabel = `${weekday}, ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}: ${verified ? `${cell.observedLeads} observed ${metricLabel}${demandMetric === 'calls' ? ` across ${cell.coveredWeeks} of 4 covered weeks` : ''}` : 'no verified coverage'}${cell.recurring ? ', recurring demand' : ''}. Weekly counts: ${weekValues}`;
                            return <td key={hour} className="p-0.5"><button type="button" onFocus={() => setActiveDemandCell(key)} onClick={() => setActiveDemandCell(key)} aria-label={accessibleLabel} title={accessibleLabel} className={`relative h-7 w-full rounded-sm font-bold outline-none transition focus:z-10 focus:ring-2 focus:ring-blue-700 ${demandCellColor(cell.observedLeads, verified)} ${activeDemandCell === key ? 'ring-2 ring-blue-700' : ''}`}>{verified ? cell.observedLeads : '—'}{cell.recurring && <span aria-hidden="true" className="absolute -right-0.5 -top-1 text-[8px] text-amber-700">★</span>}</button></td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
                {selectedDemandCell && <p className="mt-2 text-[11px] text-slate-700" aria-live="polite"><strong>{plot.weekdays[selectedDemandCell.weekday]} · {hourLabel(selectedDemandCell.hour)}–{hourLabel((selectedDemandCell.hour + 1) % 24)}:</strong> {selectedDemandCell.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)} ${count === null ? 'unverified' : `${count} ${demandMetric === 'calls' ? 'leads' : 'jobs completed'}`}`).join(' · ')}{selectedDemandCell.recurring ? ' · recurring demand' : ''}</p>}
                {selectedDemandBucket && activeDemandBucket && <p className="mt-2 text-[11px] text-slate-700" aria-live="polite"><strong>{activeDemandBucket.startsWith('day:') ? plot.weekdays[Number(activeDemandBucket.split(':')[1])] : `${hourLabel(Number(activeDemandBucket.split(':')[1]))} hour`}:</strong> {selectedDemandBucket.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)} ${count === null ? 'unverified' : `${count} ${demandMetric === 'calls' ? 'leads' : 'jobs completed'}`}`).join(' · ')}</p>}
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Weekly call demand totals">
                  {plot.weeks.map((week) => <div key={week.startDate} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[10px] text-slate-700"><span className="font-bold">{shortDate(week.startDate)}–{shortDate(week.endDate)}</span><span className="ml-2">{week.complete ? `${week.leads} ${demandMetric === 'calls' ? 'leads' : 'jobs completed'}` : `Partial · ${week.coveredDays}/7 days · total unavailable`}</span></div>)}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">★ Recurring means activity in at least 3 of 4 weeks and a pooled count of at least {plot.minRecurringLeads}. This is a four-week operational pattern, not seasonality.</p>
              </>
            )}
          </section>}
          {selectedSection === 'activity' && <section className="mt-4 rounded-xl border border-slate-100 bg-white p-4" aria-labelledby="call-activity-title">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 id="call-activity-title" className="text-sm font-black">Call activity · {activeRangeLabel}</h3><p className="mt-1 text-[11px] text-slate-500">Exact Toronto call times. Known callers count once per day in lead totals; activity rows are paginated call records.</p></div>
              <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="call-search">Search caller or transcript</label><input id="call-search" value={activitySearch} onChange={(event) => { setActivitySearch(event.target.value); setActivityPage(1); }} placeholder="Search caller or transcript" className="w-52 rounded-lg border border-slate-200 px-3 py-2 text-xs" />
                <label className="sr-only" htmlFor="call-outcome">Filter outcome</label><select id="call-outcome" value={activityOutcome} onChange={(event) => { setActivityOutcome(event.target.value); setActivityPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><option value="all">All outcomes</option><option value="answered">Answered</option><option value="missed">Missed</option><option value="voicemail">Voicemail</option><option value="short">Brief calls</option><option value="callback-recovered">Callback recovered</option><option value="unresolved">Unresolved opportunities</option></select>
                <label className="sr-only" htmlFor="call-number-filter">Receiving number</label><select id="call-number-filter" value={receivingNumber} onChange={(event) => { setReceivingNumber(event.target.value); setActivityPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><option value="all">All tracked numbers</option>{(analytics.targetPhoneNumbers || []).map((number) => <option key={number} value={number}>{formatPhoneNumber(number)}</option>)}</select></div></div>
            {analytics.coverage?.lastError && <p className="mt-3 rounded bg-amber-50 p-2 text-[11px] text-amber-900">Last sync issue: {analytics.coverage.lastError}. Cached activity remains available.</p>}
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500"><tr><th className="px-3 py-2">Call time</th><th className="px-3 py-2">Caller</th><th className="px-3 py-2">Receiving number</th><th className="px-3 py-2">Outcome / callback</th><th className="px-3 py-2">Duration</th><th className="px-3 py-2">Available voicemail</th><th className="px-3 py-2">Linked job</th></tr></thead><tbody className="divide-y divide-slate-100">{activityRows.map((call, index) => <tr key={`${call.id || call.sessionId || call.time}-${index}`} className={call.missedOpportunity ? 'bg-rose-50/70' : ''}><td className="whitespace-nowrap px-3 py-3 font-semibold">{formatCallTime(call.time, true)}</td><td className="px-3 py-3"><div className="font-bold">{formatPhoneNumber(call.callerNumber)}</div><div className="text-[10px] text-slate-500">{displayValue(call.callerName)}</div></td><td className="px-3 py-3">{formatPhoneNumber(call.destinationNumber)}</td><td className="px-3 py-3"><span className={`font-bold ${call.missedOpportunity ? 'text-rose-700' : call.callbackTime ? 'text-emerald-700' : 'text-slate-700'}`}>{call.missedOpportunity ? 'Unresolved opportunity' : call.callbackTime ? `Callback ${formatCallTime(call.callbackTime)}` : call.activityKind}</span><div className="text-[10px] text-slate-500">{displayValue(call.result || call.reason)}</div></td><td className="whitespace-nowrap px-3 py-3">{formatDuration(call.durationSeconds)}</td><td className="max-w-64 px-3 py-3 text-slate-600">{call.voicemailTranscript || (call.voicemailTranscriptionStatus ? `Transcript ${call.voicemailTranscriptionStatus.toLowerCase()}` : call.activityKind === 'voicemail' ? 'No transcript available' : '—')}</td><td className="px-3 py-3">{call.linkedJobs?.length ? call.linkedJobs.map((job) => <a key={job.jobId} href={`/dispatch/jobs/${encodeURIComponent(job.jobId)}`} className="block font-bold text-blue-700 hover:underline">#{job.jobNumber || job.jobId} · {job.jobStatus.toLowerCase()}</a>) : '—'}</td></tr>)}</tbody></table>{activityRows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No activity matches these filters.</p>}</div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-600"><span>{analytics.activityPagination?.total || 0} matches · page {analytics.activityPagination?.page || 1} of {analytics.activityPagination?.totalPages || 1}</span><div className="flex gap-2"><button type="button" disabled={(analytics.activityPagination?.page || 1) <= 1 || loading} onClick={() => setActivityPage((page) => Math.max(1, page - 1))} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button><button type="button" disabled={(analytics.activityPagination?.page || 1) >= (analytics.activityPagination?.totalPages || 1) || loading} onClick={() => setActivityPage((page) => page + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button></div></div>
          </section>}
          {selectedSection === 'linked-jobs' && <section className="mt-4 rounded-xl border border-slate-100 bg-white p-4" aria-labelledby="linked-jobs-title">
            <h3 id="linked-jobs-title" className="text-sm font-black">Confirmed originating call links · {activeRangeLabel}</h3><p className="mt-1 text-[11px] text-slate-600">Conversion uses confirmed originating inbound sessions only. Follow-up calls are not additional originating conversions. Historical review can change these observed results; as of {analytics.definitions?.observationCutoff ? formatCallTime(analytics.definitions.observationCutoff, true) : 'the latest report'}.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">{[['Eligible inbound sessions', String(analytics.linkedConversion?.eligibleSessions ?? 0)], ['Sessions with a confirmed job', analytics.linkedConversion?.conversionRate == null ? 'Unavailable' : `${analytics.linkedConversion.linkedSessions} · ${analytics.linkedConversion.conversionRate.toFixed(1)}%`], ['Completed linked sessions', analytics.linkedConversion?.completedConversionRate == null ? 'Unavailable' : `${analytics.linkedConversion.completedLinkedSessions} · ${analytics.linkedConversion.completedConversionRate.toFixed(1)}%`], ['Jobs without confirmed originating link', String(analytics.linkedConversion?.unlinkedJobs ?? 0)]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase text-slate-500">{label}</div><div className="mt-1 text-lg font-black">{value}</div></div>)}</div>
            <label className="mt-3 block text-[11px] font-bold text-slate-600">Search confirmed links <input value={activitySearch} onChange={(event) => { setActivitySearch(event.target.value); setActivityPage(1); }} className="ml-2 rounded-lg border border-slate-200 px-3 py-2 font-normal" placeholder="Job or caller" /></label>
            <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">{(analytics.linkedJobs || []).map((job) => <div key={`${job.sessionId}:${job.jobId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-xs"><span>{formatCallTime(job.callTime || '', true)} · {formatPhoneNumber(job.callerNumber)}</span><a href={`/dispatch/jobs/${encodeURIComponent(job.jobId)}`} className="font-bold text-blue-700 hover:underline">Job #{job.jobNumber || job.jobId} · {job.jobStatus.toLowerCase()}</a></div>)}{!analytics.linkedJobs?.length && <p className="p-5 text-sm text-slate-500">No confirmed originating links in this range.</p>}</div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-600"><span>{analytics.activityPagination?.total || 0} confirmed links · page {analytics.activityPagination?.page || 1} of {analytics.activityPagination?.totalPages || 1}</span><div className="flex gap-2"><button type="button" disabled={(analytics.activityPagination?.page || 1) <= 1 || loading} onClick={() => setActivityPage((page) => Math.max(1, page - 1))} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button><button type="button" disabled={(analytics.activityPagination?.page || 1) >= (analytics.activityPagination?.totalPages || 1) || loading} onClick={() => setActivityPage((page) => page + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button></div></div>
          </section>}
        </>
      )}


    </section>
  );
}
