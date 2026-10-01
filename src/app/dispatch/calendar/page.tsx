'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, UserRound } from 'lucide-react';

type DispatchJob = {
  id: string; jobNumber: string; serviceType: string; serviceAddress: string; status: string;
  isScheduled?: boolean; scheduledFor?: string | null; customer?: { name: string }; technician?: { name: string } | null;
};

const ACTIVE = new Set(['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS']);
const torontoDateKey = (value: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const monthTitle = (date: Date) => new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: 'America/Toronto' }).format(date);
const dayNumber = (date: Date) => Number(new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'America/Toronto' }).format(date));
const timeLabel = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftMonth(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export default function DispatchCalendarPage() {
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => localDateKey(new Date()));

  useEffect(() => {
    fetch('/api/jobs', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load appointments.');
      setJobs(data.jobs || []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load appointments.')).finally(() => setLoading(false));
  }, []);

  const appointments = useMemo(() => jobs.filter((job) => job.isScheduled && job.scheduledFor && ACTIVE.has(job.status)), [jobs]);
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
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [month]);
  const selectedJobs = grouped.get(selectedDay) || [];
  const unscheduled = jobs.filter((job) => ACTIVE.has(job.status) && !job.isScheduled);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Dispatch planning</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Calendar</h1><p className="mt-1 text-sm text-slate-500">Upcoming booked work, shown in Toronto local time.</p></div>
        <Link href="/dispatch" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">Open dispatch desk</Link>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-4 sm:px-5">
            <div><h2 className="text-lg font-black text-slate-900">{monthTitle(month)}</h2><p className="mt-0.5 text-xs text-slate-500">{appointments.length} active appointment{appointments.length === 1 ? '' : 's'}</p></div>
            <div className="flex items-center gap-1">
              <button onClick={() => setMonth((value) => shiftMonth(value, -1))} aria-label="Previous month" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><ChevronLeft size={17} /></button>
              <button onClick={() => { const now = new Date(); setMonth(now); setSelectedDay(localDateKey(now)); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Today</button>
              <button onClick={() => setMonth((value) => shiftMonth(value, 1))} aria-label="Next month" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><ChevronRight size={17} /></button>
            </div>
          </header>
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="px-1 py-2 text-center text-[10px] font-black uppercase tracking-wide text-slate-500 sm:text-xs">{day}</div>)}</div>
          {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading appointments…</div> : (
            <div className="grid grid-cols-7">
              {cells.map((date) => {
                const key = localDateKey(date);
                const isCurrentMonth = date.getMonth() === month.getMonth();
                const isToday = key === localDateKey(new Date());
                const isSelected = key === selectedDay;
                const count = grouped.get(key)?.length || 0;
                return <button key={key} onClick={() => setSelectedDay(key)} className={`min-h-[76px] border-b border-r border-slate-100 p-1.5 text-left transition sm:min-h-[105px] sm:p-2 ${isSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-500' : 'hover:bg-slate-50'} ${!isCurrentMonth ? 'text-slate-300' : 'text-slate-800'}`}>
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${isToday ? 'bg-blue-700 text-white' : ''}`}>{dayNumber(date)}</span>
                  {count > 0 && <div className="mt-1.5 space-y-1">{grouped.get(key)!.slice(0, 2).map((job) => <div key={job.id} className="truncate rounded-md bg-violet-100 px-1.5 py-1 text-[9px] font-bold text-violet-800 sm:text-[10px]">{timeLabel(job.scheduledFor!)} · #{job.jobNumber}</div>)}{count > 2 && <p className="px-1 text-[9px] font-bold text-slate-500">+{count - 2} more</p>}</div>}
                </button>;
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-4 px-4 py-3 text-[11px] font-semibold text-slate-500"><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-violet-300" />Appointment</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue-700" />Today</span></div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center gap-2"><CalendarDays className="text-blue-700" size={18} /><h2 className="font-black text-slate-900">{new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${selectedDay}T12:00:00Z`))}</h2></div>
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
        </aside>
      </div>
    </div>
  );
}
