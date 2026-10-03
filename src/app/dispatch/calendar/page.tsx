'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, UserRound } from 'lucide-react';
import { buildCalendarActivity } from '@/lib/calendar-activity';
import { formatTorontoDateInput } from '@/lib/timezone';

type DispatchJob = {
  id: string; jobNumber: string; serviceType: string; serviceAddress: string; status: string;
  isScheduled?: boolean; scheduledFor?: string | null; customer?: { name: string }; technician?: { name: string } | null;
  completedAt?: string | null; createdAt?: string | null;
  workerCommission?: number | string | null;
  items?: Array<{ isPart?: boolean; unitCost?: number | string | null; quantity?: number | string | null }>;
  invoice?: { paymentStatus?: string | null; paidAt?: string | null; grandTotal?: number | string | null; taxAmount?: number | string | null; taxCollected?: boolean | null; cogsAmount?: number | string | null } | null;
};

const ACTIVE = new Set(['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS']);
const torontoDateKey = formatTorontoDateInput;
const monthTitle = (date: Date) => new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
const dayNumber = (date: Date) => date.getUTCDate();
const timeLabel = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const money = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
const compactMoney = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
const netMoney = (value: number | null | undefined) => typeof value === 'number' ? money(value) : 'Not synced';
const compactNetMoney = (value: number | null | undefined) => typeof value === 'number' ? compactMoney(value) : '—';

function calendarDate(key: string) {
  return new Date(`${key}T12:00:00.000Z`);
}

function shiftMonth(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1, 12));
}

export default function DispatchCalendarPage() {
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adSpendByDate, setAdSpendByDate] = useState<Map<string, number>>(new Map());
  const [month, setMonth] = useState(() => calendarDate(torontoDateKey(new Date())));
  const [selectedDay, setSelectedDay] = useState(() => torontoDateKey(new Date()));

  useEffect(() => {
    fetch('/api/jobs', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load appointments.');
      setJobs(data.jobs || []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load appointments.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => setIsAdmin(data.success && data.user?.role === 'ADMIN'))
      .catch(() => setIsAdmin(false));
  }, []);

  const appointments = useMemo(() => jobs.filter((job) => job.isScheduled && job.scheduledFor && ACTIVE.has(job.status)), [jobs]);
  const activity = useMemo(() => buildCalendarActivity(jobs, isAdmin ? adSpendByDate : new Map()), [jobs, isAdmin, adSpendByDate]);
  const grouped = useMemo(() => {
    const map = new Map<string, DispatchJob[]>();
    for (const job of appointments) {
      const key = torontoDateKey(job.scheduledFor!);
      map.set(key, [...(map.get(key) || []), job]);
    }
    for (const entries of map.values()) entries.sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());
    return map;
  }, [appointments]);

  const cells = useMemo(() => {
    const first = shiftMonth(month, 0);
    const start = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 - first.getUTCDay(), 12));
    return Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index, 12)));
  }, [month]);
  const activityRange = useMemo(() => ({
    from: cells[0]?.toISOString().slice(0, 10) || '',
    to: cells[cells.length - 1]?.toISOString().slice(0, 10) || '',
  }), [cells]);

  useEffect(() => {
    if (!isAdmin || !activityRange.from || !activityRange.to) return;
    setAdSpendByDate(new Map());
    fetch(`/api/owner/calendar-ad-spend?from=${activityRange.from}&to=${activityRange.to}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load ad spend.');
        setAdSpendByDate(new Map<string, number>(Object.entries(data.spendByDate || {}).map(([date, spend]) => [date, Number(spend)] as [string, number])));
      })
      .catch(() => setAdSpendByDate(new Map()));
  }, [isAdmin, activityRange]);
  const todayKey = torontoDateKey(new Date());
  const monthKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthAppointments = appointments.filter((job) => torontoDateKey(job.scheduledFor!).startsWith(monthKey)).length;
  const selectedActivity = activity.get(selectedDay);
  const selectedJobs = grouped.get(selectedDay) || [];
  const unscheduled = jobs.filter((job) => ACTIVE.has(job.status) && !job.isScheduled);
  const showSelectedActivity = selectedDay <= todayKey;

  function navigateMonth(amount: number) {
    const next = shiftMonth(month, amount);
    setMonth(next);
    setSelectedDay(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Dispatch activity</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Calendar</h1><p className="mt-1 text-sm text-slate-500">Booked work, completed jobs, and paid revenue by Toronto day{isAdmin ? ', with profit after synced Ads spend.' : '.'}</p></div>
        <Link href="/dispatch" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">Open dispatch desk</Link>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-4 sm:px-5">
            <div><h2 className="text-lg font-black text-slate-900">{monthTitle(month)}</h2><p className="mt-0.5 text-xs text-slate-500">{monthAppointments} active appointment{monthAppointments === 1 ? '' : 's'} this month</p></div>
            <div className="flex items-center gap-1">
              <button onClick={() => navigateMonth(-1)} aria-label="Previous month" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><ChevronLeft size={17} /></button>
              <button onClick={() => { setMonth(calendarDate(todayKey)); setSelectedDay(todayKey); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Today</button>
              <button onClick={() => navigateMonth(1)} aria-label="Next month" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><ChevronRight size={17} /></button>
            </div>
          </header>
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="px-1 py-2 text-center text-[10px] font-black uppercase tracking-wide text-slate-500 sm:text-xs">{day}</div>)}</div>
          {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading calendar…</div> : error ? <div className="p-10 text-center text-sm text-slate-500">Calendar activity is unavailable.</div> : (
            <div className="grid grid-cols-7">
              {cells.map((date) => {
                const key = date.toISOString().slice(0, 10);
                const isCurrentMonth = date.getUTCMonth() === month.getUTCMonth();
                const isToday = key === todayKey;
                const isSelected = key === selectedDay;
                const count = grouped.get(key)?.length || 0;
                const dayActivity = activity.get(key);
                const showActivity = key <= todayKey;
                return <button key={key} onClick={() => { setSelectedDay(key); if (!isCurrentMonth) setMonth(date); }} aria-label={`${key}: ${showActivity ? `${dayActivity?.completedJobs.length || 0} completed jobs, ${money(Number(dayActivity?.revenue || 0))} paid revenue${isAdmin ? `, ${dayActivity?.profit === null || dayActivity?.profit === undefined ? 'Ads not synced' : `${money(dayActivity.profit)} net profit`}` : ''}, ` : ''}${count} active appointments`} className={`min-h-[92px] border-b border-r border-slate-100 p-1 text-left transition sm:min-h-[118px] sm:p-2 ${isSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-500' : 'hover:bg-slate-50'} ${!isCurrentMonth ? 'text-slate-400' : 'text-slate-800'}`}>
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${isToday ? 'bg-blue-700 text-white' : ''}`}>{dayNumber(date)}</span>
                  {showActivity && <div className="mt-1 space-y-0.5 text-[9px] font-bold leading-tight sm:text-[11px]"><p className="truncate text-emerald-800">{dayActivity?.completedJobs.length || 0} completed</p><p className="truncate text-slate-700">{compactMoney(Number(dayActivity?.revenue || 0))}</p>{isAdmin && <p className="truncate text-amber-800">Net {compactNetMoney(dayActivity?.profit)}</p>}</div>}
                  {count > 0 && <div className="mt-1.5 space-y-1">{grouped.get(key)!.slice(0, showActivity ? 1 : 2).map((job) => <div key={job.id} className="truncate rounded-md bg-violet-100 px-1 py-1 text-[9px] font-bold text-violet-800 sm:px-1.5 sm:text-[10px]">{timeLabel(job.scheduledFor!)} · #{job.jobNumber}</div>)}{count > (showActivity ? 1 : 2) && <p className="px-1 text-[9px] font-bold text-slate-500">+{count - (showActivity ? 1 : 2)} more</p>}</div>}
                </button>;
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-4 px-4 py-3 text-[11px] font-semibold text-slate-500"><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-violet-300" />Appointment</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />Completed jobs</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue-700" />Today</span><span>Revenue = paid invoices, including tax</span>{isAdmin && <><span>Net profit = gross revenue − HST − parts − commission − Ads spend</span><span>— = Ads not synced</span></>}</div>
        </section>

        {!error && !loading && <aside className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center gap-2"><CalendarDays className="text-blue-700" size={18} /><h2 className="font-black text-slate-900">{new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${selectedDay}T12:00:00Z`))}</h2></div>
            {showSelectedActivity && <div className={`mb-5 grid gap-2 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}><div className="rounded-xl bg-emerald-50 p-3"><p className="text-[11px] font-bold text-emerald-800">Jobs completed</p><p className="mt-1 text-xl font-black text-emerald-950">{selectedActivity?.completedJobs.length || 0}</p></div><div className="rounded-xl bg-blue-50 p-3"><p className="text-[11px] font-bold text-blue-800">Paid revenue</p><p className="mt-1 text-lg font-black text-blue-950">{money(Number(selectedActivity?.revenue || 0))}</p></div>{isAdmin && <div className="rounded-xl bg-amber-50 p-3"><p className="text-[11px] font-bold text-amber-800">Net profit after Ads</p><p className="mt-1 text-sm font-black text-amber-950">{netMoney(selectedActivity?.profit)}</p></div>}</div>}
            {showSelectedActivity && <div className="mb-5"><h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-600">Completed jobs</h3>{selectedActivity?.completedJobs.length ? <div className="space-y-2">{selectedActivity.completedJobs.map((job) => <Link key={job.id} href={`/dispatch/jobs/${job.id}`} className="block rounded-lg border border-slate-200 p-2.5 text-xs hover:border-emerald-300 hover:bg-emerald-50/40"><span className="font-black text-slate-900">#{job.jobNumber}</span><span className="ml-1 text-slate-600">· {job.customer?.name || 'Customer'} · {job.serviceType}</span></Link>)}</div> : <p className="text-xs text-slate-500">No jobs completed on this day.</p>}</div>}
            {showSelectedActivity && !!selectedActivity?.paidJobs.length && <div className="mb-5"><h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-600">Revenue received</h3><div className="space-y-2">{selectedActivity.paidJobs.map((job) => <Link key={job.id} href={`/dispatch/jobs/${job.id}`} className="flex justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-xs hover:border-blue-300 hover:bg-blue-50/40"><span className="font-bold text-slate-800">#{job.jobNumber} · {job.customer?.name || 'Customer'}</span><span className="shrink-0 font-black text-slate-900">{money(job.invoice?.grandTotal || 0)}</span></Link>)}</div></div>}
            <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-600">Active appointments</h3>
            {selectedJobs.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No appointments on this day.</p> : <div className="space-y-3">{selectedJobs.map((job) => <Link href={`/dispatch/jobs/${job.id}`} key={job.id} className="block rounded-xl border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/40">
              <div className="flex items-start justify-between gap-2"><span className="text-sm font-black text-slate-900">{timeLabel(job.scheduledFor!)} · #{job.jobNumber}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-600">{job.status.replaceAll('_', ' ')}</span></div>
              <p className="mt-1 text-xs font-semibold text-slate-700">{job.customer?.name || 'Customer'} · {job.serviceType}</p>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500"><MapPin size={14} className="mt-0.5 shrink-0" />{job.serviceAddress}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><UserRound size={14} />{job.technician?.name || 'Unassigned'}</p>
            </Link>)}</div>}
          </section>
          <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-black text-slate-900">Active, unscheduled</h2><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900">{unscheduled.length}</span></div>
            <p className="mb-3 text-xs leading-5 text-slate-600">These jobs are open but don’t have an appointment time.</p>
            <div className="max-h-64 space-y-2 overflow-y-auto">{unscheduled.slice(0, 12).map((job) => <Link key={job.id} href={`/dispatch/jobs/${job.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 bg-white px-3 py-2 text-xs hover:border-amber-400"><span className="truncate font-bold text-slate-800">#{job.jobNumber} · {job.customer?.name || job.serviceType}</span><Clock3 size={14} className="shrink-0 text-amber-700" /></Link>)}{unscheduled.length === 0 && <p className="text-xs text-slate-500">No unscheduled active jobs.</p>}</div>
          </section>
        </aside>}
      </div>
    </div>
  );
}
