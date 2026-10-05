'use client';

import { useCallback, useEffect, useState } from 'react';

type MatchRow = {
  id: string;
  jobId: string;
  ringCentralCallLogId: string;
  status: 'SUGGESTED' | 'CONFIRMED' | 'REJECTED';
  rationale: string | null;
  stalePhone: boolean;
  reviewedBy?: { name: string; role: string } | null;
  reviewedByName?: string | null;
  reviewedByRole?: string | null;
  reviewedAt?: string | null;
  callTime: string | null;
  callerPhoneMasked: string;
  call: { direction: string | null; durationSeconds: number | null; result: string | null };
  job: { id: string; jobNumber: string; createdAt: string; serviceType: string; customer: { name: string; phone: string } };
};

function formatTorontoTime(value: string | null) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

export default function AdminJobCallMatchReview() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationInfo, setGenerationInfo] = useState('');
  const [generationCursor, setGenerationCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [queueCursor, setQueueCursor] = useState<string | null>(null);
  const [hasMoreQueue, setHasMoreQueue] = useState(false);

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    setLoading(true);
    setError('');
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await fetch(`/api/owner/job-call-matches${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load call review queue');
      setMatches((current) => append ? [...current, ...(data.matches || [])] : data.matches || []);
      setAvailable(Boolean(data.ringCentralAvailable));
      setQueueCursor(data.nextCursor || null);
      setHasMoreQueue(Boolean(data.hasMore));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load call review queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const review = async (match: MatchRow, action: 'confirm' | 'reject') => {
    setWorkingId(match.id);
    setError('');
    try {
      const response = await fetch('/api/owner/job-call-matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: match.id,
          jobId: match.jobId,
          callId: match.ringCentralCallLogId,
          action,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save review');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save review');
    } finally {
      setWorkingId(null);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError('');
    setGenerationInfo('');
    try {
      const response = await fetch('/api/owner/job-call-matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', cursor: generationCursor }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to generate suggestions');
      const generation = data.generation;
      setGenerationCursor(generation.truncated ? generationCursor : generation.nextCursor || null);
      setGenerationInfo(generation.truncated
        ? `This batch scanned ${generation.scannedJobs} jobs but reached the call/candidate safety cap. No partial suggestions were saved; retry this batch after narrowing the historical data scope.`
        : `Scanned ${generation.scannedJobs} jobs and reviewed ${generation.generatedCandidates} candidate pairs; added ${generation.created} new suggestions.${generation.hasMoreJobs ? ' Older jobs remain; select “Scan next 100 jobs” to continue.' : ' Historical job scan is complete.'}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate suggestions');
    } finally {
      setGenerating(false);
    }
  };

  const pending = matches.filter((match) => match.status === 'SUGGESTED');
  const reviewed = matches.filter((match) => match.status !== 'SUGGESTED');

  return (
    <section className="mb-6 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm" aria-labelledby="job-call-review-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 id="job-call-review-title" className="text-base font-black text-slate-900">Historical call match review</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            Suggestions require an exact canonical phone and a qualifying inbound call near the job record time. Every link needs an Admin decision; job creation time is only a ranking hint.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={loading || generating} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Refresh queue</button>
          <button type="button" onClick={() => void generate()} disabled={loading || generating || !available} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{generating ? 'Searching…' : generationCursor ? 'Scan next 100 jobs' : 'Generate suggestions'}</button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {generationInfo && <p role="status" className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">{generationInfo}</p>}
      {!available && !loading && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900">RingCentral call data is not available. Jobs and Admin review remain usable; no call suggestions were generated.</p>}
      {loading && <p className="py-5 text-sm text-slate-500">Loading call suggestions…</p>}
      {!loading && available && pending.length === 0 && <p className="py-5 text-sm text-slate-500">No unreviewed call suggestions.</p>}

      <div className="mt-3 space-y-3">
        {pending.map((match) => (
          <article key={match.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
              <div className="min-w-0">
                <p className="font-bold text-slate-900">
                  Job {match.job.jobNumber} · {match.job.customer.name} · {match.job.serviceType}
                </p>
                <p className="mt-1 text-sm text-slate-700">Candidate call: {formatTorontoTime(match.callTime)} Toronto time</p>
                <p className="text-xs text-slate-600">Caller {match.callerPhoneMasked} · {match.call.durationSeconds ?? 'duration unknown'}s · {match.call.result || 'result unavailable'}</p>
                <p className="mt-1 text-xs text-slate-500">{match.rationale || 'Suggested from exact phone and timing.'}</p>
                {match.stalePhone && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">Customer phone changed or no longer matches. Review the customer record before confirming.</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" disabled={Boolean(workingId) || match.stalePhone} onClick={() => void review(match, 'confirm')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{workingId === match.id ? 'Saving…' : 'Confirm call'}</button>
                <button type="button" disabled={Boolean(workingId)} onClick={() => void review(match, 'reject')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Reject</button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {!loading && hasMoreQueue && <button type="button" onClick={() => void load(queueCursor, true)} disabled={loading || generating} className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Load older call matches</button>}

      {!loading && reviewed.length > 0 && (
        <details className="mt-5 border-t border-slate-100 pt-4">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">Reviewed history ({reviewed.length} loaded)</summary>
          <div className="mt-3 space-y-2">
            {reviewed.map((match) => (
              <div key={match.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <strong>{match.status === 'CONFIRMED' ? 'Confirmed call' : 'Rejected candidate'}</strong> · Job {match.job.jobNumber} · {formatTorontoTime(match.callTime)} · Reviewed by {match.reviewedBy?.name || match.reviewedByName || 'former user'}{match.reviewedByRole || match.reviewedBy?.role ? ` (${match.reviewedByRole || match.reviewedBy?.role})` : ''} at {formatTorontoTime(match.reviewedAt || null)}
                {match.stalePhone && <span className="ml-2 font-bold text-amber-800">Current customer phone differs from the candidate.</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
