'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface UserItem {
  id: string;
  name: string;
  phone: string;
  role: 'OWNER' | 'DISPATCHER' | 'TECHNICIAN';
  email: string | null;
}

export default function LoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/auth/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const handleLoginUser = async (user: UserItem) => {
    try {
      setLoading(true);
      setErrorMsg('');

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Login failed');
      }

      // Redirect based on role
      if (user.role === 'OWNER') {
        router.push('/owner');
      } else if (user.role === 'DISPATCHER') {
        router.push('/dispatch');
      } else {
        router.push('/tech');
      }
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;

    try {
      setLoading(true);
      setErrorMsg('');

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'User with that phone number not found');
      }

      if (data.user.role === 'OWNER') {
        router.push('/owner');
      } else if (data.user.role === 'DISPATCHER') {
        router.push('/dispatch');
      } else {
        router.push('/tech');
      }
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col justify-center items-center px-4 py-12">
      <div className="max-w-md w-full">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-900 text-white text-3xl shadow-lg mb-3">
            🔐
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            LockOps Access Portal
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Secure Role-Based Authentication for Locksmith Operations
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {/* 1. Fast Team Sign-In (Categorized by 2 Roles: Owner & Contractor) */}
        <div className="space-y-4 mb-6">
          {/* Owners Section */}
          <div className="bg-white rounded-3xl border border-purple-200/80 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-black uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                <span>👑</span> Owner Login ({users.filter(u => u.role === 'OWNER').length})
              </h2>
              <span className="text-[10px] text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded-full">
                Full Business Hub & Settlements
              </span>
            </div>

            <div className="space-y-2">
              {users
                .filter((u) => u.role === 'OWNER')
                .map((u) => (
                  <button
                    key={u.id}
                    disabled={loading}
                    onClick={() => handleLoginUser(u)}
                    className="w-full text-left p-3 rounded-2xl border border-purple-100 hover:border-purple-300 hover:bg-purple-50/60 transition flex items-center justify-between group active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-black">
                        👑
                      </span>
                      <div>
                        <div className="font-bold text-xs text-slate-900 group-hover:text-purple-700 transition">
                          {u.name}
                        </div>
                        <div className="text-[10px] text-slate-400">{u.phone}</div>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-purple-700 bg-white px-2.5 py-1 rounded-lg border border-purple-200 shadow-xs">
                      Sign In &rarr;
                    </span>
                  </button>
                ))}

              {users.filter((u) => u.role === 'OWNER').length === 0 && (
                <div className="text-xs text-slate-400 italic py-2 text-center">
                  Loading owners...
                </div>
              )}
            </div>
          </div>

          {/* Contractors Section */}
          <div className="bg-white rounded-3xl border border-emerald-200/80 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-black uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                <span>🛠️</span> Contractor Login ({users.filter(u => u.role === 'TECHNICIAN' || (u.role as any) === 'CONTRACTOR').length})
              </h2>
              <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                Mobile Field & Invoicing
              </span>
            </div>

            <div className="space-y-2">
              {users
                .filter((u) => u.role === 'TECHNICIAN' || (u.role as any) === 'CONTRACTOR')
                .map((u) => (
                  <button
                    key={u.id}
                    disabled={loading}
                    onClick={() => handleLoginUser(u)}
                    className="w-full text-left p-3 rounded-2xl border border-emerald-100 hover:border-emerald-300 hover:bg-emerald-50/60 transition flex items-center justify-between group active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-black">
                        🛠️
                      </span>
                      <div>
                        <div className="font-bold text-xs text-slate-900 group-hover:text-emerald-700 transition">
                          {u.name}
                        </div>
                        <div className="text-[10px] text-slate-400">{u.phone}</div>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-700 bg-white px-2.5 py-1 rounded-lg border border-emerald-200 shadow-xs">
                      Sign In &rarr;
                    </span>
                  </button>
                ))}

              {users.filter((u) => u.role === 'TECHNICIAN' || (u.role as any) === 'CONTRACTOR').length === 0 && (
                <div className="text-xs text-slate-400 italic py-2 text-center">
                  Loading contractors...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Direct Phone Login */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-1">
            Sign In with Any Phone Number
          </h2>
          <p className="text-[11px] text-slate-400 mb-3">
            Enter your registered owner or contractor mobile number.
          </p>

          <form onSubmit={handlePhoneLogin} className="space-y-3">
            <input
              type="text"
              placeholder="(647) 555-0301"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />

            <button
              type="submit"
              disabled={loading || !phone}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow transition disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <div className="text-center mt-6">
          <Link href="/" className="text-xs font-bold text-slate-500 hover:text-slate-800">
            &larr; Return to Home & Open Jobs
          </Link>
        </div>

      </div>
    </div>
  );
}
