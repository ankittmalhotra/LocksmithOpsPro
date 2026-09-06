'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: 'SUPER_ADMIN' | 'OWNER' | 'DISPATCHER' | 'TECHNICIAN';
}

export default function HomePage() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSession();
  }, []);

  const fetchSession = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success && data.user) {
        setCurrentUser(data.user);
      }
    } catch (err) {
      console.error('Failed to load session:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setCurrentUser(null);
  };

  const isOwnerOrDispatcher =
    currentUser &&
    (currentUser.role === 'OWNER' ||
      currentUser.role === 'DISPATCHER' ||
      currentUser.role === 'SUPER_ADMIN');

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 flex-1 flex flex-col justify-center w-full">
      {/* User Session Banner (If Logged In) */}
      {currentUser && (
        <div className="bg-slate-900 text-white rounded-2xl p-4 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl">
              {isOwnerOrDispatcher ? '📞' : '🛠️'}
            </span>
            <div>
              <div className="text-xs text-slate-400">Signed In As</div>
              <div className="font-extrabold text-sm sm:text-base text-white">
                {currentUser.name}{' '}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/10 text-amber-300 ml-1">
                  {isOwnerOrDispatcher ? 'Owner / Dispatcher' : 'Technician'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Link
              href={isOwnerOrDispatcher ? '/dispatch' : '/tech'}
              className="flex-1 sm:flex-none text-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
            >
              Enter {isOwnerOrDispatcher ? 'Dispatch' : 'Technician'} Workspace &rarr;
            </Link>
            <button
              onClick={handleLogout}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition"
            >
              Logout
            </button>
          </div>
        </div>
      )}

      {/* Main Brand Title */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-900 text-white text-3xl shadow-lg mb-3">
          🔐
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          LockOps Operations Portal
        </h1>
        <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-xl mx-auto">
          Fast incoming call dispatch, instant field technician acknowledgment, and payment settlement.
        </p>
      </div>

      {/* 2 Core User Profile Workspaces */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Profile 1: Owner / Dispatcher */}
        <Link
          href="/dispatch"
          className="group block bg-white rounded-3xl border border-slate-200 hover:border-blue-500 p-7 shadow-xs hover:shadow-lg transition relative"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center text-2xl group-hover:scale-105 transition">
              📞
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200/80">
              Profile 1
            </span>
          </div>
          <h3 className="text-lg font-black text-slate-900 mb-1.5 group-hover:text-blue-600 transition">
            Owner / Dispatcher
          </h3>
          <p className="text-xs text-slate-600 mb-5 leading-relaxed">
            Receive incoming customer phone calls, enter job details, configure technician fixed commissions, assign field staff, and monitor dispatches and settlements.
          </p>
          <div className="text-xs font-black text-blue-600 flex items-center gap-1 group-hover:translate-x-0.5 transition">
            Open Dispatch Desk &rarr;
          </div>
        </Link>

        {/* Profile 2: Technician */}
        <Link
          href="/tech"
          className="group block bg-white rounded-3xl border border-slate-200 hover:border-emerald-500 p-7 shadow-xs hover:shadow-lg transition relative"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center text-2xl group-hover:scale-105 transition">
              🛠️
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/80">
              Profile 2
            </span>
          </div>
          <h3 className="text-lg font-black text-slate-900 mb-1.5 group-hover:text-emerald-600 transition">
            Field Technician
          </h3>
          <p className="text-xs text-slate-600 mb-5 leading-relaxed">
            Receive dispatch alerts, 1-tap acknowledge jobs to notify dispatcher & client, inspect & quote on site, and record payment mode (Cash, Interac, Debit, or Credit).
          </p>
          <div className="text-xs font-black text-emerald-600 flex items-center gap-1 group-hover:translate-x-0.5 transition">
            Open Technician Portal &rarr;
          </div>
        </Link>
      </div>

      {/* Direct Sign-In Link */}
      {!currentUser && (
        <div className="text-center pt-2">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-sm transition"
          >
            <span>📱</span> Sign In with Phone Number &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
