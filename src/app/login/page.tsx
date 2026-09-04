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

        {/* Fast 1-Tap Team Login */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm mb-6">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">
            Select Team Member (1-Tap Login)
          </h2>

          <div className="space-y-2">
            {users.map((u) => {
              const roleBadgeColor =
                u.role === 'OWNER'
                  ? 'bg-purple-100 text-purple-800 border-purple-200'
                  : u.role === 'DISPATCHER'
                  ? 'bg-blue-100 text-blue-800 border-blue-200'
                  : 'bg-emerald-100 text-emerald-800 border-emerald-200';

              const roleEmoji =
                u.role === 'OWNER' ? '👑' : u.role === 'DISPATCHER' ? '📞' : '🛠️';

              return (
                <button
                  key={u.id}
                  disabled={loading}
                  onClick={() => handleLoginUser(u)}
                  className="w-full text-left p-3 rounded-2xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 transition flex items-center justify-between group active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{roleEmoji}</span>
                    <div>
                      <div className="font-bold text-xs text-slate-900 group-hover:text-blue-600 transition">
                        {u.name}
                      </div>
                      <div className="text-[10px] text-slate-400">{u.phone}</div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${roleBadgeColor}`}
                  >
                    {u.role}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Manual Phone Number Login Form */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">
            Or Login with Phone Number
          </h2>

          <form onSubmit={handlePhoneLogin} className="space-y-3">
            <div>
              <input
                type="text"
                placeholder="(647) 555-0301"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !phone}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow transition disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Sign In & Enter'}
            </button>
          </form>
        </div>

        <div className="text-center mt-6">
          <Link href="/" className="text-xs font-bold text-slate-500 hover:text-slate-800">
            &larr; Return to Home & Open Jobs Board
          </Link>
        </div>
      </div>
    </div>
  );
}
