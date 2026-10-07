'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { AccountingEntityCode } from '@/lib/accounting-types';

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
  const [expensePage, setExpensePage] = useState(1);
  const [expenseSearch, setExpenseSearch] = useState('');
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
      const url = section === 'overview' ? `/api/books/summary?entityCode=${entityCode}`
        : section === 'expenses' ? `/api/books/expenses?entityCode=${entityCode}&page=${expensePage}&pageSize=50&search=${encodeURIComponent(expenseSearch)}`
          : section === 'reimbursements' ? `/api/books/summary?entityCode=${entityCode}`
            : section === 'billing' ? `/api/books/billing-summary?entityCode=${entityCode}`
              : null;
      if (!url) { if (requestId === requestSequence.current) setData({}); return; }
      const response = await fetch(url, { cache: 'no-store', signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load this Books task');
      if (section === 'expenses' && entityCode === 'IT_MARKETING' && isAdmin) {
        const adsResponse = await fetch('/api/books/ads-summary', { cache: 'no-store', signal });
        const ads = await adsResponse.json();
        if (!adsResponse.ok || !ads.success) throw new Error(ads.error || 'Unable to load recent Google Ads spend');
        result.adsSummary = ads;
      }
      if (requestId === requestSequence.current) setData(result);
    } catch (cause) {
      if (signal?.aborted || requestId !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Unable to load Books'); setData(null);
    } finally { if (requestId === requestSequence.current) setLoading(false); }
  }, [accessReady, entityCode, section, expensePage, expenseSearch, isAdmin]);

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
      {loading ? <div className='mt-6 h-56 animate-pulse rounded-2xl bg-slate-200' /> : <BooksTaskContent section={section} data={data || {}} entityCode={entityCode} capabilities={activeCapabilities} expenseSearch={expenseSearch} onExpenseSearch={(value) => { setExpenseSearch(value); setExpensePage(1); }} expensePage={expensePage} onExpensePage={setExpensePage} />}
    </div>
  </main>;
}

function BooksTaskContent({ section, data, entityCode, capabilities, expenseSearch, onExpenseSearch, expensePage, onExpensePage }: { section: Section; data: State; entityCode: AccountingEntityCode; capabilities: Record<string, boolean>; expenseSearch: string; onExpenseSearch: (value: string) => void; expensePage: number; onExpensePage: (page: number) => void }) {
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
  if (section === 'expenses') return <ExpensesSection expenses={data.expenses || []} pagination={data.pagination} adsSummary={data.adsSummary} showAds={Boolean(capabilities.isAdmin)} entityCode={entityCode} canManage={Boolean(capabilities.manageExpenses)} search={expenseSearch} onSearch={onExpenseSearch} page={expensePage} onPage={onExpensePage} />;
  if (section === 'reimbursements') return <section className='mt-6 space-y-5'><p className='rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950'>These attention counts cover the current partner-billing period. Open the full queue to review historical outstanding balances.</p><div className='grid gap-4 sm:grid-cols-3'><Card label='Current-period personal expenses' value={`${data.summary?.personalExpenseCount || 0}`} note='Personal-paid expense records in this period' /><Card label='Current-period confirmation needed' value={money(data.summary?.awaitingConfirmationCents)} note={`${data.summary?.awaitingConfirmationCount || 0} need payer or original payment date`} /><Card label='Current-period confirmed records' value={`${Math.max(0, (data.summary?.personalExpenseCount || 0) - (data.summary?.awaitingConfirmationCount || 0))}`} note='Open the full queue for current balances' /></div><section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><div className='flex justify-between gap-4'><div><h2 className='text-xl font-black'>Personal reimbursement queue</h2><p className='mt-1 text-sm text-slate-500'>This bounded task summary avoids loading repayment history on entry. A repayment settles selected liabilities; it never creates a second expense.</p></div><Link href={`${href('/books/legacy', entityCode)}#reimbursements`} className='rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white'>{capabilities.manageReimbursements ? 'Review or record repayment' : 'Review details'}</Link></div><p className='mt-4 text-xs font-semibold text-slate-500'>Only an Admin can reverse a repayment, with a recorded reason. The full entity-scoped reimbursement CSV is available in Reports.</p></section></section>;
  if (section === 'billing') return <section className='mt-6 space-y-5'><p className='rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950'>This is a read-only list of the latest {data.limit || 12} issued records. Creating closed-period snapshots remains an explicit action in the advanced workflow.</p><section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><div className='flex justify-between gap-4'><div><h2 className='text-xl font-black'>Partner billing periods</h2><p className='mt-1 text-sm text-slate-500'>Issued snapshots and invoices are immutable records.</p></div><Link href={href('/books/legacy', entityCode)} className='rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white'>{capabilities.issueInvoices ? 'Issue or manage invoice' : 'View billing detail'}</Link></div><div className='mt-4 divide-y divide-slate-100'>{(data.periods || []).length ? data.periods.map((period: any) => <div key={period.id} className='flex flex-wrap justify-between gap-4 py-3 text-sm'><span><b>{date(period.periodStart)} – {date(period.periodEnd)}</b> · {period.status}</span><span>Partner fee {money(period.partnerFeeCents)}</span></div>) : <p className='py-3 text-sm text-slate-500'>No closed periods yet.</p>}</div></section><section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><h2 className='text-xl font-black'>Issued invoices</h2><div className='mt-3 divide-y divide-slate-100'>{(data.invoices || []).length ? data.invoices.map((invoice: any) => <div key={invoice.id} className='flex justify-between gap-4 py-3 text-sm'><span><b>{invoice.invoiceNumber}</b> · {invoice.invoiceKind === 'CUSTOMER_SERVICE' ? 'Customer invoice' : entityCode === 'IT_MARKETING' ? 'Invoice to Locksmith' : 'Invoice from IT & Marketing'} · {invoice.paymentStatus.toLowerCase()}</span><b>{money(invoice.totalCents)}</b></div>) : <p className='py-3 text-sm text-slate-500'>No issued invoices recorded yet.</p>}</div></section></section>;
  return <section className='mt-6 grid gap-5 lg:grid-cols-2'>{capabilities.viewOperationalReport && <section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><h2 className='text-xl font-black'>Operational finance report</h2><p className='mt-2 text-sm text-slate-500'>Analyze operational jobs and financial activity for the Locksmith business with explicit dates.</p><Link className='mt-4 inline-block rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white' href='/books/reports/operations?entityCode=LOCKSMITH'>Open Locksmith operations report</Link></section>}<section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'><h2 className='text-xl font-black'>Reimbursement CSV</h2><p className='mt-2 text-sm text-slate-500'>Download the complete entity-scoped reimbursement ledger, allocations, mapping fields, and void state.</p><a className='mt-4 inline-block rounded-xl border border-slate-300 px-3 py-2 text-sm font-black text-slate-700' href={`/api/books/reimbursements/export?entityCode=${entityCode}`}>Download CSV</a></section></section>;
}

function Card({ label, value, note }: { label: string; value: string; note: string }) { return <div className='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'><p className='text-xs font-bold uppercase tracking-wide text-slate-500'>{label}</p><p className='mt-2 text-2xl font-black text-slate-950'>{value}</p><p className='mt-1 text-xs text-slate-500'>{note}</p></div>; }

function ExpensesSection({ expenses, pagination, adsSummary, showAds, entityCode, canManage, search, onSearch, page, onPage }: { expenses: any[]; pagination?: { page: number; hasNextPage: boolean; storedTotal?: number }; adsSummary?: State; showAds: boolean; entityCode: AccountingEntityCode; canManage: boolean; search: string; onSearch: (value: string) => void; page: number; onPage: (page: number) => void }) {
  const legacyHref = href('/books/legacy', entityCode);
  const adsPeriods = Array.isArray(adsSummary?.periods) ? adsSummary.periods : [];
  return <div className='mt-6 space-y-5'>
    <section className='rounded-2xl border border-slate-200 bg-white shadow-sm'>
      <header className='flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5'>
        <div><p className='text-xs font-black uppercase tracking-wide text-blue-700'>Expense ledger</p><h2 className='mt-1 text-xl font-black'>Expenses for this entity</h2><p className='mt-1 text-sm text-slate-500'>This paginated list contains stored accounting expenses only.</p></div>
        <Link href={canManage ? `${legacyHref}&openExpense=1` : legacyHref} className='rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white'>{canManage ? 'Record or edit expense' : 'Review expense details'}</Link>
      </header>
      <div className='border-b border-slate-100 p-4'><input aria-label='Search expenses' value={search} onChange={(event) => onSearch(event.target.value)} placeholder='Search vendor or purpose' className='w-full rounded-xl border border-slate-300 px-3 py-2 text-sm sm:max-w-md' /></div>
      <div className='divide-y divide-slate-100'>{expenses.length ? expenses.map((expense: any) => <div key={expense.id} className='flex flex-wrap justify-between gap-4 p-5 text-sm'><div><p className='font-black'>{expense.vendorName}</p><p className='mt-1 text-slate-500'>{expense.businessPurpose || expense.description || 'Business purpose not recorded'} · {date(expense.expenseDate)}</p><p className='mt-1 text-xs text-slate-500'>{expense.fundingSource === 'PERSONAL' ? 'Paid personally' : 'Paid by business'} · Receipt: {expense.receiptStatus.toLowerCase().replace('_', ' ')}</p></div><b>{new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(expense.totalAmount || 0))}</b></div>) : <p className='p-6 text-sm text-slate-500'>No expenses match this filter.</p>}</div>
      <footer className='flex items-center justify-between border-t border-slate-100 p-4 text-sm'><button disabled={page <= 1} onClick={() => onPage(page - 1)} className='rounded-lg border border-slate-300 px-3 py-2 font-bold disabled:opacity-40'>Previous</button><span>Page {pagination?.page || page}{pagination?.storedTotal !== undefined ? ` · ${pagination.storedTotal} stored records` : ''}</span><button disabled={!pagination?.hasNextPage} onClick={() => onPage(page + 1)} className='rounded-lg border border-slate-300 px-3 py-2 font-bold disabled:opacity-40'>Next</button></footer>
    </section>
    {entityCode === 'IT_MARKETING' && showAds && <section className='rounded-2xl border border-blue-100 bg-blue-50 p-5 shadow-sm'><h2 className='text-xl font-black text-slate-950'>Recent Google Ads spend</h2><p className='mt-1 text-sm text-slate-600'>Read-only cached spend context. These rows are not editable expense records and are not included in the ledger pages above.</p><div className='mt-4 divide-y divide-blue-100'>{adsPeriods.length ? adsPeriods.map((period: any) => <div key={`${period.customerId}:${period.periodStart}`} className='flex flex-wrap justify-between gap-4 py-3 text-sm'><span>{period.periodStart} – {period.periodEnd} · Account {period.customerId}</span><b>{money(period.spendCents)}</b></div>) : <p className='py-3 text-sm text-slate-600'>No synced Google Ads spend in the last {adsSummary?.window?.periodLimit || 4} billing periods.</p>}</div>{adsSummary?.truncated && <p className='mt-3 text-xs font-semibold text-amber-900'>The bounded cache read reached its row cap; use Google Ads for a complete account ledger.</p>}</section>}
  </div>;
}
