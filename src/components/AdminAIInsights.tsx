'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminInsightsSnapshot, AdminInsightMetric } from '@/lib/admin-insights';
import type { GeminiAdminInsight } from '@/lib/gemini-admin-insights';

type AiResponse = { generatedAt: string; dataThrough: string | null; model: string; insights: GeminiAdminInsight[] };

function torontoTimestamp(value: string | null) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function metricValue(value: number | string | null, id?: string) {
  if (value === null) return id?.startsWith('links.') ? 'Not available' : 'Coverage gap';
  return typeof value === 'number' ? value.toLocaleString('en-CA') : value;
}

function Evidence({ metrics }: { metrics: AdminInsightMetric[] }) {
  return <ul className="mt-3 flex flex-wrap gap-2">{metrics.map((metric) => <li key={metric.id} className="rounded-lg bg-white/80 px-2.5 py-1.5 text-xs text-slate-700"><span className="font-semibold">{metric.label}:</span> {metricValue(metric.value, metric.id)}</li>)}</ul>;
}

export default function AdminAIInsights() {
  const [snapshot, setSnapshot] = useState<AdminInsightsSnapshot | null>(null);
  const [aiResult, setAiResult] = useState<AiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [aiError, setAiError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/owner/ai-insights', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load Admin Insights.');
      setSnapshot(data.snapshot);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Admin Insights.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const metricMap = useMemo(() => new Map((snapshot?.metrics || []).map((metric) => [metric.id, metric])), [snapshot]);

  const generateAi = async () => {
    setGenerating(true);
    setAiError('');
    try {
      const response = await fetch('/api/owner/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ action: 'generate-ai' }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to generate AI insights.');
      setAiResult(data);
    } catch (generateError) {
      setAiError(generateError instanceof Error ? generateError.message : 'Unable to generate AI insights.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-blue-50 p-5 shadow-sm" aria-labelledby="admin-ai-insights-title">
      <div className="flex flex-col gap-3 border-b border-violet-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-violet-700">Operations patterns</p>
          <h2 id="admin-ai-insights-title" className="mt-1 text-lg font-black text-slate-950">AI Insights</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">Deterministic call-demand metrics for the last four complete Toronto weeks, with optional AI commentary. Call links and ad spend are not treated as campaign attribution.</p>
        </div>
        <button type="button" onClick={generateAi} disabled={loading || generating || !snapshot?.ai.configured} className="shrink-0 rounded-xl bg-violet-700 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
          {generating ? 'Generating…' : aiResult ? 'Refresh AI commentary' : 'Generate AI commentary'}
        </button>
      </div>

      {loading && <p className="py-5 text-sm text-slate-500">Loading verified call-demand metrics…</p>}
      {!loading && error && <div className="py-5"><p role="alert" className="text-sm font-semibold text-rose-700">{error}</p><button type="button" onClick={() => void load()} className="mt-2 text-xs font-bold text-blue-700 underline">Retry</button></div>}

      {!loading && snapshot && <>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <span><strong>Window:</strong> {snapshot.window.startDate} to {snapshot.window.endDate} (Toronto)</span>
          <span><strong>Coverage:</strong> {snapshot.coverage.coveredDays}/{snapshot.coverage.totalDays} days</span>
          <span><strong>Data through:</strong> {torontoTimestamp(snapshot.dataThrough)}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {snapshot.metrics.filter((metric) => !metric.id.startsWith('leads.week-')).map((metric) => <div key={metric.id} className="rounded-xl border border-slate-100 bg-white/85 p-3">
            <p className="text-[10px] font-bold text-slate-500">{metric.label}</p><p className="mt-1 text-lg font-black text-slate-900">{metricValue(metric.value, metric.id)}</p>
          </div>)}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-black text-slate-900">Deterministic observations</h3>
            <div className="mt-2 space-y-2">{snapshot.observations.map((observation) => <article key={observation.id} className="rounded-xl border border-slate-100 bg-white/85 p-3">
              <h4 className="text-xs font-black text-slate-800">{observation.title}</h4><p className="mt-1 text-xs leading-5 text-slate-600">{observation.detail}</p><Evidence metrics={observation.evidence} />
            </article>)}</div>
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900">Recurring weekday and hour windows</h3>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">A window appears only when at least three covered weeks have calls and the pooled minimum is met. Each cell keeps weekday and hour separate.</p>
            {snapshot.recurringDemandCells.length ? <ul className="mt-2 space-y-2">{snapshot.recurringDemandCells.map((cell) => <li key={cell.id} className="rounded-xl border border-slate-100 bg-white/85 p-3">
              <div className="flex items-baseline justify-between gap-3"><span className="text-xs font-black text-slate-800">{cell.day}, {cell.hour}</span><span className="text-xs font-bold text-violet-800">{cell.leadCount} caller-day leads</span></div>
              <p className="mt-1 text-[11px] text-slate-500">Weekly counts: {cell.weekCounts.map((count, index) => `W${index + 1} ${count === null ? 'not covered' : count}`).join(' · ')}</p>
            </li>)}</ul> : <p className="mt-2 rounded-xl bg-white/80 p-3 text-xs text-slate-600">No window meets the repeat-week and sample thresholds.</p>}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-violet-100 bg-white/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-black text-slate-900">Optional AI commentary</h3><span className="text-[10px] text-slate-500">{aiResult ? `Generated ${torontoTimestamp(aiResult.generatedAt)} · ${aiResult.model}` : snapshot.ai.configured ? `Available · ${snapshot.ai.model}` : 'Gemini is not configured'}</span></div>
          <p className="mt-1 text-[11px] text-slate-500">AI receives aggregate call counts and time buckets only. Numeric evidence below comes from the server metrics.</p>
          {!snapshot.ai.configured && <p className="mt-2 text-xs text-slate-600">Deterministic observations remain available. Configure Gemini to enable optional commentary.</p>}
          {aiError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{aiError}</p>}
          {aiResult?.insights.length ? <div className="mt-3 space-y-2">{aiResult.insights.map((insight) => <article key={insight.id} className="rounded-lg bg-violet-50/70 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-xs font-black text-slate-900">{insight.title}</h4><span className="text-[10px] font-bold uppercase text-violet-700">{insight.confidence} confidence</span></div>
            <p className="mt-1 text-xs leading-5 text-slate-700">{insight.finding}</p><p className="mt-1 text-xs leading-5 text-slate-700"><strong>Possible experiment:</strong> {insight.recommendation}</p>
            <Evidence metrics={insight.metricIds.flatMap((id) => metricMap.has(id) ? [metricMap.get(id)!] : [])} />
          </article>)}</div> : aiResult ? <p className="mt-2 text-xs text-slate-600">No AI commentary passed evidence validation.</p> : null}
        </div>
      </>}
    </section>
  );
}
