'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountingEntityCode, AccountingEntitySummary } from '@/lib/accounting-types';
import { formatTorontoDateInput } from '@/lib/timezone';

type Role = 'ADMIN' | 'DISPATCHER' | 'TECHNICIAN' | 'ACCOUNTANT';

type Entity = AccountingEntitySummary & { hstEnabled: boolean; currency: string };

type Expense = {
  id: string;
  vendorName: string;
  businessPurpose?: string | null;
  description?: string | null;
  expenseDate: string;
  subtotalAmount: number;
  hstAmount: number;
  totalAmount: number;
  paymentStatus: 'PAID' | 'UNPAID';
  paymentMethod?: string | null;
  notes?: string | null;
  receiptStatus: 'ATTACHED' | 'MISSING' | 'NOT_REQUIRED';
  receiptFileName?: string | null;
  receiptMimeType?: string | null;
  receiptSize?: number | null;
  receiptUploadedAt?: string | null;
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
  invoiceKind?: 'PARTNER_SERVICE' | 'CUSTOMER_SERVICE';
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  paymentStatus: 'PENDING' | 'RECEIVED';
  lineDescription: string;
  quantity?: number;
  serviceAmount: number;
  hstAmount: number;
  totalAmount: number;
  hstRate: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  issuedAt?: string | null;
  dueAt?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  emailSentAt?: string | null;
  emailSentTo?: string | null;
  emailMessageId?: string | null;
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

function periodLabel(start?: string | null, end?: string | null) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

type InvoiceParty = Partial<Entity> & { legalName?: string | null; email?: string | null; corporationNumber?: string | null; addressLine1?: string | null; city?: string | null; province?: string | null; postalCode?: string | null; country?: string | null };

function partyAddress(party?: InvoiceParty | null) {
  return party ? [party.addressLine1, party.city, party.province, party.postalCode, party.country].filter(Boolean).join(', ') : '';
}

function InvoiceDocument({ invoice, issuer, recipient, draft = false, hstPending = false }: { invoice: Partial<Invoice>; issuer?: InvoiceParty | null; recipient?: InvoiceParty | null; draft?: boolean; hstPending?: boolean }) {
  const quantity = Number(invoice.quantity || 1);
  const subtotal = Number(invoice.serviceAmount || 0);
  const hst = hstPending ? null : Number(invoice.hstAmount || 0);
  const total = hstPending ? null : Number(invoice.totalAmount ?? subtotal + (hst || 0));
  return <article className="print-invoice mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-7 text-slate-950 shadow-sm sm:p-10">
    <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-7">
      <div><p className="text-3xl font-black tracking-tight text-slate-950">INVOICE</p><p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{draft ? 'Draft preview — not issued' : invoice.invoiceKind === 'CUSTOMER_SERVICE' ? 'Professional services' : 'IT services for Locksmith'}</p></div>
      <div className="text-right"><p className="text-sm font-black text-slate-900">{invoice.invoiceNumber || 'Draft invoice'}</p><p className="mt-1 text-xs text-slate-500">Issue date: {formatDate(invoice.issuedAt) || 'On issue'}</p><p className="mt-1 text-xs text-slate-500">Due date: {formatDate(invoice.dueAt) || 'Due on receipt'}</p>{draft && <span className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-amber-800">Draft</span>}</div>
    </div>
    <div className="grid gap-7 border-b border-slate-200 py-7 sm:grid-cols-2">
      <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">From</p><p className="mt-2 font-black">{issuer?.legalName || '1001744934 ONTARIO INC.'}</p>{issuer?.corporationNumber && <p className="mt-1 text-xs text-slate-600">OCN: {issuer.corporationNumber}</p>}{issuer?.hstRegistrationNumber && <p className="mt-1 text-xs text-slate-600">HST: {issuer.hstRegistrationNumber}</p>}{partyAddress(issuer) && <p className="mt-2 max-w-xs text-xs leading-5 text-slate-600">{partyAddress(issuer)}</p>}{issuer?.email && <p className="mt-1 text-xs text-slate-600">{issuer.email}</p>}</div>
      <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Bill to</p><p className="mt-2 font-black">{recipient?.legalName || 'Customer'}</p>{recipient?.corporationNumber && <p className="mt-1 text-xs text-slate-600">OCN: {recipient.corporationNumber}</p>}{partyAddress(recipient) && <p className="mt-2 max-w-xs text-xs leading-5 text-slate-600">{partyAddress(recipient)}</p>}{recipient?.email && <p className="mt-1 text-xs text-slate-600">{recipient.email}</p>}</div>
    </div>
    <table className="w-full border-collapse text-sm"><thead><tr className="border-b border-slate-200 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><th className="py-4">Description</th><th className="py-4 text-right">Qty</th><th className="py-4 text-right">Rate</th><th className="py-4 text-right">Amount</th></tr></thead><tbody><tr className="border-b border-slate-100"><td className="py-5 font-semibold">{invoice.lineDescription || 'Professional services'}</td><td className="py-5 text-right">{quantity.toFixed(2).replace(/\.00$/, '')}</td><td className="py-5 text-right">{formatMoney(quantity ? subtotal / quantity : subtotal)}</td><td className="py-5 text-right font-bold">{formatMoney(subtotal)}</td></tr></tbody></table>
    <div className="ml-auto mt-7 w-full max-w-xs space-y-3 text-sm"><div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-semibold">{formatMoney(subtotal)}</span></div><div className="flex justify-between"><span className="text-slate-500">HST {invoice.hstRate ? `(${(Number(invoice.hstRate) * 100).toFixed(0)}%)` : ''}</span><span className="font-semibold">{hstPending ? 'Pending' : formatMoney(hst)}</span></div><div className="flex justify-between border-t border-slate-200 pt-3 text-lg"><span className="font-black">Total CAD</span><span className="font-black">{total === null ? 'Pending' : formatMoney(total)}</span></div>{!draft && <div className={`mt-3 rounded-xl px-3 py-2 text-center text-xs font-black uppercase tracking-wide ${invoice.paymentStatus === 'RECEIVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{invoice.paymentStatus === 'RECEIVED' ? 'Paid' : 'Payment pending'}</div>}</div>
    {(invoice.paymentTerms || invoice.notes || draft) && <div className="mt-10 border-t border-slate-200 pt-6 text-xs leading-5 text-slate-600"><p className="font-black uppercase tracking-wide text-slate-500">Notes</p>{invoice.paymentTerms && <p className="mt-2"><span className="font-bold">Payment terms:</span> {invoice.paymentTerms}</p>}{invoice.notes && <p className="mt-1">{invoice.notes}</p>}{draft && <p className="mt-2 font-semibold text-amber-700">HST registration is pending. This document is for layout review only and is not an accounting entry.</p>}</div>}
  </article>;
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
  const [serviceInvoiceOpen, setServiceInvoiceOpen] = useState(false);
  const [serviceInvoiceSaving, setServiceInvoiceSaving] = useState(false);
  const [serviceInvoiceForm, setServiceInvoiceForm] = useState({ customerName: '', customerNumber: '', customerEmail: '', addressLine1: '', city: '', province: 'Ontario', postalCode: '', country: 'Canada', lineDescription: '', quantity: '1', unitPrice: '', dueDate: '', paymentTerms: 'Due on receipt', notes: '' });
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<BillingPeriod | null>(null);
  const [periodEditForm, setPeriodEditForm] = useState({ revenueAmount: '', hstDeductedAmount: '', cogsAmount: '', technicianCommissionsAmount: '' });
  const [periodSaving, setPeriodSaving] = useState(false);
  const [invoiceIssuing, setInvoiceIssuing] = useState<string | null>(null);
  const [paymentUpdating, setPaymentUpdating] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState<string | null>(null);
  const [hstFormOpen, setHstFormOpen] = useState(false);
  const [hstSaving, setHstSaving] = useState(false);
  const [hstNumber, setHstNumber] = useState('');
  const [hstEffectiveDate, setHstEffectiveDate] = useState('');
  const [receiptFilter, setReceiptFilter] = useState<'ALL' | 'REVIEW'>('ALL');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptDraftId, setReceiptDraftId] = useState<string | null>(null);
  const [receiptAiParsing, setReceiptAiParsing] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ vendorName: '', businessPurpose: '', expenseDate: formatTorontoDateInput(), description: '', subtotalAmount: '', hstAmount: '0.00', paymentStatus: 'UNPAID', paymentMethod: '', receiptStatus: 'MISSING', notes: '' });

  useEffect(() => {
    if (expenseForm.receiptStatus !== 'ATTACHED' && receiptFile) setReceiptFile(null);
  }, [expenseForm.receiptStatus, receiptFile]);

  // Selecting a manual receipt replaces an AI draft. Discard it best-effort;
  // the server also expires abandoned drafts after 24 hours.
  useEffect(() => {
    if (!receiptFile || !receiptDraftId) return;
    void fetch(`/api/books/expenses/receipt-draft?id=${encodeURIComponent(receiptDraftId)}`, { method: 'DELETE' }).catch(() => undefined);
    setReceiptDraftId(null);
  }, [receiptFile, receiptDraftId]);

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
    discardReceiptDraft();
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

  const discardReceiptDraft = (draftId: string | null = receiptDraftId) => {
    if (!draftId) return;
    void fetch(`/api/books/expenses/receipt-draft?id=${encodeURIComponent(draftId)}`, { method: 'DELETE' }).catch(() => undefined);
  };

  const resetExpenseForm = () => {
    discardReceiptDraft();
    setEditingExpense(null);
    setReceiptFile(null);
    setReceiptDraftId(null);
    setExpenseForm({ vendorName: '', businessPurpose: '', expenseDate: formatTorontoDateInput(), description: '', subtotalAmount: '', hstAmount: '0.00', paymentStatus: 'UNPAID', paymentMethod: '', receiptStatus: 'MISSING', notes: '' });
  };

  const openEditExpense = (expense: Expense) => {
    discardReceiptDraft();
    setEditingExpense(expense);
    setReceiptFile(null);
    setReceiptDraftId(null);
    setExpenseForm({ vendorName: expense.vendorName, businessPurpose: expense.businessPurpose || '', expenseDate: dateOnly(expense.expenseDate), description: expense.description || '', subtotalAmount: expense.subtotalAmount.toFixed(2), hstAmount: expense.hstAmount.toFixed(2), paymentStatus: expense.paymentStatus, paymentMethod: expense.paymentMethod || '', receiptStatus: expense.receiptStatus || 'MISSING', notes: expense.notes || '' });
    setExpenseFormOpen(true);
  };

  const parseReceipt = async (file: File) => {
    setReceiptAiParsing(true);
    setError('');
    try {
      const body = new FormData();
      body.append('entityCode', entityCode);
      body.append('receipt', file);
      const response = await fetch('/api/books/expenses/receipt-draft', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to read receipt');
      const extracted = data.draft.extracted || {};
      setReceiptDraftId(data.draft.id);
      setReceiptFile(null);
      setExpenseForm((current) => ({
        ...current,
        vendorName: extracted.vendorName || current.vendorName,
        businessPurpose: extracted.businessPurposeSuggestion || current.businessPurpose,
        expenseDate: extracted.expenseDate || current.expenseDate,
        description: extracted.description || current.description,
        subtotalAmount: extracted.subtotalAmount === null || extracted.subtotalAmount === undefined ? current.subtotalAmount : Number(extracted.subtotalAmount).toFixed(2),
        hstAmount: extracted.hstAmount === null || extracted.hstAmount === undefined ? current.hstAmount : Number(extracted.hstAmount).toFixed(2),
        receiptStatus: 'ATTACHED',
        notes: '',
      }));
      const warning = Array.isArray(extracted.warnings) && extracted.warnings.length ? ` Review warnings: ${extracted.warnings.join(' ')}` : '';
      showSuccess(`Receipt read with Gemini Flash. Review every field before saving.${warning}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read receipt');
    } finally {
      setReceiptAiParsing(false);
    }
  };

  const saveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    setExpenseSaving(true);
    setError('');
    try {
      const subtotal = Number(expenseForm.subtotalAmount);
      const hst = Number(expenseForm.hstAmount || 0);
      if (!expenseForm.vendorName.trim() || !expenseForm.expenseDate || !Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(hst) || hst < 0) throw new Error('Enter a vendor, date, and valid amounts.');
      if (!expenseForm.businessPurpose.trim()) throw new Error('Add the business purpose for this expense.');
      if (expenseForm.receiptStatus !== 'ATTACHED' && !expenseForm.notes.trim()) throw new Error('Add a note explaining why a receipt is missing or not required.');
      if (expenseForm.receiptStatus === 'ATTACHED' && !receiptFile && !receiptDraftId && !editingExpense?.receiptFileName) throw new Error('Attach a PDF or photo of the receipt.');
      const body = new FormData();
      Object.entries({ entityCode, ...expenseForm, subtotalAmount: subtotal.toFixed(2), hstAmount: hst.toFixed(2), totalAmount: (subtotal + hst).toFixed(2) }).forEach(([key, value]) => body.append(key, String(value)));
      if (receiptFile) body.append('receipt', receiptFile);
      if (receiptDraftId) body.append('receiptDraftId', receiptDraftId);
      const response = await fetch(editingExpense ? `/api/books/expenses/${editingExpense.id}` : '/api/books/expenses', { method: editingExpense ? 'PATCH' : 'POST', body });
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

  const issueServiceInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    setServiceInvoiceSaving(true);
    setError('');
    try {
      const quantity = Number(serviceInvoiceForm.quantity || 1);
      const unitPrice = Number(serviceInvoiceForm.unitPrice);
      if (!serviceInvoiceForm.customerName.trim() || !serviceInvoiceForm.lineDescription.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error('Enter a customer, service description, quantity, and valid unit price.');
      }
      if (!hstReadyForIssue) throw new Error('Configure the IT & Marketing HST number and effective date before issuing an invoice.');
      const response = await fetch('/api/books/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        entityCode: 'IT_MARKETING', invoiceKind: 'CUSTOMER_SERVICE', serviceAmount: (quantity * unitPrice).toFixed(2), quantity, lineDescription: serviceInvoiceForm.lineDescription,
        dueDate: serviceInvoiceForm.dueDate || undefined, paymentTerms: serviceInvoiceForm.paymentTerms, notes: serviceInvoiceForm.notes,
        customer: { legalName: serviceInvoiceForm.customerName, corporationNumber: serviceInvoiceForm.customerNumber, email: serviceInvoiceForm.customerEmail, addressLine1: serviceInvoiceForm.addressLine1, city: serviceInvoiceForm.city, province: serviceInvoiceForm.province, postalCode: serviceInvoiceForm.postalCode, country: serviceInvoiceForm.country },
      }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to issue service invoice');
      setServiceInvoiceOpen(false);
      setServiceInvoiceForm({ customerName: '', customerNumber: '', customerEmail: '', addressLine1: '', city: '', province: 'Ontario', postalCode: '', country: 'Canada', lineDescription: '', quantity: '1', unitPrice: '', dueDate: '', paymentTerms: 'Due on receipt', notes: '' });
      await loadBooks(entityCode, false);
      setSelectedInvoice(data.invoice);
      showSuccess(`Invoice ${data.invoice.invoiceNumber} issued.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to issue service invoice');
    } finally {
      setServiceInvoiceSaving(false);
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
      showSuccess(status === 'RECEIVED'
        ? data.emailNotification?.sent ? 'Payment marked received and paid invoice emailed.' : 'Payment marked received.'
        : 'Payment returned to pending.');
      if (status === 'RECEIVED' && data.emailNotification?.error) setError(`Payment was saved, but the paid invoice email could not be sent: ${data.emailNotification.error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update payment status');
    } finally {
      setPaymentUpdating(null);
    }
  };

  const sendInvoiceEmail = async (invoice: Invoice) => {
    const knownEmail = invoice.emailSentTo || invoice.recipientEntity?.email || invoice.recipientSnapshot?.email || '';
    const email = window.prompt('Customer email address (optional on the invoice, required to send):', knownEmail);
    if (!email) return;
    setEmailSending(invoice.id);
    setError('');
    try {
      const response = await fetch(`/api/books/invoices/${invoice.id}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to send invoice email');
      await loadBooks(entityCode, false);
      setSelectedInvoice(data.invoice);
      showSuccess(`Invoice emailed to ${data.sentTo}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send invoice email');
    } finally {
      setEmailSending(null);
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

  const visibleExpenses = useMemo(
    () => receiptFilter === 'REVIEW' ? state.expenses.filter((expense) => expense.receiptStatus === 'MISSING') : state.expenses,
    [receiptFilter, state.expenses],
  );

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
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Expense ledger</p><h2 className="mt-1 text-xl font-black text-slate-950">{visibleExpenses.length ? `${visibleExpenses.length} expense${visibleExpenses.length === 1 ? '' : 's'}` : receiptFilter === 'REVIEW' ? 'No receipts need review' : 'No expenses yet'}</h2></div><div className="flex items-center gap-2">{state.expenses.some((expense) => expense.receiptStatus === 'MISSING') && <select value={receiptFilter} onChange={(event) => setReceiptFilter(event.target.value as 'ALL' | 'REVIEW')} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700"><option value="ALL">All expenses</option><option value="REVIEW">Needs receipt review</option></select>}{canManageExpenses && <button onClick={() => { resetExpenseForm(); setExpenseFormOpen(true); }} className="rounded-xl bg-slate-950 px-3.5 py-2.5 text-sm font-black text-white transition hover:bg-slate-800">+ Add expense</button>}</div></div>
            <div className="divide-y divide-slate-100">
              {visibleExpenses.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">{receiptFilter === 'REVIEW' ? 'All expenses have receipt evidence or an explicit explanation.' : 'Add a vendor bill, receipt, or other company expense to begin.'}</div> : visibleExpenses.map((expense) => <div key={expense.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-900">{expense.vendorName}</p><StatusBadge status={expense.paymentStatus} />{expense.receiptStatus === 'ATTACHED' ? <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">Receipt attached</span> : <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">{expense.receiptStatus === 'NOT_REQUIRED' ? 'Receipt not required' : 'Receipt missing — review'}</span>}{expense.systemGenerated && <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700 ring-1 ring-blue-200">Auto-synced</span>}</div><p className="mt-1 truncate text-sm text-slate-500">{expense.businessPurpose || expense.description || 'Business purpose not recorded'} · {formatDate(expense.expenseDate)}</p>{expense.receiptStatus === 'ATTACHED' && !expense.systemGenerated && <a href={`/api/books/expenses/${expense.id}/receipt?entityCode=${entityCode}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-blue-700 hover:text-blue-900">View receipt{expense.receiptFileName ? ` · ${expense.receiptFileName}` : ''}</a>}</div><div className="flex items-center justify-between gap-4 sm:justify-end"><p className="font-black text-slate-950">{formatMoney(expense.totalAmount)}</p>{canManageExpenses && !expense.systemGenerated && <button onClick={() => openEditExpense(expense)} className="text-xs font-black text-blue-700 hover:text-blue-900">Edit</button>}</div></div>)}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Partner billing</p><h2 className="mt-1 text-xl font-black text-slate-950">Biweekly periods</h2><p className="mt-1 text-xs text-slate-500">Completed periods are calculated automatically from the operational portal.</p></div></div>
            <div className="divide-y divide-slate-100">
              {state.periods.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">The first period is September 7–20, 2026.</div> : state.periods.map((period) => <div key={period.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{periodLabel(period.periodStart, period.periodEnd)}</p><p className="mt-1 text-xs text-slate-500">Profit snapshot: <span className="font-bold text-slate-700">{formatMoney(period.adjustedProfitAmount)}</span> · Partner share: <span className="font-bold text-slate-700">{formatMoney(period.partnerFeeAmount)}</span></p></div><StatusBadge status={period.invoice ? period.invoice.paymentStatus : entityCode === 'LOCKSMITH' && period.partnerFeeAmount > 0 ? 'PENDING' : period.status} /></div>{period.negativeCarryForward > 0 && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Negative profit carried forward: {formatMoney(period.negativeCarryForward)}. No invoice is due for this period.</p>}{isAdmin && entityCode === 'IT_MARKETING' && !period.invoice && <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => openEditPeriod(period)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Edit snapshot</button>{period.partnerFeeAmount > 0 && <button onClick={() => setConfirmingPeriod(period)} disabled={invoiceIssuing === period.id} className={`rounded-xl border px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${hstReadyForIssue ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100' : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}>{hstReadyForIssue ? 'Review & send invoice' : 'Preview draft — HST pending'}</button>}</div>}</div>)}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Invoices</p><h2 className="mt-1 text-xl font-black text-slate-950">{state.invoices.length ? 'Invoice history' : 'No invoices issued yet'}</h2><p className="mt-1 text-xs text-slate-500">{entityCode === 'IT_MARKETING' ? 'Partner and customer service invoices issued by IT & Marketing.' : 'Invoices issued by IT & Marketing to the Locksmith business.'}</p></div>{isAdmin && entityCode === 'IT_MARKETING' && <button onClick={() => setServiceInvoiceOpen(true)} className="rounded-xl bg-slate-950 px-3.5 py-2.5 text-sm font-black text-white hover:bg-slate-800">+ New customer invoice</button>}</div><div className="divide-y divide-slate-100">{state.invoices.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Issued invoices will appear here with their period, amount, and payment status.</div> : state.invoices.map((invoice) => <div key={invoice.id} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between"><button onClick={() => openInvoice(invoice)} className="min-w-0 text-left"><div className="flex flex-wrap items-center gap-2"><span className="font-black text-slate-950">{invoice.invoiceNumber}</span><StatusBadge status={invoice.paymentStatus} /><span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{invoice.invoiceKind === 'CUSTOMER_SERVICE' ? 'Customer invoice' : 'Locksmith partner invoice'}</span></div><p className="mt-1 truncate text-sm text-slate-500">{invoice.periodStart ? periodLabel(invoice.periodStart, invoice.periodEnd) : invoice.recipientSnapshot?.legalName || 'Customer service invoice'} · {invoice.lineDescription}</p></button><div className="flex items-center justify-between gap-4 lg:justify-end"><p className="font-black text-slate-950">{formatMoney(invoice.totalAmount)}</p><button onClick={() => openInvoice(invoice)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50">View / PDF</button>{isAdmin && <button onClick={() => updatePayment(invoice, invoice.paymentStatus === 'RECEIVED' ? 'PENDING' : 'RECEIVED')} disabled={paymentUpdating === invoice.id} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50">{paymentUpdating === invoice.id ? 'Saving…' : invoice.paymentStatus === 'RECEIVED' ? 'Mark pending' : 'Mark received'}</button>}</div></div>)}</div></section>

        <p className="mt-6 text-xs leading-5 text-slate-500">Partner invoice description: <span className="font-bold text-slate-700">IT Services for Locksmith - C$ xxxx.xx</span>. The amount replaces the placeholder for each period. HST is charged only after the registration number and effective date are configured.</p>
      </div>

      {confirmingPeriod && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="no-print flex items-start justify-between gap-4"><div><p className={`text-xs font-black uppercase tracking-[0.16em] ${hstReadyForIssue ? 'text-blue-700' : 'text-amber-700'}`}>{hstReadyForIssue ? 'Invoice review' : 'Draft — HST pending'}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{hstReadyForIssue ? 'Confirm invoice to Locksmith' : 'Preview invoice for Locksmith'}</h2><p className="mt-1 text-sm text-slate-500">{periodLabel(confirmingPeriod.periodStart, confirmingPeriod.periodEnd)}</p></div><button onClick={() => setConfirmingPeriod(null)} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div><div className="mt-6"><InvoiceDocument draft={!hstReadyForIssue} hstPending={!hstReadyForIssue} invoice={{ invoiceKind: 'PARTNER_SERVICE', lineDescription: 'IT Services for Locksmith', serviceAmount: confirmingPeriod.partnerFeeAmount, hstAmount: confirmingPeriod.partnerFeeAmount * 0.13, totalAmount: confirmingPeriod.partnerFeeAmount * 1.13, hstRate: 0.13, quantity: 1, periodStart: confirmingPeriod.periodStart, periodEnd: confirmingPeriod.periodEnd, paymentTerms: 'Due on receipt' }} issuer={state.entity} recipient={{ legalName: '1001348245 ONTARIO INC.', corporationNumber: '1001348245', email: 'bcltoronto1@gmail.com', addressLine1: '27 Knollside Drive', city: 'Richmond Hill', province: 'Ontario', postalCode: 'L4C4W7', country: 'Canada' }} /></div><div className="no-print mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => window.print()} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">Download / print PDF</button>{hstReadyForIssue ? <button type="button" onClick={() => { setConfirmingPeriod(null); issueInvoice(confirmingPeriod.id); }} disabled={invoiceIssuing === confirmingPeriod.id} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800 disabled:opacity-50">{invoiceIssuing === confirmingPeriod.id ? 'Sending…' : 'Confirm & send invoice'}</button> : <button type="button" disabled className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-black text-slate-500">Issuing blocked — HST pending</button>}</div></div></div>}

      {editingPeriod && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="w-full max-w-xl rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Edit snapshot</p><h2 className="mt-1 text-2xl font-black text-slate-950">Adjust completed period</h2><p className="mt-1 text-sm text-slate-500">{periodLabel(editingPeriod.periodStart, editingPeriod.periodEnd)}</p></div><button onClick={() => setEditingPeriod(null)} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div><form onSubmit={savePeriod} className="mt-6 space-y-4"><div className="grid gap-4 sm:grid-cols-2">{([['revenueAmount', 'Revenue'], ['hstDeductedAmount', 'HST deducted'], ['cogsAmount', 'COGS'], ['technicianCommissionsAmount', 'Technician commissions']] as const).map(([field, label]) => <label key={field} className="block"><span className="field-label">{label} (CAD)</span><input required inputMode="decimal" value={periodEditForm[field]} onChange={(event) => setPeriodEditForm({ ...periodEditForm, [field]: event.target.value })} className="field-input" /></label>)}</div><p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">The 50% partner share and any negative carry-forward will be recalculated from these values. Editing is disabled after an invoice is issued.</p><div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setEditingPeriod(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">Cancel</button><button disabled={periodSaving} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{periodSaving ? 'Saving…' : 'Save snapshot'}</button></div></form></div></div>}

      {expenseFormOpen && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">{editingExpense ? 'Edit expense' : 'New expense'}</p><h2 className="mt-1 text-2xl font-black text-slate-950">Record a company expense</h2></div><button onClick={() => { setExpenseFormOpen(false); resetExpenseForm(); }} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div><form onSubmit={saveExpense} className="mt-6 space-y-4"><label className="block"><span className="field-label">Vendor</span><input required value={expenseForm.vendorName} onChange={(event) => setExpenseForm({ ...expenseForm, vendorName: event.target.value })} className="field-input" placeholder="e.g. Bell Canada" /></label><label className="block"><span className="field-label">Business purpose</span><input required value={expenseForm.businessPurpose} onChange={(event) => setExpenseForm({ ...expenseForm, businessPurpose: event.target.value })} className="field-input" placeholder="e.g. Google Ads campaign for locksmith leads" /><span className="mt-1 block text-xs text-slate-500">Describe how this expense relates to this company.</span></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="field-label">Expense date</span><input required type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm({ ...expenseForm, expenseDate: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">Payment status</span><select value={expenseForm.paymentStatus} onChange={(event) => setExpenseForm({ ...expenseForm, paymentStatus: event.target.value })} className="field-input"><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option></select></label></div><label className="block"><span className="field-label">Description</span><input value={expenseForm.description} onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })} className="field-input" placeholder="Optional detail from the receipt" /></label><div className="grid gap-4 sm:grid-cols-3"><label className="block"><span className="field-label">Subtotal (CAD)</span><input required inputMode="decimal" value={expenseForm.subtotalAmount} onChange={(event) => setExpenseForm({ ...expenseForm, subtotalAmount: event.target.value })} className="field-input" placeholder="0.00" /></label><label className="block"><span className="field-label">HST paid</span><input required inputMode="decimal" value={expenseForm.hstAmount} onChange={(event) => setExpenseForm({ ...expenseForm, hstAmount: event.target.value })} className="field-input" placeholder="0.00" /><span className="mt-1 block text-xs text-slate-500">Use 0 if the receipt does not show HST.</span></label><div><span className="field-label">Total</span><div className="field-input bg-slate-50 font-black">{formatMoney((Number(expenseForm.subtotalAmount) || 0) + (Number(expenseForm.hstAmount) || 0))}</div></div></div><label className="block"><span className="field-label">Receipt evidence</span><select value={expenseForm.receiptStatus} onChange={(event) => setExpenseForm({ ...expenseForm, receiptStatus: event.target.value })} className="field-input"><option value="MISSING">Missing — requires review</option><option value="NOT_REQUIRED">Not required — explain why</option><option value="ATTACHED">Receipt attached</option></select><span className="mt-1 block text-xs text-slate-500">PDFs, emailed invoices, scans, and clear photos are accepted. Maximum 10 MB.</span></label>{!editingExpense && <label className="block rounded-2xl border border-blue-200 bg-blue-50 p-4"><span className="field-label text-blue-900">Auto-fill with Gemini Flash (optional)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={receiptAiParsing} onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseReceipt(file); }} className="field-input mt-2 bg-white" />{receiptAiParsing && <span className="mt-2 block text-xs font-semibold text-blue-700">Reading receipt… please review the suggested fields.</span>}{receiptDraftId && !receiptAiParsing && <span className="mt-2 block text-xs font-semibold text-emerald-700">Receipt parsed. Review the fields, then save the expense.</span>}</label>}<label className="block"><span className="field-label">Upload receipt (PDF or photo)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0] || null; setReceiptFile(file); if (file) { setReceiptDraftId(null); setExpenseForm({ ...expenseForm, receiptStatus: 'ATTACHED' }); } }} className="field-input" />{receiptFile && <span className="mt-1 block text-xs font-semibold text-emerald-700">Ready to upload: {receiptFile.name}</span>}{!receiptFile && editingExpense?.receiptFileName && <span className="mt-1 block text-xs font-semibold text-emerald-700">Already attached: {editingExpense.receiptFileName}</span>}</label><label className="block"><span className="field-label">Notes / missing-receipt explanation</span><textarea rows={3} value={expenseForm.notes} onChange={(event) => setExpenseForm({ ...expenseForm, notes: event.target.value })} className="field-input" placeholder="Required when no receipt is attached; otherwise optional." /></label><div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setExpenseFormOpen(false); resetExpenseForm(); }} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">Cancel</button><button disabled={expenseSaving || receiptAiParsing} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{expenseSaving ? 'Saving…' : editingExpense ? 'Save changes' : 'Add expense'}</button></div></form></div></div>}

      {serviceInvoiceOpen && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Customer service invoice</p><h2 className="mt-1 text-2xl font-black text-slate-950">Issue an invoice to another business</h2><p className="mt-1 text-sm text-slate-500">This is separate from the biweekly Locksmith partner invoice.</p></div><button onClick={() => setServiceInvoiceOpen(false)} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div><form onSubmit={issueServiceInvoice} className="mt-6 space-y-5"><div><p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Customer details</p><div className="grid gap-4 sm:grid-cols-2"><label className="block sm:col-span-2"><span className="field-label">Business / customer legal name *</span><input required value={serviceInvoiceForm.customerName} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, customerName: event.target.value })} className="field-input" placeholder="Example Business Inc." /></label><label className="block"><span className="field-label">Corporation / account number</span><input value={serviceInvoiceForm.customerNumber} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, customerNumber: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">Email</span><input type="email" value={serviceInvoiceForm.customerEmail} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, customerEmail: event.target.value })} className="field-input" /></label><label className="block sm:col-span-2"><span className="field-label">Street address</span><input value={serviceInvoiceForm.addressLine1} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, addressLine1: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">City</span><input value={serviceInvoiceForm.city} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, city: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">Province</span><input value={serviceInvoiceForm.province} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, province: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">Postal code</span><input value={serviceInvoiceForm.postalCode} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, postalCode: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">Country</span><input value={serviceInvoiceForm.country} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, country: event.target.value })} className="field-input" /></label></div></div><div><p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Invoice line</p><div className="grid gap-4 sm:grid-cols-4"><label className="block sm:col-span-2"><span className="field-label">Description *</span><input required value={serviceInvoiceForm.lineDescription} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, lineDescription: event.target.value })} className="field-input" placeholder="IT consulting and marketing services" /></label><label className="block"><span className="field-label">Quantity</span><input required inputMode="decimal" value={serviceInvoiceForm.quantity} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, quantity: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">Unit price (CAD) *</span><input required inputMode="decimal" value={serviceInvoiceForm.unitPrice} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, unitPrice: event.target.value })} className="field-input" placeholder="0.00" /></label></div></div><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="field-label">Due date</span><input type="date" value={serviceInvoiceForm.dueDate} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, dueDate: event.target.value })} className="field-input" /></label><label className="block"><span className="field-label">Payment terms</span><input value={serviceInvoiceForm.paymentTerms} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, paymentTerms: event.target.value })} className="field-input" placeholder="Due on receipt" /></label></div><label className="block"><span className="field-label">Notes</span><textarea rows={3} value={serviceInvoiceForm.notes} onChange={(event) => setServiceInvoiceForm({ ...serviceInvoiceForm, notes: event.target.value })} className="field-input" placeholder="Optional note for the customer" /></label><div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600">HST is calculated at 13% and the IT & Marketing HST registration snapshot is included on the invoice. Configure HST before issuing.</div><div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setServiceInvoiceOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">Cancel</button><button disabled={serviceInvoiceSaving || !hstReadyForIssue} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{serviceInvoiceSaving ? 'Issuing…' : hstReadyForIssue ? 'Review and issue invoice' : 'HST setup required'}</button></div></form></div></div>}

      {selectedInvoice && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Invoice detail</p><h2 className="mt-1 text-2xl font-black text-slate-950">{selectedInvoice.invoiceNumber}</h2><p className="mt-1 text-sm text-slate-500">{periodLabel(selectedInvoice.periodStart, selectedInvoice.periodEnd)}</p></div><div className="flex items-center gap-2"><button onClick={() => window.print()} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Download / print PDF</button><button onClick={() => setSelectedInvoice(null)} className="rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button></div></div><div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-bold text-slate-900">{selectedInvoice.lineDescription}</p><div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs font-bold uppercase text-slate-500">Service</p><p className="mt-1 font-black">{formatMoney(selectedInvoice.serviceAmount)}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">HST</p><p className="mt-1 font-black">{formatMoney(selectedInvoice.hstAmount)}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Total</p><p className="mt-1 text-lg font-black text-slate-950">{formatMoney(selectedInvoice.totalAmount)}</p></div></div></div><div className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">From</p><p className="mt-1 font-bold text-slate-900">{selectedIssuer?.legalName || 'IT & marketing partner'}</p><p className="text-slate-500">{selectedIssuer?.corporationNumber ? `OCN: ${selectedIssuer.corporationNumber}` : 'IT & marketing partner'}</p>{selectedIssuer?.addressLine1 && <p className="text-slate-500">{[selectedIssuer.addressLine1, selectedIssuer.city, selectedIssuer.province, selectedIssuer.postalCode, selectedIssuer.country].filter(Boolean).join(', ')}</p>}</div><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">To</p><p className="mt-1 font-bold text-slate-900">{selectedRecipient?.legalName || '1001348245 ONTARIO INC.'}</p><p className="text-slate-500">OCN: {selectedRecipient?.corporationNumber || '1001348245'}</p>{selectedRecipient?.addressLine1 && <p className="text-slate-500">{[selectedRecipient.addressLine1, selectedRecipient.city, selectedRecipient.province, selectedRecipient.postalCode, selectedRecipient.country].filter(Boolean).join(', ')}</p>}</div></div><div className="mt-5 rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">History</p><div className="mt-3 space-y-2 text-xs text-slate-600"><p>Issued: {selectedInvoice.issuedAt ? formatDate(selectedInvoice.issuedAt) : 'Pending issue'}</p>{selectedInvoice.paymentEvents?.map((event) => <p key={event.id}>{event.toStatus === 'RECEIVED' ? 'Payment received' : 'Payment pending'}: {formatDate(event.paidAt || event.createdAt)}</p>)}</div></div><div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Payment status</p><div className="mt-2"><StatusBadge status={selectedInvoice.paymentStatus} /></div></div>{isAdmin && <button onClick={() => updatePayment(selectedInvoice, selectedInvoice.paymentStatus === 'RECEIVED' ? 'PENDING' : 'RECEIVED')} disabled={paymentUpdating === selectedInvoice.id} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{paymentUpdating === selectedInvoice.id ? 'Saving…' : selectedInvoice.paymentStatus === 'RECEIVED' ? 'Mark payment pending' : 'Mark payment received'}</button>}</div><p className="mt-6 text-xs leading-5 text-slate-500">HST is shown from the registration snapshot at issuance. This invoice cannot be recalculated from live job data.</p></div></div>}
      {selectedInvoice && isAdmin && <div className="no-print fixed bottom-5 left-1/2 z-[70] -translate-x-1/2"><button onClick={() => sendInvoiceEmail(selectedInvoice)} disabled={emailSending === selectedInvoice.id} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-900/20 hover:bg-blue-800 disabled:opacity-50">{emailSending === selectedInvoice.id ? 'Sending…' : selectedInvoice.paymentStatus === 'RECEIVED' ? 'Send paid invoice' : 'Email invoice'}</button></div>}
      {selectedInvoice && <div className="print-invoice"><InvoiceDocument invoice={selectedInvoice} issuer={selectedIssuer} recipient={selectedRecipient} /></div>}
    </main>
  );
}
