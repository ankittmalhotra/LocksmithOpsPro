'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type TeamMember = { id: string; name: string; phone: string; email?: string | null; role: string; active: boolean; commissionRate?: number; createdAt?: string };

const roles = [
  ['TECHNICIAN', 'Technician'], ['ADMIN', 'Admin'], ['DISPATCHER', 'Dispatcher'], ['ACCOUNTANT', 'Accountant'],
] as const;

export default function AdminTeamClient() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<(typeof roles)[number][0]>('TECHNICIAN');
  const [commission, setCommission] = useState('0.00');
  const [commissionEdits, setCommissionEdits] = useState<Record<string, string>>({});
  const [busyMember, setBusyMember] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/users?activeOnly=false', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load team members');
      setMembers(data.users || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load team members');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/auth/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, password, role, commissionRate: role === 'TECHNICIAN' ? Number(commission) : undefined }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to add team member');
      setName(''); setPhone(''); setEmail(''); setPassword(''); setCommission('0.00');
      setNotice(`${data.user.name} was added as ${roles.find(([key]) => key === data.user.role)?.[1] || data.user.role}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add team member');
    } finally {
      setSaving(false);
    }
  };

  const updateMember = async (member: TeamMember, updates: Record<string, unknown>) => {
    setBusyMember(member.id); setError(''); setNotice('');
    try {
      const response = await fetch('/api/auth/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.id, ...updates }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to update team member');
      setNotice(data.message || 'Team member updated.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update team member');
    } finally { setBusyMember(''); }
  };

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <div className="mb-5"><Link href="/dashboard" className="text-xs font-bold text-blue-700 hover:underline">← Dashboard</Link><p className="mt-3 text-xs font-black uppercase tracking-[0.16em] text-blue-700">Admin tools</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Team management</h1><p className="mt-1 text-sm text-slate-600">Add application profiles, review team status, and manage technician commission rates.</p></div>
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div>}
    {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</div>}
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-base font-black text-slate-900">Add team member</h2>
      <form onSubmit={addMember} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold text-slate-600">Full name<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900" placeholder="Full name" /></label>
        <label className="text-xs font-bold text-slate-600">Phone<input required value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900" placeholder="Primary phone" /></label>
        <label className="text-xs font-bold text-slate-600">Email (optional)<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900" placeholder="member@example.com" /></label>
        <label className="text-xs font-bold text-slate-600">Initial password<input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900" placeholder="At least 8 characters" /></label>
        <label className="text-xs font-bold text-slate-600">Profile<select value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900">{roles.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {role === 'TECHNICIAN' && <label className="text-xs font-bold text-slate-600">Commission rate (%)<input type="number" min="0" max="100" step="0.01" value={commission} onChange={(event) => setCommission(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900" /></label>}
        <div className="flex items-end lg:col-span-2"><button disabled={saving} className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50">{saving ? 'Adding…' : 'Add member'}</button></div>
      </form>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-black text-slate-900">Team roster</h2><p className="text-xs text-slate-500">Technician commission and activation controls use the existing Admin-only team API.</p></div><button onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">Refresh</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr className="border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500"><th className="px-3 py-3">Member</th><th className="px-3 py-3">Profile</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Commission</th><th className="px-3 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{members.map((member) => <tr key={member.id} className="hover:bg-slate-50"><td className="px-3 py-3"><div className="font-bold text-slate-900">{member.name}</div><div className="text-[10px] text-slate-500">{member.phone}{member.email ? ` · ${member.email}` : ''}</div></td><td className="px-3 py-3 font-semibold text-slate-700">{roles.find(([key]) => key === member.role)?.[1] || member.role}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${member.active ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{member.active ? 'Active' : 'Inactive'}</span></td><td className="px-3 py-3">{member.role === 'TECHNICIAN' ? <div className="flex items-center gap-1"><input aria-label={`Commission rate for ${member.name}`} type="number" min="0" max="100" step="0.01" value={commissionEdits[member.id] ?? String(member.commissionRate || 0)} onChange={(event) => setCommissionEdits((current) => ({ ...current, [member.id]: event.target.value }))} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs"/><span>%</span><button disabled={busyMember === member.id} onClick={() => void updateMember(member, { commissionRate: Number(commissionEdits[member.id] ?? member.commissionRate ?? 0) })} className="rounded-lg bg-blue-700 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40">Set</button></div> : <span className="text-slate-400">—</span>}</td><td className="px-3 py-3 text-right">{member.role === 'TECHNICIAN' ? <button disabled={busyMember === member.id} onClick={() => void updateMember(member, { active: !member.active })} className={`rounded-lg px-3 py-2 text-[10px] font-bold disabled:opacity-50 ${member.active ? 'border border-slate-300 bg-white text-slate-700' : 'bg-emerald-700 text-white'}`}>{member.active ? 'Deactivate' : 'Approve / activate'}</button> : <span className="text-[10px] text-slate-400">Profile status is managed separately</span>}</td></tr>)}</tbody></table>{loading && members.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Loading team roster…</p>}{!loading && members.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No team members found.</p>}</div>
    </section>
  </main>;
}
