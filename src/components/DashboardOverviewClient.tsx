'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PeriodComparisonWidget, { type PeriodComparisonMode, type PeriodComparisons } from '@/components/PeriodComparisonWidget';
import { formatTorontoDateInput } from '@/lib/timezone';
import { REVENUE_PERIOD_LABELS, REVENUE_PERIOD_OPTIONS, type RevenuePeriod } from '@/lib/revenue-period';
import { buildOperationsReportHref, type OperationsReportBasis, type OperationsReportPeriod } from '@/lib/operations-reporting';
import { createRequestSequenceGuard } from '@/lib/request-sequence';

type DashboardSummary = {
  generatedAt: string;
  currencyCode: string;
  financialPeriod: { key: RevenuePeriod; label: string; dateFrom: string | null; dateTo: string | null; timeZone: string };
  summary: {
    paidInvoiceCount: number;
    completedJobsCount: number;
    totalGrossRevenue: number;
    totalCashRevenue: number;
    totalInteracRevenue: number;
    totalCardRevenue: number;
    totalTaxHST: number;
    totalCommissionsEarned: number;
    totalPartsCost: number;
    netCompanyProfit: number;
  };
  last7Days: Array<{ date: string; label: string; dateLabel: string; paidInvoiceCount: number; completedJobsCount: number; revenue: number; tax: number; profit: number; isPartial: boolean }>;
  last7DaysSummary: { paidInvoiceCount: number; completedJobsCount: number; revenue: number; averagePaidTicket: number; dateFrom: string | null; dateTo: string | null; todayIsPartial: boolean };
  recentActivity: Array<{
    id: string;
    jobNumber: string;
    status: string;
    isManual: boolean;
    createdAt: string;
    completedAt?: string | null;
    serviceType?: string | null;
    customer?: { name?: string | null } | null;
    technician?: { name?: string | null } | null;
    technicianName?: string | null;
    invoice?: { paymentStatus?: string | null; grandTotal?: number | null; paymentMethod?: string | null } | null;
  }>;
};

type AdsSummary = {
  generatedAt: string;
  range: string;
  rangeLabel: string;
  dateFrom: string | null;
  dateTo: string | null;
  timeZone: string | null;
  currencyCode: string | null;
  operatingCurrencyCode: string;
  currenciesMatch: boolean;
  metadataVerified: boolean;
  spendCoverageComplete: boolean;
  ratiosAvailable: boolean;
  ratioUnavailableReason: 'not_configured' | 'account_metadata_unverified' | 'partial_spend_coverage' | 'currency_mismatch' | 'zero_spend' | null;
  configured: boolean;
  missingVariables: string[];
  syncedAt: string | null;
  spend: number | null;
  operatingProfitBeforeAds: number | null;
  netReturn: number | null;
  roiPercent: number | null;
  roas: number | null;
  syncedDays: number;
  expectedDays: number;
  status: string;
};

const ADS_RANGES = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['last-week', 'Last week'],
  ['current-biweekly', 'This biweekly period'], ['previous-biweekly', 'Previous biweekly period'], ['all-time', 'All time'],
] as const;

function currency(value: number | null | undefined, code = 'CAD') {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(value);
}

function adsCurrency(value: number | null | undefined, code: string | null) {
  return code ? currency(value, code) : 'Unavailable';
}

function when(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
}

function reportHref(period: OperationsReportPeriod, dateFrom?: string | null, dateTo?: string | null, basis: OperationsReportBasis = 'paid-invoices') {
  return buildOperationsReportHref({ period, basis, dateFrom, dateTo });
}

function MetricCard({ label, value, detail, href, tone = 'slate' }: { label: string; value: string; detail?: string; href: string; tone?: string }) {
  const toneClass = tone === 'blue' ? 'border-blue-200 bg-blue-50/60' : tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white';
  return <Link href={href} className={`group rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${toneClass}`}>
    <div className="flex items-start justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span><span aria-hidden="true" className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span></div>
    <div className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</div>
    {detail && <div className="mt-2 text-xs leading-5 text-slate-500">{detail}</div>}
  </Link>;
}

export default function DashboardOverviewClient({ isAdmin, initialPeriod }: { isAdmin: boolean; initialPeriod: RevenuePeriod }) {
  const router = useRouter();
  const [period, setPeriod] = useState<RevenuePeriod>(initialPeriod);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [adsRange, setAdsRange] = useState('today');
  const [ads, setAds] = useState<AdsSummary | null>(null);
  const [adsLoading, setAdsLoading] = useState(isAdmin);
  const [adsError, setAdsError] = useState('');
  const adsRequestSequence = useRef(createRequestSequenceGuard());
  const [comparisonMode, setComparisonMode] = useState<PeriodComparisonMode>('week');
  const [comparisons, setComparisons] = useState<PeriodComparisons | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(true);
  const [comparisonError, setComparisonError] = useState('');

  useEffect(() => { setPeriod(initialPeriod); }, [initialPeriod]);

  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    setSummaryError('');
    fetch(`/api/dashboard/summary?period=${encodeURIComponent(period)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load Dashboard summary');
        if (active) setSummary(data as DashboardSummary);
      })
      .catch((error) => { if (active) setSummaryError(error.message || 'Unable to load Dashboard summary'); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [period, refresh]);

  useEffect(() => {
    let active = true;
    setComparisonLoading(true);
    fetch('/api/analytics/period-comparison', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load period comparisons');
        if (active) setComparisons(data.comparisons as PeriodComparisons);
      })
      .catch((error) => { if (active) setComparisonError(error.message || 'Unable to load period comparisons'); })
      .finally(() => { if (active) setComparisonLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  const loadAds = useCallback(async (range: string, signal?: AbortSignal) => {
    const requestSequence = adsRequestSequence.current.begin();
    setAdsLoading(true);
    setAdsError('');
    try {
      const response = await fetch(`/api/dashboard/google-ads-summary?range=${encodeURIComponent(range)}`, { cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load Ads summary');
      if (adsRequestSequence.current.isCurrent(requestSequence, signal)) setAds(data as AdsSummary);
    } catch (error) {
      if (adsRequestSequence.current.isCurrent(requestSequence, signal)) setAdsError(error instanceof Error ? error.message : 'Unable to load Ads summary');
    } finally {
      if (adsRequestSequence.current.isCurrent(requestSequence, signal)) setAdsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    void loadAds(adsRange, controller.signal);
    return () => {
      controller.abort();
      adsRequestSequence.current.invalidate();
    };
  }, [isAdmin, adsRange, refresh, loadAds]);

  const selectPeriod = (next: RevenuePeriod) => {
    setPeriod(next);
    const params = new URLSearchParams(window.location.search);
    params.set('period', next);
    router.push(`/dashboard?${params.toString()}`, { scroll: false });
  };

  const maxRevenue = useMemo(() => Math.max(1, ...(summary?.last7Days || []).map((day) => day.revenue)), [summary]);
  const periodLink = reportHref(period, summary?.financialPeriod.dateFrom, summary?.financialPeriod.dateTo);
  const recentJobs = summary?.recentActivity || [];

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Operations workspace</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">A shared view of paid performance, current work, and the latest activity.</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {summary?.generatedAt && <span>Updated {when(summary.generatedAt)}</span>}
        <button type="button" onClick={() => setRefresh((version) => version + 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-700 hover:bg-slate-50" disabled={summaryLoading}>Refresh</button>
      </div>
    </header>

    <section aria-labelledby="financial-period-heading" className="mb-6">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 id="financial-period-heading" className="text-base font-black text-slate-900">Financial period</h2><p className="text-xs text-slate-500">Paid invoice revenue follows Toronto payment activity dates. Completed jobs are counted separately.</p></div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">Period
          <select value={period} onChange={(event) => selectPeriod(event.target.value as RevenuePeriod)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
            {REVENUE_PERIOD_OPTIONS.map((option) => <option key={option} value={option}>{REVENUE_PERIOD_LABELS[option]}</option>)}
          </select>
        </label>
      </div>
      {summaryError && <div role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{summaryError} <button type="button" onClick={() => setRefresh((value) => value + 1)} className="ml-2 underline">Retry</button></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Paid gross revenue" value={summaryLoading && !summary ? 'Loading…' : currency(summary?.summary.totalGrossRevenue)} detail={`${summary?.summary.paidInvoiceCount ?? 0} paid invoices · ${summary?.financialPeriod.label || REVENUE_PERIOD_LABELS[period]}`} href={periodLink} tone="blue" />
        <MetricCard label="Completed jobs" value={summaryLoading && !summary ? 'Loading…' : String(summary?.summary.completedJobsCount ?? 0)} detail="Counted by completion date, including unpaid completed work" href={reportHref(period, summary?.financialPeriod.dateFrom, summary?.financialPeriod.dateTo, 'completed-jobs')} />
        <MetricCard label="Net operating profit" value={summaryLoading && !summary ? 'Loading…' : currency(summary?.summary.netCompanyProfit)} detail="Gross less on-books HST, commissions, and parts cost" href={periodLink} tone="emerald" />
        <MetricCard label="Cash / Interac / card" value={summaryLoading && !summary ? 'Loading…' : currency(summary?.summary.totalCashRevenue)} detail={`${currency(summary?.summary.totalInteracRevenue)} Interac · ${currency(summary?.summary.totalCardRevenue)} card`} href={periodLink} />
      </div>
      {summary && <p className="mt-2 text-right text-[11px] text-slate-500">{summary.financialPeriod.dateFrom || 'All available dates'}{summary.financialPeriod.dateTo ? ` to ${summary.financialPeriod.dateTo}` : ''} · HST {currency(summary.summary.totalTaxHST)} · COGS {currency(summary.summary.totalPartsCost)} · Commissions {currency(summary.summary.totalCommissionsEarned)}</p>}
    </section>

    <section aria-labelledby="last-seven-heading" className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 id="last-seven-heading" className="text-base font-black text-slate-900">Last 7 days</h2><p className="text-xs text-slate-500">Toronto business dates · {summary?.last7DaysSummary.dateFrom || '—'} to {summary?.last7DaysSummary.dateTo || '—'} · Today is partial through the latest update.</p></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1"><Link href={reportHref('custom', summary?.last7DaysSummary.dateFrom, summary?.last7DaysSummary.dateTo)} className="text-xs font-bold text-blue-700 hover:underline">Paid invoice detail ↗</Link><Link href={reportHref('custom', summary?.last7DaysSummary.dateFrom, summary?.last7DaysSummary.dateTo, 'completed-jobs')} className="text-xs font-bold text-blue-700 hover:underline">Completed job detail ↗</Link></div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Paid revenue</div><div className="mt-1 text-xl font-black text-slate-900">{currency(summary?.last7DaysSummary.revenue)}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Paid invoices</div><div className="mt-1 text-xl font-black text-slate-900">{summary?.last7DaysSummary.paidInvoiceCount ?? '—'}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Completed jobs</div><div className="mt-1 text-xl font-black text-slate-900">{summary?.last7DaysSummary.completedJobsCount ?? '—'}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Average paid ticket</div><div className="mt-1 text-xl font-black text-slate-900">{currency(summary?.last7DaysSummary.averagePaidTicket)}</div></div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-2" aria-label="Paid revenue by day">
        {(summary?.last7Days || []).map((day) => <div key={day.date} className="min-w-0 text-center">
          <div className="flex h-24 items-end justify-center rounded-lg bg-slate-50 px-1"><div title={`${day.date}: ${currency(day.revenue)}, ${day.paidInvoiceCount} paid invoices, ${day.completedJobsCount} completed jobs${day.isPartial ? ' so far (partial day)' : ''}`} className="w-full max-w-8 rounded-t-md bg-blue-500" style={{ height: `${Math.max(day.revenue > 0 ? 8 : 0, (day.revenue / maxRevenue) * 100)}%` }} /></div>
          <div className="mt-1 truncate text-[10px] font-bold text-slate-600">{day.isPartial ? 'Today · partial' : day.label}</div><div className="text-[9px] text-slate-400">{day.dateLabel}</div><div className="mt-1 text-[8px] leading-3 text-slate-500">{day.paidInvoiceCount} paid · {day.completedJobsCount} done</div>
        </div>)}
      </div>
      {summaryError && <p className="mt-2 text-xs text-slate-500">The daily chart is unavailable until the Dashboard summary loads.</p>}
    </section>

    {isAdmin && <section aria-labelledby="ads-roi-heading" className="mb-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 id="ads-roi-heading" className="text-base font-black text-slate-900">Google Ads business comparison</h2><p className="text-xs text-slate-500">Admin only · Cached account spend compared with whole-company operating profit. Jobs are not attributed to Ads.</p></div>
        <div className="flex items-center gap-2"><label htmlFor="dashboard-ads-range" className="sr-only">Google Ads date range</label><select id="dashboard-ads-range" value={adsRange} onChange={(event) => setAdsRange(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800">{ADS_RANGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Link href={`/google-ads?range=${encodeURIComponent(adsRange)}`} className="text-xs font-bold text-violet-800 hover:underline">More details ↗</Link></div>
      </div>
      {adsError ? <div role="status" className="rounded-xl border border-rose-200 bg-white p-3 text-xs font-semibold text-rose-700">{adsError} <button onClick={() => void loadAds(adsRange)} className="ml-2 underline">Retry</button></div>
        : adsLoading && !ads ? <p className="py-6 text-center text-sm text-slate-500">Loading Ads summary…</p>
          : !ads?.configured ? <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Google Ads is not configured. The rest of the Dashboard is available.</p>
            : !ads.metadataVerified ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Google Ads account currency and time zone are unverified. Spend comparisons, date windows, and return ratios are withheld until Phase 6 verifies the Google Ads Customer metadata.</p>
            : <><p className="mb-3 text-[11px] text-slate-500">{ads.dateFrom} to {ads.dateTo} · {ads.timeZone} · Last synced {when(ads.syncedAt)}</p>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[[ads.spendCoverageComplete ? 'Spend' : 'Spend synced so far', adsCurrency(ads.spend, ads.currencyCode)], ['Operating profit before Ads', currency(ads.operatingProfitBeforeAds, ads.operatingCurrencyCode)], ['Net return', ads.ratiosAvailable ? adsCurrency(ads.netReturn, ads.currencyCode) : 'Unavailable'], ['Whole-business ROI', ads.ratiosAvailable && ads.roiPercent !== null ? `${ads.roiPercent.toFixed(1)}%` : 'Unavailable']].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-slate-900">{adsLoading ? 'Updating…' : value}</div></div>)}
              </div><p className="mt-2 text-[10px] text-slate-500">{ads.syncedDays} of {ads.expectedDays} days synced. {ads.ratiosAvailable ? 'Whole-business ROI = (operating profit − complete spend) ÷ complete spend; it is not attributed Ads ROI.' : ads.ratioUnavailableReason === 'partial_spend_coverage' ? 'Return ratios are unavailable until spend is synced for every day in this range.' : ads.ratioUnavailableReason === 'currency_mismatch' ? `Return ratios are unavailable because Ads is ${ads.currencyCode} and business finances are ${ads.operatingCurrencyCode}.` : ads.ratioUnavailableReason === 'zero_spend' ? 'Return ratios are unavailable because spend is zero for this range.' : 'Return ratios are unavailable until Ads reporting is configured and complete.'}</p>
            </>}
    </section>}

    <PeriodComparisonWidget mode={comparisonMode} onModeChange={setComparisonMode} comparison={comparisons?.[comparisonMode] || null} loading={comparisonLoading} error={comparisonError} />

    <section aria-labelledby="recent-activity-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 id="recent-activity-heading" className="text-base font-black text-slate-900">Recent Operational Activity</h2><p className="text-xs text-slate-500">Latest 10 jobs, selected on the server. Financial totals above use the full eligible period.</p></div>
        <Link href="/dispatch" className="text-xs font-bold text-blue-700 hover:underline">Open Jobs desk ↗</Link>
      </div>
      {summaryError && !summary && <p className="py-8 text-center text-sm text-slate-500">Load failed. Use Retry above.</p>}
      {!summaryError && summaryLoading && !summary && <p className="py-8 text-center text-sm text-slate-500">Loading latest activity…</p>}
      {summary && <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs">
        <thead><tr className="border-b border-slate-200 text-[10px] font-bold uppercase text-slate-400"><th className="px-3 py-2">Job</th><th className="px-3 py-2">Service date</th><th className="px-3 py-2">Entered</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Service</th><th className="px-3 py-2">Technician</th><th className="px-3 py-2">Payment</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{recentJobs.map((job) => <tr key={job.id} className="hover:bg-slate-50"><td className="px-3 py-3 font-black text-slate-900"><Link href={`/dispatch/jobs/${encodeURIComponent(job.id)}`} className="text-blue-700 hover:underline">#{job.jobNumber}</Link>{job.isManual && <div className="mt-1 text-[9px] font-semibold uppercase text-slate-500">Manual entry</div>}</td><td className="px-3 py-3 text-slate-600">{formatTorontoDateInput(job.completedAt) || '—'}</td><td className="px-3 py-3 text-slate-600">{formatTorontoDateInput(job.createdAt) || '—'}</td><td className="px-3 py-3 font-semibold text-slate-800">{job.customer?.name || '—'}</td><td className="max-w-48 truncate px-3 py-3 text-slate-600">{job.serviceType || '—'}</td><td className="px-3 py-3 text-slate-600">{job.technician?.name || job.technicianName || 'Unassigned'}</td><td className="px-3 py-3 text-slate-600">{job.invoice?.paymentStatus === 'PAID' ? (job.invoice.paymentMethod || 'Paid').replaceAll('_', ' ') : 'Unpaid'}</td><td className="px-3 py-3 font-bold text-slate-900">{job.invoice?.paymentStatus === 'PAID' ? currency(job.invoice.grandTotal) : '—'}</td><td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">{job.status.replaceAll('_', ' ')}</span></td></tr>)}</tbody>
      </table>{recentJobs.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No jobs have been recorded yet.</p>}</div>}
    </section>
  </main>;
}
