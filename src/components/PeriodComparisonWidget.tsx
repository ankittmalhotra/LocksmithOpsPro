'use client';

import Link from 'next/link';
import { buildOperationsReportHref } from '@/lib/operations-reporting';

export type PeriodComparisonMode = 'week' | 'biweekly';
export type PeriodComparisonWindow = { start: string; end: string; revenue: number; completedJobs: number };
export type PeriodComparisonMetric = { current: number; previous: number; change: number; changePercent: number | null };
export type PeriodComparison = {
  current: PeriodComparisonWindow;
  previous: PeriodComparisonWindow;
  revenue: PeriodComparisonMetric;
  completedJobs: PeriodComparisonMetric;
};
export type PeriodComparisons = Record<PeriodComparisonMode, PeriodComparison>;

function formatComparisonDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function formatCurrencyChange(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export default function PeriodComparisonWidget({
  mode, onModeChange, comparison, loading, error,
}: {
  mode: PeriodComparisonMode;
  onModeChange: (mode: PeriodComparisonMode) => void;
  comparison: PeriodComparison | null;
  loading: boolean;
  error: string;
}) {
  const rangeLabel = (window: PeriodComparisonWindow) => `${formatComparisonDate(window.start)} – ${formatComparisonDate(window.end)}`;
  const metricCard = (title: string, metric: PeriodComparisonMetric, format: (value: number) => string, formatChange: (value: number) => string, basis: 'paid-invoices' | 'completed-jobs') => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div><div className="text-[11px] text-slate-500">This period</div><div className="text-xl font-black text-slate-900">{format(metric.current)}</div></div>
        <div><div className="text-[11px] text-slate-500">Previous</div><div className="text-xl font-black text-slate-700">{format(metric.previous)}</div></div>
      </div>
      <div className={`mt-3 text-xs font-bold ${metric.change > 0 ? 'text-emerald-700' : metric.change < 0 ? 'text-rose-700' : 'text-slate-500'}`}>
        {formatChange(metric.change)} ({metric.changePercent === null ? 'N/A (previous was 0)' : `${metric.changePercent > 0 ? '+' : ''}${metric.changePercent}%`}) vs previous
      </div>
      <Link href={buildOperationsReportHref({ basis, period: 'custom', dateFrom: comparison?.current.start, dateTo: comparison?.current.end })} className="mt-3 inline-flex text-xs font-bold text-blue-700 hover:underline">View current period details ↗</Link>
    </div>
  );

  return (
    <section className="mb-6 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="period-comparison-title">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="period-comparison-title" className="text-base font-black text-slate-900">Period comparison</h2>
          <p className="text-xs text-slate-500">Equal-length windows: paid gross revenue by payment date and completed jobs by completion date.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="period-comparison-mode" className="text-xs font-bold text-slate-600">Compare</label>
          <select id="period-comparison-mode" value={mode} onChange={(event) => onModeChange(event.target.value as PeriodComparisonMode)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200">
            <option value="week">Week to date vs same days last week</option>
            <option value="biweekly">Biweekly to date vs same days previous period</option>
          </select>
        </div>
      </div>
      {loading ? <div role="status" className="py-6 text-center text-sm text-slate-500">Loading period comparison…</div>
        : error ? <div role="status" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>
        : comparison ? <>
          <div className="mb-3 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:justify-between">
            <span>This period: <strong className="text-slate-700">{rangeLabel(comparison.current)}</strong></span>
            <span>Previous: <strong className="text-slate-700">{rangeLabel(comparison.previous)}</strong></span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {metricCard('Paid gross revenue', comparison.revenue, (value) => `$${value.toFixed(2)}`, formatCurrencyChange, 'paid-invoices')}
            {metricCard('Completed jobs', comparison.completedJobs, (value) => `${value}`, (value) => `${value > 0 ? '+' : ''}${value}`, 'completed-jobs')}
          </div>
        </> : <div className="py-6 text-center text-sm text-slate-500">No comparison data available.</div>}
    </section>
  );
}
