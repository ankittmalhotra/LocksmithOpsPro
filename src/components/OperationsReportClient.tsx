'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OPERATIONS_REPORT_BASES, OPERATIONS_REPORT_ENTITY_CODE, OPERATIONS_REPORT_PERIODS, OPERATIONS_REPORT_STATUSES, type OperationsReportBasis, type OperationsReportPeriod, type OperationsReportStatus } from '@/lib/operations-reporting';
import { REVENUE_PERIOD_LABELS } from '@/lib/revenue-period';
import { formatTorontoDateInput } from '@/lib/timezone';

type ReportData = {
  generatedAt: string;
  currencyCode: string;
  filters: { period: OperationsReportPeriod; basis: OperationsReportBasis; status: OperationsReportStatus; entityCode: typeof OPERATIONS_REPORT_ENTITY_CODE; dateFrom: string | null; dateTo: string | null; timeZone: string };
  summary: { completedJobsCount: number; paidInvoiceCount: number }
    | { paidInvoiceCount: number; totalGrossRevenue: number; totalCashRevenue: number; totalInteracRevenue: number; totalCardRevenue: number; totalTaxHST: number; totalCommissionsEarned: number; totalPartsCost: number; netCompanyProfit: number };
  rows: Array<{
    id: string;
    jobNumber: string;
    status: string;
    isManual?: boolean;
    createdAt: string;
    completedAt?: string | null;
    serviceType?: string | null;
    workerCommission?: number;
    resolvedPartsCogs?: number;
    technician?: { name?: string | null } | null;
    technicianName?: string | null;
    customer?: { name?: string | null } | null;
    invoice?: { paymentStatus?: string | null; paymentMethod?: string | null; paidAt?: string | null; grandTotal?: number; taxAmount?: number; taxCollected?: boolean; cogsAmount?: number; subtotal?: number; totalAmountCollected?: number } | null;
  }>;
  pagination: { page: number; pageSize: number; totalRows: number; pageCount: number };
};

const PERIOD_LABELS: Record<OperationsReportPeriod, string> = {
  'all-time': REVENUE_PERIOD_LABELS['all-time'],
  'current-biweekly': REVENUE_PERIOD_LABELS['current-biweekly'],
  'previous-biweekly': REVENUE_PERIOD_LABELS['previous-biweekly'],
  'this-month': REVENUE_PERIOD_LABELS['this-month'],
  'last-7-days': 'Last 7 days',
  custom: 'Custom range',
};

function formatCurrency(value: number | null | undefined, code = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function oneParam(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

function statusLabel(status: string) { return status.replaceAll('_', ' ').toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()); }

function normalizeInitialQuery(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const key of ['period', 'basis', 'status', 'entityCode', 'dateFrom', 'dateTo', 'page']) {
    const value = oneParam(params[key]);
    if (value) query.set(key, value);
  }
  if (!query.has('period')) query.set('period', 'all-time');
  if (!query.has('basis')) query.set('basis', 'paid-invoices');
  if (!query.has('status')) query.set('status', 'ALL');
  if (!query.has('entityCode')) query.set('entityCode', OPERATIONS_REPORT_ENTITY_CODE);
  if (!query.has('page')) query.set('page', '1');
  return query.toString();
}

export default function OperationsReportClient({ initialParams }: { initialParams: Record<string, string | string[] | undefined> }) {
  const router = useRouter();
  const [basis, setBasis] = useState<OperationsReportBasis>(() => {
    const value = oneParam(initialParams.basis);
    return (OPERATIONS_REPORT_BASES as readonly string[]).includes(value || '') ? value as OperationsReportBasis : 'paid-invoices';
  });
  const [period, setPeriod] = useState<OperationsReportPeriod>(() => {
    const value = oneParam(initialParams.period);
    return (OPERATIONS_REPORT_PERIODS as readonly string[]).includes(value || '') ? value as OperationsReportPeriod : 'all-time';
  });
  const [status, setStatus] = useState<OperationsReportStatus>(() => {
    const value = oneParam(initialParams.status);
    return (OPERATIONS_REPORT_STATUSES as readonly string[]).includes(value || '') ? value as OperationsReportStatus : 'ALL';
  });
  const [dateFrom, setDateFrom] = useState(oneParam(initialParams.dateFrom) || '');
  const [dateTo, setDateTo] = useState(oneParam(initialParams.dateTo) || '');
  const [page, setPage] = useState(Number(oneParam(initialParams.page) || 1));
  const initialQuery = normalizeInitialQuery(initialParams);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const filters = useMemo(() => new URLSearchParams(appliedQuery), [appliedQuery]);

  useEffect(() => {
    const query = new URLSearchParams(initialQuery);
    const nextBasis = query.get('basis') || 'paid-invoices';
    const nextPeriod = query.get('period') || 'all-time';
    const nextStatus = query.get('status') || 'ALL';
    const nextPage = Number(query.get('page') || 1);
    setBasis((OPERATIONS_REPORT_BASES as readonly string[]).includes(nextBasis) ? nextBasis as OperationsReportBasis : 'paid-invoices');
    setPeriod((OPERATIONS_REPORT_PERIODS as readonly string[]).includes(nextPeriod) ? nextPeriod as OperationsReportPeriod : 'all-time');
    setStatus((OPERATIONS_REPORT_STATUSES as readonly string[]).includes(nextStatus) ? nextStatus as OperationsReportStatus : 'ALL');
    setDateFrom(query.get('dateFrom') || '');
    setDateTo(query.get('dateTo') || '');
    setPage(Number.isSafeInteger(nextPage) && nextPage > 0 ? nextPage : 1);
    setAppliedQuery(initialQuery);
  }, [initialQuery]);

  const load = useCallback(async (query: URLSearchParams, signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const response = await fetch(`/api/analytics/operations-report?${query.toString()}`, { cache: 'no-store', signal });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load the report');
      if (sequence === requestSequence.current && !signal?.aborted) setData(body as ReportData);
    } catch (cause) {
      if (sequence === requestSequence.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load the report');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(filters, controller.signal);
    return () => {
      controller.abort();
      requestSequence.current += 1;
    };
  }, [filters, load]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams({ period, basis, status: basis === 'paid-invoices' ? status : 'ALL', entityCode: OPERATIONS_REPORT_ENTITY_CODE, page: '1' });
    if (period === 'custom') { next.set('dateFrom', dateFrom); next.set('dateTo', dateTo); }
    setPage(1);
    setAppliedQuery(next.toString());
    router.push(`/books/reports/operations?${next.toString()}`, { scroll: false });
  };

  const goToPage = (nextPage: number) => {
    const boundedPage = Math.max(1, Math.min(data?.pagination.pageCount || 1, nextPage));
    setPage(boundedPage);
    const next = new URLSearchParams(filters);
    next.set('page', String(boundedPage));
    setAppliedQuery(next.toString());
    router.push(`/books/reports/operations?${next.toString()}`, { scroll: false });
  };

  const exportHref = `/api/analytics/operations-report/export?${new URLSearchParams([...filters.entries()].filter(([key]) => key !== 'page')).toString()}`;

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><Link href="/dashboard" className="text-xs font-bold text-blue-700 hover:underline">← Dashboard</Link><p className="mt-3 text-xs font-black uppercase tracking-[0.16em] text-blue-700">Books · Reports · {OPERATIONS_REPORT_ENTITY_CODE}</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{basis === 'completed-jobs' ? 'Completed jobs report' : 'Paid invoice report'}</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">{basis === 'completed-jobs' ? 'Includes paid and unpaid completed work. Date ranges use the Toronto completion date; invoice status is current.' : 'A complete paid-invoice register. Revenue uses paid activity dates in Toronto time.'} Source: Locksmith Job/Invoice records.</p></div>
      <a href={exportHref} className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800">Export all matching rows ↓</a>
    </div>

    <form onSubmit={applyFilters} className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs font-bold text-slate-600">Report basis<select value={basis} onChange={(event) => { const next = event.target.value as OperationsReportBasis; setBasis(next); if (next === 'completed-jobs') setStatus('ALL'); }} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800">{OPERATIONS_REPORT_BASES.map((option) => <option key={option} value={option}>{option === 'completed-jobs' ? 'Completed jobs' : 'Paid invoices'}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">Date range<select value={period} onChange={(event) => setPeriod(event.target.value as OperationsReportPeriod)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800">{OPERATIONS_REPORT_PERIODS.map((option) => <option key={option} value={option}>{PERIOD_LABELS[option]}</option>)}</select></label>
      {period === 'custom' && <>
        <label className="text-xs font-bold text-slate-600">From (Toronto)<input type="date" required value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800" /></label>
        <label className="text-xs font-bold text-slate-600">To (Toronto)<input type="date" required value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800" /></label>
      </>}
      {basis === 'paid-invoices' && <label className="text-xs font-bold text-slate-600">Job status<select value={status} onChange={(event) => setStatus(event.target.value as OperationsReportStatus)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800">{OPERATIONS_REPORT_STATUSES.map((option) => <option key={option} value={option}>{option === 'ALL' ? 'All paid invoices' : statusLabel(option)}</option>)}</select></label>}
      <button type="submit" className="self-end rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-black text-white hover:bg-blue-800">Apply filters</button>
    </form>

    {error && <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}<button onClick={() => void load(filters)} className="underline">Retry</button></div>}
    {data && <>
      {data.filters.basis === 'completed-jobs' && 'completedJobsCount' in data.summary ? <section aria-label="Report totals" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          ['Completed jobs', String(data.summary.completedJobsCount)],
          ['Have a paid invoice', String(data.summary.paidInvoiceCount)],
          ['No paid invoice', String(data.summary.completedJobsCount - data.summary.paidInvoiceCount)],
        ].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-slate-900">{value}</div></div>)}
      </section> : 'totalGrossRevenue' in data.summary && <section aria-label="Report totals" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[
          ['Paid gross revenue', formatCurrency(data.summary.totalGrossRevenue)],
          ['Paid invoices', String(data.summary.paidInvoiceCount)],
          ['On-books HST', formatCurrency(data.summary.totalTaxHST)],
          ['Parts cost', formatCurrency(data.summary.totalPartsCost)],
          ['Net operating profit', formatCurrency(data.summary.netCompanyProfit)],
        ].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-slate-900">{value}</div></div>)}
      </section>}
      <div className="mb-3 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>{data.filters.dateFrom || 'All available dates'}{data.filters.dateTo ? ` – ${data.filters.dateTo}` : ''} · {data.filters.timeZone}{'totalCashRevenue' in data.summary ? ` · $${data.summary.totalCashRevenue.toFixed(2)} cash / $${data.summary.totalInteracRevenue.toFixed(2)} Interac / $${data.summary.totalCardRevenue.toFixed(2)} card` : ''} · Financial actuals are shown for paid invoices only.</span><span>{data.pagination.totalRows} matching rows · Updated {new Date(data.generatedAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}</span></div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1060px] text-left text-xs">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-500"><th className="px-3 py-3">Job</th><th className="px-3 py-3">{data.filters.basis === 'completed-jobs' ? 'Completed date' : 'Paid activity date'}</th><th className="px-3 py-3">Customer</th><th className="px-3 py-3">Service</th><th className="px-3 py-3">Technician</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Payment</th><th className="px-3 py-3 text-right">Gross</th><th className="px-3 py-3 text-right">HST</th><th className="px-3 py-3 text-right">COGS</th><th className="px-3 py-3 text-right">Commission</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.rows.map((job) => <tr key={job.id} className="hover:bg-slate-50"><td className="px-3 py-3 font-black text-slate-900">#{job.jobNumber}</td><td className="px-3 py-3 text-slate-600">{formatTorontoDateInput(data.filters.basis === 'completed-jobs' ? job.completedAt : job.invoice?.paidAt || job.completedAt || job.createdAt) || '—'}</td><td className="px-3 py-3 font-bold text-slate-800">{job.customer?.name || '—'}</td><td className="max-w-48 truncate px-3 py-3 text-slate-600">{job.serviceType || '—'}</td><td className="px-3 py-3 text-slate-600">{job.technician?.name || job.technicianName || 'Unassigned'}</td><td className="px-3 py-3 text-slate-600">{statusLabel(job.status)}</td><td className="px-3 py-3 text-slate-600">{job.invoice?.paymentStatus === 'PAID' ? (job.invoice.paymentMethod || 'Paid').replaceAll('_', ' ') : job.invoice?.paymentStatus ? statusLabel(job.invoice.paymentStatus) : 'No invoice'}</td><td className="px-3 py-3 text-right font-bold text-slate-900">{job.invoice?.paymentStatus === 'PAID' ? formatCurrency(job.invoice.grandTotal) : '—'}</td><td className="px-3 py-3 text-right text-slate-600">{job.invoice?.paymentStatus === 'PAID' ? formatCurrency(job.invoice.taxAmount) : '—'}</td><td className="px-3 py-3 text-right text-slate-600">{job.invoice?.paymentStatus === 'PAID' ? formatCurrency(job.resolvedPartsCogs) : '—'}</td><td className="px-3 py-3 text-right text-slate-600">{job.invoice?.paymentStatus === 'PAID' ? formatCurrency(job.workerCommission) : '—'}</td></tr>)}</tbody>
        </table>
        {data.rows.length === 0 && <p className="p-10 text-center text-sm text-slate-500">{data.filters.basis === 'completed-jobs' ? 'No completed jobs match this date range.' : 'No paid invoices match this range and status.'}</p>}
      </div>
      <div className="mt-4 flex items-center justify-between"><span className="text-xs text-slate-500">Page {data.pagination.page} of {data.pagination.pageCount} · {data.pagination.pageSize} rows per page</span><div className="flex gap-2"><button type="button" disabled={data.pagination.page <= 1 || loading} onClick={() => goToPage(data.pagination.page - 1)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">Previous</button><button type="button" disabled={data.pagination.page >= data.pagination.pageCount || loading} onClick={() => goToPage(data.pagination.page + 1)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">Next</button></div></div>
    </>}
    {!data && loading && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading report…</div>}
  </main>;
}
