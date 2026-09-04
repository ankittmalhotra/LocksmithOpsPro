'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

interface UserSession {
  id: string;
  name: string;
  phone: string;
  role: 'OWNER' | 'DISPATCHER' | 'TECHNICIAN';
}

export default function NavigationHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, [pathname]);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-50 bg-slate-900 text-white shadow-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Tax Badge */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">🔐</span>
            <span className="font-extrabold text-lg tracking-tight">LockOps Pro</span>
          </Link>
          <span className="text-[11px] bg-amber-500/20 text-amber-300 font-bold px-2.5 py-0.5 rounded-full border border-amber-500/30">
            Ontario (13% HST)
          </span>
        </div>

        {/* Navigation Links based on Role */}
        <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-semibold">
          {/* Universal Workspaces */}
          {(!user || user.role === 'OWNER' || user.role === 'DISPATCHER') && (
            <Link
              href="/dispatch"
              className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                pathname === '/dispatch'
                  ? 'bg-blue-600 text-white font-bold'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200'
              }`}
            >
              <span>📞</span>
              <span>Dispatch</span>
            </Link>
          )}

          {(!user || user.role === 'OWNER' || user.role === 'DISPATCHER' || user.role === 'TECHNICIAN') && (
            <Link
              href="/tech"
              className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                pathname.startsWith('/tech')
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200'
              }`}
            >
              <span>📱</span>
              <span>Tech Mobile</span>
            </Link>
          )}

          {(!user || user.role === 'OWNER') && (
            <Link
              href="/owner"
              className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                pathname === '/owner'
                  ? 'bg-purple-600 text-white font-bold'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200'
              }`}
            >
              <span>📊</span>
              <span>Owner Hub</span>
            </Link>
          )}

          {/* User Profile / Login Button */}
          {user ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-700">
              <span className="text-xs text-slate-300 font-bold hidden md:inline">
                {user.name.split(' ')[0]} (
                <span className="text-amber-400 text-[11px]">{user.role}</span>)
              </span>
              <button
                onClick={handleLogout}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 text-xs font-bold transition border border-slate-700"
              >
                Logout
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black transition shadow"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
