'use client';

import { useEffect, useMemo, useState } from 'react';

type CallAnalytics = {
  configured: boolean;
  connected: boolean;
  connectRequired?: boolean;
  cacheAvailable?: boolean;
  dataSource?: 'cache';
  targetPhoneNumber?: string | null;
  targetPhoneNumbers?: string[];
  range?: 'today' | 'yesterday' | 'last-week';
  rangeLabel?: string;
  summary?: { received: number; converted: number; conversionRate: number };
  today?: { date: string; received: number; converted: number; conversionRate: number };
  daily?: Array<{ date: string; label: string; dateLabel: string; received: number; converted: number; conversionRate: number }>;
  totalCalls?: number;
  totalConvertedCalls?: number;
  conversionRate?: number;
  lastSyncedAt?: string;
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

const rangeOptions = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last-week', label: 'Last week' },
] as const;

type AnalyticsRange = (typeof rangeOptions)[number]['value'];

export default function RingCentralCallAnalytics({ canManageConnection = false }: { canManageConnection?: boolean }) {
  const [analytics, setAnalytics] = useState<CallAnalytics | null>(null);
  const [selectedRange, setSelectedRange] = useState<AnalyticsRange>('today');
  const [loading, setLoading] = useState(false);

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
      const response = await fetch(`/api/ringcentral/call-analytics/refresh?range=${selectedRange}`, { method: 'POST', cache: 'no-store' });
      const data = await response.json();
      if (response.ok && data.success) {
        setAnalytics(data);
      } else {
        await fetchAnalytics();
      }
    } catch {
      await fetchAnalytics();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const daily = analytics?.daily || [];
  const activeRange = analytics?.range || selectedRange;
  const activeRangeLabel = analytics?.rangeLabel || rangeOptions.find((option) => option.value === activeRange)?.label || 'Today';
  const periodLabel = activeRange === 'last-week' ? 'last 7 days' : activeRange === 'yesterday' ? 'yesterday' : 'today';
  const summary = analytics?.summary || { received: 0, converted: 0, conversionRate: 0 };
  const maxDailyCalls = useMemo(() => Math.max(1, ...daily.map((day) => Math.max(day.received, day.converted))), [daily]);

  const disconnect = async () => {
    await fetch('/api/ringcentral/disconnect', { method: 'POST' });
    await fetchAnalytics();
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm" aria-labelledby="call-analytics-title">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="call-analytics-title" className="flex items-center gap-2 text-base font-black">
            <span>📞</span> Call analytics
            {analytics?.connected && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Connected</span>}
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Inbound calls received by {(analytics?.targetPhoneNumbers || [analytics?.targetPhoneNumber]).filter(Boolean).map((number) => formatPhoneNumber(number)).join(', ') || '(416) 240-0593'}, grouped by Toronto calendar day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {analytics?.connected && canManageConnection && (
            <button onClick={disconnect} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100">Disconnect</button>
          )}
          <label className="sr-only" htmlFor="call-analytics-range">Call analytics period</label>
          <select
            id="call-analytics-range"
            value={selectedRange}
            onChange={(event) => {
              const nextRange = event.target.value as AnalyticsRange;
              setSelectedRange(nextRange);
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
            <p className="mt-1 text-xs text-slate-600">{canManageConnection ? 'Authorize the read-only Call Log permission to start the daily count.' : 'An Admin must connect call tracking before Dispatcher analytics can be shown.'}</p>
            {analytics.error && <p className="mt-1 text-xs text-rose-600">{analytics.error}</p>}
          </div>
          {canManageConnection && <button onClick={() => { window.location.href = '/api/ringcentral/connect'; }} className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white transition hover:bg-blue-700">Connect call tracking</button>}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <span>{analytics.cacheAvailable ? `Showing cached data${analytics.lastSyncedAt ? ` · last synced ${new Date(analytics.lastSyncedAt).toLocaleString()}` : ''}` : 'No successful sync yet.'}</span>
            {analytics.syncError && <span className="font-bold text-rose-600">Last refresh failed: {analytics.syncError}</span>}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="flex min-h-[132px] flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Calls received · {activeRangeLabel}</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-blue-700">{summary.received}</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">30+ sec calls; repeat callers counted once</p>
            </div>
            <div className="flex min-h-[132px] flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Converted · {activeRangeLabel}</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-emerald-700">{summary.converted}</div>
              <p className="mt-auto pt-1 text-[11px] text-slate-500">Matched to a LockOps job</p>
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
                <p className="text-[11px] text-slate-500">Qualified calls; repeat callers count once per Toronto day</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-slate-600 sm:justify-end">
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />Received</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Converted</span>
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
        </>
      )}
    </section>
  );
}
