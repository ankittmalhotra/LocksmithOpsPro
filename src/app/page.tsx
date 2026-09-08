'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { AppRole } from '@/lib/session';

interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: AppRole;
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

  const isAdminOrDispatcher =
    currentUser &&
    (currentUser.role === 'ADMIN' ||
      currentUser.role === 'DISPATCHER');

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 flex-1 flex flex-col justify-center w-full">
      {/* User Session Banner (If Logged In) */}
      {currentUser && (
        <div className="bg-slate-900 text-white rounded-2xl p-4 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl">
              {isAdminOrDispatcher ? '📞' : '🛠️'}
            </span>
            <div>
              <div className="text-xs text-slate-400">Signed In As</div>
              <div className="font-extrabold text-sm sm:text-base text-white">
                {currentUser.name}{' '}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/10 text-amber-300 ml-1">
                  {isAdminOrDispatcher ? 'Admin / Dispatcher' : 'Technician'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Link
              href={isAdminOrDispatcher ? '/dispatch' : '/tech'}
              className="flex-1 sm:flex-none text-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
            >
              Enter {isAdminOrDispatcher ? 'Dispatch' : 'Technician'} Workspace &rarr;
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

      {/* 2 Core Workspaces */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Admin / Dispatcher */}
        <Link
          href="/dispatch"
          className="group block bg-white rounded-3xl border border-slate-200 hover:border-blue-500 p-7 shadow-xs hover:shadow-lg transition relative"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center text-2xl group-hover:scale-105 transition">
              📞
            </div>
          </div>
          <h3 className="text-lg font-black text-slate-900 mb-1.5 group-hover:text-blue-600 transition">
            Admin / Dispatcher
          </h3>
          <p className="text-xs text-slate-600 mb-5 leading-relaxed">
            Receive incoming calls, assign jobs, configure technician commissions, and manage dispatches & settlements.
          </p>
          <div className="text-xs font-black text-blue-600 flex items-center gap-1 group-hover:translate-x-0.5 transition">
            Open Dispatch Desk &rarr;
          </div>
        </Link>

        {/* Technician */}
        <Link
          href="/tech"
          className="group block bg-white rounded-3xl border border-slate-200 hover:border-emerald-500 p-7 shadow-xs hover:shadow-lg transition relative"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center text-2xl group-hover:scale-105 transition">
              🛠️
            </div>
          </div>
          <h3 className="text-lg font-black text-slate-900 mb-1.5 group-hover:text-emerald-600 transition">
            Technician
          </h3>
          <p className="text-xs text-slate-600 mb-5 leading-relaxed">
            Receive jobs, 1-tap acknowledge dispatches, inspect & quote on site, and record payment mode.
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
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-sm transition"
          >
            <span>🔐</span> Sign In to Account &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
