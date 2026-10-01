'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPinned, Navigation, RefreshCw } from 'lucide-react';

type DispatchJob = {
  id: string; jobNumber: string; serviceType: string; serviceAddress: string; status: string;
  isScheduled?: boolean; scheduledFor?: string | null; customer?: { name: string }; technician?: { name: string } | null;
};
type LocatedJob = DispatchJob & { coordinates: [number, number] };
const ACTIVE = new Set(['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS']);
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

async function geocodeAddress(address: string, token: string): Promise<[number, number] | null> {
  const params = new URLSearchParams({ q: address, country: 'CA', types: 'address', limit: '1', autocomplete: 'false', access_token: token });
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`);
  if (!response.ok) throw new Error('Mapbox could not locate one or more job addresses.');
  const result = await response.json();
  const coordinates = result?.features?.[0]?.geometry?.coordinates;
  return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(Number.isFinite)
    ? [coordinates[0], coordinates[1]] as [number, number]
    : null;
}

export default function DispatchMapPage() {
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [located, setLocated] = useState<LocatedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/jobs', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load jobs.');
      if (!cancelled) setJobs((data.jobs || []).filter((job: DispatchJob) => ACTIVE.has(job.status)));
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load jobs.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || jobs.length === 0) { setLocated([]); return; }
    let cancelled = false;
    setGeocoding(true);
    setError('');
    const validJobs = jobs.filter((job) => job.serviceAddress?.trim()).slice(0, 60);
    const uniqueAddresses = [...new Set(validJobs.map((job) => job.serviceAddress.trim()))];
    const coordinatesByAddress = new Map<string, [number, number]>();
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < uniqueAddresses.length && !cancelled) {
        const address = uniqueAddresses[nextIndex++];
        try {
          const coordinates = await geocodeAddress(address, MAPBOX_TOKEN);
          if (coordinates) coordinatesByAddress.set(address, coordinates);
          if (!cancelled) setLocated(validJobs.flatMap((job) => {
            const foundCoordinates = coordinatesByAddress.get(job.serviceAddress.trim());
            return foundCoordinates ? [{ ...job, coordinates: foundCoordinates }] : [];
          }));
        } catch (reason) {
          if (!cancelled) setError(reason instanceof Error ? reason.message : 'Address lookup failed.');
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, uniqueAddresses.length) }, worker)).then(() => {
      if (!cancelled) setLocated(validJobs.flatMap((job) => {
        const coordinates = coordinatesByAddress.get(job.serviceAddress.trim());
        return coordinates ? [{ ...job, coordinates }] : [];
      }));
    }).finally(() => { if (!cancelled) setGeocoding(false); });
    return () => { cancelled = true; };
  }, [jobs]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapContainer.current || map.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/streets-v12', center: [-79.3832, 43.6532], zoom: 9 });
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    return () => { markers.current.forEach((marker) => marker.remove()); markers.current = []; map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = located.map((job) => {
      const content = document.createElement('div');
      content.className = 'min-w-48 p-1';
      const title = document.createElement('p'); title.className = 'font-bold text-slate-900'; title.textContent = `#${job.jobNumber} · ${job.customer?.name || 'Customer'}`;
      const service = document.createElement('p'); service.className = 'mt-1 text-xs text-slate-700'; service.textContent = job.serviceType;
      const address = document.createElement('p'); address.className = 'mt-1 text-xs text-slate-500'; address.textContent = job.serviceAddress;
      const tech = document.createElement('p'); tech.className = 'mt-1 text-xs text-slate-600'; tech.textContent = job.technician?.name || 'Unassigned';
      content.append(title, service, address, tech);
      const popup = new mapboxgl.Popup({ offset: 20, maxWidth: '280px' }).setDOMContent(content);
      const marker = new mapboxgl.Marker({ color: job.isScheduled ? '#7c3aed' : '#2563eb' }).setLngLat(job.coordinates).setPopup(popup).addTo(map.current!);
      return marker;
    });
    if (located.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      located.forEach((job) => bounds.extend(job.coordinates));
      map.current.fitBounds(bounds, { padding: 72, maxZoom: 13, duration: 500 });
    } else if (located[0]) map.current.flyTo({ center: located[0].coordinates, zoom: 13, duration: 500 });
  }, [located]);

  const filtered = useMemo(() => located.filter((job) => `${job.jobNumber} ${job.customer?.name || ''} ${job.serviceAddress} ${job.technician?.name || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [located, query]);
  const focusJob = (job: LocatedJob) => { map.current?.flyTo({ center: job.coordinates, zoom: 14, duration: 600 }); markers.current[located.indexOf(job)]?.togglePopup(); };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Dispatch planning</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Live job map</h1><p className="mt-1 text-sm text-slate-500">Open jobs and their service locations.</p></div>
        <button onClick={() => setRefreshKey((value) => value + 1)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"><RefreshCw size={15} />Refresh jobs</button>
      </div>

      {!MAPBOX_TOKEN ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><h2 className="font-black">Mapbox token required</h2><p className="mt-1 leading-6">Set <code className="rounded bg-amber-100 px-1.5 py-0.5">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to a public Mapbox token with URL restrictions for your portal domain, then reload this page.</p><a className="mt-2 inline-block font-bold underline" href="https://docs.mapbox.com/help/dive-deeper/access-tokens/" target="_blank" rel="noreferrer">Mapbox token setup</a></div> : <>
        <p className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-900">When this map opens, active job addresses are sent to Mapbox to place them on the map. Results are used for this view only and aren’t saved. Mapbox requires geocoding results to appear with a Mapbox map.</p>
        {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm sm:min-h-[650px]">
            <div ref={mapContainer} className="absolute inset-0" />
            {(loading || geocoding) && <div className="absolute left-3 top-3 z-10 rounded-xl border border-white/70 bg-white/95 px-3 py-2 text-xs font-bold text-slate-700 shadow"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />{loading ? 'Loading jobs…' : `Locating jobs… ${located.length}/${jobs.length}`}</span></div>}
            {jobs.length > 60 && <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-white/95 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow">Showing first 60 active jobs. Filter the queue before opening the map to narrow results.</div>}
          </div>
          <aside className="flex max-h-[650px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-4"><div className="flex items-center justify-between"><h2 className="font-black text-slate-900">Mapped jobs</h2><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-800">{located.length}</span></div><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search jobs, customer, address" className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" /><p className="mt-2 text-[10px] text-slate-500">Blue: open job · Purple: scheduled</p></div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {filtered.map((job) => <div key={job.id} className="rounded-xl border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/50">
                <button onClick={() => focusJob(job)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-black text-slate-900">#{job.jobNumber} · {job.customer?.name || 'Customer'}</span><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${job.isScheduled ? 'bg-violet-500' : 'bg-blue-600'}`} /></div>
                  <p className="mt-1 text-[11px] font-semibold text-slate-600">{job.serviceType} · {job.technician?.name || 'Unassigned'}</p><p className="mt-1 text-[11px] text-slate-500">{job.serviceAddress}</p>
                </button>
                <Link href={`/dispatch/jobs/${job.id}`} className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-blue-700 hover:underline"><Navigation size={11} />Open job</Link>
              </div>)}
              {!loading && located.length === 0 && <div className="px-3 py-10 text-center"><MapPinned className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-bold text-slate-700">No locations to show</p><p className="mt-1 text-xs text-slate-500">{jobs.length ? 'Mapbox could not match these addresses.' : 'There are no active jobs right now.'}</p></div>}
              {located.length > 0 && filtered.length === 0 && <p className="p-5 text-center text-xs text-slate-500">No mapped jobs match that search.</p>}
            </div>
          </aside>
        </div>
      </>}
    </div>
  );
}
