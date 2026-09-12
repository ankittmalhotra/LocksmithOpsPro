'use client';

import { useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginFormContent() {
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect');

  // Unified Credential State
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Status State
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const submittingRef = useRef(false);

  const handleRedirect = (role: string, targetUrl?: string) => {
    let destination = '/tech';
    const requestedDestination = redirectPath || targetUrl;
    if (requestedDestination?.startsWith('/') && !requestedDestination.startsWith('//')) {
      destination = requestedDestination;
    } else if (role === 'ADMIN' || role === 'DISPATCHER') {
      destination = '/dispatch';
    }

    // A full navigation makes the browser send the new session cookie with
    // the destination request. It also avoids leaving the login form stuck
    // when an App Router RSC transition fails or never completes.
    window.location.replace(destination);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || submittingRef.current) return;

    submittingRef.current = true;
    let navigationStarted = false;
    const requestController = new AbortController();
    const requestTimeout = window.setTimeout(() => requestController.abort(), 15_000);

    try {
      setLoading(true);
      setErrorMsg('');

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: requestController.signal,
        body: JSON.stringify({
          identifier: identifier.trim(),
          password: password.trim() || undefined,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : null;
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Authentication service unavailable. Please try again.');
      }

      handleRedirect(data.user.role, data.redirectUrl);
      navigationStarted = true;
    } catch (err: any) {
      setErrorMsg(
        err?.name === 'AbortError'
          ? 'Login request timed out. Please try again.'
          : err.message || 'Authentication service unavailable. Please try again.'
      );
    } finally {
      window.clearTimeout(requestTimeout);
      // Keep the submit guard active while the successful document navigation
      // is in flight.
      if (!navigationStarted) {
        submittingRef.current = false;
        setLoading(false);
      }
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
            Enter your username or phone number and password to enter
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {/* Single Unified Login Box */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Phone Number or Username
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. 647-555-0100 or admin"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-slate-400"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !identifier.trim()}
              className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-md transition disabled:opacity-50"
            >
              {loading ? 'Verifying & Loading Profile...' : 'Sign In →'}
            </button>
          </form>
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
