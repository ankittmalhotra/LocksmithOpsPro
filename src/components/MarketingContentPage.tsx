import Link from 'next/link';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { siteUrl } from '@/lib/site';
import type { MarketingPageDefinition } from '@/lib/public-seo-pages';
import { PublicMarketingFooter, PublicMarketingHeader } from '@/components/PublicMarketingShell';
import Breadcrumbs from '@/components/Breadcrumbs';

export default function MarketingContentPage({ page }: { page: MarketingPageDefinition }) {
  const breadcrumbItems = page.path === '/features'
    ? [{ label: 'Home', href: '/' }, { label: page.breadcrumbLabel }]
    : [{ label: 'Home', href: '/' }, { label: 'Features', href: '/features' }, { label: page.breadcrumbLabel }];

  return (
    <div className="min-h-full bg-slate-950 text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'WebPage',
                '@id': `${siteUrl}${page.path}#webpage`,
                url: `${siteUrl}${page.path}`,
                name: page.seoTitle,
                description: page.description,
                isPartOf: { '@id': `${siteUrl}/#website` },
                about: { '@type': 'SoftwareApplication', name: 'LockOps Pro', applicationCategory: 'BusinessApplication', operatingSystem: 'Web' },
                publisher: { '@type': 'Organization', name: 'LockOps Pro', url: siteUrl, email: 'info@locksmithsnearme.ca' },
                breadcrumb: { '@id': `${siteUrl}${page.path}#breadcrumb` },
              },
              {
                '@type': 'BreadcrumbList',
                '@id': `${siteUrl}${page.path}#breadcrumb`,
                itemListElement: breadcrumbItems.map((item, index) => ({
                  '@type': 'ListItem',
                  position: index + 1,
                  name: item.label,
                  ...(item.href ? { item: `${siteUrl}${item.href}` } : {}),
                })),
              },
            ],
          }),
        }}
      />
      <PublicMarketingHeader />
      <Breadcrumbs items={breadcrumbItems} dark />
      <main>
        <section className="hero-grid border-b border-white/10">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:py-28">
            <div>
              <p className="section-kicker text-amber-300">{page.eyebrow}</p>
              <h1 className="mt-5 max-w-4xl text-5xl font-black leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl">{page.title}</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">{page.intro}</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center"><Link href="/contact" className="button-amber">Talk with LockOps Pro <ArrowRight size={16} aria-hidden="true" /></Link><Link href="/features" className="button-ghost">See all features <ArrowRight size={16} aria-hidden="true" /></Link></div>
            </div>
            <div className="rounded-[2rem] border border-white/15 bg-white/[0.08] p-3 shadow-2xl shadow-black/20 backdrop-blur-sm">
              <div className="rounded-[1.5rem] bg-white p-6 text-slate-900 sm:p-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><Sparkles size={22} aria-hidden="true" /></div>
                <p className="mt-7 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Why this matters</p>
                <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{page.highlightTitle}</h2>
                <p className="mt-4 text-sm leading-7 text-slate-600">{page.highlightText}</p>
                <div className="mt-6 border-t border-slate-200 pt-5 text-sm font-bold text-slate-700"><span className="text-emerald-600">●</span> One connected locksmith operation</div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-20 text-slate-900 sm:px-8 lg:px-10 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-5 lg:grid-cols-2">
              {page.sections.map((section, index) => (
                <article key={section.title} className="rounded-[1.65rem] border border-slate-200 bg-slate-50 p-6 sm:p-8">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">{section.label || `0${index + 1}`}</p>
                  <h2 className="mt-4 text-2xl font-black leading-tight tracking-[-0.03em]">{section.title}</h2>
                  <p className="mt-4 text-sm leading-7 text-slate-600">{section.body}</p>
                  <ul className="mt-6 space-y-3 border-t border-slate-200 pt-6">
                    {section.bullets.map((bullet) => <li key={bullet} className="flex gap-2.5 text-sm font-semibold leading-5 text-slate-700"><Check size={17} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />{bullet}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#f8fafc] px-5 py-20 text-slate-900 sm:px-8 lg:px-10 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <p className="section-kicker">Keep exploring</p>
            <h2 className="section-title mt-4">See how the pieces connect.</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {page.related.map((item) => <Link key={item.href} href={item.href} className="group rounded-[1.5rem] border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-lg"><span className="text-lg font-black tracking-tight">{item.label}</span><span className="mt-2 block text-sm leading-6 text-slate-600">{item.description}</span><span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-blue-700">Explore <ArrowRight size={16} className="transition group-hover:translate-x-1" aria-hidden="true" /></span></Link>)}
            </div>
          </div>
        </section>

        <section className="bg-amber-400 px-5 py-16 text-slate-950 sm:px-8 lg:px-10 lg:py-20">
          <div className="mx-auto flex max-w-7xl flex-col gap-7 lg:flex-row lg:items-center lg:justify-between"><div className="max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-950/60">Built around your operation</p><h2 className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-4xl">Have a workflow question?</h2><p className="mt-4 max-w-xl text-base leading-7 text-slate-800">Tell us how your calls, technicians, closeouts, and reporting work today. We can show you where LockOps Pro fits.</p></div><Link href="/contact" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800">Contact LockOps Pro <ArrowRight size={16} aria-hidden="true" /></Link></div>
        </section>
      </main>
      <PublicMarketingFooter />
    </div>
  );
}
