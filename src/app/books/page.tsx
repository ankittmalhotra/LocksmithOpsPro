'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountingEntityCode, AccountingEntitySummary } from '@/lib/accounting-types';
import { formatTorontoDateInput } from '@/lib/timezone';

type Role = 'ADMIN' | 'DISPATCHER' | 'TECHNICIAN' | 'ACCOUNTANT';

type Entity = AccountingEntitySummary & { hstEnabled: boolean; currency: string };

type Expense = {
  id: string;
  vendorName: string;
  description?: string | null;
  expenseDate: string;
  subtotalAmount: number;
  hstAmount: number;
  totalAmount: number;
  paymentStatus: 'PAID' | 'UNPAID';
  paymentMethod?: string | null;
  notes?: string | null;
  systemGenerated?: boolean;
  source?: string;
};

type BillingPeriod = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  revenueAmount: number;
  hstDeductedAmount: number;
  cogsAmount: number;
  technicianCommissionsAmount: number;
  operationalProfitAmount: number;
  adjustedProfitAmount: number;
  negativeCarryForward: number;
  partnerFeeAmount: number;
  hstAmount: number;
  invoice?: Invoice | null;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  paymentStatus: 'PENDING' | 'RECEIVED';
  lineDescription: string;
  serviceAmount: number;
  hstAmount: number;
  totalAmount: number;
  hstRate: number;
  periodStart: string;
  periodEnd: string;
  issuedAt?: string | null;
  dueAt?: string | null;
  issuerEntity?: Entity;
  recipientEntity?: Entity;
  issuerSnapshot?: Entity;
  recipientSnapshot?: Entity;
  hstRegistrationSnapshot?: string | null;
  billingPeriod?: BillingPeriod;
  paymentEvents?: Array<{ id: string; toStatus: string; paidAt?: string | null; createdAt: string; note?: string | null }>;
  auditEvents?: Array<{ id: string; action: string; createdAt: string; metadata?: Record<string, unknown> | null }>;
};

type ApiState = {
  entity: Entity | null;
  expenses: Expense[];
  periods: BillingPeriod[];
  invoices: Invoice[];
};

const EMPTY_STATE: ApiState = { entity: null, expenses: [], periods: [], invoices: [] };
function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value || 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function dateOnly(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(0, 10);
}

function periodLabel(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function StatusBadge({ status, tone }: { status: string; tone?: 'green' | 'amber' | 'slate' | 'red' }) {
  const colors = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  const selected = tone || (status === 'RECEIVED' || status === 'PAID' ? 'green' : status === 'PENDING' || status === 'UNPAID' ? 'amber' : 'slate');
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ring-1 ${colors[selected]}`}>{status.replaceAll('_', ' ')}</span>;
}

function EntityDetails({ entity }: { entity: Entity }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Legal entity</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">{entity.legalName}</h2>
          <p className="mt-1 text-sm text-slate-500">OCN: {entity.corporationNumber || 'Not configured'}</p>
        </div>
        <StatusBadge status={entity.hstEnabled && entity.hstRegistrationNumber ? 'HST configured' : 'HST pending'} tone={entity.hstEnabled && entity.hstRegistrationNumber ? 'green' : 'amber'} />
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <p><span className="font-bold text-slate-800">Email:</span> {entity.email || 'Not configured'}</p>
        <p><span className="font-bold text-slate-800">HST number:</span> {entity.hstRegistrationNumber || 'Pending — invoices cannot charge HST yet'}</p>
        <p className="sm:col-span-2"><span className="font-bold text-slate-800">Address:</span> {[entity.addressLine1, entity.city, entity.province, entity.postalCode, entity.country].filter(Boolean).join(', ') || 'Not configured'}</p>
        {entity.authorizedPersonName && <p><span className="font-bold text-slate-800">Authorized by:</span> {entity.authorizedPersonName}{entity.authorizedPersonTitle ? `, ${entity.authorizedPersonTitle}` : ''}</p>}
      </div>
    </div>
  );
}

export default function BooksPage() {
  const [user, setUser] = useState<{ role: Role; name: string } | null>(null);
  const [entityCode, setEntityCode] = useState<AccountingEntityCode>('IT_MARKETING');
  const [state, setState] = useState<ApiState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [confirmingPeriod, setConfirmingPeriod] = useState<BillingPeriod | null>(null);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<BillingPeriod | null>(null);
  const [periodEditForm, setPeriodEditForm] = useState({ revenueAmount: '', hstDeductedAmount: '', cogsAmount: '', technicianCommissionsAmount: '' });
  const [periodSaving, setPeriodSaving] = useState(false);
  const [invoiceIssuing, setInvoiceIssuing] = useState<string | null>(null);
  const [paymentUpdating, setPaymentUpdating] = useState<string | null>(null);
  const [hstFormOpen, setHstFormOpen] = useState(false);
  const [hstSaving, setHstSaving] = useState(false);
  const [hstNumber, setHstNumber] = useState('');
  const [hstEffectiveDate, setHstEffectiveDate] = useState('');
  const [expenseForm, setExpenseForm] = useState({ vendorName: '', expenseDate: formatTorontoDateInput(), description: '', subtotalAmount: '', hstAmount: '0.00', paymentStatus: 'UNPAID', paymentMethod: '', notes: '' });

  const isAdmin = user?.role === 'ADMIN';
  const canManageExpenses = isAdmin || user?.role === 'DISPATCHER';
  const availableCodes: AccountingEntityCode[] = user?.role === 'DISPATCHER' ? ['LOCKSMITH'] : ['IT_MARKETING', 'LOCKSMITH'];
  const hstReadyForIssue = Boolean(
    entityCode === 'IT_MARKETING'
      && state.entity?.hstEnabled
      && state.entity.hstRegistrationNumber
      && state.entity.hstEffectiveDate
      && dateOnly(state.entity.hstEffectiveDate) <= formatTorontoDateInput(new Date()),
  );

  const loadBooks = useCallback(async (code: AccountingEntityCode, showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const [expenseRes, periodsRes, invoicesRes] = await Promise.all([
        fetch(`/api/books/expenses?entityCode=${code}`, { cache: 'no-store' }),
        fetch(`/api/books/periods?entityCode=${code}`, { cache: 'no-store' }),
        fetch(`/api/books/invoices?entityCode=${code}`, { cache: 'no-store' }),
      ]);
      const [expenseData, periodsData, invoicesData] = await Promise.all([expenseRes.json(), periodsRes.json(), invoicesRes.json()]);
      const firstError = [expenseData, periodsData, invoicesData].find((data) => !data.success);
      if (firstError) throw new Error(firstError.error || 'Unable to load Books');
      setState({ entity: expenseData.entity || null, expenses: expenseData.expenses || [], periods: periodsData.periods || [], invoices: invoicesData.invoices || [] });
      setHstNumber(expenseData.entity?.hstRegistrationNumber || '');
      setHstEffectiveDate(dateOnly(expenseData.entity?.hstEffectiveDate));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Books');
      setState(EMPTY_STATE);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        const data = await response.json();
        if (!data.success || !data.user) throw new Error('Please sign in to access Books.');
        if (cancelled) return;
        setUser(data.user);
        const initialCode: AccountingEntityCode = data.user.role === 'DISPATCHER' ? 'LOCKSMITH' : 'IT_MARKETING';
        setEntityCode(initialCode);
        await loadBooks(initialCode);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load Books');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadBooks]);

  const switchEntity = async (code: AccountingEntityCode) => {
    if (code === entityCode) return;
    setEntityCode(code);
    setSelectedInvoice(null);
    await loadBooks(code);
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadBooks(entityCode, false);
  };

  const showSuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(''), 4500);
  };

  const resetExpenseForm = () => {
    setEditingExpense(null);
    setExpenseForm({ vendorName: '', expenseDate: formatTorontoDateInput(), description: '', subtotalAmount: '', hstAmount: '0.00', paymentStatus: 'UNPAID', paymentMethod: '', notes: '' });
  };

  const openEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
    setExpenseForm({ vendorName: expense.vendorName, expenseDate: dateOnly(expense.expenseDate), description: expense.description || '', subtotalAmount: expense.subtotalAmount.toFixed(2), hstAmount: expense.hstAmount.toFixed(2), paymentStatus: expense.paymentStatus, paymentMethod: expense.paymentMethod || '', notes: expense.notes || '' });
    setExpenseFormOpen(true);
  };

  const saveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    setExpenseSaving(true);
    setError('');
    try {
      const subtotal = Number(expenseForm.subtotalAmount);
      const hst = Number(expenseForm.hstAmount || 0);
      if (!expenseForm.vendorName.trim() || !expenseForm.expenseDate || !Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(hst) || hst < 0) throw new Error('Enter a vendor, date, and valid amounts.');
      const body = { entityCode, ...expenseForm, subtotalAmount: subtotal.toFixed(2), hstAmount: hst.toFixed(2), totalAmount: (subtotal + hst).toFixed(2) };
      const response = await fetch(editingExpense ? `/api/books/expenses/${editingExpense.id}` : '/api/books/expenses', { method: editingExpense ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save expense');
      setExpenseFormOpen(false);
      resetExpenseForm();
      await loadBooks(entityCode, false);
      showSuccess(editingExpense ? 'Expense updated.' : 'Expense added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save expense');
    } finally {
      setExpenseSaving(false);
    }
  };

  const openEditPeriod = (period: BillingPeriod) => {
    setEditingPeriod(period);
    setPeriodEditForm({
      revenueAmount: period.revenueAmount.toFixed(2),
      hstDeductedAmount: period.hstDeductedAmount.toFixed(2),
      cogsAmount: period.cogsAmount.toFixed(2),
      technicianCommissionsAmount: period.technicianCommissionsAmount.toFixed(2),
    });
  };

  const savePeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingPeriod) return;
    setPeriodSaving(true);
    setError('');
    try {
      const response = await fetch('/api/books/periods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityCode: 'IT_MARKETING', periodId: editingPeriod.id, ...periodEditForm }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to update billing snapshot');
      setEditingPeriod(null);
      await loadBooks(entityCode, false);
      showSuccess('Billing snapshot updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update billing snapshot');
    } finally {
      setPeriodSaving(false);
    }
  };

  const issueInvoice = async (periodId: string) => {
    setInvoiceIssuing(periodId);
    setError('');
    try {
      const response = await fetch('/api/books/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityCode: 'IT_MARKETING', billingPeriodId: periodId }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to issue invoice');
      await loadBooks(entityCode, false);
      setSelectedInvoice(data.invoice);
      showSuccess(`Invoice ${data.invoice.invoiceNumber} issued to Locksmith.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to issue invoice');
    } finally {
      setInvoiceIssuing(null);
    }
  };

  const updatePayment = async (invoice: Invoice, status: 'PENDING' | 'RECEIVED') => {
    setPaymentUpdating(invoice.id);
    setError('');
    try {
      const response = await fetch(`/api/books/invoices/${invoice.id}/payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to update payment status');
      await loadBooks(entityCode, false);
      setSelectedInvoice(data.invoice);
      showSuccess(status === 'RECEIVED' ? 'Payment marked received.' : 'Payment returned to pending.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update payment status');
    } finally {
      setPaymentUpdating(null);
    }
  };

  const saveHstSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setHstSaving(true);
    setError('');
    try {
      if (!hstNumber.trim() || !hstEffectiveDate) throw new Error('Enter the HST registration number and effective date.');
      const response = await fetch(`/api/books/entities/${entityCode}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hstRegistrationNumber: hstNumber.trim(), hstEffectiveDate, hstEnabled: true }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save HST settings');
      setHstFormOpen(false);
      await loadBooks(entityCode, false);
      showSuccess('HST settings saved. Eligible invoices can now be issued once the effective date begins.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save HST settings');
    } finally {
      setHstSaving(false);
    }
  };

  const totals = useMemo(() => ({
    expenses: state.expenses.reduce((sum, expense) => sum + expense.totalAmount, 0),
    unpaidExpenses: state.expenses.filter((expense) => expense.paymentStatus === 'UNPAID').reduce((sum, expense) => sum + expense.totalAmount, 0),
    invoiced: state.invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0),
    outstanding: state.invoices.filter((invoice) => invoice.paymentStatus === 'PENDING' && invoice.status === 'ISSUED').reduce((sum, invoice) => sum + invoice.totalAmount, 0),
  }), [state.expenses, state.invoices]);

  const openInvoice = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    try {
      const response = await fetch(`/api/books/invoices/${invoice.id}?entityCode=${entityCode}`, { cache: 'no-store' });
      const data = await response.json();
      if (response.ok && data.success) setSelectedInvoice(data.invoice);
    } catch {
      // The list item remains a complete, useful invoice summary if detail fails.
    }
  };

  const selectedIssuer = selectedInvoice?.issuerEntity || selectedInvoice?.issuerSnapshot;
  const selectedRecipient = selectedInvoice?.recipientEntity || selectedInvoice?.recipientSnapshot;

  if (loading) return <main className="min-h-screen bg-slate-50 px-4 py-10"><div className="mx-auto max-w-7xl animate-pulse"><div className="h-10 w-72 rounded-xl bg-slate-200" /><div className="mt-6 h-36 rounded-2xl bg-slate-200" /><div className="mt-6 h-64 rounded-2xl bg-slate-200" /></div></main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">Books & accounting</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Keep the books clear.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Expenses, partner billing, and payment history live here—separate from operational revenue reporting.</p>
          </div>
          <button onClick={refresh} disabled={refreshing} className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-50">{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>

        {availableCodes.length > 1 && <div className="mt-7 inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Books entity">
          {availableCodes.map((code) => <button key={code} onClick={() => switchEntity(code)} role="tab" aria-selected={entityCode === code} className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${entityCode === code ? 'bg-slate-950 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>{code === 'IT_MARKETING' ? 'IT & Marketing' : 'Locksmith business'}</button>)}
        </div>}

        {error && <div className="mt-5 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {success && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{success}</div>}

        {state.entity && <div className="mt-7"><EntityDetails entity={state.entity} />{isAdmin && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-black text-amber-950">HST configuration</p><p className="mt-1 text-xs leading-5 text-amber-800">The first partner invoice stays blocked until the registration number and effective date are saved.</p></div><button onClick={() => { setHstNumber(state.entity?.hstRegistrationNumber || ''); setHstEffectiveDate(dateOnly(state.entity?.hstEffectiveDate)); setHstFormOpen(!hstFormOpen); }} className="rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-black text-amber-900 hover:bg-amber-100">{hstFormOpen ? 'Close settings' : state.entity.hstRegistrationNumber ? 'Edit HST settings' : 'Enter HST number'}</button></div>{hstFormOpen && <form onSubmit={saveHstSettings} className="mt-4 grid gap-3 border-t border-amber-200 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="block"><span className="field-label">HST registration number</span><input required value={hstNumber} onChange={(event) => setHstNumber(event.target.value)} className="field-input" placeholder="Awaited" /></label><label className="block"><span className="field-label">Effective date</span><input required type="date" value={hstEffectiveDate} onChange={(event) => setHstEffectiveDate(event.target.value)} className="field-input" /></label><button disabled={hstSaving} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50">{hstSaving ? 'Saving…' : 'Save and enable HST'}</button></form>}</div>}</div>}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Expenses recorded', formatMoney(totals.expenses), 'All active expense records'],
            ['Unpaid expenses', formatMoney(totals.unpaidExpenses), 'Needs payment tracking'],
            [entityCode === 'IT_MARKETING' ? 'Invoices issued' : 'Invoices received', formatMoney(totals.invoiced), `${state.invoices.length} invoice${state.invoices.length === 1 ? '' : 's'}`],
            ['Outstanding partner invoices', formatMoney(totals.outstanding), 'Payment status: Pending'],
          ].map(([label, value, hint]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{hint}</p></div>)}
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Expense ledger</p><h2 className="mt-1 text-xl font-black text-slate-950">{state.expenses.length ? `${state.expenses.length} expense${state.expenses.length === 1 ? '' : 's'}` : 'No expenses yet'}</h2></div>{canManageExpenses && <button onClick={() => { resetExpenseForm(); setExpenseFormOpen(true); }} className="rounded-xl bg-slate-950 px-3.5 py-2.5 text-sm font-black text-white transition hover:bg-slate-800">+ Add expense</button>}</div>
            <div className="divide-y divide-slate-100">
              {state.expenses.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Add a vendor bill, receipt, or other company expense to begin.</div> : state.expenses.map((expense) => <div key={expense.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-900">{expense.vendorName}</p><StatusBadge status={expense.paymentStatus} />{expense.systemGenerated && <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700 ring-1 ring-blue-200">Auto-synced</span>}</div><p className="mt-1 truncate text-sm text-slate-500">{expense.description || 'Expense'} · {formatDate(expense.expenseDate)}</p></div><div className="flex items-center justify-between gap-4 sm:justify-end"><p className="font-black text-slate-950">{formatMoney(expense.totalAmount)}</p>{canManageExpenses && !expense.systemGenerated && <button onClick={() => openEditExpense(expense)} className="text-xs font-black text-blue-700 hover:text-blue-900">Edit</button>}</div></div>)}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Partner billing</p><h2 className="mt-1 text-xl font-black text-slate-950">Biweekly periods</h2><p className="mt-1 text-xs text-slate-500">Completed periods are calculated automatically from the operational portal.</p></div></div>
            <div className="divide-y divide-slate-100">
              {state.periods.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">The first period is September 7–20, 2026.</div> : state.periods.map((period) => <div key={period.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{periodLabel(period.periodStart, period.periodEnd)}</p><p className="mt-1 text-xs text-slate-500">Profit snapshot: <span className="font-bold text-slate-700">{formatMoney(period.adjustedProfitAmount)}</span> · Partner share: <span className="font-bold text-slate-700">{formatMoney(period.partnerFeeAmount)}</span></p></div><StatusBadge status={period.invoice ? period.invoice.paymentStatus : entityCode === 'LOCKSMITH' && period.partnerFeeAmount > 0 ? 'PENDING' : period.status} /></div>{period.negativeCarryForward > 0 && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Negative profit carried forward: {formatMoney(period.negativeCarryForward)}. No invoice is due for this period.</p>}{isAdmin && entityCode === 'IT_MARKETING' && !period.invoice && <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => openEditPeriod(period)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Edit snapshot</button>{period.partnerFeeAmount > 0 && <button onClick={() => setConfirmingPeriod(period)} disabled={invoiceIssuing === period.id} className={`rounded-xl border px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${hstReadyForIssue ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100' : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}>{hstReadyForIssue ? 'Review & send invoice' : 'Preview draft — HST pending'}</button>}</div>}</div>)}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Invoices</p><h2 className="mt-1 text-xl font-black text-slate-950">{state.invoices.length ? 'Partner invoice history' : 'No partner invoices issued yet'}</h2></div><div className="divide-y divide-slate-100">{state.invoices.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Issued invoices will appear here with their period, amount, and payment status.</div> : state.invoices.map((invoice) => <div key={invoice.id} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between"><button onClick={() => openInvoice(invoice)} className="min-w-0 text-left"><div className="flex flex-wrap items-center gap-2"><span className="font-black text-slate-950">{invoice.invoiceNumber}</span><StatusBadge status={invoice.paymentStatus} /></div><p className="mt-1 truncate text-sm text-slate-500">{periodLabel(invoice.periodStart, invoice.periodEnd)} · {invoice.lineDescription}</p></button><div className="flex items-center justify-between gap-4 lg:justify-end"><p className="font-black text-slate-950">{formatMoney(invoice.totalAmount)}</p><button onClick={() => openInvoice(invoice)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50">View</button>{isAdmin && <button onClick={() => updatePayment(invoice, invoice.paymentStatus === 'RECEIVED' ? 'PENDING' : 'RECEIVED')} disabled={paymentUpdating === invoice.id} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50">{paymentUpdating === invoice.id ? 'Saving…' : invoice.paymentStatus === 'RECEIVED' ? 'Mark pending' : 'Mark received'}</button>}</div></div>)}</div></section>

        <p className="mt-6 text-xs leading-5 text-slate-500">Partner invoice description: <span className="font-bold text-slate-700">IT Services for Locksmith - C$ xxxx.xx</span>. The amount replaces the placeholder for each period. HST is charged only after the registration number and effective date are configured.</p>
      </div>

      {confirmingPeriod && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="w-full max-w-xl rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className={`text-xs font-black uppercase tracking-[0.16em] ${hstReadyForIssue ? 'text-blue-700' : 'text-amber-700'}`}>{hstReadyForIssue ? 'Invoice review' : 'Draft — HST pending'}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{hstReadyForIssue ? 'Confirm invoice to Locksmith' : 'Preview invoice for Locksmith'}</h2><p className="mt-1 text-sm text-slate-500">{periodLabel(confirmingPeriod.periodStart, confirmingPeriod.periodEnd)}</p></div><button onClick={() => setConfirmingPeriod(null)} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div>{!hstReadyForIssue && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="font-black text-amber-950">Draft — HST pending</p><p className="mt-1 text-xs leading-5 text-amber-800">This preview is for layout testing only. It does not create an invoice, notify Locksmith, or affect the accounting ledger. Issuing stays blocked until the IT & Marketing HST number and effective date are configured.</p></div>}<div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="font-bold text-slate-900">IT Services for Locksmith</p><div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs font-bold uppercase text-slate-500">Service</p><p className="mt-1 font-black">{formatMoney(confirmingPeriod.partnerFeeAmount)}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">{hstReadyForIssue ? 'HST (13%)' : 'HST'}</p><p className="mt-1 font-black">{hstReadyForIssue ? formatMoney(confirmingPeriod.partnerFeeAmount * 0.13) : 'Pending'}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Total</p><p className="mt-1 text-lg font-black text-slate-950">{hstReadyForIssue ? formatMoney(confirmingPeriod.partnerFeeAmount * 1.13) : 'Pending'}</p></div></div></div><p className="mt-4 text-xs leading-5 text-slate-500">{hstReadyForIssue ? 'Review the amount, then print or save this preview as PDF. Confirming sends the invoice to Locksmith and records the issuance time in the invoice history.' : 'Print or save this clearly marked draft as PDF to check the layout. Nothing is saved until HST setup is complete and you confirm issuance.'}</p><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => window.print()} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">Download / print PDF</button>{hstReadyForIssue ? <button type="button" onClick={() => { setConfirmingPeriod(null); issueInvoice(confirmingPeriod.id); }} disabled={invoiceIssuing === confirmingPeriod.id} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800 disabled:opacity-50">{invoiceIssuing === confirmingPeriod.id ? 'Sending…' : 'Confirm & send invoice'}</button> : <button type="button" disabled className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-black text-slate-500">Issuing blocked — HST pending</button>}</div></div></div>}

      {editingPeriod && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="w-full max-w-xl rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Edit snapshot</p><h2 className="mt-1 text-2xl font-black text-slate-950">Adjust completed period</h2><p className="mt-1 text-sm text-slate-500">{periodLabel(editingPeriod.periodStart, editingPeriod.periodEnd)}</p></div><button onClick={() => setEditingPeriod(null)} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div><form onSubmit={savePeriod} className="mt-6 space-y-4"><div className="grid gap-4 sm:grid-cols-2">{([['revenueAmount', 'Revenue'], ['hstDeductedAmount', 'HST deducted'], ['cogsAmount', 'COGS'], ['technicianCommissionsAmount', 'Technician commissions']] as const).map(([field, label]) => <label key={field} className="block"><span className="field-label">{label} (CAD)</span><input required inputMode="decimal" value={periodEditForm[field]} onChange={(event) => setPeriodEditForm({ ...periodEditForm, [field]: event.target.value })} className="field-input" /></label>)}</div><p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">The 50% partner share and any negative carry-forward will be recalculated from these values. Editing is disabled after an invoice is issued.</p><div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setEditingPeriod(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">Cancel</button><button disabled={periodSaving} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{periodSaving ? 'Saving…' : 'Save snapshot'}</button></div></form></div></div>}

      {expenseFormOpen && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">{editingExpense ? 'Edit expense' : 'New expense'}</p><h2 className="mt-1 text-2xl font-black text-slate-950">Record a company expense</h2></div><button onClick={() => { setExpenseFormOpen(false); resetExpenseForm(); }} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div><form onSubmit={saveExpense} className="mt-6 space-y-4"><label className="block"><span className="field-label">Vendor</span><input required value={expenseForm.vendorName} onChange={(event) => setExpenseForm({ ...expenseForm, vendorName: event.target.value })} className="field-input" placeholder="e.g. Bell Canada" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="field-label">Expense date</span><input required type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm({ ...expenseForm, expenseDate: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">Payment status</span><select value={expenseForm.paymentStatus} onChange={(event) => setExpenseForm({ ...expenseForm, paymentStatus: event.target.value })} className="field-input"><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option></select></label></div><label className="block"><span className="field-label">Description</span><input value={expenseForm.description} onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })} className="field-input" placeholder="What was this for?" /></label><div className="grid gap-4 sm:grid-cols-3"><label className="block"><span className="field-label">Subtotal (CAD)</span><input required inputMode="decimal" value={expenseForm.subtotalAmount} onChange={(event) => setExpenseForm({ ...expenseForm, subtotalAmount: event.target.value })} className="field-input" placeholder="0.00" /></label><label className="block"><span className="field-label">HST paid</span><input required inputMode="decimal" value={expenseForm.hstAmount} onChange={(event) => setExpenseForm({ ...expenseForm, hstAmount: event.target.value })} className="field-input" placeholder="0.00" /></label><div><span className="field-label">Total</span><div className="field-input bg-slate-50 font-black">{formatMoney((Number(expenseForm.subtotalAmount) || 0) + (Number(expenseForm.hstAmount) || 0))}</div></div></div><label className="block"><span className="field-label">Payment method</span><select value={expenseForm.paymentMethod} onChange={(event) => setExpenseForm({ ...expenseForm, paymentMethod: event.target.value })} className="field-input"><option value="">Select method</option><option value="BANK_TRANSFER">Bank transfer</option><option value="INTERAC">Interac</option><option value="CREDIT_CARD">Credit card</option><option value="DEBIT_CARD">Debit card</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></label><label className="block"><span className="field-label">Notes</span><textarea rows={3} value={expenseForm.notes} onChange={(event) => setExpenseForm({ ...expenseForm, notes: event.target.value })} className="field-input" placeholder="Optional notes for the accountant" /></label><div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setExpenseFormOpen(false); resetExpenseForm(); }} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">Cancel</button><button disabled={expenseSaving} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{expenseSaving ? 'Saving…' : editingExpense ? 'Save changes' : 'Add expense'}</button></div></form></div></div>}

      {selectedInvoice && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Invoice detail</p><h2 className="mt-1 text-2xl font-black text-slate-950">{selectedInvoice.invoiceNumber}</h2><p className="mt-1 text-sm text-slate-500">{periodLabel(selectedInvoice.periodStart, selectedInvoice.periodEnd)}</p></div><div className="flex items-center gap-2"><button onClick={() => window.print()} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Download / print PDF</button><button onClick={() => setSelectedInvoice(null)} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div></div><div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-bold text-slate-900">{selectedInvoice.lineDescription}</p><div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs font-bold uppercase text-slate-500">Service</p><p className="mt-1 font-black">{formatMoney(selectedInvoice.serviceAmount)}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">HST</p><p className="mt-1 font-black">{formatMoney(selectedInvoice.hstAmount)}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Total</p><p className="mt-1 text-lg font-black text-slate-950">{formatMoney(selectedInvoice.totalAmount)}</p></div></div></div><div className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">From</p><p className="mt-1 font-bold text-slate-900">{selectedIssuer?.legalName || 'IT & marketing partner'}</p><p className="text-slate-500">{selectedIssuer?.corporationNumber ? `OCN: ${selectedIssuer.corporationNumber}` : 'IT & marketing partner'}</p>{selectedIssuer?.addressLine1 && <p className="text-slate-500">{[selectedIssuer.addressLine1, selectedIssuer.city, selectedIssuer.province, selectedIssuer.postalCode, selectedIssuer.country].filter(Boolean).join(', ')}</p>}</div><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">To</p><p className="mt-1 font-bold text-slate-900">{selectedRecipient?.legalName || '1001348245 ONTARIO INC.'}</p><p className="text-slate-500">OCN: {selectedRecipient?.corporationNumber || '1001348245'}</p>{selectedRecipient?.addressLine1 && <p className="text-slate-500">{[selectedRecipient.addressLine1, selectedRecipient.city, selectedRecipient.province, selectedRecipient.postalCode, selectedRecipient.country].filter(Boolean).join(', ')}</p>}</div></div><div className="mt-5 rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">History</p><div className="mt-3 space-y-2 text-xs text-slate-600"><p>Issued: {selectedInvoice.issuedAt ? formatDate(selectedInvoice.issuedAt) : 'Pending issue'}</p>{selectedInvoice.paymentEvents?.map((event) => <p key={event.id}>{event.toStatus === 'RECEIVED' ? 'Payment received' : 'Payment pending'}: {formatDate(event.paidAt || event.createdAt)}</p>)}</div></div><div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Payment status</p><div className="mt-2"><StatusBadge status={selectedInvoice.paymentStatus} /></div></div>{isAdmin && <button onClick={() => updatePayment(selectedInvoice, selectedInvoice.paymentStatus === 'RECEIVED' ? 'PENDING' : 'RECEIVED')} disabled={paymentUpdating === selectedInvoice.id} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{paymentUpdating === selectedInvoice.id ? 'Saving…' : selectedInvoice.paymentStatus === 'RECEIVED' ? 'Mark payment pending' : 'Mark payment received'}</button>}</div><p className="mt-6 text-xs leading-5 text-slate-500">HST is shown from the registration snapshot at issuance. This invoice cannot be recalculated from live job data.</p></div></div>}
    </main>
  );
}
