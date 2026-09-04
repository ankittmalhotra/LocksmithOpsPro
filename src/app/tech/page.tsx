'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Job {
  id: string;
  jobNumber: number;
  serviceType: string;
  serviceAddress: string;
  problemDescription: string;
  workerCommission: number;
  status: string;
  createdAt: string;
  customer: {
    name: string;
    phone: string;
    extension?: string;
  };
  technician?: {
    id: string;
    name: string;
    phone: string;
  };
  invoice?: {
    grandTotal: number;
    paymentStatus: string;
    paymentMethod: string;
  };
}

export default function TechJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTech, setSelectedTech] = useState('Dave Miller');
  const [techList, setTechList] = useState<any[]>([]);

  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const authRes = await fetch('/api/auth/me');
      const authData = await authRes.json();
      if (authData.success && authData.user) {
        setCurrentUser(authData.user);
        if (authData.user.role === 'TECHNICIAN') {
          setSelectedTech(authData.user.name);
        }
      }

      const res = await fetch('/api/jobs');
      const data = await res.json();
      if (data.success) {
        setJobs(data.jobs);
        const techs = data.jobs
          .map((j: any) => j.technician)
          .filter((t: any) => t !== null && t !== undefined);
        const uniqueTechs = Array.from(new Map(techs.map((t: any) => [t.id, t])).values());
        setTechList(uniqueTechs);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter jobs for selected tech
  const techJobs = jobs.filter((j) => (j.technician?.name || 'Dave Miller') === selectedTech);
  const activeJobs = techJobs.filter((j) =>
    ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(j.status)
  );
  const pastJobs = techJobs.filter(
    (j) => !['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(j.status)
  );

  return (
    <div className="max-w-md mx-auto px-4 py-5 w-full">
      {/* Worker Header Card */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-lg mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-500 text-white font-black text-xl flex items-center justify-center shadow">
            🛠️
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Technician Portal</div>
            <select
              value={selectedTech}
              onChange={(e) => setSelectedTech(e.target.value)}
              className="bg-transparent text-white font-bold text-base focus:outline-none cursor-pointer border-b border-dashed border-slate-600"
            >
              <option value="Dave Miller" className="text-slate-900">
                Dave Miller (Tech 1)
              </option>
              <option value="Sam Chen" className="text-slate-900">
                Sam Chen (Tech 2)
              </option>
            </select>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[11px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold px-2 py-0.5 rounded-full">
            Online
          </span>
        </div>
      </div>

      {/* Active Jobs Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <span>🚨</span> Active Jobs ({activeJobs.length})
          </h2>
        </div>

        {loading ? (
          <div className="text-center py-8 text-slate-400 text-sm">Loading jobs...</div>
        ) : activeJobs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-sm">
            No active jobs in your queue. Enjoy the break!
          </div>
        ) : (
          <div className="space-y-3">
            {activeJobs.map((job) => (
              <Link
                key={job.id}
                href={`/tech/jobs/${job.jobNumber}`}
                className="block bg-white rounded-2xl border-2 border-emerald-500/40 p-4 shadow-sm hover:shadow-md transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                      JOB #{job.jobNumber}
                    </span>
                    <h3 className="font-extrabold text-base text-slate-900 mt-1">
                      {job.serviceType}
                    </h3>
                  </div>
                  <span className="text-xs font-bold uppercase px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                    {job.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="text-xs text-slate-700 font-medium flex items-start gap-1.5 mb-2">
                  <span className="text-slate-400 shrink-0">📍</span>
                  <span className="line-clamp-1">{job.serviceAddress}</span>
                </div>

                <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-xl mb-3 border border-slate-100">
                  <span className="font-semibold text-slate-800">{job.customer.name}</span>
                  <span className="text-slate-500">
                    {' '}
                    • {job.customer.phone}
                    {job.customer.extension ? ` #${job.customer.extension}` : ''}
                  </span>
                  <div className="italic text-slate-500 mt-0.5 line-clamp-1">
                    "{job.problemDescription || 'No additional notes'}"
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                  <div className="text-xs font-bold text-emerald-700">
                    Your Commission: ${job.workerCommission.toFixed(2)}
                  </div>
                  <span className="text-xs font-black text-blue-600 flex items-center gap-1">
                    Open Job &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Completed / Past Jobs Section */}
      <div>
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-3 flex items-center gap-1.5">
          <span>✅</span> Completed Today ({pastJobs.length})
        </h2>

        <div className="space-y-2">
          {pastJobs.map((job) => (
            <Link
              key={job.id}
              href={`/tech/jobs/${job.jobNumber}`}
              className="block bg-white rounded-xl border border-slate-200 p-3 shadow-xs hover:border-slate-300 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-xs text-slate-900">
                    #{job.jobNumber} • {job.customer.name}
                  </div>
                  <div className="text-[11px] text-slate-500">{job.serviceType}</div>
                </div>

                <div className="text-right">
                  {job.invoice && (
                    <div className="font-extrabold text-xs text-slate-900">
                      ${job.invoice.grandTotal.toFixed(2)}
                    </div>
                  )}
                  <div className="text-[10px] font-bold text-emerald-600 uppercase">
                    Comm: ${job.workerCommission.toFixed(2)}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
