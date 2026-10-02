'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { CalendarDays, MapPin, MapPinned, RefreshCw } from 'lucide-react';
import { formatTorontoDateInput } from '@/lib/timezone';

type DateRange = 'today' | 'yesterday' | 'this-week' | 'all';

type DispatchJob = {
  id: string;
  jobNumber: string;
  serviceAddress: string;
  createdAt: string;
  customer?: { id?: string; name: string };
};
type CustomerLocation = {
  key: string;
  address: string;
  coordinates: [number, number];
  jobs: DispatchJob[];
  customers: Array<{ id: string; name: string }>;
};
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

async function geocodeAddress(address: string, token: string): Promise<[number, number] | null> {
  const params = new URLSearchParams({ q: address, country: 'CA', types: 'address', limit: '1', autocomplete: 'false', access_token: token });
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`);
  if (!response.ok) throw new Error('Mapbox could not look up this address.');
  const result = await response.json();
  const coordinates = result?.features?.[0]?.geometry?.coordinates;
  return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(Number.isFinite)
    ? [coordinates[0], coordinates[1]] as [number, number]
    : null;
}

function groupJobsByAddress(jobs: DispatchJob[]) {
  const groups = new Map<string, { address: string; jobs: DispatchJob[] }>();
  for (const job of jobs) {
    const address = job.serviceAddress?.trim();
    if (!address) continue;
    const key = address.toLocaleLowerCase().replace(/\s+/g, ' ');
    const group = groups.get(key) || { address, jobs: [] };
    group.jobs.push(job);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

function getDateRange(dateRange: DateRange, now = new Date()) {
  const today = formatTorontoDateInput(now);
  if (dateRange === 'all') return { start: '', end: '' };
  if (dateRange === 'today') return { start: today, end: today };

  const date = new Date(`${today}T00:00:00Z`);
  if (dateRange === 'yesterday') {
    date.setUTCDate(date.getUTCDate() - 1);
    const yesterday = date.toISOString().slice(0, 10);
    return { start: yesterday, end: yesterday };
  }

  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return { start: date.toISOString().slice(0, 10), end: today };
}

function isInDateRange(job: DispatchJob, dateRange: DateRange, now = new Date()) {
  if (dateRange === 'all') return true;
  const jobDate = formatTorontoDateInput(job.createdAt);
  if (!jobDate) return false;
  const { start, end } = getDateRange(dateRange, now);
  return jobDate >= start && jobDate <= end;
}

export default function DispatchMapPage() {
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [located, setLocated] = useState<CustomerLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [completedLookups, setCompletedLookups] = useState(0);
  const [error, setError] = useState('');
  const [unmatched, setUnmatched] = useState(0);
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [mapError, setMapError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [query, setQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const dateFilteredJobs = useMemo(() => jobs.filter((job) => isInDateRange(job, dateRange)), [jobs, dateRange]);
  const addressGroups = useMemo(() => groupJobsByAddress(dateFilteredJobs), [dateFilteredJobs]);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch('/api/jobs', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load jobs.');
      if (!cancelled) setJobs(data.jobs || []);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load jobs.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || dateFilteredJobs.length === 0) { setLocated([]); setUnmatched(0); setCompletedLookups(0); setGeocoding(false); return; }
    let cancelled = false;
    setGeocoding(true);
    setError('');
    setLocated([]);
    setCompletedLookups(0);
    const coordinatesByAddress = new Map<string, [number, number]>();
    let nextIndex = 0;
    let completed = 0;
    let missing = 0;
    let lookupFailed = false;
    const worker = async () => {
      while (nextIndex < addressGroups.length && !cancelled) {
        const group = addressGroups[nextIndex++];
        try {
          const coordinates = await geocodeAddress(group.address, MAPBOX_TOKEN);
          if (coordinates) coordinatesByAddress.set(group.key, coordinates);
          else missing += 1;
        } catch {
          lookupFailed = true;
          missing += 1;
        }
        completed += 1;
        if (!cancelled && (completed % 10 === 0 || completed === addressGroups.length)) setCompletedLookups(completed);
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, addressGroups.length) }, worker)).then(() => {
      if (!cancelled) {
        setLocated(addressGroups.flatMap((item) => {
          const coordinates = coordinatesByAddress.get(item.key);
          if (!coordinates) return [];
          return [{
            ...item,
            coordinates,
            customers: [...new Map(item.jobs.flatMap((job) => {
              const name = job.customer?.name?.trim();
              if (!name) return [];
              const id = job.customer?.id || name.toLocaleLowerCase();
              return [[id, { id, name }] as const];
            })).values()],
          }];
        }));
        setUnmatched(missing);
        if (lookupFailed) setError('Some addresses could not be looked up. Mapped customer locations are still shown.');
      }
    }).finally(() => { if (!cancelled) setGeocoding(false); });
    return () => { cancelled = true; };
  }, [addressGroups, dateFilteredJobs.length]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapContainer.current || map.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    try {
      map.current = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/streets-v12', center: [-79.3832, 43.6532], zoom: 9 });
      map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
      map.current.on('load', () => {
        map.current?.resize();
        setMapReady(true);
        setMapError('');
      });
      map.current.on('error', () => {
        setMapError('Mapbox could not load the map tiles. Check the public token’s Styles:Read access and allowed portal domains.');
      });
      const observer = new ResizeObserver(() => map.current?.resize());
      observer.observe(mapContainer.current);
      return () => {
        observer.disconnect();
        markers.current.forEach((marker) => marker.remove());
        markers.current = [];
        map.current?.remove();
        map.current = null;
      };
    } catch {
      setMapError('The map could not be initialized in this browser. Reload the page or try another browser.');
      return;
    }
  }, []);

  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = located.map((location) => {
      const content = document.createElement('div');
      content.className = 'min-w-48 p-1';
      const title = document.createElement('p'); title.className = 'font-bold text-slate-900'; title.textContent = location.address;
      const summary = document.createElement('p'); summary.className = 'mt-1 text-xs text-slate-700'; summary.textContent = `${location.jobs.length} ${location.jobs.length === 1 ? 'job' : 'jobs'} · ${location.customers.length} ${location.customers.length === 1 ? 'customer' : 'customers'}`;
      const customers = document.createElement('p'); customers.className = 'mt-1 text-xs text-slate-500'; customers.textContent = location.customers.slice(0, 6).map((customer) => customer.name).join(', ') + (location.customers.length > 6 ? ` +${location.customers.length - 6} more` : '');
      content.append(title, summary, customers);
      const popup = new mapboxgl.Popup({ offset: 20, maxWidth: '300px' }).setDOMContent(content);
      return new mapboxgl.Marker({ color: '#2563eb' }).setLngLat(location.coordinates).setPopup(popup).addTo(map.current!);
    });
    if (located.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      located.forEach((location) => bounds.extend(location.coordinates));
      map.current.fitBounds(bounds, { padding: 72, maxZoom: 13, duration: 500 });
    } else if (located[0]) map.current.flyTo({ center: located[0].coordinates, zoom: 13, duration: 500 });
  }, [located]);

  const filtered = useMemo(() => located.filter((location) => `${location.address} ${location.customers.map((customer) => customer.name).join(' ')} ${location.jobs.map((job) => job.jobNumber).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [located, query]);
  const totalCustomers = useMemo(() => new Set(located.flatMap((location) => location.customers.map((customer) => customer.id))).size, [located]);
  const focusLocation = (location: CustomerLocation) => { map.current?.flyTo({ center: location.coordinates, zoom: 14, duration: 600 }); markers.current[located.indexOf(location)]?.togglePopup(); };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Customer insights</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Customer locations</h1><p className="mt-1 text-sm text-slate-500">Explore customer locations by job date.</p></div>
        <button onClick={() => setRefreshKey((value) => value + 1)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"><RefreshCw size={15} />Refresh locations</button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label htmlFor="customer-map-date-range" className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"><CalendarDays size={16} className="text-blue-600" />Job date</label>
        <select id="customer-map-date-range" value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)} className="min-w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="this-week">This week</option>
          <option value="all">All</option>
        </select>
        <p className="text-xs text-slate-500">{dateFilteredJobs.length} {dateFilteredJobs.length === 1 ? 'job' : 'jobs'} · dates use Toronto time</p>
      </div>

      {!MAPBOX_TOKEN ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><h2 className="font-black">Mapbox token required</h2><p className="mt-1 leading-6">Set <code className="rounded bg-amber-100 px-1.5 py-0.5">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to a public Mapbox token with URL restrictions for your portal domain, then reload this page.</p><a className="mt-2 inline-block font-bold underline" href="https://docs.mapbox.com/help/dive-deeper/access-tokens/" target="_blank" rel="noreferrer">Mapbox token setup</a></div> : <>
        <p className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">Customer service addresses are sent to Mapbox to locate them. Locations are grouped by address and results are used for this map view only; coordinates are not saved to job records.</p>
        {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {mapError && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{mapError}</p>}
        {unmatched > 0 && <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{unmatched} {unmatched === 1 ? 'address could' : 'addresses could'} not be matched and {unmatched === 1 ? 'is' : 'are'} omitted from the map.</p>}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative h-[65vh] min-h-[520px] max-h-[800px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
            <div ref={mapContainer} className="absolute inset-0 h-full w-full" />
            {!mapReady && !mapError && <div className="absolute inset-0 z-[1] grid place-items-center bg-slate-100/80 text-sm font-semibold text-slate-600"><span className="rounded-xl bg-white/95 px-4 py-3 shadow-sm">Loading Mapbox map…</span></div>}
            {(loading || geocoding) && <div className="absolute left-3 top-3 z-10 rounded-xl border border-white/70 bg-white/95 px-3 py-2 text-xs font-bold text-slate-700 shadow"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />{loading ? 'Loading job history…' : `Locating addresses… ${completedLookups}/${addressGroups.length}`}</span></div>}
          </div>
          <aside className="flex max-h-[650px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-4"><div className="flex items-center justify-between"><h2 className="font-black text-slate-900">Customer locations</h2><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-800">{located.length}</span></div><p className="mt-1 text-xs text-slate-500">{totalCustomers} customers · {located.reduce((total, location) => total + location.jobs.length, 0)} jobs</p><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search customer or address" className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" /></div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {filtered.map((location) => <button key={location.key} onClick={() => focusLocation(location)} className="w-full rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/50">
                <div className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-blue-600" /><div className="min-w-0 flex-1"><p className="text-xs font-black text-slate-900">{location.address}</p><p className="mt-1 text-[11px] font-semibold text-slate-600">{location.customers.length} {location.customers.length === 1 ? 'customer' : 'customers'} · {location.jobs.length} {location.jobs.length === 1 ? 'job' : 'jobs'}</p><p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{location.customers.map((customer) => customer.name).join(', ') || 'Customer name unavailable'}</p></div></div>
              </button>)}
              {!loading && !geocoding && located.length === 0 && <div className="px-3 py-10 text-center"><MapPinned className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-bold text-slate-700">No locations to show</p><p className="mt-1 text-xs text-slate-500">{dateFilteredJobs.length ? 'Mapbox could not match these addresses.' : 'There are no jobs in this date range. Try This week or All.'}</p></div>}
              {located.length > 0 && filtered.length === 0 && <p className="p-5 text-center text-xs text-slate-500">No locations match that search.</p>}
            </div>
          </aside>
        </div>
      </>}
    </div>
  );
}
