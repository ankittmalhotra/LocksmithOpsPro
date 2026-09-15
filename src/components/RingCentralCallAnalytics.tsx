'use client';

import { useEffect, useMemo, useState } from 'react';

type CallAnalytics = {
  configured: boolean;
  connected: boolean;
  connectRequired?: boolean;
  targetPhoneNumber?: string | null;
  today?: { date: string; received: number; converted: number; conversionRate: number };
  daily?: Array<{ date: string; label: string; dateLabel: string; received: number; converted: number; conversionRate: number }>;
  totalCalls?: number;
  totalConvertedCalls?: number;
  conversionRate?: number;
  lastSyncedAt?: string;
  error?: string;
};

export default function RingCentralCallAnalytics({ canManageConnection = false }: { canManageConnection?: boolean }) {
  const [analytics, setAnalytics] = useState<CallAnalytics | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/ringcentral/call-analytics', { cache: 'no-store' });
      const data = await response.json();
      setAnalytics(data.success ? data : { configured: true, connected: false, error: data.error || 'Unable to load RingCentral call analytics.' });
    } catch (error: any) {
      setAnalytics({ configured: true, connected: false, error: error.message || 'Unable to load RingCentral call analytics.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const daily = analytics?.daily || [];
  const maxDailyCalls = useMemo(() => Math.max(1, ...daily.map((day) => day.received)), [daily]);

  const disconnect = async () => {
    await fetch('/api/ringcentral/disconnect', { method: 'POST' });
    await fetchAnalytics();
  };

  return (
    <section className="mb-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-950 via-slate-900 to-slate-950 p-5 text-white shadow-sm" aria-labelledby="ringcentral-title">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="ringcentral-title" className="flex items-center gap-2 text-base font-black">
            <span>📞</span> RingCentral call analytics
            {analytics?.connected && <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Connected</span>}
          </h2>
          <p className="mt-0.5 text-xs text-slate-300">
            Inbound calls received by {analytics?.targetPhoneNumber || '(416) 240-0593'}, grouped by Toronto calendar day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {analytics?.connected && canManageConnection && (
            <button onClick={disconnect} className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/15">Disconnect</button>
          )}
          <button onClick={fetchAnalytics} disabled={loading} className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/15 disabled:cursor-wait disabled:opacity-70">
            {loading ? 'Syncing…' : 'Refresh calls'}
          </button>
        </div>
      </div>

      {!analytics ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Loading RingCentral call analytics…</div>
      ) : !analytics.configured ? (
        <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          <p className="font-black">Connect RingCentral to see call volume.</p>
          <p className="mt-1 text-xs text-amber-200/80">Add the RingCentral app credentials to the server environment, then reload this dashboard.</p>
        </div>
      ) : !analytics.connected ? (
        <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="font-black">RingCentral authorization needed</p>
            <p className="mt-1 text-xs text-slate-300">{canManageConnection ? 'Authorize the read-only Call Log permission to start the daily count.' : 'An Admin must connect RingCentral before Dispatcher analytics can be shown.'}</p>
            {analytics.error && <p className="mt-1 text-xs text-rose-300">{analytics.error}</p>}
          </div>
          {canManageConnection && <button onClick={() => { window.location.href = '/api/ringcentral/connect'; }} className="shrink-0 rounded-xl bg-violet-500 px-4 py-2 text-xs font-black text-white transition hover:bg-violet-400">Connect RingCentral</button>}
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-violet-200">Calls received today</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-white">{analytics.today?.received || 0}</div>
              <p className="mt-1 text-[11px] text-slate-400">Unique inbound call sessions</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-200">Converted today</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-emerald-300">{analytics.today?.converted || 0}</div>
              <p className="mt-1 text-[11px] text-slate-400">Matched to a LockOps job</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-200">Conversion rate</div>
              <div className="mt-2 text-4xl font-black tracking-tight text-amber-300">{(analytics.today?.conversionRate || 0).toFixed(1)}%</div>
              <p className="mt-1 text-[11px] text-slate-400">{analytics.totalCalls || 0} received in seven days</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black">Received vs converted</h3>
                <p className="text-[11px] text-slate-400">A conversion is a same-day caller-to-job phone match</p>
              </div>
              <div className="flex gap-3 text-[10px] font-bold text-slate-300"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-400" />Received</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />Converted</span></div>
            </div>
            <div className="flex h-40 items-end gap-2 border-b border-white/10 px-1 pt-2">
              {daily.map((day) => {
                const receivedHeight = day.received ? Math.max(8, (day.received / maxDailyCalls) * 100) : 3;
                const convertedHeight = day.converted ? Math.max(8, (day.converted / maxDailyCalls) * 100) : 3;
                return (
                  <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${day.dateLabel}: ${day.received} received, ${day.converted} converted`}>
                    <span className="text-[10px] font-black text-violet-100">{day.received || ''}</span>
                    <div className="flex h-full w-full max-w-12 items-end justify-center gap-1">
                      <div className="w-1/2 rounded-t-md bg-violet-400" style={{ height: `${receivedHeight}%` }} role="img" aria-label={`${day.dateLabel}: ${day.received} calls received`} />
                      <div className="w-1/2 rounded-t-md bg-emerald-400" style={{ height: `${convertedHeight}%` }} role="img" aria-label={`${day.dateLabel}: ${day.converted} calls converted`} />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">{day.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
