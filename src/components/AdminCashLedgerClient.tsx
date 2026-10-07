'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type LedgerTech = {
  id: string;
  name: string;
  phone: string;
  active?: boolean;
  commissionRate?: number;
  cashCollected: number;
  commissionsEarned: number;
  totalSettled: number;
  netCashOwedToCompany: number;
  jobsCount: number;
  settlements: Array<{ id?: string; amountSettled: number; settledAt?: string; createdAt?: string; notes?: string | null; paymentMethod?: string }>;
};

function money(value: number) { return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value); }

export default function AdminCashLedgerClient() {
  const [ledger, setLedger] = useState<LedgerTech[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<LedgerTech | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/cash-ledger', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load the cash ledger');
      setLedger(data.ledger || []);
      setUpdatedAt(data.generatedAt || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the cash ledger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openSettlement = (tech: LedgerTech) => {
    setSelected(tech);
    setAmount(Math.max(0, tech.netCashOwedToCompany).toFixed(2));
    setNotes(`Cash handover from ${tech.name}`);
    setError('');
    setNotice('');
  };

  const saveSettlement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/owner/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicianId: selected.id, amountSettled: Number(amount), notes: notes.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to record settlement');
      setSelected(null);
      setNotice(data.message || 'Cash settlement recorded.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to record settlement');
    } finally {
      setSaving(false);
    }
  };

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><Link href="/dashboard" className="text-xs font-bold text-blue-700 hover:underline">← Dashboard</Link><p className="mt-3 text-xs font-black uppercase tracking-[0.16em] text-blue-700">Admin report</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Cash settlement ledger</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">Paid cash jobs, technician commissions, and recorded handovers. Only Admin can view or record settlements.</p></div>
      <button onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh ledger'}</button>
    </div>
    {updatedAt && <p className="mb-3 text-right text-[11px] text-slate-500">Updated {new Date(updatedAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}</p>}
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div>}
    {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</div>}
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[1050px] text-left text-xs">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-500"><th className="px-3 py-3">Technician</th><th className="px-3 py-3">Status / commission</th><th className="px-3 py-3 text-right">Cash collected</th><th className="px-3 py-3 text-right">Commissions earned</th><th className="px-3 py-3 text-right">Settled</th><th className="px-3 py-3 text-right">Net position</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{ledger.map((tech) => <tr key={tech.id} className="align-top hover:bg-slate-50"><td className="px-3 py-3"><div className="font-black text-slate-900">{tech.name}</div><div className="mt-0.5 text-[10px] text-slate-500">{tech.phone} · {tech.jobsCount} jobs</div></td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tech.active === false ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{tech.active === false ? 'Inactive' : 'Active'}</span><div className="mt-1 text-[10px] text-slate-500">{Number(tech.commissionRate || 0).toFixed(2)}% rate</div></td><td className="px-3 py-3 text-right font-semibold text-slate-700">{money(tech.cashCollected)}</td><td className="px-3 py-3 text-right font-semibold text-slate-700">{money(tech.commissionsEarned)}</td><td className="px-3 py-3 text-right font-semibold text-slate-700">{money(tech.totalSettled)}</td><td className="px-3 py-3 text-right font-black text-slate-900"><span className={tech.netCashOwedToCompany > 0 ? 'text-amber-700' : tech.netCashOwedToCompany < 0 ? 'text-blue-700' : 'text-emerald-700'}>{tech.netCashOwedToCompany > 0 ? `Worker owes ${money(tech.netCashOwedToCompany)}` : tech.netCashOwedToCompany < 0 ? `Company owes ${money(Math.abs(tech.netCashOwedToCompany))}` : 'Balanced'}</span></td><td className="px-3 py-3 text-right"><button onClick={() => openSettlement(tech)} className="rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold text-white hover:bg-slate-800">Record handover</button></td></tr>)}
          {ledger.length === 0 && !loading && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-500">No technicians found.</td></tr>}
        </tbody>
      </table>
      {loading && ledger.length === 0 && <p className="p-10 text-center text-sm text-slate-500">Loading cash ledger…</p>}
    </div>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-black text-slate-900">Recent handovers</h2>
      <div className="mt-3 divide-y divide-slate-100">{ledger.flatMap((tech) => tech.settlements.map((settlement, index) => ({ tech, settlement, key: settlement.id || `${tech.id}-${index}` }))).sort((a, b) => new Date(b.settlement.settledAt || b.settlement.createdAt || 0).getTime() - new Date(a.settlement.settledAt || a.settlement.createdAt || 0).getTime()).slice(0, 20).map(({ tech, settlement, key }) => <div key={key} className="flex flex-col gap-1 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"><span className="font-bold text-slate-800">{tech.name} · {money(Number(settlement.amountSettled))}</span><span className="text-slate-500">{settlement.notes || settlement.paymentMethod || 'Cash handover'} · {settlement.settledAt || settlement.createdAt ? new Date(settlement.settledAt || settlement.createdAt!).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) : 'Date unavailable'}</span></div>)}
        {ledger.every((tech) => tech.settlements.length === 0) && <p className="py-4 text-xs text-slate-500">No settlements have been recorded.</p>}
      </div>
    </section>
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={saveSettlement} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-base font-black text-slate-900">Record cash handover</h2><p className="mt-1 text-xs text-slate-500">From {selected.name}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close settlement form" className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">×</button></div><label className="mt-4 block text-xs font-bold text-slate-700">Amount received<input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900" /></label><label className="mt-3 block text-xs font-bold text-slate-700">Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900" /></label>{error && <p role="alert" className="mt-3 text-xs font-semibold text-rose-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setSelected(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">Cancel</button><button disabled={saving} className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Record settlement'}</button></div></form></div>}
  </main>;
}
