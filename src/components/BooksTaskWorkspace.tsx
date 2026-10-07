'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { AccountingEntityCode } from '@/lib/accounting-types';
import LegacyBooksWorkspace from '@/components/LegacyBooksWorkspace';

type Section = 'overview' | 'expenses' | 'reimbursements' | 'billing' | 'reports';
type EntityOption = { code: AccountingEntityCode; legalName: string; capabilities: Record<string, boolean> };
type State = Record<string, any>;

const sectionForPath = (path: string): Section =>
  path.includes('/expenses') ? 'expenses'
    : path.includes('/reimbursements') ? 'reimbursements'
      : path.includes('/billing') ? 'billing'
        : path.includes('/reports') ? 'reports' : 'overview';

function money(cents: number | undefined) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents || 0) / 100);
}

function date(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}

function href(path: string, entityCode: AccountingEntityCode) {
  return `${path}?entityCode=${entityCode}`;
}

export default function BooksTaskWorkspace() {
  return <Suspense fallback={<main className='min-h-screen bg-slate-50 p-8'><div className='mx-auto h-56 max-w-7xl animate-pulse rounded-2xl bg-slate-200' /></main>}><BooksTaskWorkspaceContent /></Suspense>;
}

function BooksTaskWorkspaceContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const section = sectionForPath(pathname);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [entityCode, setEntityCode] = useState<AccountingEntityCode>('IT_MARKETING');
  const [accessReady, setAccessReady] = useState(false);
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    requestSequence.current += 1;
    setAccessReady(false);
    void (async () => {
      try {
        const response = await fetch('/api/books/access', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load Books access');
        const allowed = (result.entities || []) as EntityOption[];
        const requested = searchParams.get('entityCode') as AccountingEntityCode | null;
        const selected = allowed.some((entity) => entity.code === requested)
          ? requested!
          : allowed[0]?.code;
        if (!selected) throw new Error('No Books entity is available for this account.');
        if (!cancelled) {
          setEntities(allowed);
          setEntityCode(selected);
          setAccessReady(true);
        }
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : 'Unable to load Books'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams]);

  const selectedCapabilities = entities.find((entity) => entity.code === entityCode)?.capabilities || {};
  const isAdmin = Boolean(selectedCapabilities.isAdmin);

  const load = useCallback(async (externalSignal?: AbortSignal) => {
    if (!accessReady || !entityCode) return;
    const requestId = ++requestSequence.current;
    const controller = externalSignal ? null : new AbortController();
    const signal = externalSignal || controller?.signal;
    setLoading(true); setError('');
    try {
      // Expenses, Reimbursements and Billing mount the controlled task forms,
      // which load their own data. Only Overview and the IT Ads panel fetch here.
      if (section === 'expenses' && entityCode === 'IT_MARKETING' && isAdmin) {
        const adsResponse = await fetch('/api/books/ads-summary', { cache: 'no-store', signal });
        const ads = await adsResponse.json();
        if (!adsResponse.ok || !ads.success) throw new Error(ads.error || 'Unable to load recent Google Ads spend');
        if (requestId === requestSequence.current) setData({ adsSummary: ads });
        return;
      }
      const url = section === 'overview' ? `/api/books/summary?entityCode=${entityCode}` : null;
      if (!url) { if (requestId === requestSequence.current) setData({}); return; }
      const response = await fetch(url, { cache: 'no-store', signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load this Books task');
      if (requestId === requestSequence.current) setData(result);
    } catch (cause) {
      if (signal?.aborted || requestId !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Unable to load Books'); setData(null);
    } finally { if (requestId === requestSequence.current) setLoading(false); }
  }, [accessReady, entityCode, section, isAdmin]);

  useEffect(() => {
    if (!accessReady) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [accessReady, load]);

  const labels: Array<{ key: Section; label: string; path: string }> = [
    { key: 'overview', label: 'Overview', path: '/books' },
    { key: 'expenses', label: 'Expenses', path: '/books/expenses' },
    { key: 'reimbursements', label: 'Reimbursements', path: '/books/reimbursements' },
    { key: 'billing', label: 'Billing', path: '/books/billing' },
    { key: 'reports', label: 'Reports', path: '/books/reports' },
  ];
  const entityName = entities.find((entity) => entity.code === entityCode)?.legalName || (entityCode === 'IT_MARKETING' ? 'IT & Marketing' : 'Locksmith business');
  const activeCapabilities = (data?.capabilities || selectedCapabilities) as Record<string, boolean>;

  return <main className='min-h-screen bg-slate-50 px-4 pb-16 pt-8 sm:px-6 lg:px-8'>
    <div className='mx-auto max-w-7xl'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div><p className='text-xs font-black uppercase tracking-[0.2em] text-blue-700'>Books & accounting</p><h1 className='mt-2 text-3xl font-black tracking-tight text-slate-950'>Keep the books clear.</h1><p className='mt-2 max-w-2xl text-sm text-slate-500'>Choose the work you need to do. Financial records and partner billing remain separate from operational reporting.</p></div>
        <button onClick={() => void load()} className='rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700'>Refresh</button>
      </div>
      <div className='mt-6 flex flex-wrap gap-2' aria-label='Books tasks'>
        {labels.map((item) => <Link key={item.key} href={href(item.path, entityCode)} className={`rounded-xl px-4 py-2 text-sm font-black ${section === item.key ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>{item.label}</Link>)}
      </div>
      <div className='mt-4 flex flex-wrap items-center gap-2'><span className='text-xs font-bold uppercase tracking-wide text-slate-500'>Entity</span>{entities.map((entity) => <Link key={entity.code} href={href(pathname, entity.code)} className={`rounded-lg px-3 py-2 text-sm font-bold ${entity.code === entityCode ? 'bg-blue-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>{entity.code === 'IT_MARKETING' ? 'IT & Marketing' : 'Locksmith business'}</Link>)}<span className='text-sm text-slate-500'>{entityName}</span></div>
      {error && <p className='mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800'>{error}</p>}
      {loading ? <div className='mt-6 h-56 animate-pulse rounded-2xl bg-slate-200' /> : <BooksTaskContent section={section} data={data || {}} entityCode={entityCode} capabilities={activeCapabilities} />}
    </div>
  </main>;
}

function BooksTaskContent({ section, data, entityCode, capabilities }: { section: Section; data: State; entityCode: AccountingEntityCode; capabilities: Record<string, boolean> }) {
  if (section === 'overview') return <div className='mt-6 space-y-6'>
    <p className='rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950'>Overview is read-only. It uses stored ledger and invoice records only, so opening it does not create or alter a partner-billing snapshot.</p>
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      <Card label='Recorded expenses' value={money(data.summary?.expenseCents)} note={`${data.summary?.expenseCount || 0} active records this period`} />
      <Card label={entityCode === 'IT_MARKETING' ? 'Invoices issued' : 'Invoices received'} value={money(data.summary?.invoiceCents)} note={`${data.summary?.invoiceCount || 0} issued records this period`} />
      <Card label='Personal expenses' value={`${data.summary?.personalExpenseCount || 0}`} note='Current-period potential liabilities' />
      <Card label='Needs confirmation' value={money(data.summary?.awaitingConfirmationCents)} note='Current-period records excluded from repayment selection' />
    </div>
    <p className='text-sm font-semibold text-slate-600'>Current partner-billing period: {data.window?.label || '—'}.</p>
    <section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><h2 className='text-xl font-black text-slate-950'>Recent invoices</h2><div className='mt-3 divide-y divide-slate-100'>{(data.recentInvoices || []).length ? data.recentInvoices.map((invoice: any) => <div key={invoice.id} className='flex justify-between gap-4 py-3 text-sm'><span><b>{invoice.invoiceNumber}</b> · {invoice.invoiceKind === 'CUSTOMER_SERVICE' ? 'Customer invoice' : entityCode === 'IT_MARKETING' ? 'Invoice to Locksmith' : 'Invoice from IT & Marketing'}</span><span className='font-black'>{money(invoice.totalCents)}</span></div>) : <p className='py-4 text-sm text-slate-500'>No invoices recorded yet.</p>}</div></section>
  </div>;
  if (section === 'expenses') return <div className='mt-6 space-y-5'>{entityCode === 'IT_MARKETING' && capabilities.isAdmin && <AdsSpendPanel adsSummary={data.adsSummary} />}<LegacyBooksWorkspace view='expenses' embedded /></div>;
  if (section === 'reimbursements') return <div className='mt-6'><LegacyBooksWorkspace view='reimbursements' embedded /></div>;
  if (section === 'billing') return <div className='mt-6'><LegacyBooksWorkspace view='billing' embedded /></div>;
  return <section className='mt-6 grid gap-5 lg:grid-cols-2'>{capabilities.viewOperationalReport && <section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><h2 className='text-xl font-black'>Operational finance report</h2><p className='mt-2 text-sm text-slate-500'>Analyze operational jobs and financial activity for the Locksmith business with explicit dates.</p><Link className='mt-4 inline-block rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white' href='/books/reports/operations?entityCode=LOCKSMITH'>Open Locksmith operations report</Link></section>}<section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><h2 className='text-xl font-black'>Reimbursement CSV</h2><p className='mt-2 text-sm text-slate-500'>Download the complete entity-scoped reimbursement ledger, allocations, mapping fields, and void state.</p><a className='mt-4 inline-block rounded-xl border border-slate-300 px-3 py-2 text-sm font-black text-slate-700' href={`/api/books/reimbursements/export?entityCode=${entityCode}`}>Download CSV</a></section>{capabilities.mapAccounts && <section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><h2 className='text-xl font-black'>Accounting mapping</h2><p className='mt-2 text-sm text-slate-500'>Review expenses and repayments that still need an accounting account.</p><Link className='mt-4 inline-block rounded-xl border border-slate-300 px-3 py-2 text-sm font-black text-slate-700' href={href('/books/reimbursements', entityCode)}>Open the mapping queue</Link></section>}</section>;
}

function Card({ label, value, note }: { label: string; value: string; note: string }) { return <div className='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'><p className='text-xs font-bold uppercase tracking-wide text-slate-500'>{label}</p><p className='mt-2 text-2xl font-black text-slate-950'>{value}</p><p className='mt-1 text-xs text-slate-500'>{note}</p></div>; }

function AdsSpendPanel({ adsSummary }: { adsSummary?: State }) {
  const adsPeriods = Array.isArray(adsSummary?.periods) ? adsSummary.periods : [];
  return <section className='rounded-2xl border border-blue-100 bg-blue-50 p-5 shadow-sm'><h2 className='text-xl font-black text-slate-950'>Recent Google Ads spend</h2><p className='mt-1 text-sm text-slate-600'>Read-only cached spend context. These rows are not editable expense records and are not included in the ledger pages above.</p><div className='mt-4 divide-y divide-blue-100'>{adsPeriods.length ? adsPeriods.map((period: any) => <div key={`${period.customerId}:${period.periodStart}`} className='flex flex-wrap justify-between gap-4 py-3 text-sm'><span>{period.periodStart} – {period.periodEnd} · Account {period.customerId}</span><b>{money(period.spendCents)}</b></div>) : <p className='py-3 text-sm text-slate-600'>No synced Google Ads spend in the last {adsSummary?.window?.periodLimit || 4} billing periods.</p>}</div>{adsSummary?.truncated && <p className='mt-3 text-xs font-semibold text-amber-900'>The bounded cache read reached its row cap; use Google Ads for a complete account ledger.</p>}</section>;
}
