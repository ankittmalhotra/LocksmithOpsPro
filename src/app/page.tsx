'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ActiveJob {
  id: string;
  jobNumber: number;
  serviceType: string;
  serviceAddress: string;
  problemDescription: string;
  workerCommission: number;
  status: string;
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
}

interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: 'OWNER' | 'DISPATCHER' | 'TECHNICIAN';
}

export default function HomePage() {
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      // 1. Fetch user session
      const authRes = await fetch('/api/auth/me');
      const authData = await authRes.json();
      if (authData.success && authData.user) {
        setCurrentUser(authData.user);
      }

      // 2. Fetch jobs
      const jobsRes = await fetch('/api/jobs');
      const jobsData = await jobsRes.json();
      if (jobsData.success) {
        const open = jobsData.jobs.filter((j: any) =>
          ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(j.status)
        );
        setActiveJobs(open);
      }
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setCurrentUser(null);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 flex-1 flex flex-col justify-center w-full">
      {/* User Session Banner (If Logged In) */}
      {currentUser ? (
        <div className="bg-slate-900 text-white rounded-2xl p-4 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl">
              {currentUser.role === 'OWNER'
                ? '👑'
                : currentUser.role === 'DISPATCHER'
                ? '📞'
                : '🛠️'}
            </span>
            <div>
              <div className="text-xs text-slate-400">Authenticated Session</div>
              <div className="font-extrabold text-sm sm:text-base text-white">
                {currentUser.name}{' '}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/10 text-amber-300 ml-1">
                  {currentUser.role}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Link
              href={
                currentUser.role === 'OWNER'
                  ? '/owner'
                  : currentUser.role === 'DISPATCHER'
                  ? '/dispatch'
                  : '/tech'
              }
              className="flex-1 sm:flex-none text-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
            >
              Go to {currentUser.role} Workspace &rarr;
            </Link>
            <button
              onClick={handleLogout}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition"
            >
              Logout
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-r from-blue-900 to-indigo-950 text-white rounded-2xl p-4 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔒</span>
            <div>
              <div className="font-black text-sm text-white">Guest View Mode</div>
              <div className="text-xs text-blue-200">
                Displaying live open jobs. Sign in to access your role-specific console.
              </div>
            </div>
          </div>
          <Link
            href="/login"
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-black transition shadow"
          >
            🔑 Team Login (1-Tap) &rarr;
          </Link>
        </div>
      )}

      {/* Main Title */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500 text-white text-3xl shadow-lg mb-3">
          🔐
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Locksmith Operations Management
        </h1>
        <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-2xl mx-auto">
          Automated operations platform replacing WhatsApp: Fast call intake, Twilio SMS dispatch, Ontario 13% HST calculations, Stripe card links with 4% surcharge, and contractor cash reconciliation.
        </p>
      </div>

      {/* LIVE OPEN JOBS SECTION - Displayed Prominently */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <span>🔑</span> Live Open Jobs ({activeJobs.length})
          </h2>
          <span className="text-xs text-slate-500 font-medium">
            Real-time active field dispatches
          </span>
        </div>

        {loading ? (
          <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center text-slate-400 text-xs">
            Loading open jobs...
          </div>
        ) : activeJobs.length === 0 ? (
          <div className="p-8 bg-white rounded-2xl border border-dashed border-slate-300 text-center text-slate-500 text-sm">
            No open jobs right now. All caught up!
          </div>
        ) : (
          <div className="space-y-3">
            {activeJobs.map((job) => {
              const techName = job.technician?.name || 'Unassigned';
              const techFirstName = techName.split(' ')[0] || 'Tech';
              const extStr = job.customer.extension ? ` #${job.customer.extension}` : '';

              return (
                <div
                  key={job.id}
                  className="bg-amber-50/80 hover:bg-amber-50 border-2 border-amber-300/80 hover:border-amber-400 rounded-2xl p-4 sm:p-5 shadow-xs transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="font-extrabold text-slate-900 text-sm sm:text-base flex flex-wrap items-center gap-1.5">
                      <span>🔑</span>
                      <span>
                        Active Job #{job.jobNumber} - {job.serviceAddress} ({job.serviceType})
                      </span>
                    </div>

                    <div className="text-xs sm:text-sm text-slate-700">
                      Assigned to <strong className="text-slate-900">{techName}</strong> •
                      Customer: <strong className="text-slate-900">{job.customer.name}</strong> ({job.customer.phone}
                      {extStr}) • Commission:{' '}
                      <strong className="text-emerald-700 font-extrabold">
                        ${job.workerCommission.toFixed(2)}
                      </strong>
                    </div>

                    {job.problemDescription && (
                      <div className="text-xs text-slate-500 italic line-clamp-1 pt-0.5">
                        "{job.problemDescription}"
                      </div>
                    )}
                  </div>

                  <div className="w-full sm:w-auto shrink-0">
                    <Link
                      href={`/tech/jobs/${job.jobNumber}`}
                      className="inline-flex items-center justify-center w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs sm:text-sm shadow-sm hover:shadow transition"
                    >
                      Open Job as {techFirstName} &rarr;
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Role Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* 1. Dispatcher Portal */}
        <Link
          href="/dispatch"
          className="group block bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md hover:border-blue-500 transition relative overflow-hidden"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-2xl mb-4 group-hover:scale-105 transition">
            📞
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition">
            Call Intake & Dispatch
          </h3>
          <p className="text-xs text-slate-600 mb-4 leading-relaxed">
            Rapid job logging from client calls. Enter customer details, extension, location, problem notes, and assign worker commission with auto-dispatch via Twilio SMS.
          </p>
          <div className="text-xs font-semibold text-blue-600 flex items-center gap-1">
            Open Dispatch Desk &rarr;
          </div>
        </Link>

        {/* 2. Field Technician Mobile Portal */}
        <Link
          href="/tech"
          className="group block bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md hover:border-emerald-500 transition relative overflow-hidden"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl mb-4 group-hover:scale-105 transition">
            📱
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-emerald-600 transition">
            Technician Mobile App
          </h3>
          <p className="text-xs text-slate-600 mb-4 leading-relaxed">
            Mobile-optimized for workers on site. 1-tap navigation, reverse/forward 13% HST billing, $20/$25 abandoned travel charge, cash collection, and Stripe SMS toggle.
          </p>
          <div className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
            Open Field Technician View &rarr;
          </div>
        </Link>

        {/* 3. Owner Dashboard */}
        <Link
          href="/owner"
          className="group block bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md hover:border-purple-500 transition relative overflow-hidden"
        >
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-2xl mb-4 group-hover:scale-105 transition">
            📊
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-purple-600 transition">
            Owner Hub & Settlements
          </h3>
          <p className="text-xs text-slate-600 mb-4 leading-relaxed">
            Real-time business performance. Track revenue (Cash vs Stripe vs Interac), Ontario HST for CRA, and live worker cash-in-hand reconciliation with 1-click handover settlements.
          </p>
          <div className="text-xs font-semibold text-purple-600 flex items-center gap-1">
            Open Executive Dashboard &rarr;
          </div>
        </Link>
      </div>
    </div>
  );
}
