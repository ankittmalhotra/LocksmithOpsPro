'use client';

import { useEffect, useMemo, useState } from 'react';

type CallAnalytics = {
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
  jobCreationHeatmap?: {
    startDate: string;
    endDate: string;
    weeks: Array<{ startDate: string; endDate: string; coveredDays: number; complete: boolean; leads: number | null }>;
    weekdays: string[];
    cells: Array<{ weekday: number; hour: number; observedLeads: number; coveredWeeks: number; weekCounts: number[]; recurring: boolean }>;
    coverage: { coveredDays: number; totalDays: number; complete: boolean };
    totalLeads: number;
    minRecurringLeads: number;
    manualExcluded: number;
  };
  demandSummary?: {
    rawInboundSessions: number;
    callerDayLeads: number;
    confirmedOriginatingLinks: number;
    suggestedOriginatingLinks: number;
    jobsCreated: number;
    note: string;
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
  }>;
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
  refreshOnLoad = false,
}: {
  canManageConnection?: boolean;
  refreshOnLoad?: boolean;
}) {
  const [analytics, setAnalytics] = useState<CallAnalytics | null>(null);
  const [selectedRange, setSelectedRange] = useState<AnalyticsRange>('today');
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsView, setDetailsView] = useState<'received' | 'missed' | 'all'>('received');
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [activeDemandCell, setActiveDemandCell] = useState<string | null>(null);
  const [demandMetric, setDemandMetric] = useState<'calls' | 'jobs'>('calls');
  const [demandView, setDemandView] = useState<'day-hour' | 'day' | 'hour'>('day-hour');
  const [activeDemandBucket, setActiveDemandBucket] = useState<string | null>(null);

  const fetchAnalytics = async (range: AnalyticsRange = selectedRange) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/ringcentral/call-analytics?range=${range}`, { cache: 'no-store' });
      const data = await response.json();
      setAnalytics(data.success ? data : { configured: true, connected: false, error: data.error || 'Unable to load call analytics.' });
      return data;
    } catch (error: any) {
      setAnalytics({ configured: true, connected: false, error: error.message || 'Unable to load call analytics.' });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const refreshAnalytics = async () => {
    try {
      setLoading(true);
      setRefreshError(null);
      const response = await fetch(`/api/ringcentral/call-analytics/refresh?range=${selectedRange}`, { method: 'POST', cache: 'no-store' });
      const data = await response.json();
      if (response.ok && data.success) {
        setAnalytics(data);
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
        await fetchAnalytics();
        setRefreshError(data.error || 'Unable to refresh calls. Please try again shortly.');
      }
    } catch {
      await fetchAnalytics();
      setRefreshError('Unable to refresh calls. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAnalytics().then((data) => {
      if (refreshOnLoad && data?.success) void refreshAnalytics();
    });
  }, [refreshOnLoad]);

  useEffect(() => {
    if (!showDetails) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowDetails(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDetails]);

  const daily = analytics?.daily || [];
  const activeRange = analytics?.range || selectedRange;
  const activeRangeLabel = analytics?.rangeLabel || rangeOptions.find((option) => option.value === activeRange)?.label || 'Today';
  const periodLabel = activeRange === 'last-week' ? 'last 7 days' : activeRange === 'yesterday' ? 'yesterday' : 'today';
  const summary = analytics?.summary || { received: 0, converted: 0, conversionRate: 0, missedOpportunities: 0 };
  const maxDailyCalls = useMemo(() => Math.max(1, ...daily.map((day) => Math.max(day.received, day.converted))), [daily]);
  const allDetails = analytics?.callDetails || [];
  const receivedDetails = allDetails.filter((call) => call.countsAsReceived);
  const missedDetails = allDetails.filter((call) => !call.countsAsReceived);
  const visibleDetails = detailsView === 'received' ? receivedDetails : detailsView === 'missed' ? missedDetails : allDetails;
  const demand = analytics?.demandHeatmap;
  const plot = demandMetric === 'calls' ? demand : analytics?.jobCreationHeatmap;
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
            onClick={() => { setDetailsView('received'); setShowDetails(true); }}
            disabled={loading || !analytics?.callDetails}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            More details
          </button>
          <label className="sr-only" htmlFor="call-analytics-range">Call analytics period</label>
          <select
            id="call-analytics-range"
            value={selectedRange}
            onChange={(event) => {
              const nextRange = event.target.value as AnalyticsRange;
              setSelectedRange(nextRange);
              setShowDetails(false);
              fetchAnalytics(nextRange);
            }}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:opacity-70"
          >
            {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button onClick={refreshAnalytics} disabled={loading} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-70">
            {loading ? 'Syncing…' : 'Refresh calls'}
          </button>
        </div>
      </div>

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
            <span>{analytics.cacheAvailable ? `Showing cached data${analytics.lastSyncedAt ? ` · last synced ${new Date(analytics.lastSyncedAt).toLocaleString()}` : ''}` : 'No successful sync yet.'}</span>
            {analytics.voicemailPermissionDenied ? (
              <span className="font-bold text-amber-700">Voicemail sync needs the Read Messages permission.</span>
            ) : analytics.syncError ? (
              <span className="font-bold text-rose-600">Last refresh failed: {analytics.syncError}</span>
            ) : null}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="flex min-h-[132px] flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Calls received · {activeRangeLabel}</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-blue-700">{summary.received}</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">30+ sec answered calls and missed calls successfully called back; repeat callers counted once per day</p>
            </div>
            <div className="flex min-h-[132px] flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Converted · {activeRangeLabel}</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-emerald-700">{summary.converted}</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">All jobs logged, matched or unmatched</p>
            </div>
            <div className="flex min-h-[132px] flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Conversion rate</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-amber-700">{summary.conversionRate.toFixed(1)}%</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">{summary.received} received {periodLabel === 'today' || periodLabel === 'yesterday' ? periodLabel : `in ${periodLabel}`}</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900">Received vs converted</h3>
                <p className="text-[11px] text-slate-500">All jobs logged count; phone matching is not required</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-slate-600 sm:justify-end">
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />Received</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Converted / jobs logged</span>
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
                    <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${day.dateLabel}: ${day.received} received, ${day.converted} converted`}>
                      <div className="flex h-36 w-full max-w-14 items-end justify-center gap-1">
                        <div className="flex h-full w-1/2 flex-col items-center justify-end">
                          <span className="mb-1 text-[10px] font-black text-blue-700">{day.received}</span>
                          <div className="w-full rounded-t-md bg-blue-500 transition-all hover:bg-blue-600" style={{ height: `${Math.max(6, receivedHeight * 0.82)}%` }} role="img" aria-label={`${day.dateLabel}: ${day.received} calls received`} />
                        </div>
                        <div className="flex h-full w-1/2 flex-col items-center justify-end">
                          <span className="mb-1 text-[10px] font-black text-emerald-700">{day.converted}</span>
                          <div className="w-full rounded-t-md bg-emerald-500 transition-all hover:bg-emerald-600" style={{ height: `${Math.max(6, convertedHeight * 0.82)}%` }} role="img" aria-label={`${day.dateLabel}: ${day.converted} calls converted`} />
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

          <section className="mt-4 rounded-xl border border-slate-100 bg-white p-4" aria-labelledby="demand-heatmap-title">
            {analytics?.demandSummary && <div className="mb-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Separate four-week activity counts">
                {[
                  ['Raw inbound sessions', analytics.demandSummary.rawInboundSessions],
                  ['Caller-day leads', analytics.demandSummary.callerDayLeads],
                  ['Confirmed call links', analytics.demandSummary.confirmedOriginatingLinks],
                  ['Suggested call links', analytics.demandSummary.suggestedOriginatingLinks],
                  ['Jobs created', analytics.demandSummary.jobsCreated],
                ].map(([label, count]) => <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold text-slate-600">{label}</div>
                  <div className="text-lg font-black text-slate-900">{count}</div>
                </div>)}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">{analytics.demandSummary.note} Counts use the four complete Toronto weeks shown below; incomplete RingCentral coverage is called out in the chart.</p>
            </div>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="demand-heatmap-title" className="text-sm font-black text-slate-900">Four-week activity by Toronto day and hour</h3>
                <div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Choose activity for four-week chart">
                  <button type="button" onClick={() => { setDemandMetric('calls'); setActiveDemandCell(null); }} aria-pressed={demandMetric === 'calls'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandMetric === 'calls' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Caller-day leads</button>
                  <button type="button" onClick={() => { setDemandMetric('jobs'); setActiveDemandCell(null); }} aria-pressed={demandMetric === 'jobs'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandMetric === 'jobs' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Jobs created</button>
                </div>
                <div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Choose heatmap view">
                  <button type="button" onClick={() => { setDemandView('day'); setActiveDemandBucket(null); setActiveDemandCell(null); }} aria-pressed={demandView === 'day'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandView === 'day' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Day</button>
                  <button type="button" onClick={() => { setDemandView('day-hour'); setActiveDemandBucket(null); }} aria-pressed={demandView === 'day-hour'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandView === 'day-hour' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Day &amp; Hour</button>
                  <button type="button" onClick={() => { setDemandView('hour'); setActiveDemandBucket(null); setActiveDemandCell(null); }} aria-pressed={demandView === 'hour'} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${demandView === 'hour' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Hour</button>
                </div>
                {demandMetric === 'calls'
                  ? <p className="mt-1 text-[11px] text-slate-600">Known callers count once per Toronto calendar day; unknown callers count by call session. Includes answered calls of 30+ seconds and missed calls called back successfully.</p>
                  : <p className="mt-1 text-[11px] text-slate-600">Counts job record creation time, not call arrival or conversion. Manual historical jobs are excluded because their entry time is often recorded at midnight.</p>}
                {plot && <p className="mt-1 text-[11px] font-semibold text-slate-500">{shortDate(plot.startDate)}–{shortDate(plot.endDate)}{demandMetric === 'calls' ? ` · ${plot.coverage.coveredDays}/${plot.coverage.totalDays} days verified · ${demand?.lastSyncedAt ? `last synced ${new Date(demand.lastSyncedAt).toLocaleString()}` : 'no successful sync recorded'}` : ` · ${plot.totalLeads} jobs created · ${analytics?.jobCreationHeatmap?.manualExcluded || 0} manual historical jobs excluded`}</p>}
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
              <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{demandMetric === 'calls' ? 'No verified RingCentral coverage for these four complete weeks yet. Unverified periods are not counted as zero demand.' : 'Job creation activity is not available for this period.'}</div>
            ) : (
              <>
                {demandMetric === 'calls' && !plot.coverage.complete && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">Only {plot.coverage.coveredDays} of 28 days have verified sync coverage. Unverified day/hour cells show a dash and are excluded from observed totals.</p>}
                {demandView === 'day' && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Observed totals by Toronto weekday">
                  {plot.weekdays.map((weekday, index) => {
                    const bucket = aggregateDemandBucket('day', index)!;
                    const key = `day:${index}`;
                    const weeks = bucket.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)}: ${count === null ? 'unverified' : count}`).join('; ');
                    const label = `${weekday}: ${bucket.verified ? bucket.observedLeads : 'unverified'} ${demandMetric === 'calls' ? 'caller-day leads' : 'jobs created'}. Weekly totals: ${weeks}`;
                    return <button key={weekday} type="button" onClick={() => setActiveDemandBucket(key)} onFocus={() => setActiveDemandBucket(key)} aria-label={label} title={label} className={`relative rounded-lg p-3 text-left outline-none focus:ring-2 focus:ring-blue-700 ${demandCellColor(bucket.observedLeads, bucket.verified)} ${activeDemandBucket === key ? 'ring-2 ring-blue-700' : ''}`}><span className="block text-[10px] font-bold">{weekday}</span><span className="mt-1 block text-lg font-black">{bucket.verified ? bucket.observedLeads : '—'}</span>{bucket.recurring && <span className="absolute right-2 top-1 text-xs text-amber-700" aria-hidden="true">★</span>}</button>;
                  })}
                </div>}
                {demandView === 'hour' && <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-8" aria-label="Observed totals by Toronto hour">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const bucket = aggregateDemandBucket('hour', hour)!;
                    const key = `hour:${hour}`;
                    const weeks = bucket.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)}: ${count === null ? 'unverified' : count}`).join('; ');
                    const label = `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}: ${bucket.verified ? bucket.observedLeads : 'unverified'} ${demandMetric === 'calls' ? 'caller-day leads' : 'jobs created'}. Weekly totals: ${weeks}`;
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
                            const weekValues = cell.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)}: ${count === null ? 'unverified' : `${count} ${demandMetric === 'calls' ? 'leads' : 'jobs created'}`}`).join('; ');
                            const metricLabel = demandMetric === 'calls' ? 'leads' : 'jobs created';
                            const accessibleLabel = `${weekday}, ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}: ${verified ? `${cell.observedLeads} observed ${metricLabel}${demandMetric === 'calls' ? ` across ${cell.coveredWeeks} of 4 covered weeks` : ''}` : 'no verified coverage'}${cell.recurring ? ', recurring demand' : ''}. Weekly counts: ${weekValues}`;
                            return <td key={hour} className="p-0.5"><button type="button" onFocus={() => setActiveDemandCell(key)} onClick={() => setActiveDemandCell(key)} aria-label={accessibleLabel} title={accessibleLabel} className={`relative h-7 w-full rounded-sm font-bold outline-none transition focus:z-10 focus:ring-2 focus:ring-blue-700 ${demandCellColor(cell.observedLeads, verified)} ${activeDemandCell === key ? 'ring-2 ring-blue-700' : ''}`}>{verified ? cell.observedLeads : '—'}{cell.recurring && <span aria-hidden="true" className="absolute -right-0.5 -top-1 text-[8px] text-amber-700">★</span>}</button></td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
                {selectedDemandCell && <p className="mt-2 text-[11px] text-slate-700" aria-live="polite"><strong>{plot.weekdays[selectedDemandCell.weekday]} · {hourLabel(selectedDemandCell.hour)}–{hourLabel((selectedDemandCell.hour + 1) % 24)}:</strong> {selectedDemandCell.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)} ${count === null ? 'unverified' : `${count} ${demandMetric === 'calls' ? 'leads' : 'jobs created'}`}`).join(' · ')}{selectedDemandCell.recurring ? ' · recurring demand' : ''}</p>}
                {selectedDemandBucket && activeDemandBucket && <p className="mt-2 text-[11px] text-slate-700" aria-live="polite"><strong>{activeDemandBucket.startsWith('day:') ? plot.weekdays[Number(activeDemandBucket.split(':')[1])] : `${hourLabel(Number(activeDemandBucket.split(':')[1]))} hour`}:</strong> {selectedDemandBucket.weekCounts.map((count, week) => `${shortDate(plot.weeks[week].startDate)} ${count === null ? 'unverified' : `${count} ${demandMetric === 'calls' ? 'leads' : 'jobs created'}`}`).join(' · ')}</p>}
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Weekly call demand totals">
                  {plot.weeks.map((week) => <div key={week.startDate} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[10px] text-slate-700"><span className="font-bold">{shortDate(week.startDate)}–{shortDate(week.endDate)}</span><span className="ml-2">{week.complete ? `${week.leads} ${demandMetric === 'calls' ? 'leads' : 'jobs created'}` : `Partial · ${week.coveredDays}/7 days · total unavailable`}</span></div>)}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">★ Recurring means at least {plot.minRecurringLeads} observed {demandMetric === 'calls' ? 'caller-day leads' : 'jobs created'} in a cell with activity in at least 3 of 4 weeks. This is a four-week operational pattern, not seasonality.</p>
              </>
            )}
          </section>
        </>
      )}

      {showDetails && analytics && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowDetails(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="call-details-title"
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <h2 id="call-details-title" className="text-base font-black text-slate-900">Call details · {activeRangeLabel}</h2>
                <p className="mt-1 text-xs text-slate-500">{receivedDetails.length} calls received · {missedDetails.length} other call activities · Toronto time</p>
              </div>
              <button type="button" onClick={() => setShowDetails(false)} className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Close call details">×</button>
            </div>

            <div className="overflow-auto p-4 sm:p-6">
              <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Call detail category">
                {([
                  { value: 'received', label: 'Received calls', count: receivedDetails.length },
                  { value: 'missed', label: 'Missed / voicemail / short', count: missedDetails.length },
                  { value: 'all', label: 'All activity', count: allDetails.length },
                ] as const).map((view) => (
                  <button
                    key={view.value}
                    type="button"
                    aria-pressed={detailsView === view.value}
                    onClick={() => setDetailsView(view.value)}
                    className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${detailsView === view.value ? 'border-blue-200 bg-blue-50 text-blue-700' : view.value === 'missed' && summary.missedOpportunities > 0 ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {view.label} ({view.count})
                  </button>
                ))}
              </div>
              <p className="mb-4 text-[11px] text-slate-500">Received calls match the card and graph. Missed calls that were successfully called back are included; uncalled missed calls, voicemail and calls under 30 seconds are shown separately. Known callers count once per Toronto day; unknown numbers count by call session.</p>
              {visibleDetails.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">{detailsView === 'received' ? 'No qualifying calls received for this period.' : detailsView === 'missed' ? 'No missed calls, voicemail or short calls for this period.' : 'No inbound call activity for this period.'}</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-[1000px] w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-3">Date &amp; time</th>
                        <th className="whitespace-nowrap px-4 py-3">Caller</th>
                        <th className="whitespace-nowrap px-4 py-3">Received by</th>
                        <th className="whitespace-nowrap px-4 py-3">Duration</th>
                        <th className="whitespace-nowrap px-4 py-3">Lead status</th>
                        <th className="whitespace-nowrap px-4 py-3">Result</th>
                        <th className="whitespace-nowrap px-4 py-3">Voicemail transcript</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {visibleDetails.map((call, index) => (
                        <tr data-call-detail-row="true" key={`${call.date}:${call.id || call.telephonySessionId || call.sessionId || `${call.time}-${call.callerNumber}-${index}`}`} className={`align-top transition ${call.missedOpportunity ? 'bg-rose-50/80 hover:bg-rose-100/80' : 'hover:bg-blue-50/40'}`}>
                          <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{formatCallTime(call.time, true)}</td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900">{formatPhoneNumber(call.callerNumber)}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500">{displayValue(call.callerName)}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-800">{formatPhoneNumber(call.destinationNumber)}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500">{displayValue(call.destinationName)}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-900">{formatDuration(call.durationSeconds)}</td>
                          <td className="px-4 py-3">
                            {call.missedOpportunity ? (
                              <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-rose-700">Missed opportunity</span>
                            ) : call.callbackTime ? (
                              <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">Called back</span>
                            ) : call.activityKind === 'answered' ? (
                              <span className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-blue-700">Answered</span>
                            ) : call.activityKind === 'short' ? (
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">Brief call (not a valid lead)</span>
                            ) : (
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">{call.activityKind}</span>
                            )}
                            {call.callbackTime && <div className="mt-1 text-[11px] text-slate-500">Callback: {formatCallTime(call.callbackTime)}</div>}
                            <div className="mt-1 text-[10px] text-slate-500">{call.countsAsReceived ? 'Included in received total' : 'Not included in received total'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-800">{displayValue(call.result)}</div>
                            {call.action && <div className="mt-0.5 text-[11px] text-slate-500">Action: {call.action}</div>}
                            {call.reason && <div className="mt-0.5 text-[11px] text-slate-500">Reason: {call.reason}</div>}
                          </td>
                          <td className="max-w-sm px-4 py-3">
                            {call.voicemailTranscript ? (
                              <div>
                                <div className="whitespace-pre-wrap leading-5 text-slate-800">{call.voicemailTranscript}</div>
                                <div className="mt-1 text-[10px] font-semibold text-slate-400">RingCentral transcription</div>
                              </div>
                            ) : call.activityKind === 'voicemail' ? (
                              <span className="text-slate-400">Transcription {call.voicemailTranscriptionStatus?.toLowerCase() || 'not available'}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
