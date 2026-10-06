'use client';

import { useEffect, useState } from 'react';
import type { AdminInsightsSnapshot } from '@/lib/admin-insights';

export default function AdminAIInsights() {
  const [snapshot, setSnapshot] = useState<AdminInsightsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      await fetch('/api/ringcentral/call-analytics/refresh?range=today', { method: 'POST', cache: 'no-store' }).catch(() => null);
      const response = await fetch('/api/owner/ai-insights', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load call demand.');
      if (active) setSnapshot(data.snapshot as AdminInsightsSnapshot);
    };
    load().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to load call demand.');
    })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const topWindow = snapshot?.recurringDemandCells[0];

  return (
    <section className="mb-6 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm" aria-labelledby="call-demand-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="call-demand-title" className="text-base font-black text-slate-900">Call demand &amp; ad timing</h2>
          <p className="mt-1 text-xs text-slate-600">A simple guide based on the last four complete weeks of RingCentral data.</p>
        </div>
        {snapshot && <p className="text-[11px] font-semibold text-slate-500">{snapshot.coverage.coveredDays}/28 call-data days verified · Toronto time</p>}
      </div>

      {loading && <p className="mt-3 text-sm text-slate-500">Loading call patterns…</p>}
      {!loading && error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      {!loading && !error && <div className="mt-3 rounded-xl bg-blue-50 px-4 py-3">
        {topWindow ? <>
          <p className="text-sm font-black text-blue-950">Most consistent busy window: {topWindow.day}, {topWindow.hour}</p>
          <p className="mt-1 text-xs leading-5 text-slate-700">{topWindow.leadCount} caller-day leads across {topWindow.coveredWeeks} of 4 weeks.</p>
          <p className="mt-2 text-xs leading-5 text-slate-700"><strong>Ad timing:</strong> Keep campaigns and call-answering coverage active around this window. Use Google Ads results to decide spend; these call patterns don’t identify which campaign generated a call.</p>
        </> : <p className="text-xs leading-5 text-slate-700">There isn’t enough repeat activity yet to recommend a reliable weekday and hour. Keep current ad timing and revisit as more weeks are collected.</p>}
      </div>}
    </section>
  );
}
