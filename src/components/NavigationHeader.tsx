'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  Plus,
  Settings2,
  UsersRound,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AppRole } from '@/lib/session';
import { getRoleDestination } from '@/lib/role-destination';

interface UserSession {
  id: string;
  name: string;
  phone: string;
  role: AppRole;
  originalRole?: 'ADMIN';
}

interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const publicMarketingPaths = new Set([
  '/', '/login', '/contact', '/features', '/locksmith-dispatch-software',
  '/locksmith-field-service-management', '/locksmith-business-management',
  '/automotive-locksmith-software', '/commercial-locksmith-software', '/locksmith-job-costing',
]);

// Keep Admin and Dispatcher on one ordered workspace; only Ads is Admin-only.
const operationalNavigation: NavigationItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Call Analytics', href: '/dispatch/call-analytics', icon: ChartNoAxesCombined },
  { label: 'Books', href: '/books', icon: Settings2 },
  { label: 'Live Map', href: '/dispatch/map', icon: MapPinned },
  { label: 'Calendar', href: '/dispatch/calendar', icon: CalendarDays },
  { label: 'Google Ads', href: '/google-ads', icon: CircleDollarSign, adminOnly: true },
];

const intakeDestinations = [
  { label: 'Assigned job', href: '/dispatch?newJob=assigned' },
  { label: 'Unassigned job', href: '/dispatch?newJob=unassigned' },
  // Keep the established completed-entry URL working for existing links.
  { label: 'Completed job', href: '/dispatch?addJob=1' },
];

function isActiveLink(item: NavigationItem, pathname: string) {
  if (item.href === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/dashboard/');
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

export default function NavigationHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = await res.json();
      setUser(data.success && data.user ? data.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void checkAuth(); }, [checkAuth, pathname]);
  useEffect(() => {
    document.body.classList.toggle('portal-shell', Boolean(user) && !publicMarketingPaths.has(pathname));
    return () => document.body.classList.remove('portal-shell');
  }, [user, pathname]);
  useEffect(() => {
    document.body.classList.toggle('portal-shell-collapsed', collapsed);
    return () => document.body.classList.remove('portal-shell-collapsed');
  }, [collapsed]);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/');
    router.refresh();
  };

  const restoreAdminProfile = async () => {
    if (!user || user.role !== 'DISPATCHER' || user.originalRole !== 'ADMIN' || restoring) return;
    setRestoring(true);
    setRestoreError('');
    try {
      const response = await fetch('/api/auth/role-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'ADMIN' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to return to Admin.');
      setUser(result.user);
      setMobileOpen(false);
      router.replace(getRoleDestination(result.user.role));
      router.refresh();
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : 'Unable to return to Admin.');
    } finally {
      setRestoring(false);
    }
  };

  if (publicMarketingPaths.has(pathname) || loading || !user) return null;

  const isAdmin = user.role === 'ADMIN';
  const isOperationsProfile = user.role === 'ADMIN' || user.role === 'DISPATCHER';
  const links: NavigationItem[] = isOperationsProfile
    ? operationalNavigation.filter((item) => !item.adminOnly || isAdmin)
    : user.role === 'ACCOUNTANT'
      ? [{ label: 'Books', href: '/books', icon: Settings2 }]
      : [{ label: 'My jobs', href: '/tech', icon: Wrench }];
  const roleLabel = user.originalRole === 'ADMIN'
    ? 'Dispatcher mode'
    : user.role === 'ADMIN'
      ? 'Admin'
      : user.role === 'DISPATCHER'
        ? 'Dispatcher'
        : user.role === 'ACCOUNTANT'
          ? 'Accountant'
          : 'Technician';
  const homeHref = getRoleDestination(user.role);

  const sidebarContent = (
    <>
      <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-slate-800 px-5">
        <Link href={homeHref} className={`flex min-w-0 items-center gap-3 rounded-lg ${focusRing}`} aria-label="LockOps Pro home">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-2xl">🔐</span>
          <span className={`min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
            <span className="block truncate text-[15px] font-black tracking-tight text-white">LockOps Pro</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Operations</span>
          </span>
        </Link>
        <button onClick={() => setMobileOpen(false)} className={`rounded-lg p-2 text-slate-400 hover:bg-slate-800 md:hidden ${focusRing}`} aria-label="Close menu"><X size={18} /></button>
      </div>

      <div className="sticky top-0 z-30 hidden h-9 shrink-0 justify-end border-b border-slate-800 bg-slate-950 px-2 md:flex">
        <button onClick={() => setCollapsed((value) => !value)} className={`flex h-7 w-7 items-center justify-center self-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 shadow hover:bg-slate-800 ${focusRing}`} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <div className="shrink-0 px-3 pt-5">
        <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Workspace</p>
        <nav aria-label="Main navigation" className="space-y-1">
          {links.map((item) => {
            const Icon = item.icon;
            const active = isActiveLink(item, pathname);
            return <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined} aria-current={active ? 'page' : undefined} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${focusRing} ${active ? 'bg-blue-600 text-white shadow-md shadow-blue-950/30' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <Icon size={18} strokeWidth={2.2} /><span className={collapsed ? 'md:hidden' : ''}>{item.label}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white" />}
            </Link>;
          })}
        </nav>
      </div>

      {isOperationsProfile && <div className="shrink-0 px-3 pt-5">
        <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Quick actions</p>
        <Link href="/dispatch" title={collapsed ? 'Jobs' : undefined} aria-current={pathname === '/dispatch' || pathname.startsWith('/dispatch/jobs/') ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${focusRing} ${pathname === '/dispatch' || pathname.startsWith('/dispatch/jobs/') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
          <ClipboardList size={18} strokeWidth={2.2} /><span className={collapsed ? 'md:hidden' : ''}>Jobs</span>
        </Link>
        <details className="group mt-1" onToggle={(event) => { if (event.currentTarget.open) setCollapsed(false); }}>
          <summary title={collapsed ? 'New job' : undefined} className={`flex cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-slate-800 hover:text-white [&::-webkit-details-marker]:hidden ${focusRing}`}>
            <Plus size={18} strokeWidth={2.2} /><span className={`flex-1 ${collapsed ? 'md:hidden' : ''}`}>New job</span><ChevronDown size={15} className={`transition group-open:rotate-180 ${collapsed ? 'md:hidden' : ''}`} />
          </summary>
          <div className="ml-4 mt-1 border-l border-slate-700 pl-3">
            {intakeDestinations.map((item) => <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`block rounded-lg px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white ${focusRing}`}>{item.label}</Link>)}
          </div>
        </details>
      </div>}

      {user.originalRole === 'ADMIN' && (
        <div className="mx-3 mt-5 shrink-0 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-300">Limited role mode</p>
          <p className="mt-1 text-xs leading-5 text-slate-200">This legacy session is restricted to Dispatcher access.</p>
          <button onClick={restoreAdminProfile} disabled={restoring} className={`mt-3 w-full rounded-xl bg-amber-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-amber-300 disabled:opacity-50 ${focusRing}`}>{restoring ? 'Returning…' : 'Return to Admin'}</button>
        </div>
      )}

      {isAdmin && <div className="shrink-0 px-3 pt-5">
        <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Admin tools</p>
        <nav aria-label="Admin tools" className="space-y-1">
          <Link href="/admin/team" title={collapsed ? 'Team management' : undefined} aria-current={pathname.startsWith('/admin/team') ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold transition ${focusRing} ${pathname.startsWith('/admin/team') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}><UsersRound size={17} /><span className={collapsed ? 'md:hidden' : ''}>Team management</span></Link>
          <Link href="/admin/cash-ledger" title={collapsed ? 'Cash settlement ledger' : undefined} aria-current={pathname.startsWith('/admin/cash-ledger') ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold transition ${focusRing} ${pathname.startsWith('/admin/cash-ledger') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}><CircleDollarSign size={17} /><span className={collapsed ? 'md:hidden' : ''}>Cash settlement ledger</span></Link>
          <Link href="/tech" title={collapsed ? 'Technician view' : undefined} aria-current={pathname.startsWith('/tech') ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold transition ${focusRing} ${pathname.startsWith('/tech') ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}><Wrench size={17} /><span className={collapsed ? 'md:hidden' : ''}>Technician view</span></Link>
        </nav>
      </div>}

      <div className="mt-auto shrink-0 border-t border-slate-800 p-3">
        <div className="flex items-center gap-3 rounded-xl bg-slate-800/70 p-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-black text-white">{user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
          <div className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}>
            <p className="truncate text-xs font-bold text-white">{user.name}</p>
            <p className="text-[10px] font-semibold text-slate-400">{roleLabel}</p>
          </div>
          <button onClick={handleLogout} title="Sign out" className={`rounded-lg p-2 text-slate-400 hover:bg-rose-950 hover:text-rose-300 ${focusRing}`} aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col overflow-y-auto border-r border-slate-800 bg-slate-950 transition-all md:flex ${collapsed ? 'w-[76px]' : 'w-64'}`}>
        {sidebarContent}
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 text-white md:hidden">
        <button onClick={() => setMobileOpen(true)} className={`rounded-lg p-2 text-slate-200 hover:bg-slate-800 ${focusRing}`} aria-label="Open menu"><Menu size={20} /></button>
        <Link href={homeHref} className={`rounded-lg text-sm font-black ${focusRing}`} aria-label="LockOps Pro home">🔐 LockOps Pro</Link>
        <span className="max-w-24 truncate text-[10px] font-bold text-slate-400">{roleLabel}</span>
      </div>
      {mobileOpen && <div className="fixed inset-0 z-50 md:hidden"><button className="absolute inset-0 bg-slate-950/70" onClick={() => setMobileOpen(false)} aria-label="Close menu" /><aside className="absolute inset-y-0 left-0 flex w-[min(84vw,300px)] flex-col overflow-y-auto bg-slate-950 shadow-2xl">{sidebarContent}</aside></div>}
      {restoreError && <div role="alert" className="fixed right-4 top-16 z-50 max-w-sm rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 shadow-lg"><div className="flex items-start gap-3"><span>{restoreError}</span><button onClick={() => setRestoreError('')} className="font-black" aria-label="Dismiss error">×</button></div></div>}
    </>
  );
}
