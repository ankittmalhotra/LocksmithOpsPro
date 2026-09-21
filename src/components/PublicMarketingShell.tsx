import Link from 'next/link';
import { ArrowRight, Wrench } from 'lucide-react';

export function PublicMarketingHeader() {
  return (
    <header className="border-b border-white/10 bg-slate-950 text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-5 sm:px-8 lg:px-10">
        <Link href="/" className="group flex items-center gap-3" aria-label="LockOps Pro home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 transition group-hover:-rotate-3"><Wrench size={21} strokeWidth={2.5} aria-hidden="true" /></span>
          <span><span className="block text-[15px] font-black tracking-tight">LockOps Pro</span><span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Locksmith operations</span></span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-bold text-slate-300 lg:flex" aria-label="Public navigation">
          <Link href="/features" className="transition hover:text-white">Features</Link>
          <Link href="/locksmith-dispatch-software" className="transition hover:text-white">Dispatch</Link>
          <Link href="/locksmith-field-service-management" className="transition hover:text-white">Field work</Link>
          <Link href="/locksmith-business-management" className="transition hover:text-white">For owners</Link>
          <Link href="/contact" className="transition hover:text-white">Contact</Link>
        </nav>
        <Link href="/login" className="button-amber">Sign in <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </header>
  );
}

export function PublicMarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-slate-950 px-5 py-10 text-slate-400 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-[1fr_auto]">
        <div>
          <Link href="/" className="flex items-center gap-3 text-white"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-slate-950"><Wrench size={18} aria-hidden="true" /></span><span className="font-black tracking-tight">LockOps Pro</span></Link>
          <p className="mt-4 max-w-md text-sm leading-6">Mobile-first operations management for locksmith businesses that want every job, handoff, and dollar accounted for.</p>
        </div>
        <nav className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm font-bold sm:grid-cols-3" aria-label="Public footer navigation">
          <Link href="/features" className="transition hover:text-white">Features</Link>
          <Link href="/locksmith-dispatch-software" className="transition hover:text-white">Dispatch</Link>
          <Link href="/locksmith-field-service-management" className="transition hover:text-white">Field work</Link>
          <Link href="/locksmith-business-management" className="transition hover:text-white">For owners</Link>
          <Link href="/locksmith-job-costing" className="transition hover:text-white">Job costing</Link>
          <Link href="/contact" className="transition hover:text-white">Contact</Link>
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-7xl text-xs text-slate-600">LockOps Pro © 2026 · Operations across North America, including the United States, Canada, and Mexico.</p>
    </footer>
  );
}
