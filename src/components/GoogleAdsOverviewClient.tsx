'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const RANGES: Array<[string, string]> = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['last-week', 'Last 7 days'],
  ['current-biweekly', 'This biweekly period'], ['previous-biweekly', 'Previous biweekly period'], ['all-time', 'All time'],
];

type Totals = { spend: number; clicks: number; impressions: number; conversionsValue: number; ctr: number | null; averageCpc: number | null };
type Analytics = {
  status: 'not_configured' | 'metadata_unverified' | 'migration_required' | 'not_synced' | 'partially_synced' | 'synced';
  rangeLabel: string; currencyCode: string | null; timeZone: string | null; missingVariables: string[];
  dateFrom?: string; dateTo?: string; expectedDays?: number; syncedDays?: number; syncedAt?: string | null;
  totals?: Totals | null; prior?: (Totals & { dateFrom: string; dateTo: string }) | null;
  daily?: Array<{ date: string; synced: boolean; spend: number | null; clicks: number | null; impressions: number | null }>;
};
type Business = {
  ratiosAvailable: boolean; ratioUnavailableReason: string | null; operatingProfitBeforeAds: number | null; spend: number | null;
  netReturn: number | null; roiPercent: number | null; operatingCurrencyCode: string;
};

const money = (value: number | null | undefined, code = 'CAD') => value === null || value === undefined ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: code }).format(value);
const whole = (value: number | null | undefined) => value === null || value === undefined ? '—' : new Intl.NumberFormat('en-CA').format(value);
const pct = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
const when = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(value)) : 'never';

function delta(current: number | null | undefined, prior: number | null | undefined) {
  if (current === null || current === undefined || prior === null || prior === undefined || prior === 0) return null;
  const change = ((current - prior) / prior) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs prior period`;
}

export default function GoogleAdsOverviewClient({ initialRange, authResult }: { initialRange: string; authResult: string }) {
  const [range, setRange] = useState(RANGES.some(([key]) => key === initialRange) ? initialRange : 'last-week');
  const [data, setData] = useState<Analytics | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [analytics, summary] = await Promise.all([
        fetch(`/api/owner/google-ads/analytics?range=${encodeURIComponent(range)}`, { cache: 'no-store', signal }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch(`/api/dashboard/google-ads-summary?range=${encodeURIComponent(range)}`, { cache: 'no-store', signal }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      ]);
      if (!analytics.ok || !analytics.j.success) throw new Error(analytics.j.error || 'Unable to load Google Ads analytics');
      setData(analytics.j as Analytics);
      setBusiness(summary.ok && summary.j.success ? summary.j as Business : null);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load Google Ads analytics');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const params = new URLSearchParams(window.location.search);
    params.set('range', range);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    return () => controller.abort();
  }, [load, range]);

  const sync = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const response = await fetch(`/api/owner/google-ads/sync?range=${encodeURIComponent(range)}`, { method: 'POST', cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Sync failed');
      setSyncMessage('Synced from Google Ads.');
      await load();
    } catch (cause) {
      setSyncMessage(cause instanceof Error ? cause.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const code = data?.currencyCode || 'CAD';
  const totals = data?.totals;
  const maxSpend = Math.max(1, ...(data?.daily || []).map((day) => day.spend || 0));
  const cards: Array<[string, string, string | null]> = totals ? [
    ['Spend', money(totals.spend, code), delta(totals.spend, data?.prior?.spend)],
    ['Clicks', whole(totals.clicks), delta(totals.clicks, data?.prior?.clicks)],
    ['Impressions', whole(totals.impressions), delta(totals.impressions, data?.prior?.impressions)],
    ['CTR', pct(totals.ctr), null],
    ['Average CPC', money(totals.averageCpc, code), null],
    ['Google-reported conversion value', money(totals.conversionsValue, code), null],
  ] : [];

  return <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Admin only</p><h1 className="text-2xl font-black tracking-tight text-slate-950">Google Ads</h1><p className="mt-1 text-sm text-slate-600">Account-level performance from the cached Google Ads daily totals.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="ads-range" className="sr-only">Date range</label>
        <select id="ads-range" value={range} onChange={(event) => setRange(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">{RANGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <button onClick={() => void sync()} disabled={syncing || data?.status === 'not_configured' || data?.status === 'metadata_unverified'} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-50">{syncing ? 'Syncing…' : 'Sync from Google Ads'}</button>
        <a href="/api/owner/google-ads/connect" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Reconnect</a>
      </div>
    </div>

    {authResult === 'connected' && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Google Ads authorization completed successfully.</p>}
    {authResult === 'failed' && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">Google Ads authorization did not complete. Review the account access and OAuth setup before retrying.</p>}
    {syncMessage && <p role="status" className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">{syncMessage}</p>}
    {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error} <button onClick={() => void load()} className="ml-2 underline">Retry</button></p>}
    {loading && !data && <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />}

    {data?.status === 'not_configured' && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">Google Ads is not configured. Missing: {data.missingVariables.join(', ')}.</p>}
    {data?.status === 'metadata_unverified' && <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">Account currency and time zone have not been verified, so no spend figures are shown. Set GOOGLE_ADS_CURRENCY_CODE and GOOGLE_ADS_TIME_ZONE to the values in the Google Ads account, then GOOGLE_ADS_METADATA_VERIFIED=true.</p>}
    {data?.status === 'migration_required' && <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">The Google Ads cache table is not in this database yet. Apply the Google Ads migration SQL, then reload.</p>}
    {data?.status === 'not_synced' && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">Nothing is cached for {data.dateFrom} to {data.dateTo}. Use “Sync from Google Ads”. A day that has not been synced is unknown, not zero.</p>}

    {totals && data && <>
      <p className="mb-3 text-xs text-slate-500">{data.dateFrom} to {data.dateTo} · {data.timeZone} · {data.syncedDays} of {data.expectedDays} days synced · last synced {when(data.syncedAt)}{data.status === 'partially_synced' ? ' · Some days are missing, so totals are partial.' : ''}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{cards.map(([label, value, change]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-black text-slate-950">{value}</div>{change && <div className="mt-1 text-[11px] text-slate-500">{change}</div>}</div>)}</div>
      {data.prior && <p className="mt-2 text-[11px] text-slate-500">Prior period: {data.prior.dateFrom} to {data.prior.dateTo}.</p>}
      <p className="mt-1 text-[11px] text-slate-500">Conversion value is what Google reports from its configured conversion actions. It is not cash received by the portal and is not shown as ROAS.</p>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="ads-daily-title">
        <h2 id="ads-daily-title" className="text-base font-black text-slate-900">Daily spend</h2>
        <div className="mt-3 flex h-32 items-end gap-1 overflow-x-auto">{(data.daily || []).map((day) => <div key={day.date} className="flex h-full min-w-[10px] flex-1 flex-col justify-end" title={day.synced ? `${day.date}: ${money(day.spend, code)}, ${whole(day.clicks)} clicks` : `${day.date}: not synced`}><div className={`w-full rounded-t ${day.synced ? 'bg-violet-500' : 'bg-slate-200'}`} style={{ height: `${day.synced ? Math.max(3, ((day.spend || 0) / maxSpend) * 100) : 6}%` }} /></div>)}</div>
        <p className="mt-2 text-[10px] text-slate-500">Grey bars are days that have not been synced.</p>
      </section>
    </>}

    {business && business.operatingProfitBeforeAds !== null && <section className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-4" aria-labelledby="ads-business-title">
      <h2 id="ads-business-title" className="text-base font-black text-slate-900">Business contribution after ad spend</h2>
      <p className="mt-1 text-xs text-slate-500">Whole-business comparison for the same dates. Jobs are not attributed to Google Ads, so this is not Ads profit.</p>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Operating profit before Ads', money(business.operatingProfitBeforeAds, business.operatingCurrencyCode)], ['Ad spend', business.ratiosAvailable ? money(business.spend, data?.currencyCode || 'CAD') : '—'], ['Contribution after Ads', business.ratiosAvailable ? money(business.netReturn, data?.currencyCode || 'CAD') : 'Unavailable'], ['Whole-business ROI', business.ratiosAvailable && business.roiPercent !== null ? `${business.roiPercent.toFixed(1)}%` : 'Unavailable']].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-slate-900">{value}</div></div>)}
      </div>
      {!business.ratiosAvailable && <p className="mt-2 text-[11px] text-slate-500">Ratios appear once spend is synced for every day in the range, and Ads and business currencies match.</p>}
      <p className="mt-2 text-[11px] text-slate-500">Attributed ROI is unavailable: the portal has no verified link between a job and a campaign.</p>
    </section>}

    <p className="mt-6 text-xs text-slate-500"><Link href="/dashboard" className="font-bold text-blue-700 hover:underline">← Back to Dashboard</Link></p>
  </main>;
}
