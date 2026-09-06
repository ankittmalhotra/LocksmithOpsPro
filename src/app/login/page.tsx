'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect');

  const [tab, setTab] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');

  // Sign In State
  const [phone, setPhone] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUser, setAdminUser] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // Sign Up State (Contractors only)
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');

  // Status State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Registered staff for quick phone fill
  const [registeredUsers, setRegisteredUsers] = useState<any[]>([]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/auth/users');
      const data = await res.json();
      if (data.success && data.users) {
        setRegisteredUsers(data.users);
      }
    } catch {
      // ignore
    }
  };

  const handleRedirect = (role: string) => {
    if (redirectPath) {
      router.push(redirectPath);
      return;
    }
    if (role === 'SUPER_ADMIN' || role === 'OWNER' || role === 'DISPATCHER') {
      router.push('/dispatch');
    } else {
      router.push('/tech');
    }
  };

  const handlePhoneLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;

    try {
      setLoading(true);
      setErrorMsg('');
      setSuccessMsg('');

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'User with that phone number was not found. Please check your number or sign up below.');
      }

      handleRedirect(data.user.role);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUser || !adminPassword) return;

    try {
      setLoading(true);
      setErrorMsg('');

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUser.trim(), password: adminPassword.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid credentials');
      }

      handleRedirect('SUPER_ADMIN');
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;

    try {
      setLoading(true);
      setErrorMsg('');
      setSuccessMsg('');

      // Contractor registration is submitted with isSelfRegistration = true (pending admin approval)
      const createRes = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.trim(),
          email: newEmail.trim() || undefined,
          isSelfRegistration: true,
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to submit registration');
      }

      // If user was already approved or active, attempt auto sign-in
      if (!createData.pendingApproval) {
        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: newPhone.trim() }),
        });
        const loginData = await loginRes.json();
        if (loginData.success) {
          handleRedirect(loginData.user.role);
          router.refresh();
          return;
        }
      }

      setSuccessMsg(
        '⏳ Registration received! Your contractor account has been submitted and is pending Admin/Owner approval. You will be able to log in once activated.'
      );
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setTab('LOGIN');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex flex-col justify-center items-center px-4 py-8">
      <div className="max-w-md w-full">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 text-white text-2xl shadow-lg mb-2.5">
            🔐
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            LockOps Access Portal
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Sign in with your mobile phone number to access your operations dashboard
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            {successMsg}
          </div>
        )}

        {/* Main Card */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          {/* Segmented Tab Switcher */}
          <div className="flex border-b border-slate-200 bg-slate-50/80 p-1 mb-5">
            <button
              onClick={() => {
                setTab('LOGIN');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`flex-1 py-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 ${
                tab === 'LOGIN'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <span>📱</span> Sign In
            </button>
            <button
              onClick={() => {
                setTab('SIGNUP');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`flex-1 py-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 ${
                tab === 'SIGNUP'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <span>🛠️</span> Register as Technician
            </button>
          </div>

          {/* TAB 1: SIGN IN */}
          {tab === 'LOGIN' && (
            <div>
              {!showAdmin ? (
                <form onSubmit={handlePhoneLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Mobile Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. (647) 555-0100"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-slate-400"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Your registered phone number is your primary key.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !phone.trim()}
                    className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-md transition disabled:opacity-50"
                  >
                    {loading ? 'Verifying & Signing In...' : 'Sign In with Phone →'}
                  </button>

                  {/* Registered Team Members Quick Select (Dev Friendly) */}
                  {registeredUsers.length > 0 && (
                    <div className="pt-3 border-t border-slate-100">
                      <div className="text-[11px] font-bold text-slate-400 mb-2">
                        Quick Fill from Registered Team:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {registeredUsers.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => setPhone(u.phone)}
                            className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700 transition"
                          >
                            {u.name} ({u.role === 'TECHNICIAN' ? 'Tech' : 'Owner/Dispatch'})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setShowAdmin(true)}
                      className="text-[11px] text-slate-400 hover:text-slate-700 underline"
                    >
                      Administrator login
                    </button>
                  </div>
                </form>
              ) : (
                /* Super Admin Form */
                <form onSubmit={handleAdminLogin} className="space-y-3.5">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                    <span className="text-xs font-black text-slate-800 flex items-center gap-1">
                      <span>🛡️</span> Administrator Login
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAdmin(false)}
                      className="text-[11px] text-slate-500 hover:text-slate-800"
                    >
                      ← Back to Phone
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="admin"
                      value={adminUser}
                      onChange={(e) => setAdminUser(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAdminUser('admin');
                        setAdminPassword('admin123');
                      }}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 rounded-xl transition"
                    >
                      Fill Default (admin)
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow transition disabled:opacity-50"
                    >
                      {loading ? 'Signing in...' : 'Sign In as Admin'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 2: SIGN UP - TECHNICIAN ONBOARDING */}
          {tab === 'SIGNUP' && (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs">
                <div className="font-extrabold flex items-center gap-1.5 mb-0.5">
                  <span>🛠️</span> Technician Onboarding
                </div>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  New field locksmith technicians can register here. Once submitted, your account will be reviewed and activated by the Dispatch Manager.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Legal Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Vance"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mobile Phone Number (Primary Key) *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="(647) 555-0199"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  You will use this phone number to sign in and receive live dispatch SMS alerts.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Email Address <span className="text-slate-400 font-normal">(Optional, for dispatch notifications)</span>
                </label>
                <input
                  type="email"
                  placeholder="technician@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                  <span>Role Profile:</span>
                  <span className="bg-slate-200 text-slate-800 px-2 py-0.5 rounded-md font-extrabold text-[10px]">
                    Field Technician
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Note: Owner and Dispatcher profiles are configured internally by administration.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !newName.trim() || !newPhone.trim()}
                className="w-full mt-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? 'Submitting Application...' : 'Submit Technician Registration →'}
              </button>
            </form>
          )}
        </div>

        <div className="text-center mt-6">
          <Link href="/" className="text-xs font-semibold text-slate-500 hover:text-slate-800">
            &larr; Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-xs text-slate-400">Loading portal...</div>}>
      <LoginFormContent />
    </Suspense>
  );
}
