'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Building2,
  Calculator,
  Camera,
  Car,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  FileCheck,
  Home,
  Landmark,
  MapPin,
  Menu,
  Phone,
  Receipt,
  Route,
  Smartphone,
  Sparkles,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { AppRole } from '@/lib/session';
import { siteUrl } from '@/lib/site';

interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: AppRole;
}

type Icon = typeof ArrowRight;

const workflow = [
  { step: '01', title: 'Capture the call', description: 'Turn a ringing phone into a complete job record in seconds.', icon: Phone, tone: 'blue' },
  { step: '02', title: 'Dispatch with clarity', description: 'Assign the right technician with the details they need to move.', icon: Route, tone: 'amber' },
  { step: '03', title: 'Work from the field', description: 'Give your team a focused mobile workflow for every job.', icon: Smartphone, tone: 'emerald' },
  { step: '04', title: 'Close out cleanly', description: 'Capture proof, payment, tax, commission, and the full job story.', icon: Receipt, tone: 'violet' },
];

const pillars: Array<{
  eyebrow: string;
  title: string;
  description: string;
  icon: Icon;
  tone: string;
  features: string[];
  href: string;
  linkLabel: string;
}> = [
  {
    eyebrow: 'For dispatch teams',
    title: 'Move from call to technician without the scramble.',
    description: 'Keep intake, scheduling, assignment, and job status in one calm command center.',
    icon: ClipboardList,
    tone: 'blue',
    features: ['Fast customer and service intake', 'Technician assignment and commission rates', 'Scheduled and historical jobs', 'Native SMS draft handoff'],
    href: '#features',
    linkLabel: 'Explore dispatch',
  },
  {
    eyebrow: 'For field technicians',
    title: 'A job workflow that works on the job site.',
    description: 'Give your team the right information, the next action, and a clean closeout on any phone.',
    icon: Wrench,
    tone: 'emerald',
    features: ['One-tap maps, calls, and job status', 'Key bitting, door, and vehicle details', 'Signatures and proof-of-work photos', 'Forward and reverse billing calculations'],
    href: '#field-work',
    linkLabel: 'Explore field work',
  },
  {
    eyebrow: 'For owners',
    title: 'Know what the business is doing, not just what is busy.',
    description: 'Bring revenue, tax, commissions, cash handovers, calls, and marketing performance into view.',
    icon: BarChart3,
    tone: 'violet',
    features: ['Revenue, HST, profit, and payment KPIs', 'Contractor cash-in-hand ledger', 'Call conversion and marketing ROI', 'Team access and accountant-ready exports'],
    href: '#owner-control',
    linkLabel: 'Explore owner control',
  },
];

const featureGroups: Array<{ title: string; description: string; icon: Icon; items: string[] }> = [
  {
    title: 'Dispatch and call intake',
    description: 'Everything your dispatcher needs to turn a call into a job your technician can act on.',
    icon: Phone,
    items: ['Rapid call logging with customer, phone, extension, address, and problem details', 'Service types for lockouts, rekeys, commercial work, and more', 'Technician assignment with configured commission rates', 'Scheduled appointments and intake windows', 'Manual entry for completed or historical jobs', 'Automotive fields for year, make, model, VIN, key type, and FCC ID', 'Native Messages draft handoff for technician assignments', 'Job lists, status visibility, and role-based access'],
  },
  {
    title: 'Mobile technician workflow',
    description: 'A focused field experience that keeps the next action obvious and the record complete.',
    icon: Smartphone,
    items: ['Mobile-first one-hand job queue', 'One-tap acknowledgment and status progression', 'One-tap Google Maps or Apple Maps navigation', 'Direct customer calling with extensions supported', 'Key bitting and door/cam specification capture', 'Pre-work authorization and customer completion signatures', 'Proof-of-work photo attachment', 'Commission visibility for assigned technicians'],
  },
  {
    title: 'Payment and job closeout',
    description: 'Close the loop with accurate totals, clear payment status, and less room for disputes.',
    icon: CircleDollarSign,
    items: ['Forward billing: labor plus parts plus Ontario HST', 'Reverse billing from the total amount collected', 'Abandoned-job travel fee handling', 'Cash and Interac payment capture', 'Payment status and method tracking', 'Customer invoice and receipt communication where enabled', 'Stripe-hosted payment links where configured and verified', 'Structured request IDs and failure logging for supportability'],
  },
  {
    title: 'Owner control and reporting',
    description: 'See the operational and financial signals that help you run a better locksmith business.',
    icon: BarChart3,
    items: ['Gross revenue, payment splits, HST, and net-profit KPIs', 'Contractor cash-in-hand ledger and commission tracking', 'Cash handover settlements with audit notes', 'RingCentral inbound call and conversion analytics where configured', 'Google Ads ROI view where configured', 'CSV export for accountant and QuickBooks workflows', 'Team member creation and role management', 'Admin, dispatcher, and technician access controls'],
  },
];

const audienceCards = [
  { title: 'Owners', description: 'Protect margin, reduce cash leakage, and see how every lead becomes revenue.', icon: Landmark, href: '#owner-control', accent: 'text-violet-700 bg-violet-100' },
  { title: 'Dispatchers', description: 'Keep the phones moving and give every technician a job they can execute.', icon: Phone, href: '#features', accent: 'text-blue-700 bg-blue-100' },
  { title: 'Technicians', description: 'Spend less time hunting for details and more time completing the job right.', icon: Wrench, href: '#field-work', accent: 'text-emerald-700 bg-emerald-100' },
];

const roadmapItems = ['Customer history and repeat-customer profiles', 'Quote templates and approval tracking', 'Automated customer status messages with delivery status', 'Commercial maintenance reminders and renewals', 'Parts and key-blank inventory with low-stock alerts', 'Route planning, service-area pricing, and expense tracking'];

const faqs = [
  { question: 'Who is LockOps Pro built for?', answer: 'LockOps Pro is designed for locksmith owners, dispatchers, and field technicians who need one connected workflow for incoming calls, job execution, payment, and business reporting.' },
  { question: 'Can technicians use it from their phones?', answer: 'Yes. The technician experience is mobile-first, with one-tap navigation, customer calling, job status actions, billing, signatures, and proof-of-work photo capture.' },
  { question: 'Does LockOps automatically send SMS messages?', answer: 'The current workflow prepares a native Messages draft for review and sending on the user’s device. It does not claim delivery or silently send messages on your behalf.' },
  { question: 'How are roles and access handled?', answer: 'The current app supports Admin, Dispatcher, and Technician roles. Each role sees the workspace and actions appropriate to their job, while Admins can manage team members.' },
  { question: 'Does it support cash, Interac, and card workflows?', answer: 'Cash and Interac are supported for job closeout and cash-ledger tracking. Stripe-hosted payment links are available where the payment integration is configured and verified for the deployment.' },
  { question: 'Can I track HST and contractor handovers?', answer: 'Yes. The app supports Ontario HST calculations, tax visibility, technician commissions, contractor cash-in-hand balances, and recorded cash handover settlements.' },
];

function toneClasses(tone: string) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700 ring-blue-200',
    amber: 'bg-amber-100 text-amber-700 ring-amber-200',
    emerald: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    violet: 'bg-violet-100 text-violet-700 ring-violet-200',
  };
  return tones[tone] || tones.blue;
}

function IconBox({ icon: IconComponent, tone = 'blue', className = '' }: { icon: Icon; tone?: string; className?: string }) {
  return <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ${toneClasses(tone)} ${className}`}><IconComponent size={20} strokeWidth={2.2} aria-hidden="true" /></div>;
}

function AuthAction({ user, loading }: { user: AuthUser | null; loading: boolean }) {
  if (loading) return <span className="hidden text-sm font-bold text-slate-300 sm:inline">Checking workspace…</span>;
  if (!user) return <Link href="/login" className="button-amber whitespace-nowrap">Enter workspace <ArrowRight size={16} aria-hidden="true" /></Link>;

  const destination = getWorkspaceDestination(user);
  const label = user.role === 'ADMIN' ? 'Open Admin Hub' : user.role === 'DISPATCHER' ? 'Open Dispatch' : 'Open My Jobs';
  return <Link href={destination} className="button-amber whitespace-nowrap">{label} <ArrowRight size={16} aria-hidden="true" /></Link>;
}

function getWorkspaceDestination(user: AuthUser | null) {
  if (!user) return '/login';
  return user.role === 'ADMIN' ? '/owner' : user.role === 'DISPATCHER' ? '/dispatch' : '/tech';
}

export default function HomePage() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => { if (mounted && data.success && data.user) setCurrentUser(data.user); })
      .catch(() => { /* The public page works without a session response. */ })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="overflow-hidden bg-[#f8fafc] text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'Organization',
                '@id': `${siteUrl}/#organization`,
                name: 'LockOps Pro',
                url: siteUrl,
                email: 'info@locksmithsnearme.ca',
                areaServed: ['US', 'CA', 'MX'],
                knowsAbout: ['locksmith dispatch', 'field service management', 'job costing', 'technician workflows', 'cash reconciliation'],
              },
              {
                '@type': 'SoftwareApplication',
                '@id': `${siteUrl}/#software`,
                name: 'LockOps Pro',
                url: siteUrl,
                applicationCategory: 'BusinessApplication',
                operatingSystem: 'Web',
                description: 'Mobile-first operations management for locksmith businesses.',
                provider: { '@id': `${siteUrl}/#organization` },
              },
              {
                '@type': 'WebSite',
                '@id': `${siteUrl}/#website`,
                name: 'LockOps Pro',
                url: siteUrl,
                publisher: { '@id': `${siteUrl}/#organization` },
              },
            ],
          }),
        }}
      />
      <header className="absolute inset-x-0 top-0 z-50">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
          <Link href="/" className="group flex items-center gap-3" aria-label="LockOps Pro home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 transition group-hover:-rotate-3"><Wrench size={21} strokeWidth={2.5} aria-hidden="true" /></span>
            <span><span className="block text-[15px] font-black tracking-tight text-white">LockOps Pro</span><span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Locksmith operations</span></span>
          </Link>

          <nav className="hidden items-center gap-8 lg:flex" aria-label="Public navigation">
            <a href="#workflow" className="public-nav-link">How it works</a><a href="#features" className="public-nav-link">Features</a><a href="#owner-control" className="public-nav-link">For owners</a><a href="#faq" className="public-nav-link">FAQ</a><Link href="/contact" className="public-nav-link">Contact</Link>
          </nav>

          <div className="hidden items-center gap-4 sm:flex"><Link href="/login" className="text-sm font-bold text-slate-200 transition hover:text-white">Sign in</Link><AuthAction user={currentUser} loading={loading} /></div>
          <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white sm:hidden" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}</button>
        </div>

        {menuOpen && <div className="mx-5 rounded-2xl border border-white/10 bg-slate-900/95 p-3 shadow-2xl backdrop-blur sm:hidden"><nav className="grid gap-1" aria-label="Mobile public navigation">{[['#workflow', 'How it works'], ['#features', 'Features'], ['#owner-control', 'For owners'], ['#faq', 'FAQ']].map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-3 text-sm font-bold text-slate-200 hover:bg-white/10">{label}</a>)}<Link href="/contact" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-3 text-sm font-bold text-slate-200 hover:bg-white/10">Contact</Link><Link href={getWorkspaceDestination(currentUser)} onClick={() => setMenuOpen(false)} className="mt-2 rounded-xl bg-amber-400 px-3 py-3 text-center text-sm font-black text-slate-950">{currentUser ? 'Open your workspace' : 'Sign in to LockOps'}</Link></nav></div>}
      </header>

      <div>
        <section className="hero-grid relative isolate overflow-hidden bg-slate-950 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_15%,rgba(37,99,235,0.22),transparent_31%),radial-gradient(circle_at_15%_70%,rgba(245,158,11,0.11),transparent_26%)]" aria-hidden="true" />
          <div className="relative mx-auto grid min-h-[760px] max-w-7xl items-center gap-16 px-5 pb-20 pt-36 sm:px-8 lg:grid-cols-[1.03fr_0.97fr] lg:px-10 lg:pb-24 lg:pt-40">
            <div className="max-w-2xl"><div className="mb-7 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-amber-200"><Sparkles size={14} aria-hidden="true" />The locksmith business command center</div><h1 className="max-w-3xl text-5xl font-black leading-[0.98] tracking-[-0.045em] text-white sm:text-6xl lg:text-[5.4rem]">Run every job from <span className="text-amber-300">first call</span> to final payment.</h1><p className="mt-7 max-w-xl text-lg leading-8 text-slate-300 sm:text-xl">LockOps Pro gives locksmith owners, dispatchers, and field technicians one fast workspace for dispatching work, closing jobs, collecting payment, and knowing exactly where the business stands.</p><div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center"><AuthAction user={currentUser} loading={loading} /><a href="#workflow" className="button-ghost">See how it works <ArrowRight size={16} aria-hidden="true" /></a></div><div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-slate-400"><span className="inline-flex items-center gap-2"><Check size={16} className="text-emerald-400" aria-hidden="true" />Built for the field</span><span className="inline-flex items-center gap-2"><Check size={16} className="text-emerald-400" aria-hidden="true" />Role-based access</span><span className="inline-flex items-center gap-2"><Check size={16} className="text-emerald-400" aria-hidden="true" />Mobile-first</span></div></div>

            <div className="relative mx-auto w-full max-w-[580px] lg:ml-auto"><div className="absolute -inset-8 rounded-[3rem] bg-blue-500/10 blur-3xl" aria-hidden="true" /><div className="relative rounded-[2rem] border border-white/15 bg-white/[0.08] p-3 shadow-2xl shadow-black/30 backdrop-blur-sm"><div className="rounded-[1.45rem] bg-slate-100 p-4 text-slate-900 sm:p-5"><div className="flex items-center justify-between border-b border-slate-200 pb-4"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Today at a glance</p><p className="mt-1 text-lg font-black tracking-tight">Your operation, in motion.</p></div><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-amber-300"><Wrench size={17} aria-hidden="true" /></span></div><div className="grid grid-cols-3 gap-2.5 py-4">{[['12', 'Active jobs', 'text-blue-600'], ['$4.8k', 'Collected', 'text-emerald-600'], ['86%', 'Completed', 'text-violet-600']].map(([value, label, color]) => <div key={label} className="rounded-2xl bg-white p-3 shadow-sm"><p className={`text-lg font-black tracking-tight ${color}`}>{value}</p><p className="mt-0.5 text-[10px] font-bold text-slate-400">{label}</p></div>)}</div><div className="rounded-2xl bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><Phone size={16} aria-hidden="true" /></span><div><p className="text-xs font-black">New service call</p><p className="text-[10px] text-slate-400">Job #9815 · Lockout</p></div></div><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">New</span></div><div className="grid grid-cols-2 gap-2 text-[11px]"><div className="rounded-xl bg-slate-50 p-2.5"><p className="font-bold text-slate-800">Sample customer</p><p className="mt-1 text-slate-400">Customer phone</p></div><div className="rounded-xl bg-slate-50 p-2.5"><p className="font-bold text-slate-800">Service area</p><p className="mt-1 text-slate-400">Residential lockout</p></div></div><div className="mt-3 flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2.5 text-white"><span className="text-[11px] font-bold">Assign a technician</span><span className="flex items-center gap-1 text-[11px] font-black text-amber-300">Dispatch <ArrowRight size={13} aria-hidden="true" /></span></div></div><div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-emerald-50 p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Field status</span><span className="h-2 w-2 rounded-full bg-emerald-500" /></div><p className="mt-2 text-sm font-black text-slate-900">On the way</p><p className="mt-1 text-[10px] text-slate-500">Sample job · #9812</p></div><div className="rounded-2xl bg-violet-50 p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-wider text-violet-700">Cash ledger</span><Banknote size={14} className="text-violet-500" aria-hidden="true" /></div><p className="mt-2 text-sm font-black text-slate-900">$1,240.00</p><p className="mt-1 text-[10px] text-slate-500">Pending handover</p></div></div></div></div><div className="absolute -bottom-5 -left-4 hidden items-center gap-3 rounded-2xl border border-white/15 bg-slate-900/90 px-4 py-3 shadow-xl backdrop-blur sm:flex"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300"><BadgeCheck size={18} aria-hidden="true" /></span><div><p className="text-xs font-black text-white">Proof of work captured</p><p className="text-[10px] text-slate-400">Signature + photo attached</p></div></div></div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white" aria-label="Product capabilities"><div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-slate-200 px-5 sm:grid-cols-4 sm:px-8 lg:px-10">{[['One workflow', 'From call to closeout'], ['Three roles', 'Owner, dispatch, field'], ['Built for work', 'Mobile-first by design'], ['Clear numbers', 'Revenue to reconciliation']].map(([title, label]) => <div key={title} className="px-3 py-6 first:pl-0 sm:px-6 lg:py-8"><p className="text-sm font-black tracking-tight text-slate-900 sm:text-base">{title}</p><p className="mt-1 text-[11px] font-semibold leading-4 text-slate-500 sm:text-xs">{label}</p></div>)}</div></section>

        <section className="bg-white px-5 py-20 sm:px-8 lg:px-10 lg:py-28"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-end"><div><p className="section-kicker">The problem</p><h2 className="section-title mt-4">Your business is too important to run from scattered messages.</h2></div><div className="max-w-2xl lg:pb-1"><p className="text-lg leading-8 text-slate-600">When calls live in one place, job details in another, and cash handovers in someone’s memory, every handoff creates risk. LockOps gives the whole team one accountable job record.</p><div className="mt-7 grid gap-3 sm:grid-cols-3">{[['Missed context', 'No more asking the customer to repeat the story.'], ['Unclear status', 'Know who owns the next action on every job.'], ['Leaky closeout', 'Connect proof, payment, commission, and tax.']].map(([title, description]) => <div key={title} className="border-l-2 border-amber-400 pl-3"><p className="text-sm font-black text-slate-900">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>)}</div></div></div></section>

        <section id="workflow" className="scroll-mt-8 bg-slate-950 px-5 py-20 text-white sm:px-8 lg:px-10 lg:py-28"><div className="mx-auto max-w-7xl"><div className="max-w-2xl"><p className="section-kicker text-amber-300">One connected workflow</p><h2 className="section-title mt-4 text-white">Every handoff is a chance to run a tighter operation.</h2><p className="mt-5 text-lg leading-8 text-slate-400">LockOps keeps the job moving while preserving the details your team and your books need at the end of the day.</p></div><div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">{workflow.map(({ step, title, description, icon: IconComponent, tone }, index) => <div key={step} className="relative border-t border-white/15 pt-5">{index < workflow.length - 1 && <span className="absolute right-0 top-[-1px] hidden h-px w-5 bg-amber-300 lg:block" aria-hidden="true" />}<div className="flex items-center justify-between"><span className="text-xs font-black tracking-[0.2em] text-slate-500">{step}</span><IconBox icon={IconComponent} tone={tone} /></div><h3 className="mt-6 text-xl font-black tracking-tight">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-400">{description}</p></div>)}</div></div></section>

        <section id="features" className="scroll-mt-8 bg-[#f8fafc] px-5 py-20 sm:px-8 lg:px-10 lg:py-28"><div className="mx-auto max-w-7xl"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div className="max-w-2xl"><p className="section-kicker">Built around real roles</p><h2 className="section-title mt-4">One platform. Three teams. A much clearer day.</h2></div><p className="max-w-md text-sm leading-6 text-slate-500 lg:pb-1">The best operations software does not add another screen. It gives each person the right screen for the work in front of them.</p></div><div className="mt-12 grid gap-5 lg:grid-cols-3">{pillars.map(({ eyebrow, title, description, icon: IconComponent, tone, features, href, linkLabel }) => <article key={title} className="group flex flex-col rounded-[1.65rem] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl sm:p-7"><IconBox icon={IconComponent} tone={tone} /><p className="mt-7 text-xs font-black uppercase tracking-[0.17em] text-slate-400">{eyebrow}</p><h3 className="mt-3 text-2xl font-black leading-tight tracking-[-0.03em] text-slate-900">{title}</h3><p className="mt-4 text-sm leading-6 text-slate-600">{description}</p><ul className="mt-7 space-y-3 border-t border-slate-100 pt-6">{features.map((feature) => <li key={feature} className="flex gap-2.5 text-sm font-semibold leading-5 text-slate-700"><Check size={17} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />{feature}</li>)}</ul><a href={href} className="mt-8 inline-flex items-center gap-2 text-sm font-black text-slate-900 transition group-hover:text-blue-700">{linkLabel} <ArrowRight size={16} aria-hidden="true" /></a></article>)}</div></div></section>

        <section className="bg-white px-5 py-20 sm:px-8 lg:px-10 lg:py-28"><div className="mx-auto max-w-7xl"><div className="max-w-2xl"><p className="section-kicker">The complete feature set</p><h2 className="section-title mt-4">Every detail that keeps a locksmith job moving.</h2><p className="mt-5 text-lg leading-8 text-slate-600">From the first phone number to the final handover, LockOps is designed around the way locksmith work actually happens.</p></div><div className="mt-12 grid gap-4 md:grid-cols-2">{featureGroups.map(({ title, description, icon: IconComponent, items }) => <article key={title} className="rounded-[1.65rem] border border-slate-200 bg-slate-50 p-6 sm:p-7"><div className="flex items-start gap-4"><IconBox icon={IconComponent} tone="blue" /><div><h3 className="text-xl font-black tracking-tight text-slate-900">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div></div><ul className="mt-6 grid gap-3 border-t border-slate-200 pt-6 sm:grid-cols-2">{items.map((item) => <li key={item} className="flex gap-2 text-sm leading-5 text-slate-700"><Check size={16} className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />{item}</li>)}</ul></article>)}</div></div></section>

        <section id="field-work" className="scroll-mt-8 bg-slate-900 px-5 py-20 text-white sm:px-8 lg:px-10 lg:py-28"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center"><div><p className="section-kicker text-emerald-300">Made for the job site</p><h2 className="section-title mt-4 text-white">The field team gets clarity, not clutter.</h2><p className="mt-5 text-lg leading-8 text-slate-400">A locksmith does not need an office dashboard in their pocket. They need the address, the customer, the next action, and a reliable way to close the job.</p><div className="mt-8 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><MapPin size={19} className="text-emerald-300" aria-hidden="true" /><p className="mt-3 text-sm font-black">Arrive prepared</p><p className="mt-1 text-xs leading-5 text-slate-400">Maps, call, key, door, and vehicle details in one place.</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><FileCheck size={19} className="text-emerald-300" aria-hidden="true" /><p className="mt-3 text-sm font-black">Leave proof behind</p><p className="mt-1 text-xs leading-5 text-slate-400">Signatures and photos create a clearer customer record.</p></div></div></div><div className="relative rounded-[2rem] border border-white/10 bg-white/[0.07] p-4 sm:p-6"><div className="rounded-[1.5rem] bg-slate-100 p-4 text-slate-900 sm:p-5"><div className="flex items-center justify-between border-b border-slate-200 pb-4"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Job #9815</p><p className="mt-1 text-lg font-black">Residential lockout</p></div><span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black text-blue-700">On site</span></div><div className="mt-4 rounded-2xl bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black">Sample customer</p><p className="mt-1 text-xs text-slate-500">Service address · Unit 402</p></div><div className="flex gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Phone size={15} aria-hidden="true" /></span><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><MapPin size={15} aria-hidden="true" /></span></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Door details</p><p className="mt-1 text-xs font-bold">Mortise · 1-1/8 backset</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Key bitting</p><p className="mt-1 text-xs font-bold">SC1 · 3-5-2-1-4</p></div></div></div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-xl bg-emerald-50 p-3 text-center"><BadgeCheck size={18} className="mx-auto text-emerald-600" aria-hidden="true" /><p className="mt-2 text-[10px] font-black text-emerald-800">Signature</p></div><div className="rounded-xl bg-amber-50 p-3 text-center"><Camera size={18} className="mx-auto text-amber-600" aria-hidden="true" /><p className="mt-2 text-[10px] font-black text-amber-800">Photo</p></div><div className="rounded-xl bg-violet-50 p-3 text-center"><Calculator size={18} className="mx-auto text-violet-600" aria-hidden="true" /><p className="mt-2 text-[10px] font-black text-violet-800">Invoice</p></div></div></div></div></div></section>

        <section id="owner-control" className="scroll-mt-8 bg-white px-5 py-20 sm:px-8 lg:px-10 lg:py-28"><div className="mx-auto max-w-7xl"><div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-end"><div><p className="section-kicker">Owner control</p><h2 className="section-title mt-4">Run the business behind the jobs.</h2></div><p className="max-w-2xl text-lg leading-8 text-slate-600">Your job count is not the whole story. LockOps connects completed work to revenue, HST, commissions, cash handovers, call conversion, and growth signals.</p></div><div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[[CircleDollarSign, 'Revenue clarity', 'Gross revenue, payment splits, HST, and net profit in one view.', 'violet'], [Banknote, 'Cash accountability', 'Know what each contractor holds and record every handover.', 'emerald'], [BarChart3, 'Call conversion', 'See received versus converted calls when RingCentral is connected.', 'blue'], [Users, 'Team control', 'Manage roles, commission rates, active status, and access.', 'amber']].map(([IconComponent, title, description, tone]) => { const FeatureIcon = IconComponent as Icon; return <div key={title as string} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5"><IconBox icon={FeatureIcon} tone={tone as string} /><h3 className="mt-5 text-lg font-black tracking-tight">{title as string}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{description as string}</p></div>; })}</div><div className="mt-5 flex flex-col gap-5 rounded-[1.75rem] border border-violet-100 bg-violet-50 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between"><div className="flex gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-200 text-violet-700"><Landmark size={20} aria-hidden="true" /></span><div><p className="text-lg font-black tracking-tight text-slate-900">A better end-of-day handoff</p><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Export the records your accountant needs, settle contractor cash with notes, and keep the operational story attached to the money.</p></div></div><Link href="/login" className="inline-flex shrink-0 items-center gap-2 text-sm font-black text-violet-800">Open the owner hub <ArrowRight size={16} aria-hidden="true" /></Link></div></div></section>

        <section className="bg-[#f8fafc] px-5 py-20 sm:px-8 lg:px-10 lg:py-28"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-center"><div><p className="section-kicker">Built for locksmith work</p><h2 className="section-title mt-4">Residential, commercial, and automotive — without forcing every job into the same box.</h2><p className="mt-5 text-lg leading-8 text-slate-600">Capture the details that make locksmith work different, while keeping the workflow simple enough to use on a busy day.</p></div><div className="grid gap-4 sm:grid-cols-3">{[[Home, 'Residential', 'Lockouts, rekeys, entry, and customer proof.', 'blue'], [Building2, 'Commercial', 'Hardware, door details, scheduled service, and follow-up.', 'violet'], [Car, 'Automotive', 'Vehicle identity, key type, VIN, and FCC ID details.', 'amber']].map(([IconComponent, title, description, tone]) => { const FeatureIcon = IconComponent as Icon; return <div key={title as string} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm"><IconBox icon={FeatureIcon} tone={tone as string} /><h3 className="mt-5 text-lg font-black tracking-tight">{title as string}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{description as string}</p></div>; })}</div></div></section>

        <section className="bg-white px-5 py-20 sm:px-8 lg:px-10 lg:py-24"><div className="mx-auto max-w-7xl"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="section-kicker">Choose your vantage point</p><h2 className="section-title mt-4">Built for the whole team.</h2></div><p className="max-w-md text-sm leading-6 text-slate-500">Everyone gets a focused workflow. Everyone contributes to the same job record.</p></div><div className="mt-10 grid gap-4 md:grid-cols-3">{audienceCards.map(({ title, description, icon: IconComponent, href, accent }) => <a key={title} href={href} className="group flex gap-4 rounded-[1.5rem] border border-slate-200 p-5 transition hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${accent}`}><IconComponent size={20} aria-hidden="true" /></span><span><span className="block text-lg font-black tracking-tight text-slate-900">{title}</span><span className="mt-1 block text-sm leading-6 text-slate-600">{description}</span><span className="mt-4 inline-flex items-center gap-1 text-xs font-black text-slate-500 transition group-hover:text-slate-900">See your workflow <ArrowRight size={14} aria-hidden="true" /></span></span></a>)}</div></div></section>

        <section className="bg-slate-950 px-5 py-20 text-white sm:px-8 lg:px-10 lg:py-24"><div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-center"><div><p className="section-kicker text-amber-300">Next for LockOps</p><h2 className="section-title mt-4 text-white">The platform keeps getting closer to the whole business.</h2><p className="mt-5 text-lg leading-8 text-slate-400">These are roadmap opportunities, not features we are pretending are already live.</p></div><div className="grid gap-3 sm:grid-cols-2">{roadmapItems.map((item) => <div key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm font-semibold text-slate-200"><Sparkles size={17} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />{item}</div>)}</div></div></section>

        <section id="faq" className="scroll-mt-8 bg-[#f8fafc] px-5 py-20 sm:px-8 lg:px-10 lg:py-28"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.7fr_1.3fr]"><div><p className="section-kicker">Questions, answered</p><h2 className="section-title mt-4">The practical stuff matters.</h2><p className="mt-5 text-lg leading-8 text-slate-600">A serious operations platform should be clear about what it does, how the team uses it, and where integrations fit.</p></div><div className="divide-y divide-slate-200 rounded-[1.5rem] border border-slate-200 bg-white px-5 sm:px-7">{faqs.map(({ question, answer }, index) => { const isOpen = openFaq === index; return <div key={question}><button type="button" className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-black text-slate-900" aria-expanded={isOpen} onClick={() => setOpenFaq(isOpen ? null : index)}><span>{question}</span><ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" /></button>{isOpen && <p className="-mt-1 pb-5 pr-8 text-sm leading-6 text-slate-600">{answer}</p>}</div>; })}</div></div></section>

        <section className="bg-amber-400 px-5 py-16 sm:px-8 lg:px-10 lg:py-20"><div className="mx-auto flex max-w-7xl flex-col gap-7 lg:flex-row lg:items-center lg:justify-between"><div className="max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-950/60">Make the next job easier</p><h2 className="mt-3 text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl">Your locksmith operation deserves a system built around the work.</h2></div><div className="flex flex-col gap-3 sm:flex-row"><AuthAction user={currentUser} loading={loading} /><a href="#workflow" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-950/20 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-white/20">Walk through the workflow <ArrowRight size={16} aria-hidden="true" /></a></div></div></section>
      </div>

      <footer className="bg-slate-950 px-5 py-10 text-slate-400 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-end sm:justify-between"><div><Link href="/" className="flex items-center gap-3 text-white"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-slate-950"><Wrench size={18} aria-hidden="true" /></span><span className="font-black tracking-tight">LockOps Pro</span></Link><p className="mt-4 max-w-sm text-sm leading-6">Mobile-first operations management for locksmith businesses that want every job, handoff, and dollar accounted for.</p></div><div className="flex flex-col gap-3 text-sm sm:items-end"><div className="flex gap-5 font-bold"><a href="#features" className="transition hover:text-white">Features</a><a href="#faq" className="transition hover:text-white">FAQ</a><Link href="/contact" className="transition hover:text-white">Contact</Link><Link href="/login" className="transition hover:text-white">Sign in</Link></div><p className="text-xs text-slate-500">LockOps Pro © 2026 · Field Service Operations Platform</p></div></div></footer>
      <div className="fixed inset-x-4 bottom-4 z-40 sm:hidden"><Link href={getWorkspaceDestination(currentUser)} className="flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3.5 text-sm font-black text-white shadow-2xl shadow-slate-900/30">{currentUser ? 'Open your workspace' : 'Sign in to LockOps'} <ArrowRight size={16} aria-hidden="true" /></Link></div>
    </div>
  );
}
