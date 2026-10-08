'use client';

import { useState } from 'react';

export default function PayButton({ token, total }: { token: string; total: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const startPayment = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.paid) {
        window.location.reload();
        return;
      }
      if (!res.ok || !data.success || typeof data.checkoutUrl !== 'string') {
        throw new Error(data.error || 'The card payment page could not be opened. Please try again.');
      }
      window.location.assign(data.checkoutUrl);
    } catch (err: any) {
      setError(err.message || 'The card payment page could not be opened. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="mt-5">
      {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
      <button
        type="button"
        onClick={startPayment}
        disabled={busy}
        className="w-full rounded-2xl bg-blue-600 py-3.5 text-base font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
      >
        {busy ? 'Opening secure payment…' : `Pay ${total} by card`}
      </button>
    </div>
  );
}
