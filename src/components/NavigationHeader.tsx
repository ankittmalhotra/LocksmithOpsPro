'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, LayoutDashboard, LogOut, MapPinned, Menu, Settings2, Wrench, X } from 'lucide-react';
import type { AppRole } from '@/lib/session';

interface UserSession {
  id: string;
  name: string;
  phone: string;
  role: AppRole;
  originalRole?: 'ADMIN';
}

const publicMarketingPaths = new Set([
  '/', '/login', '/contact', '/features', '/locksmith-dispatch-software',
  '/locksmith-field-service-management', '/locksmith-business-management',
  '/automotive-locksmith-software', '/commercial-locksmith-software', '/locksmith-job-costing',
]);

const iconMap = { dispatch: ClipboardList, calendar: CalendarDays, map: MapPinned, owner: LayoutDashboard, books: Settings2, tech: Wrench };

export default function NavigationHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [roleSwitchError, setRoleSwitchError] = useState('');
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

  const switchRoleMode = async () => {
    if (!user || switching) return;
    setSwitching(true);
    setRoleSwitchError('');
    try {
      const mode = user.originalRole === 'ADMIN' ? 'ADMIN' : 'DISPATCHER';
      const response = await fetch('/api/auth/role-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to switch role mode.');
      setUser(result.user);
      setMobileOpen(false);
      router.push(mode === 'ADMIN' ? '/owner' : '/dispatch');
      router.refresh();
    } catch (error) {
      setRoleSwitchError(error instanceof Error ? error.message : 'Unable to switch role mode.');
    } finally {
      setSwitching(false);
    }
  };

  if (publicMarketingPaths.has(pathname) || loading || !user) return null;

  const isAdmin = user.role === 'ADMIN';
  const links = user.role === 'ADMIN' || user.role === 'DISPATCHER'
    ? [
        { label: 'Dispatch desk', href: '/dispatch', icon: iconMap.dispatch },
        { label: 'Calendar', href: '/dispatch/calendar', icon: iconMap.calendar },
        { label: 'Live map', href: '/dispatch/map', icon: iconMap.map },
        ...(isAdmin ? [{ label: 'Admin hub', href: '/owner', icon: iconMap.owner }] : []),
        { label: 'Books', href: '/books', icon: iconMap.books },
        ...(isAdmin ? [{ label: 'Technician view', href: '/tech', icon: iconMap.tech }] : []),
      ]
    : user.role === 'ACCOUNTANT'
      ? [{ label: 'Books', href: '/books', icon: iconMap.books }]
      : [{ label: 'My jobs', href: '/tech', icon: iconMap.tech }];

  const roleLabel = user.originalRole === 'ADMIN' ? 'Dispatcher mode' : user.role === 'ADMIN' ? 'Admin' : user.role === 'DISPATCHER' ? 'Dispatcher' : user.role === 'ACCOUNTANT' ? 'Accountant' : 'Technician';

  const sidebarContent = (
    <>
      <div className="flex h-[72px] items-center justify-between border-b border-slate-800 px-5">
        <Link href="/dispatch" className="flex min-w-0 items-center gap-3" aria-label="LockOps Pro home">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-2xl">🔐</span>
          <span className={`min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
            <span className="block truncate text-[15px] font-black tracking-tight text-white">LockOps Pro</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Operations</span>
          </span>
        </Link>
        <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 md:hidden" aria-label="Close menu"><X size={18} /></button>
      </div>

      <div className="px-3 pt-5">
        <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Workspace</p>
        <nav aria-label="Main navigation" className="space-y-1">
          {links.map(({ label, href, icon: Icon }) => {
            const active = pathname === href
              || (href === '/dispatch' && pathname.startsWith('/dispatch/jobs/'))
              || (href !== '/dispatch' && pathname.startsWith(`${href}/`));
            return <Link key={href} href={href} title={collapsed ? label : undefined} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${active ? 'bg-blue-600 text-white shadow-md shadow-blue-950/30' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <Icon size={18} strokeWidth={2.2} /><span className={collapsed ? 'md:hidden' : ''}>{label}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white" />}
            </Link>;
          })}
        </nav>
      </div>

      {user.originalRole === 'ADMIN' && (
        <div className="mx-3 mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-300">Limited role mode</p>
          <p className="mt-1 text-xs leading-5 text-slate-200">You’re seeing the portal as a dispatcher.</p>
          <button onClick={switchRoleMode} disabled={switching} className="mt-3 w-full rounded-xl bg-amber-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-amber-300 disabled:opacity-50">{switching ? 'Switching…' : 'Return to Admin'}</button>
        </div>
      )}

      <div className="mt-auto border-t border-slate-800 p-3">
        {isAdmin && (
          <button onClick={switchRoleMode} disabled={switching} className="mb-3 flex w-full items-center gap-3 rounded-xl border border-slate-700 px-3 py-2.5 text-left text-xs font-bold text-slate-200 hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50" title={collapsed ? 'Switch to Dispatcher' : undefined}>
            <Settings2 size={17} /><span className={collapsed ? 'md:hidden' : ''}>{switching ? 'Switching…' : 'Switch to Dispatcher'}</span><ChevronRight className="ml-auto" size={15} />
          </button>
        )}
        <div className="flex items-center gap-3 rounded-xl bg-slate-800/70 p-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-black text-white">{user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
          <div className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}>
            <p className="truncate text-xs font-bold text-white">{user.name}</p>
            <p className="text-[10px] font-semibold text-slate-400">{roleLabel}</p>
          </div>
          <button onClick={handleLogout} title="Sign out" className="rounded-lg p-2 text-slate-400 hover:bg-rose-950 hover:text-rose-300" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-800 bg-slate-950 transition-all md:flex ${collapsed ? 'w-[76px]' : 'w-64'}`}>
        {sidebarContent}
        <button onClick={() => setCollapsed((value) => !value)} className="absolute -right-3 top-[88px] flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 shadow hover:bg-slate-800" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 text-white md:hidden">
        <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-200 hover:bg-slate-800" aria-label="Open menu"><Menu size={20} /></button>
        <span className="text-sm font-black">🔐 LockOps Pro</span>
        <span className="max-w-24 truncate text-[10px] font-bold text-slate-400">{roleLabel}</span>
      </div>
      {mobileOpen && <div className="fixed inset-0 z-50 md:hidden"><button className="absolute inset-0 bg-slate-950/70" onClick={() => setMobileOpen(false)} aria-label="Close menu" /><aside className="absolute inset-y-0 left-0 flex w-[min(84vw,300px)] flex-col bg-slate-950 shadow-2xl">{sidebarContent}</aside></div>}
      {roleSwitchError && <div role="alert" className="fixed right-4 top-16 z-50 max-w-sm rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 shadow-lg"><div className="flex items-start gap-3"><span>{roleSwitchError}</span><button onClick={() => setRoleSwitchError('')} className="font-black" aria-label="Dismiss error">×</button></div></div>}
    </>
  );
}
