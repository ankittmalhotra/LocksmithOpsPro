'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';

const STATUS_STEPS = [
  { key: 'DISPATCHED', label: 'Assigned', desc: 'Technician assigned to your request' },
  { key: 'EN_ROUTE', label: 'En Route', desc: 'Technician driving to your location' },
  { key: 'ON_SITE', label: 'Arrived On Site', desc: 'Technician is at your location' },
  { key: 'IN_PROGRESS', label: 'Work In Progress', desc: 'Servicing locks & hardware' },
  { key: 'COMPLETED', label: 'Completed', desc: 'Service finished & invoiced' },
];

export default function CustomerTrackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetchJob();
    const interval = setInterval(fetchJob, 5000); // Live poll every 5s
    return () => clearInterval(interval);
  }, [id]);

  const fetchJob = async () => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      const data = await res.json();
      if (data.success && data.job) {
        setJob(data.job);
      } else {
        setErrorMsg('Job tracking not found');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !job) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="text-center text-slate-500 text-xs">Loading live locksmith tracking...</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="text-center text-rose-600 text-xs">{errorMsg || 'Tracking not available'}</div>
      </div>
    );
  }

  // Determine current step index
  let currentStepIdx = 0;
  if (job.status === 'DISPATCHED') currentStepIdx = 0;
  else if (job.status === 'EN_ROUTE') currentStepIdx = 1;
  else if (job.status === 'ON_SITE') currentStepIdx = 2;
  else if (job.status === 'IN_PROGRESS') currentStepIdx = 3;
  else if (job.status === 'COMPLETED' || job.status === 'ABANDONED_TRAVEL_FEE') currentStepIdx = 4;

  const isAbandoned = job.status === 'ABANDONED_TRAVEL_FEE';

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 sm:px-6 flex flex-col justify-center">
      <div className="max-w-md mx-auto w-full">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-900 text-white text-2xl shadow-md mb-2">
            🔐
          </div>
          <h1 className="text-lg font-black text-slate-900">LockOps Live Service Tracker</h1>
          <p className="text-xs text-slate-500">Real-time status updates for your locksmith request</p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden mb-4">
          {/* Top Job Banner */}
          <div className="bg-slate-900 text-white p-5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400">Order Reference</span>
                <div className="text-xl font-black">JOB #{job.jobNumber}</div>
                <div className="text-xs text-slate-300 mt-0.5">{job.serviceType}</div>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Service Status</span>
                <span className="text-xs font-black px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {job.status.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>

          <div className="p-5">
            {/* Technician Contact Card */}
            {job.technician && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 font-black flex items-center justify-center text-sm shadow-xs">
                    🛠️
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase">Your Locksmith</div>
                    <div className="text-xs font-extrabold text-slate-900">{job.technician.name}</div>
                  </div>
                </div>

                <a
                  href={`tel:${job.technician.phone}`}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1 shadow-xs"
                >
                  <span>📞</span> Call Tech
                </a>
              </div>
            )}

            {/* Stepper Progression */}
            <div className="mb-6 space-y-4">
              <div className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">
                Service Progression
              </div>

              {STATUS_STEPS.map((step, idx) => {
                const isPast = idx < currentStepIdx;
                const isCurrent = idx === currentStepIdx;

                return (
                  <div key={step.key} className="flex items-start gap-3 relative">
                    {/* Step Icon */}
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 transition ${
                        isPast
                          ? 'bg-emerald-600 text-white'
                          : isCurrent
                          ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {isPast ? '✓' : idx + 1}
                    </div>

                    <div>
                      <div
                        className={`text-xs font-bold ${
                          isCurrent ? 'text-blue-600' : isPast ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      >
                        {step.label}
                      </div>
                      <div className="text-[11px] text-slate-500">{step.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Service Location */}
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-1 mb-5">
              <div className="font-bold text-slate-700">Destination:</div>
              <div className="text-slate-600 flex items-start gap-1">
                <span>📍</span>
                <span>{job.serviceAddress}</span>
              </div>
            </div>

            {/* Invoicing / Payment CTA if ready */}
            {job.invoice && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-slate-800">Total Billed:</span>
                  <span className="text-base font-black text-slate-900">
                    ${job.invoice.grandTotal.toFixed(2)} CAD
                  </span>
                </div>

                {job.invoice.paymentStatus === 'PAID' ? (
                  <div className="text-xs font-black text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-xl text-center">
                    ✓ Paid & Invoiced via {job.invoice.paymentMethod?.replace('_', ' ')}
                  </div>
                ) : (
                  <Link
                    href={`/pay/${job.jobNumber}`}
                    className="block w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs text-center shadow-md transition"
                  >
                    💳 Pay Online Securely with Card &rarr;
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="text-center text-[11px] text-slate-400">
          Auto-refreshing every 5 seconds • LockOps Real-time Tracking
        </div>
      </div>
    </div>
  );
}
