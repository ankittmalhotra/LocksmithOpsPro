'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type ReceiptVersion = {
  id: string;
  receiptNumber: string;
  voidedAt: string;
  voidReason: string | null;
};

export default function ReceiptAdminControls({
  jobId,
  isAdmin,
  activeReceipt,
  voidedReceipts,
}: {
  jobId: string;
  isAdmin: boolean;
  activeReceipt: { id: string; receiptNumber: string } | null;
  voidedReceipts: ReceiptVersion[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const voidReceipt = async () => {
    if (!activeReceipt || !isAdmin) return;
    const reason = window.prompt(`Why are you voiding receipt ${activeReceipt.receiptNumber}?`);
    if (reason === null) return;
    if (reason.trim().length < 8) {
      setError('Enter a correction reason of at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/receipt/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to void receipt');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to void receipt');
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin && voidedReceipts.length === 0) return null;

  return (
    <section className="mt-5 border-t border-slate-100 pt-4" aria-label="Receipt correction history">
      {isAdmin && activeReceipt && (
        <div>
          <button type="button" disabled={busy} onClick={voidReceipt} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-50">
            {busy ? 'Voiding…' : `Void receipt ${activeReceipt.receiptNumber}`}
          </button>
          <p className="mt-1 text-[11px] text-slate-500">Voiding preserves the original audit copy. Make the correction, then issue a replacement receipt.</p>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
      {voidedReceipts.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-black text-slate-800">Voided receipt history</h3>
          <ul className="mt-2 space-y-2">
            {voidedReceipts.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-600">{receipt.receiptNumber} · {receipt.voidedAt.slice(0, 10)}{receipt.voidReason ? ` · ${receipt.voidReason}` : ''}</span>
                {isAdmin && <a className="font-bold text-blue-700 hover:underline" href={`/api/jobs/${encodeURIComponent(jobId)}/receipt/history?versionId=${encodeURIComponent(receipt.id)}`}>Download voided copy</a>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
