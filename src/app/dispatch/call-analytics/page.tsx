'use client';

import { useEffect, useState } from 'react';
import RingCentralCallAnalytics from '@/components/RingCentralCallAnalytics';

export default function CallAnalyticsPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (active) setIsAdmin(Boolean(data.success && data.user?.role === 'ADMIN'));
      })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <h1 className="text-2xl font-black tracking-tight text-slate-950">Call Analytics</h1>
        <p className="mt-1 text-sm text-slate-600">See when calls arrive and compare call demand with completed jobs.</p>
      </div>
      {ready ? <RingCentralCallAnalytics canManageConnection={isAdmin} refreshOnLoad /> : <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading call analytics…</div>}
    </main>
  );
}
