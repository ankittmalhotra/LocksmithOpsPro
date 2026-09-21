import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Globe2, Mail, Wrench } from 'lucide-react';
import { siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Contact LockOps Pro | Locksmith Operations Management',
  description: 'Contact LockOps Pro at info@locksmithsnearme.ca about locksmith dispatch, field operations, payments, and business management across North America.',
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact LockOps Pro',
    description: 'Talk with LockOps Pro about running a better locksmith operation across North America.',
    url: `${siteUrl}/contact`,
    type: 'website',
  },
};

export default function ContactPage() {
  return (
    <div className="min-h-full bg-slate-950 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ContactPage',
            '@id': `${siteUrl}/contact#webpage`,
            url: `${siteUrl}/contact`,
            name: 'Contact LockOps Pro',
            description: 'Contact LockOps Pro about locksmith dispatch, field operations, payments, and business management across North America.',
            mainEntity: {
              '@type': 'Organization',
              name: 'LockOps Pro',
              url: siteUrl,
              email: 'info@locksmithsnearme.ca',
              areaServed: [
                { '@type': 'Country', name: 'United States' },
                { '@type': 'Country', name: 'Canada' },
                { '@type': 'Country', name: 'Mexico' },
              ],
            },
          }),
        }}
      />
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
          <Link href="/" className="group flex items-center gap-3" aria-label="LockOps Pro home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 transition group-hover:-rotate-3"><Wrench size={21} strokeWidth={2.5} aria-hidden="true" /></span>
            <span><span className="block text-[15px] font-black tracking-tight text-white">LockOps Pro</span><span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Locksmith operations</span></span>
          </Link>
          <div className="flex items-center gap-4"><Link href="/" className="hidden text-sm font-bold text-slate-300 transition hover:text-white sm:inline">Back to home</Link><Link href="/login" className="button-amber">Sign in <ArrowRight size={16} aria-hidden="true" /></Link></div>
        </div>
      </header>

      <main>
        <section className="hero-grid border-b border-white/10"><div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-10 lg:py-28"><div><p className="section-kicker text-amber-300">Contact LockOps Pro</p><h1 className="mt-5 max-w-2xl text-5xl font-black leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl">Let’s make your operation easier to run.</h1><p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">Questions about dispatch, technician workflows, payment closeout, or owner reporting? Send us a note and tell us how your locksmith business works today.</p></div><div className="rounded-[2rem] border border-white/15 bg-white/[0.08] p-3 shadow-2xl shadow-black/20 backdrop-blur-sm"><div className="rounded-[1.5rem] bg-white p-6 text-slate-900 sm:p-8"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><Mail size={22} aria-hidden="true" /></div><p className="mt-7 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Email us directly</p><a href="mailto:info@locksmithsnearme.ca" className="mt-3 block break-all text-2xl font-black tracking-tight text-slate-950 transition hover:text-blue-700 sm:text-3xl">info@locksmithsnearme.ca</a><p className="mt-4 text-sm leading-6 text-slate-600">For product questions, partnership conversations, onboarding, or help understanding how LockOps Pro fits your team.</p><a href="mailto:info@locksmithsnearme.ca" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400">Start a conversation <ArrowRight size={16} aria-hidden="true" /></a></div></div></div></section>

        <section className="bg-white px-5 py-20 text-slate-900 sm:px-8 lg:px-10 lg:py-24"><div className="mx-auto grid max-w-7xl gap-5 sm:grid-cols-2"><div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-6 sm:p-7"><Globe2 size={22} className="text-blue-700" aria-hidden="true" /><h2 className="mt-5 text-xl font-black tracking-tight">Operations across North America</h2><p className="mt-3 text-sm leading-6 text-slate-600">Our operations cover North America, including the United States, Canada, and Mexico.</p></div><div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-6 sm:p-7"><Wrench size={22} className="text-emerald-700" aria-hidden="true" /><h2 className="mt-5 text-xl font-black tracking-tight">Built around locksmith work</h2><p className="mt-3 text-sm leading-6 text-slate-600">Tell us about your dispatch flow, field team, or reporting needs. We are building the operating system around the work.</p></div></div></section>
      </main>

      <footer className="border-t border-white/10 px-5 py-8 text-slate-400 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between"><p>LockOps Pro · Locksmith operations management</p><div className="flex gap-5 font-bold"><Link href="/" className="transition hover:text-white">Home</Link><Link href="/contact" className="text-white">Contact</Link><Link href="/login" className="transition hover:text-white">Sign in</Link></div></div></footer>
    </div>
  );
}
