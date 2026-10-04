'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountingEntityCode, AccountingEntitySummary } from '@/lib/accounting-types';
import { formatTorontoDateInput } from '@/lib/timezone';

type Role = 'ADMIN' | 'DISPATCHER' | 'TECHNICIAN' | 'ACCOUNTANT';

type Entity = AccountingEntitySummary & {
  hstEnabled: boolean;
  currency: string;
};

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
  businessPaymentReference?: string | null;
  fundingSource?: 'BUSINESS' | 'PERSONAL';
  personalPayeeName?: string | null;
  personalPaymentMethod?: string | null;
  personalCardLast4?: string | null;
  reimbursementNeedsConfirmation?: boolean;
  paidAt?: string | null;
  paidBeforeIncorporation?: boolean;
  reimbursedCents?: number;
  openBalanceCents?: number;
  mappingStatus?: 'NOT_REVIEWED' | 'NEEDS_CLARIFICATION' | 'MAPPED';
  accountName?: string | null;
  accountCode?: string | null;
  mappingNotes?: string | null;
  mappedAt?: string | null;
  mappedByName?: string | null;
  notes?: string | null;
  receiptStatus: 'ATTACHED' | 'MISSING' | 'NOT_REQUIRED';
  receiptFileName?: string | null;
  receiptMimeType?: string | null;
  receiptSize?: number | null;
  receiptUploadedAt?: string | null;
  systemGenerated?: boolean;
  source?: string;
};

type ReimbursementPayment = {
  id: string;
  payeeName: string;
  paymentDate: string;
  amountCents: number;
  paymentMethod: string;
  sourceAccountLabel?: string | null;
  bankReference?: string | null;
  note?: string | null;
  proofFileName?: string | null;
  voidedAt?: string | null;
  allocations: Array<{
    id: string;
    expenseId: string;
    amountCents: number;
    expense?: {
      id: string;
      vendorName: string;
      expenseDate: string;
      totalAmount: number;
    };
  }>;
  mappingStatus?: 'NOT_REVIEWED' | 'NEEDS_CLARIFICATION' | 'MAPPED';
  accountName?: string | null;
  accountCode?: string | null;
  mappingNotes?: string | null;
  mappedAt?: string | null;
  mappedByName?: string | null;
};

type ReimbursementData = {
  summary: {
    unassignedCents: number;
    owedCents: number;
    repaidCents: number;
    outstandingCents: number;
  };
  expenses: Array<Expense & { reimbursedCents: number; openBalanceCents: number }>;
  payments: ReimbursementPayment[];
  history?: Array<{
    id: string;
    targetType: string;
    targetId: string;
    action: string;
    createdAt: string;
    actorName?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
};

type EntityCapability = {
  code: AccountingEntityCode;
  legalName: string;
  capabilities: {
    view: boolean;
    manageExpenses: boolean;
    manageReimbursements: boolean;
    mapAccounts: boolean;
    issueInvoices: boolean;
    markPayments: boolean;
  };
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
  priorNegativeCarryForward: number;
  adjustedProfitAmount: number;
  negativeCarryForward: number;
  shareRate: number;
  partnerFeeAmount: number;
  hstAmount: number;
  invoice?: Invoice | null;
};

type CurrentBillingPeriod = Pick<BillingPeriod, 'periodStart' | 'periodEnd' | 'revenueAmount' | 'hstDeductedAmount' | 'cogsAmount' | 'technicianCommissionsAmount' | 'operationalProfitAmount' | 'priorNegativeCarryForward' | 'adjustedProfitAmount' | 'negativeCarryForward' | 'partnerFeeAmount' | 'shareRate'> & {
  hstAmount: number;
  hstRate: number;
  invoiceTotalAmount: number;
  contributionCount: number;
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
  paymentEvents?: Array<{
    id: string;
    toStatus: string;
    paidAt?: string | null;
    createdAt: string;
    note?: string | null;
  }>;
  auditEvents?: Array<{
    id: string;
    action: string;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
  }>;
};

type ApiState = {
  entity: Entity | null;
  expenses: Expense[];
  periods: BillingPeriod[];
  currentPeriod: CurrentBillingPeriod | null;
  invoices: Invoice[];
};

const EMPTY_STATE: ApiState = {
  entity: null,
  expenses: [],
  periods: [],
  currentPeriod: null,
  invoices: [],
};
function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(Number(value || 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(date);
}

function dateOnly(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(0, 10);
}

function periodLabel(start?: string | null, end?: string | null) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

type InvoiceParty = Partial<Entity> & {
  legalName?: string | null;
  email?: string | null;
  corporationNumber?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

function partyAddress(party?: InvoiceParty | null) {
  return party ? [party.addressLine1, party.city, party.province, party.postalCode, party.country].filter(Boolean).join(', ') : '';
}

function InvoiceDocument({ invoice, issuer, recipient, draft = false, hstPending = false }: { invoice: Partial<Invoice>; issuer?: InvoiceParty | null; recipient?: InvoiceParty | null; draft?: boolean; hstPending?: boolean }) {
  const quantity = Number(invoice.quantity || 1);
  const subtotal = Number(invoice.serviceAmount || 0);
  const hst = hstPending ? null : Number(invoice.hstAmount || 0);
  const total = hstPending ? null : Number(invoice.totalAmount ?? subtotal + (hst || 0));
  return (
    <article className='print-invoice mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-7 text-slate-950 shadow-sm sm:p-10'>
      <div className='flex items-start justify-between gap-6 border-b border-slate-200 pb-7'>
        <div>
          <p className='text-3xl font-black tracking-tight text-slate-950'>INVOICE</p>
          <p className='mt-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500'>{draft ? 'Draft preview — not issued' : invoice.invoiceKind === 'CUSTOMER_SERVICE' ? 'Professional services' : 'IT services for Locksmith'}</p>
        </div>
        <div className='text-right'>
          <p className='text-sm font-black text-slate-900'>{invoice.invoiceNumber || 'Draft invoice'}</p>
          <p className='mt-1 text-xs text-slate-500'>Issue date: {formatDate(invoice.issuedAt) || 'On issue'}</p>
          <p className='mt-1 text-xs text-slate-500'>Due date: {formatDate(invoice.dueAt) || 'Due on receipt'}</p>
          {draft && <span className='mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-amber-800'>Draft</span>}
        </div>
      </div>
      <div className='grid gap-7 border-b border-slate-200 py-7 sm:grid-cols-2'>
        <div>
          <p className='text-[10px] font-black uppercase tracking-[0.16em] text-slate-500'>From</p>
          <p className='mt-2 font-black'>{issuer?.legalName || '1001744934 ONTARIO INC.'}</p>
          {issuer?.corporationNumber && <p className='mt-1 text-xs text-slate-600'>OCN: {issuer.corporationNumber}</p>}
          {issuer?.hstRegistrationNumber && <p className='mt-1 text-xs text-slate-600'>HST: {issuer.hstRegistrationNumber}</p>}
          {partyAddress(issuer) && <p className='mt-2 max-w-xs text-xs leading-5 text-slate-600'>{partyAddress(issuer)}</p>}
          {issuer?.email && <p className='mt-1 text-xs text-slate-600'>{issuer.email}</p>}
        </div>
        <div>
          <p className='text-[10px] font-black uppercase tracking-[0.16em] text-slate-500'>Bill to</p>
          <p className='mt-2 font-black'>{recipient?.legalName || 'Customer'}</p>
          {recipient?.corporationNumber && <p className='mt-1 text-xs text-slate-600'>OCN: {recipient.corporationNumber}</p>}
          {partyAddress(recipient) && <p className='mt-2 max-w-xs text-xs leading-5 text-slate-600'>{partyAddress(recipient)}</p>}
          {recipient?.email && <p className='mt-1 text-xs text-slate-600'>{recipient.email}</p>}
        </div>
      </div>
      <table className='w-full border-collapse text-sm'>
        <thead>
          <tr className='border-b border-slate-200 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-500'>
            <th className='py-4'>Description</th>
            <th className='py-4 text-right'>Qty</th>
            <th className='py-4 text-right'>Rate</th>
            <th className='py-4 text-right'>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className='border-b border-slate-100'>
            <td className='py-5 font-semibold'>{invoice.lineDescription || 'Professional services'}</td>
            <td className='py-5 text-right'>{quantity.toFixed(2).replace(/\.00$/, '')}</td>
            <td className='py-5 text-right'>{formatMoney(quantity ? subtotal / quantity : subtotal)}</td>
            <td className='py-5 text-right font-bold'>{formatMoney(subtotal)}</td>
          </tr>
        </tbody>
      </table>
      <div className='ml-auto mt-7 w-full max-w-xs space-y-3 text-sm'>
        <div className='flex justify-between'>
          <span className='text-slate-500'>Subtotal</span>
          <span className='font-semibold'>{formatMoney(subtotal)}</span>
        </div>
        <div className='flex justify-between'>
          <span className='text-slate-500'>HST {invoice.hstRate ? `(${(Number(invoice.hstRate) * 100).toFixed(0)}%)` : ''}</span>
          <span className='font-semibold'>{hstPending ? 'Pending' : formatMoney(hst)}</span>
        </div>
        <div className='flex justify-between border-t border-slate-200 pt-3 text-lg'>
          <span className='font-black'>Total CAD</span>
          <span className='font-black'>{total === null ? 'Pending' : formatMoney(total)}</span>
        </div>
        {!draft && <div className={`mt-3 rounded-xl px-3 py-2 text-center text-xs font-black uppercase tracking-wide ${invoice.paymentStatus === 'RECEIVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{invoice.paymentStatus === 'RECEIVED' ? 'Paid' : 'Payment pending'}</div>}
      </div>
      {(invoice.paymentTerms || invoice.notes || draft) && (
        <div className='mt-10 border-t border-slate-200 pt-6 text-xs leading-5 text-slate-600'>
          <p className='font-black uppercase tracking-wide text-slate-500'>Notes</p>
          {invoice.paymentTerms && (
            <p className='mt-2'>
              <span className='font-bold'>Payment terms:</span> {invoice.paymentTerms}
            </p>
          )}
          {invoice.notes && <p className='mt-1'>{invoice.notes}</p>}
          {draft && <p className='mt-2 font-semibold text-amber-700'>HST registration is pending. This document is for layout review only and is not an accounting entry.</p>}
        </div>
      )}
    </article>
  );
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
    <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-xs font-black uppercase tracking-[0.18em] text-blue-700'>Legal entity</p>
          <h2 className='mt-1 text-xl font-black text-slate-950'>{entity.legalName}</h2>
          <p className='mt-1 text-sm text-slate-500'>OCN: {entity.corporationNumber || 'Not configured'}</p>
        </div>
        <StatusBadge status={entity.hstEnabled && entity.hstRegistrationNumber ? 'HST active' : 'HST pending'} tone={entity.hstEnabled && entity.hstRegistrationNumber ? 'green' : 'amber'} />
      </div>
      <div className='mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2'>
        <p>
          <span className='font-bold text-slate-800'>Email:</span> {entity.email || 'Not configured'}
        </p>
        <p>
          <span className='font-bold text-slate-800'>HST number:</span> {entity.hstRegistrationNumber || 'Pending — invoices cannot charge HST yet'}
        </p>
        <p className='sm:col-span-2'>
          <span className='font-bold text-slate-800'>Address:</span> {[entity.addressLine1, entity.city, entity.province, entity.postalCode, entity.country].filter(Boolean).join(', ') || 'Not configured'}
        </p>
        {entity.authorizedPersonName && (
          <p>
            <span className='font-bold text-slate-800'>Authorized by:</span> {entity.authorizedPersonName}
            {entity.authorizedPersonTitle ? `, ${entity.authorizedPersonTitle}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

export default function BooksPage() {
  const [user, setUser] = useState<{ role: Role; name: string } | null>(null);
  const [entityCode, setEntityCode] = useState<AccountingEntityCode>('IT_MARKETING');
  const [entityCapabilities, setEntityCapabilities] = useState<EntityCapability[]>([]);
  const [state, setState] = useState<ApiState>(EMPTY_STATE);
  const [reimbursements, setReimbursements] = useState<ReimbursementData | null>(null);
  const [reimbursementFilter, setReimbursementFilter] = useState<'OUTSTANDING' | 'ALL' | 'MAPPING'>('OUTSTANDING');
  const [reimbursementPayeeFilter, setReimbursementPayeeFilter] = useState('ALL');
  const [repaymentOpen, setRepaymentOpen] = useState(false);
  const [repaymentSaving, setRepaymentSaving] = useState(false);
  const [repaymentProofFile, setRepaymentProofFile] = useState<File | null>(null);
  const [selectedRepaymentExpenses, setSelectedRepaymentExpenses] = useState<string[]>([]);
  const [repaymentForm, setRepaymentForm] = useState({
    payeeName: '',
    paymentDate: formatTorontoDateInput(),
    amount: '',
    paymentMethod: 'BANK_TRANSFER',
    sourceAccountLabel: '',
    bankReference: '',
    note: '',
  });
  const [mappingDrafts, setMappingDrafts] = useState<
    Record<
      string,
      {
        accountName: string;
        accountCode: string;
        notes: string;
        status: 'NOT_REVIEWED' | 'NEEDS_CLARIFICATION' | 'MAPPED';
      }
    >
  >({});
  const [mappingSaving, setMappingSaving] = useState<string | null>(null);
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
  const [serviceInvoiceForm, setServiceInvoiceForm] = useState({
    customerName: '',
    customerNumber: '',
    customerEmail: '',
    addressLine1: '',
    city: '',
    province: 'Ontario',
    postalCode: '',
    country: 'Canada',
    lineDescription: '',
    quantity: '1',
    unitPrice: '',
    dueDate: '',
    paymentTerms: 'Due on receipt',
    notes: '',
  });
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<BillingPeriod | null>(null);
  const [periodEditForm, setPeriodEditForm] = useState({
    revenueAmount: '',
    hstDeductedAmount: '',
    cogsAmount: '',
    technicianCommissionsAmount: '',
  });
  const [periodSaving, setPeriodSaving] = useState(false);
  const [invoiceIssuing, setInvoiceIssuing] = useState<string | null>(null);
  const [paymentUpdating, setPaymentUpdating] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState<string | null>(null);
  const [receiptFilter, setReceiptFilter] = useState<'ALL' | 'REVIEW'>('ALL');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptDraftId, setReceiptDraftId] = useState<string | null>(null);
  const [receiptAiParsing, setReceiptAiParsing] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    vendorName: '',
    businessPurpose: '',
    expenseDate: formatTorontoDateInput(),
    description: '',
    subtotalAmount: '',
    hstAmount: '0.00',
    fundingSource: 'BUSINESS' as 'BUSINESS' | 'PERSONAL',
    personalPayeeName: '',
    personalPaymentMethod: 'CREDIT_CARD',
    personalCardLast4: '8833',
    paidAt: formatTorontoDateInput(),
    paidBeforeIncorporation: false,
    paymentMethod: 'CREDIT_CARD',
    businessPaymentReference: '',
    receiptStatus: 'MISSING',
    notes: '',
  });

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
  const selectedCapabilities = entityCapabilities.find((item) => item.code === entityCode)?.capabilities;
  const canManageExpenses = selectedCapabilities?.manageExpenses ?? (isAdmin || user?.role === 'DISPATCHER');
  const canManageReimbursements = selectedCapabilities?.manageReimbursements ?? (isAdmin || user?.role === 'DISPATCHER');
  const canMapAccounts = selectedCapabilities?.mapAccounts ?? isAdmin;
  const availableCodes: AccountingEntityCode[] = user?.role === 'DISPATCHER' ? ['LOCKSMITH'] : user?.role === 'ACCOUNTANT' ? entityCapabilities.filter((item) => item.capabilities.view).map((item) => item.code) : ['IT_MARKETING', 'LOCKSMITH'];
  const hstReadyForIssue = Boolean(entityCode === 'IT_MARKETING' && state.entity?.hstEnabled && state.entity.hstRegistrationNumber && state.entity.hstEffectiveDate && dateOnly(state.entity.hstEffectiveDate) <= formatTorontoDateInput(new Date()));

  const loadBooks = useCallback(async (code: AccountingEntityCode, showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const [expenseRes, periodsRes, invoicesRes, reimbursementRes] = await Promise.all([
        fetch(`/api/books/expenses?entityCode=${code}`, {
          cache: 'no-store',
        }),
        fetch(`/api/books/periods?entityCode=${code}`, {
          cache: 'no-store',
        }),
        fetch(`/api/books/invoices?entityCode=${code}`, {
          cache: 'no-store',
        }),
        fetch(`/api/books/reimbursements?entityCode=${code}`, {
          cache: 'no-store',
        }),
      ]);
      const [expenseData, periodsData, invoicesData, reimbursementData] = await Promise.all([expenseRes.json(), periodsRes.json(), invoicesRes.json(), reimbursementRes.json()]);
      const firstError = [expenseData, periodsData, invoicesData].find((data) => !data.success);
      if (firstError) throw new Error(firstError.error || 'Unable to load Books');
      setState({
        entity: expenseData.entity || null,
        expenses: expenseData.expenses || [],
        periods: periodsData.periods || [],
        currentPeriod: periodsData.currentPeriod || null,
        invoices: invoicesData.invoices || [],
      });
      setReimbursements(reimbursementData.success ? reimbursementData : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Books');
      setState(EMPTY_STATE);
      setReimbursements(null);
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
        const accessResponse = await fetch('/api/books/access', {
          cache: 'no-store',
        });
        const accessData = await accessResponse.json();
        if (!accessResponse.ok || !accessData.success) throw new Error(accessData.error || 'Unable to load your Books access.');
        const accessible: EntityCapability[] = accessData.entities || [];
        if (!cancelled) setEntityCapabilities(accessible);
        const initialCode: AccountingEntityCode = data.user.role === 'DISPATCHER' ? 'LOCKSMITH' : data.user.role === 'ACCOUNTANT' ? accessible.find((item) => item.capabilities.view)?.code || 'IT_MARKETING' : 'IT_MARKETING';
        setEntityCode(initialCode);
        await loadBooks(initialCode);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load Books');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
    setExpenseForm({
      vendorName: '',
      businessPurpose: '',
      expenseDate: formatTorontoDateInput(),
      description: '',
      subtotalAmount: '',
      hstAmount: '0.00',
      fundingSource: 'BUSINESS',
      personalPayeeName: '',
      personalPaymentMethod: 'CREDIT_CARD',
      personalCardLast4: '8833',
      paidAt: formatTorontoDateInput(),
      paidBeforeIncorporation: false,
      paymentMethod: 'CREDIT_CARD',
      businessPaymentReference: '',
      receiptStatus: 'MISSING',
      notes: '',
    });
  };

  const openEditExpense = (expense: Expense) => {
    discardReceiptDraft();
    setEditingExpense(expense);
    setReceiptFile(null);
    setReceiptDraftId(null);
    setExpenseForm({
      vendorName: expense.vendorName,
      businessPurpose: expense.businessPurpose || '',
      expenseDate: dateOnly(expense.expenseDate),
      description: expense.description || '',
      subtotalAmount: expense.subtotalAmount.toFixed(2),
      hstAmount: expense.hstAmount.toFixed(2),
      fundingSource: expense.fundingSource || 'BUSINESS',
      personalPayeeName: expense.fundingSource === 'PERSONAL' ? expense.personalPayeeName || '' : '',
      personalPaymentMethod: expense.personalPaymentMethod || 'CREDIT_CARD',
      personalCardLast4: expense.fundingSource === 'PERSONAL' ? expense.personalCardLast4 || '' : '',
      paidAt: dateOnly(expense.paidAt || ''),
      paidBeforeIncorporation: Boolean(expense.paidBeforeIncorporation),
      paymentMethod: expense.paymentMethod || 'CREDIT_CARD',
      businessPaymentReference: expense.businessPaymentReference || '',
      receiptStatus: expense.receiptStatus || 'MISSING',
      notes: expense.notes || '',
    });
    setExpenseFormOpen(true);
  };

  const parseReceipt = async (file: File) => {
    setReceiptAiParsing(true);
    setError('');
    try {
      const body = new FormData();
      body.append('entityCode', entityCode);
      body.append('receipt', file);
      const response = await fetch('/api/books/expenses/receipt-draft', {
        method: 'POST',
        body,
      });
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
      if (!expenseForm.paidAt) throw new Error('Enter the date the vendor was paid.');
      if (expenseForm.fundingSource === 'PERSONAL' && !expenseForm.personalPayeeName.trim()) throw new Error('Enter the person who paid this expense personally.');
      if (expenseForm.fundingSource === 'PERSONAL' && !expenseForm.paidAt) throw new Error('Enter the date this person paid the vendor.');
      if (expenseForm.receiptStatus !== 'ATTACHED' && !expenseForm.notes.trim()) throw new Error('Add a note explaining why a receipt is missing or not required.');
      if (expenseForm.receiptStatus === 'ATTACHED' && !receiptFile && !receiptDraftId && !editingExpense?.receiptFileName) throw new Error('Attach a PDF or photo of the receipt.');
      const body = new FormData();
      const fields = {
        entityCode,
        ...expenseForm,
        subtotalAmount: subtotal.toFixed(2),
        hstAmount: hst.toFixed(2),
        totalAmount: (subtotal + hst).toFixed(2),
        personalPayeeName: expenseForm.fundingSource === 'PERSONAL' ? expenseForm.personalPayeeName : '',
        personalPaymentMethod: expenseForm.fundingSource === 'PERSONAL' ? expenseForm.personalPaymentMethod : '',
        personalCardLast4: expenseForm.fundingSource === 'PERSONAL' ? expenseForm.personalCardLast4 : '',
        paidBeforeIncorporation: expenseForm.fundingSource === 'PERSONAL' && expenseForm.paidBeforeIncorporation,
        paymentMethod: expenseForm.fundingSource === 'BUSINESS' ? expenseForm.paymentMethod : '',
        businessPaymentReference: expenseForm.fundingSource === 'BUSINESS' ? expenseForm.businessPaymentReference : '',
      };
      Object.entries(fields).forEach(([key, value]) => body.append(key, String(value)));
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
        body: JSON.stringify({
          entityCode: 'IT_MARKETING',
          periodId: editingPeriod.id,
          ...periodEditForm,
        }),
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
      const response = await fetch('/api/books/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityCode: 'IT_MARKETING',
          billingPeriodId: periodId,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to issue invoice');
      await loadBooks(entityCode, false);
      setSelectedInvoice(data.invoice);
      showSuccess(data.emailNotification?.sent ? `Invoice ${data.invoice.invoiceNumber} issued and emailed to Locksmith.` : `Invoice ${data.invoice.invoiceNumber} issued to Locksmith.`);
      if (data.emailNotification?.error) setError(`Invoice was issued, but the email could not be sent: ${data.emailNotification.error}`);
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
      const response = await fetch('/api/books/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityCode: 'IT_MARKETING',
          invoiceKind: 'CUSTOMER_SERVICE',
          serviceAmount: (quantity * unitPrice).toFixed(2),
          quantity,
          lineDescription: serviceInvoiceForm.lineDescription,
          dueDate: serviceInvoiceForm.dueDate || undefined,
          paymentTerms: serviceInvoiceForm.paymentTerms,
          notes: serviceInvoiceForm.notes,
          customer: {
            legalName: serviceInvoiceForm.customerName,
            corporationNumber: serviceInvoiceForm.customerNumber,
            email: serviceInvoiceForm.customerEmail,
            addressLine1: serviceInvoiceForm.addressLine1,
            city: serviceInvoiceForm.city,
            province: serviceInvoiceForm.province,
            postalCode: serviceInvoiceForm.postalCode,
            country: serviceInvoiceForm.country,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to issue service invoice');
      setServiceInvoiceOpen(false);
      setServiceInvoiceForm({
        customerName: '',
        customerNumber: '',
        customerEmail: '',
        addressLine1: '',
        city: '',
        province: 'Ontario',
        postalCode: '',
        country: 'Canada',
        lineDescription: '',
        quantity: '1',
        unitPrice: '',
        dueDate: '',
        paymentTerms: 'Due on receipt',
        notes: '',
      });
      await loadBooks(entityCode, false);
      setSelectedInvoice(data.invoice);
      showSuccess(data.emailNotification?.sent ? `Invoice ${data.invoice.invoiceNumber} issued and emailed.` : `Invoice ${data.invoice.invoiceNumber} issued.`);
      if (data.emailNotification?.error) setError(`Invoice was issued, but the email could not be sent: ${data.emailNotification.error}`);
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
      const response = await fetch(`/api/books/invoices/${invoice.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to update payment status');
      await loadBooks(entityCode, false);
      setSelectedInvoice(data.invoice);
      showSuccess(status === 'RECEIVED' ? (data.emailNotification?.sent ? 'Payment marked received and paid invoice emailed.' : 'Payment marked received.') : 'Payment returned to pending.');
      if (status === 'RECEIVED' && data.emailNotification?.error) setError(`Payment was saved, but the paid invoice email could not be sent: ${data.emailNotification.error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update payment status');
    } finally {
      setPaymentUpdating(null);
    }
  };

  const personalExpenses = useMemo(() => reimbursements?.expenses.filter((expense) => expense.fundingSource === 'PERSONAL') || [], [reimbursements]);
  const reimbursementPayees = useMemo(() => Array.from(new Set(personalExpenses.map((expense) => expense.personalPayeeName).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b)), [personalExpenses]);
  const filteredPersonalExpenses = useMemo(
    () =>
      personalExpenses.filter((expense) => {
        if (reimbursementPayeeFilter !== 'ALL' && expense.personalPayeeName !== reimbursementPayeeFilter) return false;
        if (reimbursementFilter === 'OUTSTANDING' && expense.openBalanceCents <= 0) return false;
        if (reimbursementFilter === 'MAPPING' && expense.mappingStatus === 'MAPPED') return false;
        return true;
      }),
    [personalExpenses, reimbursementPayeeFilter, reimbursementFilter],
  );
  const personalExpenseGroups = useMemo(
    () =>
      filteredPersonalExpenses.reduce<Record<string, typeof filteredPersonalExpenses>>((groups, expense) => {
        const key = expense.personalPayeeName || 'Recipient to identify';
        groups[key] = [...(groups[key] || []), expense];
        return groups;
      }, {}),
    [filteredPersonalExpenses],
  );

  const beginRepayment = (payeeName: string) => {
    const eligible = personalExpenses.filter((expense) => expense.personalPayeeName === payeeName && expense.openBalanceCents > 0).sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.id.localeCompare(b.id));
    const selected = eligible.map((expense) => expense.id);
    const totalCents = eligible.reduce((sum, expense) => sum + expense.openBalanceCents, 0);
    setSelectedRepaymentExpenses(selected);
    setRepaymentProofFile(null);
    setRepaymentForm({
      payeeName,
      paymentDate: formatTorontoDateInput(),
      amount: (totalCents / 100).toFixed(2),
      paymentMethod: 'BANK_TRANSFER',
      sourceAccountLabel: '',
      bankReference: '',
      note: '',
    });
    setRepaymentOpen(true);
  };

  const repaymentAllocations = useMemo(() => {
    let remainingCents = Math.max(0, Math.round(Number(repaymentForm.amount || 0) * 100));
    return selectedRepaymentExpenses
      .map((expenseId) => {
        const expense = personalExpenses.find((item) => item.id === expenseId);
        const allocation = Math.min(remainingCents, expense?.openBalanceCents || 0);
        remainingCents -= allocation;
        return { expenseId, amountCents: allocation, expense };
      })
      .filter((allocation) => allocation.amountCents > 0);
  }, [selectedRepaymentExpenses, repaymentForm.amount, personalExpenses]);

  const saveRepayment = async (event: React.FormEvent) => {
    event.preventDefault();
    const amountCents = Math.round(Number(repaymentForm.amount || 0) * 100);
    const allocationCents = repaymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
    if (!repaymentForm.payeeName || !repaymentForm.paymentDate || amountCents <= 0 || amountCents !== allocationCents) {
      setError('Choose outstanding expenses and enter a transfer amount that can be fully allocated to them.');
      return;
    }
    setRepaymentSaving(true);
    setError('');
    try {
      const payload = {
        entityCode,
        payeeName: repaymentForm.payeeName,
        paymentDate: repaymentForm.paymentDate,
        amountCents,
        paymentMethod: repaymentForm.paymentMethod,
        sourceAccountLabel: repaymentForm.sourceAccountLabel,
        bankReference: repaymentForm.bankReference,
        note: repaymentForm.note,
        allocations: repaymentAllocations.map(({ expenseId, amountCents: allocationAmount }) => ({
          expenseId,
          amountCents: allocationAmount,
        })),
      };
      let requestBody: BodyInit;
      let headers: HeadersInit | undefined;
      if (repaymentProofFile) {
        const form = new FormData();
        Object.entries(payload).forEach(([key, value]) => form.append(key, typeof value === 'string' ? value : JSON.stringify(value)));
        form.append('proof', repaymentProofFile);
        requestBody = form;
      } else {
        headers = { 'Content-Type': 'application/json' };
        requestBody = JSON.stringify(payload);
      }
      const response = await fetch('/api/books/reimbursements', {
        method: 'POST',
        headers,
        body: requestBody,
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to record repayment');
      setRepaymentOpen(false);
      setRepaymentProofFile(null);
      await loadBooks(entityCode, false);
      showSuccess('Business repayment recorded and allocated to the selected expenses.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record repayment');
    } finally {
      setRepaymentSaving(false);
    }
  };

  const reverseReimbursement = async (payment: ReimbursementPayment) => {
    const reason = window.prompt(`Why are you reversing the ${formatMoney(payment.amountCents / 100)} repayment to ${payment.payeeName}?`);
    if (!reason?.trim()) return;
    try {
      const response = await fetch(`/api/books/reimbursements/${payment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityCode, reason: reason.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to reverse repayment');
      await loadBooks(entityCode, false);
      showSuccess('Repayment reversed. The allocated expense balances are open again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reverse repayment');
    }
  };

  const saveMapping = async (targetType: 'EXPENSE' | 'PAYMENT', targetId: string) => {
    const key = `${targetType}:${targetId}`;
    const draft = mappingDrafts[key];
    if (!draft) return;
    setMappingSaving(key);
    setError('');
    try {
      const response = await fetch('/api/books/reimbursements/mapping', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityCode,
          targetType,
          targetId,
          mappingStatus: draft.status,
          accountName: draft.accountName,
          accountCode: draft.accountCode,
          notes: draft.notes,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save accountant mapping');
      await loadBooks(entityCode, false);
      showSuccess('Accountant mapping saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save accountant mapping');
    } finally {
      setMappingSaving(null);
    }
  };

  const mappingDraft = (
    type: 'EXPENSE' | 'PAYMENT',
    id: string,
    saved?: {
      mappingStatus?: Expense['mappingStatus'];
      accountName?: string | null;
      accountCode?: string | null;
      mappingNotes?: string | null;
    },
  ) => {
    const key = `${type}:${id}`;
    return (
      mappingDrafts[key] || {
        accountName: saved?.accountName || '',
        accountCode: saved?.accountCode || '',
        notes: saved?.mappingNotes || '',
        status: saved?.mappingStatus || ('NOT_REVIEWED' as const),
      }
    );
  };

  const sendInvoiceEmail = async (invoice: Invoice) => {
    const knownEmail = invoice.emailSentTo || invoice.recipientEntity?.email || invoice.recipientSnapshot?.email || '';
    const email = window.prompt('Customer email address (optional on the invoice, required to send):', knownEmail);
    if (!email) return;
    setEmailSending(invoice.id);
    setError('');
    try {
      const response = await fetch(`/api/books/invoices/${invoice.id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
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

  const totals = useMemo(
    () => ({
      expenses: state.expenses.reduce((sum, expense) => sum + expense.totalAmount, 0),
      invoiced: state.invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0),
      invoiceRevenue: state.invoices.reduce((sum, invoice) => sum + invoice.serviceAmount, 0),
      invoiceHst: state.invoices.reduce((sum, invoice) => sum + invoice.hstAmount, 0),
      settledPartnerAmount: state.invoices.filter((invoice) => invoice.invoiceKind !== 'CUSTOMER_SERVICE' && invoice.status === 'ISSUED' && invoice.paymentStatus === 'RECEIVED').reduce((sum, invoice) => sum + invoice.totalAmount, 0),
      issuedPendingPartnerAmount: state.invoices.filter((invoice) => invoice.invoiceKind !== 'CUSTOMER_SERVICE' && invoice.status === 'ISSUED' && invoice.paymentStatus === 'PENDING').reduce((sum, invoice) => sum + invoice.totalAmount, 0),
      completedUnbilledPartnerAmount: state.periods.filter((period) => !period.invoice && period.partnerFeeAmount > 0).reduce((sum, period) => sum + period.partnerFeeAmount * (1 + (state.currentPeriod?.hstRate || 0)), 0),
      currentUnbilledPartnerAmount: state.currentPeriod?.invoiceTotalAmount || 0,
    }),
    [state.currentPeriod, state.expenses, state.invoices],
  );

  const visibleExpenses = useMemo(() => (receiptFilter === 'REVIEW' ? state.expenses.filter((expense) => expense.receiptStatus === 'MISSING') : state.expenses), [receiptFilter, state.expenses]);

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

  if (loading)
    return (
      <main className='min-h-screen bg-slate-50 px-4 py-10'>
        <div className='mx-auto max-w-7xl animate-pulse'>
          <div className='h-10 w-72 rounded-xl bg-slate-200' />
          <div className='mt-6 h-36 rounded-2xl bg-slate-200' />
          <div className='mt-6 h-64 rounded-2xl bg-slate-200' />
        </div>
      </main>
    );

  return (
    <main className='min-h-screen bg-slate-50 px-4 pb-16 pt-8 sm:px-6 lg:px-8'>
      <div className='mx-auto max-w-7xl'>
        <div className='flex flex-col justify-between gap-5 sm:flex-row sm:items-end'>
          <div>
            <p className='text-xs font-black uppercase tracking-[0.2em] text-blue-700'>Books & accounting</p>
            <h1 className='mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl'>Keep the books clear.</h1>
            <p className='mt-2 max-w-2xl text-sm leading-6 text-slate-500'>Expenses, partner billing, and payment history live here—separate from operational revenue reporting.</p>
          </div>
          <button onClick={refresh} disabled={refreshing} className='inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-50'>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        {availableCodes.length > 1 && (
          <div className='mt-7 inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm' role='tablist' aria-label='Books entity'>
            {availableCodes.map((code) => (
              <button key={code} onClick={() => switchEntity(code)} role='tab' aria-selected={entityCode === code} className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${entityCode === code ? 'bg-slate-950 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
                {code === 'IT_MARKETING' ? 'IT & Marketing' : 'Locksmith business'}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className='mt-5 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800'>
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label='Dismiss error'>
              ×
            </button>
          </div>
        )}
        {success && <div className='mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800'>{success}</div>}

        {state.entity && (
          <div className='mt-7'>
            <EntityDetails entity={state.entity} />
          </div>
        )}

        <section className='mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          <div className='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'>
            <p className='text-xs font-bold uppercase tracking-wide text-slate-500'>Expenses recorded</p>
            <p className='mt-2 text-2xl font-black text-slate-950'>{formatMoney(totals.expenses)}</p>
            <p className='mt-1 text-xs text-slate-500'>All active expense records</p>
          </div>
          <div className='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'>
            <p className='text-xs font-bold uppercase tracking-wide text-slate-500'>{entityCode === 'IT_MARKETING' ? 'Invoices issued' : 'Invoices received'}</p>
            <p className='mt-2 text-2xl font-black text-slate-950'>{formatMoney(totals.invoiced)}</p>
            <div className='mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3'>
              <div>
                <p className='text-[11px] font-bold uppercase tracking-wide text-slate-500'>Real revenue</p>
                <p className='mt-1 text-sm font-black text-slate-900'>{formatMoney(totals.invoiceRevenue)}</p>
                <p className='mt-1 text-[11px] text-slate-500'>Before HST</p>
              </div>
              <div>
                <p className='text-[11px] font-bold uppercase tracking-wide text-slate-500'>HST</p>
                <p className='mt-1 text-sm font-black text-slate-900'>{formatMoney(totals.invoiceHst)}</p>
                <p className='mt-1 text-[11px] text-slate-500'>Collected</p>
              </div>
            </div>
            <p className='mt-3 text-xs text-slate-500'>
              {state.invoices.length} invoice
              {state.invoices.length === 1 ? '' : 's'} · Total including HST
            </p>
          </div>
          <div className='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'>
            <p className='text-xs font-bold uppercase tracking-wide text-slate-500'>Partner settlement</p>
            <div className='mt-3 grid grid-cols-2 gap-3'>
              <div>
                <p className='text-[11px] font-bold uppercase tracking-wide text-emerald-700'>Settled</p>
                <p className='mt-1 text-lg font-black text-slate-950'>{formatMoney(totals.settledPartnerAmount)}</p>
                <p className='mt-1 text-[11px] text-slate-500'>Received</p>
              </div>
              <div>
                <p className='text-[11px] font-bold uppercase tracking-wide text-amber-700'>Unsettled</p>
                <p className='mt-1 text-lg font-black text-slate-950'>{formatMoney(totals.issuedPendingPartnerAmount + totals.completedUnbilledPartnerAmount + totals.currentUnbilledPartnerAmount)}</p>
                <p className='mt-1 text-[11px] text-slate-500'>Unbilled + awaiting payment</p>
              </div>
            </div>
            <p className='mt-3 text-xs text-slate-500'>Current period share: {state.currentPeriod ? `${formatMoney(state.currentPeriod.partnerFeeAmount)} before HST · ${periodLabel(state.currentPeriod.periodStart, state.currentPeriod.periodEnd)}` : 'Not available yet'}</p>
          </div>
        </section>

        {reimbursements && (
          <section className='mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'>
            <div className='flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5'>
              <div>
                <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>Personal expense reimbursements</p>
                <h2 className='mt-1 text-xl font-black text-slate-950'>Amounts paid personally for this company</h2>
                <p className='mt-1 max-w-2xl text-sm text-slate-500'>Expenses appear here once a person and original payment date are confirmed. Repayments are recorded as separate bank transactions and do not add another expense.</p>
              </div>
              {canManageReimbursements && reimbursementPayees.some((payee) => personalExpenses.some((expense) => expense.personalPayeeName === payee && expense.openBalanceCents > 0)) && (
                <label className='flex items-center gap-2 text-sm font-bold text-slate-700'>
                  <span>Record repayment to</span>
                  <select value={reimbursementPayeeFilter !== 'ALL' ? reimbursementPayeeFilter : ''} onChange={(event) => event.target.value && beginRepayment(event.target.value)} className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'>
                    <option value='' disabled>
                      Choose person
                    </option>
                    {reimbursementPayees
                      .filter((payee) => personalExpenses.some((expense) => expense.personalPayeeName === payee && expense.openBalanceCents > 0))
                      .map((payee) => (
                        <option key={payee} value={payee}>
                          {payee}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            <div className='grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-2 lg:grid-cols-4'>
              <div className='rounded-xl bg-blue-50 p-4'>
                <p className='text-xs font-black uppercase tracking-wide text-blue-800'>
                  {personalExpenses.some((expense) => !expense.personalPayeeName)
                    ? 'Recipient to identify'
                    : personalExpenses.some((expense) => !expense.paidAt)
                      ? 'Actual payment date to confirm'
                      : 'Needs confirmation'}
                </p>
                <p className='mt-1 text-xl font-black text-slate-950'>{formatMoney(reimbursements.summary.unassignedCents / 100)}</p>
                <p className='mt-1 text-xs text-slate-500'>
                  {personalExpenses.some((expense) => !expense.personalPayeeName)
                    ? 'Some personal expenses still need a recipient or actual payment date.'
                    : personalExpenses.some((expense) => !expense.paidAt)
                      ? `${personalExpenses.filter((expense) => !expense.paidAt).length} expense${personalExpenses.filter((expense) => !expense.paidAt).length === 1 ? '' : 's'} still need the actual card debit date.`
                      : 'All personal expense recipients and payment dates are confirmed.'}
                </p>
              </div>
              <div className='rounded-xl bg-blue-50 p-4'>
                <p className='text-xs font-black uppercase tracking-wide text-blue-800'>Confirmed as owed</p>
                <p className='mt-1 text-xl font-black text-slate-950'>{formatMoney(reimbursements.summary.owedCents / 100)}</p>
                <p className='mt-1 text-xs text-slate-500'>Personal expenses with confirmed payer and date</p>
              </div>
              <div className='rounded-xl bg-emerald-50 p-4'>
                <p className='text-xs font-black uppercase tracking-wide text-emerald-800'>Repaid</p>
                <p className='mt-1 text-xl font-black text-slate-950'>{formatMoney(reimbursements.summary.repaidCents / 100)}</p>
                <p className='mt-1 text-xs text-slate-500'>Business transfers allocated to expenses</p>
              </div>
              <div className='rounded-xl bg-amber-50 p-4'>
                <p className='text-xs font-black uppercase tracking-wide text-amber-800'>Total still to repay</p>
                <p className='mt-1 text-xl font-black text-slate-950'>{formatMoney(reimbursements.summary.outstandingCents / 100)}</p>
                <p className='mt-1 text-xs text-slate-500'>Includes balances awaiting recipient or date confirmation</p>
              </div>
            </div>
            <div className='flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3'>
              <label className='sr-only' htmlFor='reimbursement-person-filter'>
                Filter by person
              </label>
              <select id='reimbursement-person-filter' value={reimbursementPayeeFilter} onChange={(event) => setReimbursementPayeeFilter(event.target.value)} className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700'>
                <option value='ALL'>All payees</option>
                {reimbursementPayees.map((payee) => (
                  <option key={payee} value={payee}>
                    {payee}
                  </option>
                ))}
              </select>
              {(['OUTSTANDING', 'ALL', 'MAPPING'] as const).map((filter) => (
                <button key={filter} onClick={() => setReimbursementFilter(filter)} className={`rounded-lg px-3 py-2 text-xs font-black ${reimbursementFilter === filter ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {filter === 'OUTSTANDING' ? 'Outstanding' : filter === 'MAPPING' ? 'Needs mapping' : 'All personal expenses'}
                </button>
              ))}
            </div>
            <div className='divide-y divide-slate-100'>
              {filteredPersonalExpenses.length === 0 ? (
                <div className='p-7 text-center text-sm text-slate-500'>{reimbursementFilter === 'OUTSTANDING' ? 'No confirmed personal expenses are waiting for repayment.' : 'No personal expenses match these filters.'}</div>
              ) : (
                Object.entries(personalExpenseGroups).map(([payee, expenses]) => (
                  <div key={payee}>
                    <div className='flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-5 py-3'>
                      <p className='text-sm font-black text-slate-800'>
                        {payee}{' '}
                        <span className='font-medium text-slate-500'>
                          · {expenses.length} expense
                          {expenses.length === 1 ? '' : 's'}
                        </span>
                      </p>
                      <p className='text-xs font-bold text-slate-600'>Open balance: {formatMoney(expenses.reduce((sum, expense) => sum + expense.openBalanceCents, 0) / 100)}</p>
                    </div>
                    {expenses.map((expense) => {
                      const needsConfirmation = !expense.personalPayeeName || !expense.paidAt || expense.reimbursementNeedsConfirmation;
                      const draft = mappingDraft('EXPENSE', expense.id, expense);
                      return (
                        <div key={expense.id} className='grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]'>
                          <div>
                            <div className='flex flex-wrap items-center gap-2'>
                              <p className='font-bold text-slate-900'>{expense.vendorName}</p>
                              <StatusBadge status={needsConfirmation ? 'NEEDS_CONFIRMATION' : expense.openBalanceCents === 0 ? 'REPAID' : expense.reimbursedCents > 0 ? 'PARTIALLY_REPAID' : 'OWED'} tone={needsConfirmation ? 'amber' : expense.openBalanceCents === 0 ? 'green' : 'slate'} />
                              <StatusBadge status={expense.mappingStatus || 'NOT_REVIEWED'} tone={expense.mappingStatus === 'MAPPED' ? 'green' : 'amber'} />
                            </div>
                            <p className='mt-1 text-sm text-slate-500'>
                              {expense.businessPurpose || expense.description || 'Business purpose not recorded'} · incurred {formatDate(expense.expenseDate)} · paid {formatDate(expense.paidAt)}
                            </p>
                            <p className='mt-1 text-xs text-slate-500'>
                              Original payment: {expense.personalPaymentMethod === 'CREDIT_CARD' ? 'Personal credit card' : expense.personalPaymentMethod === 'DEBIT_CARD' ? 'Personal debit card' : expense.personalPaymentMethod === 'CASH' ? 'Cash' : expense.personalPaymentMethod || 'Personal payment'}
                              {expense.personalCardLast4 ? ` •••• ${expense.personalCardLast4}` : ''}
                              {expense.paidBeforeIncorporation ? ' · marked as before incorporation' : ''} · Receipt: {expense.receiptStatus === 'ATTACHED' ? expense.receiptFileName || 'attached' : expense.receiptStatus === 'NOT_REQUIRED' ? 'not required' : 'missing'}
                            </p>
                            {needsConfirmation && <p className='mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900'>Payer or original payment date needs confirmation. This row is excluded from the amount owed until those details are confirmed.</p>}
                            <div className='mt-3 grid gap-2 text-xs sm:grid-cols-3'>
                              <p>
                                <span className='font-bold text-slate-600'>Expense:</span> {formatMoney(expense.totalAmount)}
                              </p>
                              <p>
                                <span className='font-bold text-slate-600'>Repaid:</span> {formatMoney(expense.reimbursedCents / 100)}
                              </p>
                              <p>
                                <span className='font-bold text-slate-600'>Remaining:</span> {needsConfirmation ? 'Needs confirmation' : formatMoney(expense.openBalanceCents / 100)}
                              </p>
                            </div>
                            {canMapAccounts && (
                              <div className='mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3'>
                                <p className='text-[11px] font-black uppercase tracking-wide text-slate-600'>
                                  Accountant mapping{' '}
                                  {expense.mappedByName && (
                                    <span className='font-medium normal-case'>
                                      · saved by {expense.mappedByName} {expense.mappedAt ? `on ${formatDate(expense.mappedAt)}` : ''}
                                    </span>
                                  )}
                                </p>
                                <div className='mt-2 grid gap-2 sm:grid-cols-[1fr_9rem_10rem]'>
                                  <input
                                    aria-label='Liability or account name'
                                    value={draft.accountName}
                                    onChange={(event) =>
                                      setMappingDrafts({
                                        ...mappingDrafts,
                                        [`EXPENSE:${expense.id}`]: {
                                          ...draft,
                                          accountName: event.target.value,
                                        },
                                      })
                                    }
                                    placeholder='Liability / account name'
                                    className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                                  />
                                  <input
                                    aria-label='Account code'
                                    value={draft.accountCode}
                                    onChange={(event) =>
                                      setMappingDrafts({
                                        ...mappingDrafts,
                                        [`EXPENSE:${expense.id}`]: {
                                          ...draft,
                                          accountCode: event.target.value,
                                        },
                                      })
                                    }
                                    placeholder='Account code'
                                    className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                                  />
                                  <select
                                    aria-label='Mapping status'
                                    value={draft.status}
                                    onChange={(event) =>
                                      setMappingDrafts({
                                        ...mappingDrafts,
                                        [`EXPENSE:${expense.id}`]: {
                                          ...draft,
                                          status: event.target.value as typeof draft.status,
                                        },
                                      })
                                    }
                                    className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                                  >
                                    <option value='NOT_REVIEWED'>Not reviewed</option>
                                    <option value='NEEDS_CLARIFICATION'>Needs clarification</option>
                                    <option value='MAPPED'>Mapped</option>
                                  </select>
                                  <textarea
                                    aria-label='Accountant mapping notes'
                                    rows={2}
                                    value={draft.notes}
                                    onChange={(event) =>
                                      setMappingDrafts({
                                        ...mappingDrafts,
                                        [`EXPENSE:${expense.id}`]: {
                                          ...draft,
                                          notes: event.target.value,
                                        },
                                      })
                                    }
                                    placeholder='Mapping notes for this expense'
                                    className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:col-span-2'
                                  />
                                  <button onClick={() => saveMapping('EXPENSE', expense.id)} disabled={mappingSaving === `EXPENSE:${expense.id}`} className='rounded-lg bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-50'>
                                    {mappingSaving === `EXPENSE:${expense.id}` ? 'Saving…' : 'Save mapping'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className='flex flex-wrap items-start gap-2 lg:justify-end'>
                            {canManageExpenses && (
                              <button onClick={() => openEditExpense(expense)} className='rounded-lg border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50'>
                                {needsConfirmation ? 'Confirm payer and date' : 'Edit expense'}
                              </button>
                            )}
                            {canManageReimbursements && !needsConfirmation && expense.openBalanceCents > 0 && (
                              <button onClick={() => beginRepayment(payee)} className='rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800'>
                                Record repayment
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            {reimbursements.payments.length > 0 && (
              <div className='border-t border-slate-100 p-5'>
                <h3 className='font-black text-slate-900'>Repayment history</h3>
                <div className='mt-3 divide-y divide-slate-100'>
                  {reimbursements.payments.map((payment) => {
                    const draft = mappingDraft('PAYMENT', payment.id, payment);
                    return (
                      <div key={payment.id} className='py-3'>
                        <div className='flex flex-wrap items-start justify-between gap-2'>
                          <div>
                            <p className='text-sm font-bold text-slate-900'>
                              {formatDate(payment.paymentDate)} · {payment.payeeName} · {formatMoney(payment.amountCents / 100)}
                              {payment.voidedAt ? ' · Voided' : ''}
                            </p>
                            <p className='mt-1 text-xs text-slate-500'>
                              {payment.paymentMethod}
                              {payment.sourceAccountLabel ? ` from ${payment.sourceAccountLabel}` : ''}
                              {payment.bankReference ? ` · Ref ${payment.bankReference}` : ''}
                            </p>
                            {payment.proofFileName && (
                              <a href={`/api/books/reimbursements/${payment.id}/proof?entityCode=${entityCode}`} target='_blank' rel='noreferrer' className='mt-1 inline-block text-xs font-bold text-blue-700 hover:text-blue-900'>
                                View transfer proof · {payment.proofFileName}
                              </a>
                            )}
                            <p className='mt-1 text-xs text-slate-500'>Allocated to: {payment.allocations.map((allocation) => `${allocation.expense?.vendorName || 'Expense'} ${formatMoney(allocation.amountCents / 100)}`).join(' · ')}</p>
                          </div>
                          <StatusBadge status={payment.mappingStatus || 'NOT_REVIEWED'} tone={payment.mappingStatus === 'MAPPED' ? 'green' : 'amber'} />
                          {canManageReimbursements && !payment.voidedAt && (
                            <button type='button' onClick={() => void reverseReimbursement(payment)} className='rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-50'>
                              Reverse repayment
                            </button>
                          )}
                        </div>
                        {canMapAccounts && (
                          <div className='mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_10rem]'>
                            <input
                              aria-label='Payment account name'
                              value={draft.accountName}
                              onChange={(event) =>
                                setMappingDrafts({
                                  ...mappingDrafts,
                                  [`PAYMENT:${payment.id}`]: {
                                    ...draft,
                                    accountName: event.target.value,
                                  },
                                })
                              }
                              placeholder='Cash / bank account name'
                              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                            />
                            <input
                              aria-label='Payment account code'
                              value={draft.accountCode}
                              onChange={(event) =>
                                setMappingDrafts({
                                  ...mappingDrafts,
                                  [`PAYMENT:${payment.id}`]: {
                                    ...draft,
                                    accountCode: event.target.value,
                                  },
                                })
                              }
                              placeholder='Account code'
                              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                            />
                            <select
                              aria-label='Payment mapping status'
                              value={draft.status}
                              onChange={(event) =>
                                setMappingDrafts({
                                  ...mappingDrafts,
                                  [`PAYMENT:${payment.id}`]: {
                                    ...draft,
                                    status: event.target.value as typeof draft.status,
                                  },
                                })
                              }
                              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                            >
                              <option value='NOT_REVIEWED'>Not reviewed</option>
                              <option value='NEEDS_CLARIFICATION'>Needs clarification</option>
                              <option value='MAPPED'>Mapped</option>
                            </select>
                            <textarea
                              aria-label='Payment mapping notes'
                              rows={2}
                              value={draft.notes}
                              onChange={(event) =>
                                setMappingDrafts({
                                  ...mappingDrafts,
                                  [`PAYMENT:${payment.id}`]: {
                                    ...draft,
                                    notes: event.target.value,
                                  },
                                })
                              }
                              placeholder='Mapping notes for repayment'
                              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:col-span-2'
                            />
                            <button onClick={() => saveMapping('PAYMENT', payment.id)} disabled={mappingSaving === `PAYMENT:${payment.id}`} className='rounded-lg bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-50'>
                              {mappingSaving === `PAYMENT:${payment.id}` ? 'Saving…' : 'Save mapping'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {reimbursements.history && reimbursements.history.length > 0 && (
              <div className='border-t border-slate-100 p-5'>
                <h3 className='font-black text-slate-900'>Change history</h3>
                <div className='mt-3 space-y-2'>
                  {reimbursements.history.map((item) => (
                    <div key={item.id} className='flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs'>
                      <span className='font-semibold text-slate-700'>
                        {item.action.replaceAll('_', ' ').toLowerCase()} · {item.targetType.toLowerCase()}
                        {item.actorName ? ` · ${item.actorName}` : ''}
                      </span>
                      <span className='text-slate-500'>{formatDate(item.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <div className='mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]'>
          <section className='rounded-2xl border border-slate-200 bg-white shadow-sm'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5'>
              <div>
                <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>Expense ledger</p>
                <h2 className='mt-1 text-xl font-black text-slate-950'>{visibleExpenses.length ? `${visibleExpenses.length} expense${visibleExpenses.length === 1 ? '' : 's'}` : receiptFilter === 'REVIEW' ? 'No receipts need review' : 'No expenses yet'}</h2>
              </div>
              <div className='flex items-center gap-2'>
                {state.expenses.some((expense) => expense.receiptStatus === 'MISSING') && (
                  <select value={receiptFilter} onChange={(event) => setReceiptFilter(event.target.value as 'ALL' | 'REVIEW')} className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700'>
                    <option value='ALL'>All expenses</option>
                    <option value='REVIEW'>Needs receipt review</option>
                  </select>
                )}
                {canManageExpenses && (
                  <button
                    onClick={() => {
                      resetExpenseForm();
                      setExpenseFormOpen(true);
                    }}
                    className='rounded-xl bg-slate-950 px-3.5 py-2.5 text-sm font-black text-white transition hover:bg-slate-800'
                  >
                    + Add expense
                  </button>
                )}
              </div>
            </div>
            <div className='divide-y divide-slate-100'>
              {visibleExpenses.length === 0 ? (
                <div className='p-8 text-center text-sm text-slate-500'>{receiptFilter === 'REVIEW' ? 'All expenses have receipt evidence or an explicit explanation.' : 'Add a vendor bill, receipt, or other company expense to begin.'}</div>
              ) : (
                visibleExpenses.map((expense) => (
                  <div key={expense.id} className='flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between'>
                    <div className='min-w-0'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <p className='font-bold text-slate-900'>{expense.vendorName}</p>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ring-1 ${expense.fundingSource === 'PERSONAL' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{expense.fundingSource === 'PERSONAL' ? `Paid personally${expense.personalCardLast4 ? ` · •••• ${expense.personalCardLast4}` : ''}` : 'Paid by business'}</span>
                        {expense.receiptStatus === 'ATTACHED' ? <span className='inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200'>Receipt attached</span> : <span className='inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-amber-700 ring-1 ring-amber-200'>{expense.receiptStatus === 'NOT_REQUIRED' ? 'Receipt not required' : 'Receipt missing — review'}</span>}
                        {expense.systemGenerated && <span className='inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700 ring-1 ring-blue-200'>Auto-synced</span>}
                      </div>
                      <p className='mt-1 truncate text-sm text-slate-500'>
                        {expense.businessPurpose || expense.description || 'Business purpose not recorded'} · {formatDate(expense.expenseDate)}
                      </p>
                      {expense.receiptStatus === 'ATTACHED' && !expense.systemGenerated && (
                        <a href={`/api/books/expenses/${expense.id}/receipt?entityCode=${entityCode}`} target='_blank' rel='noreferrer' className='mt-1 inline-block text-xs font-bold text-blue-700 hover:text-blue-900'>
                          View receipt
                          {expense.receiptFileName ? ` · ${expense.receiptFileName}` : ''}
                        </a>
                      )}
                    </div>
                    <div className='flex items-center justify-between gap-4 sm:justify-end'>
                      <p className='font-black text-slate-950'>{formatMoney(expense.totalAmount)}</p>
                      {canManageExpenses && !expense.systemGenerated && (
                        <button onClick={() => openEditExpense(expense)} className='text-xs font-black text-blue-700 hover:text-blue-900'>
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className='rounded-2xl border border-slate-200 bg-white shadow-sm'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5'>
              <div>
                <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>Partner billing</p>
                <h2 className='mt-1 text-xl font-black text-slate-950'>Biweekly periods</h2>
                <p className='mt-1 text-xs text-slate-500'>Completed periods are calculated automatically from the operational portal.</p>
              </div>
            </div>
            <div className='divide-y divide-slate-100'>
              {state.periods.length === 0 ? (
                <div className='p-8 text-center text-sm text-slate-500'>The first period is September 7–20, 2026.</div>
              ) : (
                state.periods.map((period) => (
                  <div key={period.id} className='p-5'>
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                      <div>
                        <p className='font-bold text-slate-900'>{periodLabel(period.periodStart, period.periodEnd)}</p>
                        <p className='mt-1 text-xs text-slate-500'>
                          Profit snapshot: <span className='font-bold text-slate-700'>{formatMoney(period.adjustedProfitAmount)}</span> · Partner share: <span className='font-bold text-slate-700'>{formatMoney(period.partnerFeeAmount)}</span>
                        </p>
                      </div>
                      <StatusBadge status={period.invoice ? period.invoice.paymentStatus : entityCode === 'LOCKSMITH' && period.partnerFeeAmount > 0 ? 'PENDING' : period.status} />
                    </div>
                    {period.negativeCarryForward > 0 && <p className='mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800'>Negative profit carried forward: {formatMoney(period.negativeCarryForward)}. No invoice is due for this period.</p>}
                    {isAdmin && entityCode === 'IT_MARKETING' && !period.invoice && (
                      <div className='mt-4 flex flex-wrap gap-2'>
                        <button onClick={() => openEditPeriod(period)} className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50'>
                          Edit snapshot
                        </button>
                        {period.partnerFeeAmount > 0 && (
                          <button onClick={() => setConfirmingPeriod(period)} disabled={invoiceIssuing === period.id} className={`rounded-xl border px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${hstReadyForIssue ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100' : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}>
                            {hstReadyForIssue ? 'Review & send invoice' : 'Preview draft — HST pending'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section className='mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm'>
          <div className='flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5'>
            <div>
              <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>Invoices</p>
              <h2 className='mt-1 text-xl font-black text-slate-950'>{state.invoices.length ? 'Invoice history' : 'No invoices issued yet'}</h2>
              <p className='mt-1 text-xs text-slate-500'>{entityCode === 'IT_MARKETING' ? 'Partner and customer service invoices issued by IT & Marketing.' : 'Invoices issued by IT & Marketing to the Locksmith business.'}</p>
            </div>
            {isAdmin && entityCode === 'IT_MARKETING' && (
              <button onClick={() => setServiceInvoiceOpen(true)} className='rounded-xl bg-slate-950 px-3.5 py-2.5 text-sm font-black text-white hover:bg-slate-800'>
                + New customer invoice
              </button>
            )}
          </div>
          <div className='divide-y divide-slate-100'>
            {state.invoices.length === 0 ? (
              <div className='p-8 text-center text-sm text-slate-500'>Issued invoices will appear here with their period, amount, and payment status.</div>
            ) : (
              state.invoices.map((invoice) => (
                <div key={invoice.id} className='flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between'>
                  <button onClick={() => openInvoice(invoice)} className='min-w-0 text-left'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-black text-slate-950'>{invoice.invoiceNumber}</span>
                      <StatusBadge status={invoice.paymentStatus} />
                      <span className='text-[11px] font-bold uppercase tracking-wide text-slate-400'>{invoice.invoiceKind === 'CUSTOMER_SERVICE' ? 'Customer invoice' : 'Locksmith partner invoice'}</span>
                    </div>
                    <p className='mt-1 truncate text-sm text-slate-500'>
                      {invoice.periodStart ? periodLabel(invoice.periodStart, invoice.periodEnd) : invoice.recipientSnapshot?.legalName || 'Customer service invoice'} · {invoice.lineDescription}
                    </p>
                  </button>
                  <div className='flex items-center justify-between gap-4 lg:justify-end'>
                    <p className='font-black text-slate-950'>{formatMoney(invoice.totalAmount)}</p>
                    <button onClick={() => openInvoice(invoice)} className='rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50'>
                      View / PDF
                    </button>
                    {isAdmin && (
                      <button onClick={() => updatePayment(invoice, invoice.paymentStatus === 'RECEIVED' ? 'PENDING' : 'RECEIVED')} disabled={paymentUpdating === invoice.id} className='rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50'>
                        {paymentUpdating === invoice.id ? 'Saving…' : invoice.paymentStatus === 'RECEIVED' ? 'Mark pending' : 'Mark received'}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <p className='mt-6 text-xs leading-5 text-slate-500'>
          Partner invoice description: <span className='font-bold text-slate-700'>IT Services for Locksmith - C$ xxxx.xx</span>. The amount replaces the placeholder for each period. HST is charged only after the registration number and effective date are configured.
        </p>
      </div>

      {confirmingPeriod && (
        <div className='fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4'>
          <div className='max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7'>
            <div className='no-print flex items-start justify-between gap-4'>
              <div>
                <p className={`text-xs font-black uppercase tracking-[0.16em] ${hstReadyForIssue ? 'text-blue-700' : 'text-amber-700'}`}>{hstReadyForIssue ? 'Invoice review' : 'Draft — HST pending'}</p>
                <h2 className='mt-1 text-2xl font-black text-slate-950'>{hstReadyForIssue ? 'Confirm invoice to Locksmith' : 'Preview invoice for Locksmith'}</h2>
                <p className='mt-1 text-sm text-slate-500'>{periodLabel(confirmingPeriod.periodStart, confirmingPeriod.periodEnd)}</p>
              </div>
              <button onClick={() => setConfirmingPeriod(null)} className='rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100' aria-label='Close'>
                ×
              </button>
            </div>
            <div className='mt-6'>
              <InvoiceDocument
                draft={!hstReadyForIssue}
                hstPending={!hstReadyForIssue}
                invoice={{
                  invoiceKind: 'PARTNER_SERVICE',
                  lineDescription: 'IT Services for Locksmith',
                  serviceAmount: confirmingPeriod.partnerFeeAmount,
                  hstAmount: confirmingPeriod.partnerFeeAmount * 0.13,
                  totalAmount: confirmingPeriod.partnerFeeAmount * 1.13,
                  hstRate: 0.13,
                  quantity: 1,
                  periodStart: confirmingPeriod.periodStart,
                  periodEnd: confirmingPeriod.periodEnd,
                  paymentTerms: 'Due on receipt',
                }}
                issuer={state.entity}
                recipient={{
                  legalName: 'Better Call Locksmith Inc.',
                  corporationNumber: '1001348245',
                  email: 'bcltoronto1@gmail.com',
                  addressLine1: '222 Spadina Avenue, Unit 114',
                  city: 'Toronto',
                  province: 'Ontario',
                  postalCode: 'M5T 3B3',
                  country: 'Canada',
                }}
              />
            </div>
            <div className='no-print mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
              <button type='button' onClick={() => window.print()} className='rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50'>
                Download / print PDF
              </button>
              {hstReadyForIssue ? (
                <button
                  type='button'
                  onClick={() => {
                    setConfirmingPeriod(null);
                    issueInvoice(confirmingPeriod.id);
                  }}
                  disabled={invoiceIssuing === confirmingPeriod.id}
                  className='rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800 disabled:opacity-50'
                >
                  {invoiceIssuing === confirmingPeriod.id ? 'Sending…' : 'Confirm & send invoice'}
                </button>
              ) : (
                <button type='button' disabled className='rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-black text-slate-500'>
                  Issuing blocked — HST pending
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {editingPeriod && (
        <div className='fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4'>
          <div className='w-full max-w-xl rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>Edit snapshot</p>
                <h2 className='mt-1 text-2xl font-black text-slate-950'>Adjust completed period</h2>
                <p className='mt-1 text-sm text-slate-500'>{periodLabel(editingPeriod.periodStart, editingPeriod.periodEnd)}</p>
              </div>
              <button onClick={() => setEditingPeriod(null)} className='rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100' aria-label='Close'>
                ×
              </button>
            </div>
            <form onSubmit={savePeriod} className='mt-6 space-y-4'>
              <div className='grid gap-4 sm:grid-cols-2'>
                {(
                  [
                    ['revenueAmount', 'Revenue'],
                    ['hstDeductedAmount', 'HST deducted'],
                    ['cogsAmount', 'COGS'],
                    ['technicianCommissionsAmount', 'Technician commissions'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className='block'>
                    <span className='field-label'>{label} (CAD)</span>
                    <input
                      required
                      inputMode='decimal'
                      value={periodEditForm[field]}
                      onChange={(event) =>
                        setPeriodEditForm({
                          ...periodEditForm,
                          [field]: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                ))}
              </div>
              <p className='rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600'>The 50% partner share and any negative carry-forward will be recalculated from these values. Editing is disabled after an invoice is issued.</p>
              <div className='flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end'>
                <button type='button' onClick={() => setEditingPeriod(null)} className='rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50'>
                  Cancel
                </button>
                <button disabled={periodSaving} className='rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50'>
                  {periodSaving ? 'Saving…' : 'Save snapshot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {expenseFormOpen && (
        <div className='fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4'>
          <div className='max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>{editingExpense ? 'Edit expense' : 'New expense'}</p>
                <h2 className='mt-1 text-2xl font-black text-slate-950'>Record a company expense</h2>
              </div>
              <button
                onClick={() => {
                  setExpenseFormOpen(false);
                  resetExpenseForm();
                }}
                className='rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100'
                aria-label='Close'
              >
                ×
              </button>
            </div>
            <form onSubmit={saveExpense} className='mt-6 space-y-4'>
              <label className='block'>
                <span className='field-label'>Vendor</span>
                <input
                  required
                  value={expenseForm.vendorName}
                  onChange={(event) =>
                    setExpenseForm({
                      ...expenseForm,
                      vendorName: event.target.value,
                    })
                  }
                  className='field-input'
                  placeholder='e.g. Bell Canada'
                />
              </label>
              <label className='block'>
                <span className='field-label'>Business purpose</span>
                <input
                  required
                  value={expenseForm.businessPurpose}
                  onChange={(event) =>
                    setExpenseForm({
                      ...expenseForm,
                      businessPurpose: event.target.value,
                    })
                  }
                  className='field-input'
                  placeholder='e.g. Google Ads campaign for locksmith leads'
                />
                <span className='mt-1 block text-xs text-slate-500'>Describe how this expense relates to this company.</span>
              </label>
              <div className='grid gap-4 sm:grid-cols-2'>
                <label className='block'>
                  <span className='field-label'>Expense date</span>
                  <input
                    required
                    type='date'
                    value={expenseForm.expenseDate}
                    onChange={(event) =>
                      setExpenseForm({
                        ...expenseForm,
                        expenseDate: event.target.value,
                      })
                    }
                    className='field-input'
                  />
                </label>
                <label className='block'>
                  <span className='field-label'>Who paid the vendor?</span>
                  <select
                    value={expenseForm.fundingSource}
                    onChange={(event) =>
                      setExpenseForm({
                        ...expenseForm,
                        fundingSource: event.target.value as 'BUSINESS' | 'PERSONAL',
                        personalPayeeName: event.target.value === 'PERSONAL' ? expenseForm.personalPayeeName : '',
                        personalCardLast4: event.target.value === 'PERSONAL' ? expenseForm.personalCardLast4 : '',
                        businessPaymentReference: event.target.value === 'BUSINESS' ? expenseForm.businessPaymentReference : '',
                      })
                    }
                    className='field-input'
                  >
                    <option value='BUSINESS'>Company bank/card</option>
                    <option value='PERSONAL'>Personal money/card</option>
                  </select>
                </label>
              </div>
              {expenseForm.fundingSource === 'PERSONAL' && (
                <div className='space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4'>
                  <p className='text-sm font-bold text-violet-950'>Personal payment details</p>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <label className='block'>
                      <span className='field-label'>Person who paid</span>
                      <input
                        required
                        value={expenseForm.personalPayeeName}
                        onChange={(event) =>
                          setExpenseForm({
                            ...expenseForm,
                            personalPayeeName: event.target.value,
                          })
                        }
                        className='field-input bg-white'
                        placeholder='Cardholder / person to reimburse'
                      />
                    </label>
                    <label className='block'>
                      <span className='field-label'>Date personally paid</span>
                      <input
                        required
                        type='date'
                        value={expenseForm.paidAt}
                        onChange={(event) =>
                          setExpenseForm({
                            ...expenseForm,
                            paidAt: event.target.value,
                          })
                        }
                        className='field-input bg-white'
                      />
                    </label>
                    <label className='block'>
                      <span className='field-label'>Personal payment method</span>
                      <select
                        value={expenseForm.personalPaymentMethod}
                        onChange={(event) =>
                          setExpenseForm({
                            ...expenseForm,
                            personalPaymentMethod: event.target.value,
                          })
                        }
                        className='field-input bg-white'
                      >
                        <option value='CREDIT_CARD'>Credit card</option>
                        <option value='DEBIT_CARD'>Debit card</option>
                        <option value='CASH'>Cash</option>
                        <option value='OTHER'>Other</option>
                      </select>
                    </label>
                    <label className='block'>
                      <span className='field-label'>Card last 4 digits (if applicable)</span>
                      <input
                        inputMode='numeric'
                        maxLength={4}
                        value={expenseForm.personalCardLast4}
                        onChange={(event) =>
                          setExpenseForm({
                            ...expenseForm,
                            personalCardLast4: event.target.value.replace(/\D/g, '').slice(0, 4),
                          })
                        }
                        className='field-input bg-white'
                        placeholder='8833'
                      />
                    </label>
                  </div>
                  <label className='flex items-start gap-2 text-sm text-violet-950'>
                    <input
                      type='checkbox'
                      checked={expenseForm.paidBeforeIncorporation}
                      onChange={(event) =>
                        setExpenseForm({
                          ...expenseForm,
                          paidBeforeIncorporation: event.target.checked,
                        })
                      }
                      className='mt-1'
                    />
                    <span>
                      As far as I know, this expense was incurred before this company was incorporated.
                      <span className='mt-1 block text-xs text-violet-800'>This records a fact for the accountant to review; the portal does not decide the tax treatment.</span>
                    </span>
                  </label>
                  <p className='rounded-lg bg-white/70 px-3 py-2 text-xs text-violet-900'>The vendor is already paid. This records what the company may owe the person who paid.</p>
                </div>
              )}
              {expenseForm.fundingSource === 'BUSINESS' && (
                <div className='space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4'>
                  <p className='text-sm font-bold text-slate-900'>Company payment details</p>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <label className='block'>
                      <span className='field-label'>Date company paid the vendor</span>
                      <input required type='date' value={expenseForm.paidAt} onChange={(event) => setExpenseForm({ ...expenseForm, paidAt: event.target.value })} className='field-input bg-white' />
                    </label>
                    <label className='block'>
                      <span className='field-label'>Payment method</span>
                      <select value={expenseForm.paymentMethod} onChange={(event) => setExpenseForm({ ...expenseForm, paymentMethod: event.target.value })} className='field-input bg-white'>
                        <option value='CREDIT_CARD'>Credit card</option>
                        <option value='DEBIT_CARD'>Debit card</option>
                        <option value='BANK_TRANSFER'>Bank transfer</option>
                        <option value='INTERAC'>Interac</option>
                        <option value='CASH'>Cash</option>
                        <option value='CHEQUE'>Cheque</option>
                        <option value='OTHER'>Other</option>
                      </select>
                    </label>
                    <label className='block sm:col-span-2'>
                      <span className='field-label'>Account or card reference (optional)</span>
                      <input value={expenseForm.businessPaymentReference} onChange={(event) => setExpenseForm({ ...expenseForm, businessPaymentReference: event.target.value })} className='field-input bg-white' placeholder='e.g. Business card •••• 1234' />
                    </label>
                  </div>
                </div>
              )}
              <label className='block'>
                <span className='field-label'>Description</span>
                <input
                  value={expenseForm.description}
                  onChange={(event) =>
                    setExpenseForm({
                      ...expenseForm,
                      description: event.target.value,
                    })
                  }
                  className='field-input'
                  placeholder='Optional detail from the receipt'
                />
              </label>
              <div className='grid gap-4 sm:grid-cols-3'>
                <label className='block'>
                  <span className='field-label'>Subtotal (CAD)</span>
                  <input
                    required
                    inputMode='decimal'
                    value={expenseForm.subtotalAmount}
                    onChange={(event) =>
                      setExpenseForm({
                        ...expenseForm,
                        subtotalAmount: event.target.value,
                      })
                    }
                    className='field-input'
                    placeholder='0.00'
                  />
                </label>
                <label className='block'>
                  <span className='field-label'>HST paid</span>
                  <input
                    required
                    inputMode='decimal'
                    value={expenseForm.hstAmount}
                    onChange={(event) =>
                      setExpenseForm({
                        ...expenseForm,
                        hstAmount: event.target.value,
                      })
                    }
                    className='field-input'
                    placeholder='0.00'
                  />
                  <span className='mt-1 block text-xs text-slate-500'>Use 0 if the receipt does not show HST.</span>
                </label>
                <div>
                  <span className='field-label'>Total</span>
                  <div className='field-input bg-slate-50 font-black'>{formatMoney((Number(expenseForm.subtotalAmount) || 0) + (Number(expenseForm.hstAmount) || 0))}</div>
                </div>
              </div>
              <label className='block'>
                <span className='field-label'>Receipt evidence</span>
                <select
                  value={expenseForm.receiptStatus}
                  onChange={(event) =>
                    setExpenseForm({
                      ...expenseForm,
                      receiptStatus: event.target.value,
                    })
                  }
                  className='field-input'
                >
                  <option value='MISSING'>Missing — requires review</option>
                  <option value='NOT_REQUIRED'>Not required — explain why</option>
                  <option value='ATTACHED'>Receipt attached</option>
                </select>
                <span className='mt-1 block text-xs text-slate-500'>PDFs, emailed invoices, scans, and clear photos are accepted. Maximum 10 MB.</span>
              </label>
              {!editingExpense && (
                <label className='block rounded-2xl border border-blue-200 bg-blue-50 p-4'>
                  <span className='field-label text-blue-900'>Auto-fill with Gemini Flash (optional)</span>
                  <input
                    type='file'
                    accept='application/pdf,image/jpeg,image/png,image/webp'
                    disabled={receiptAiParsing}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void parseReceipt(file);
                    }}
                    className='field-input mt-2 bg-white'
                  />
                  <span className='mt-2 block text-xs text-blue-800'>Gemini can suggest vendor, date and amounts. It never selects who paid, the recipient or an account mapping.</span>
                  {receiptAiParsing && <span className='mt-2 block text-xs font-semibold text-blue-700'>Reading receipt… please review the suggested fields.</span>}
                  {receiptDraftId && !receiptAiParsing && <span className='mt-2 block text-xs font-semibold text-emerald-700'>Receipt parsed. Review the fields, then save the expense.</span>}
                </label>
              )}
              <label className='block'>
                <span className='field-label'>Upload receipt (PDF or photo)</span>
                <input
                  type='file'
                  accept='application/pdf,image/jpeg,image/png,image/webp'
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setReceiptFile(file);
                    if (file) {
                      setReceiptDraftId(null);
                      setExpenseForm({
                        ...expenseForm,
                        receiptStatus: 'ATTACHED',
                      });
                    }
                  }}
                  className='field-input'
                />
                {receiptFile && <span className='mt-1 block text-xs font-semibold text-emerald-700'>Ready to upload: {receiptFile.name}</span>}
                {!receiptFile && editingExpense?.receiptFileName && <span className='mt-1 block text-xs font-semibold text-emerald-700'>Already attached: {editingExpense.receiptFileName}</span>}
              </label>
              <label className='block'>
                <span className='field-label'>Notes / missing-receipt explanation</span>
                <textarea
                  rows={3}
                  value={expenseForm.notes}
                  onChange={(event) =>
                    setExpenseForm({
                      ...expenseForm,
                      notes: event.target.value,
                    })
                  }
                  className='field-input'
                  placeholder='Required when no receipt is attached; otherwise optional.'
                />
              </label>
              <div className='flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end'>
                <button
                  type='button'
                  onClick={() => {
                    setExpenseFormOpen(false);
                    resetExpenseForm();
                  }}
                  className='rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50'
                >
                  Cancel
                </button>
                <button disabled={expenseSaving || receiptAiParsing} className='rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50'>
                  {expenseSaving ? 'Saving…' : editingExpense ? 'Save changes' : 'Add expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {repaymentOpen && (
        <div className='fixed inset-0 z-[65] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4'>
          <div className='max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>Business bank payment</p>
                <h2 className='mt-1 text-2xl font-black text-slate-950'>Record repayment to {repaymentForm.payeeName}</h2>
                <p className='mt-1 text-sm text-slate-500'>Record a transfer that has already happened. It will reduce the amount owed, not add another expense.</p>
              </div>
              <button
                onClick={() => {
                  setRepaymentOpen(false);
                  setRepaymentProofFile(null);
                }}
                className='rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100'
                aria-label='Close'
              >
                ×
              </button>
            </div>
            <form onSubmit={saveRepayment} className='mt-6 space-y-4'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <label className='block'>
                  <span className='field-label'>Transfer date</span>
                  <input
                    required
                    type='date'
                    value={repaymentForm.paymentDate}
                    onChange={(event) =>
                      setRepaymentForm({
                        ...repaymentForm,
                        paymentDate: event.target.value,
                      })
                    }
                    className='field-input'
                  />
                </label>
                <label className='block'>
                  <span className='field-label'>Actual transfer amount (CAD)</span>
                  <input
                    required
                    inputMode='decimal'
                    value={repaymentForm.amount}
                    onChange={(event) =>
                      setRepaymentForm({
                        ...repaymentForm,
                        amount: event.target.value,
                      })
                    }
                    className='field-input'
                    placeholder='0.00'
                  />
                </label>
                <label className='block'>
                  <span className='field-label'>Payment method</span>
                  <select
                    value={repaymentForm.paymentMethod}
                    onChange={(event) =>
                      setRepaymentForm({
                        ...repaymentForm,
                        paymentMethod: event.target.value,
                      })
                    }
                    className='field-input'
                  >
                    <option value='BANK_TRANSFER'>Bank transfer</option>
                    <option value='CHEQUE'>Cheque</option>
                    <option value='OTHER'>Other</option>
                  </select>
                </label>
                <label className='block'>
                  <span className='field-label'>Business account label (optional)</span>
                  <input
                    value={repaymentForm.sourceAccountLabel}
                    onChange={(event) =>
                      setRepaymentForm({
                        ...repaymentForm,
                        sourceAccountLabel: event.target.value,
                      })
                    }
                    className='field-input'
                    placeholder='e.g. Operating account •••• 1234'
                  />
                </label>
                <label className='block sm:col-span-2'>
                  <span className='field-label'>Bank transaction reference (optional)</span>
                  <input
                    value={repaymentForm.bankReference}
                    onChange={(event) =>
                      setRepaymentForm({
                        ...repaymentForm,
                        bankReference: event.target.value,
                      })
                    }
                    className='field-input'
                  />
                </label>
              </div>
              <div className='rounded-xl border border-slate-200'>
                <div className='border-b border-slate-100 px-4 py-3'>
                  <p className='text-sm font-black text-slate-900'>Allocate this transfer to {repaymentForm.payeeName}&apos;s expenses</p>
                  <p className='mt-1 text-xs text-slate-500'>Select receipts covered by this transfer. The preview fills oldest selected balances first; partial payments are supported.</p>
                </div>
                <div className='divide-y divide-slate-100'>
                  {personalExpenses
                    .filter((expense) => expense.personalPayeeName === repaymentForm.payeeName && expense.openBalanceCents > 0 && !expense.reimbursementNeedsConfirmation)
                    .map((expense) => (
                      <label key={expense.id} className='flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50'>
                        <span className='flex min-w-0 items-center gap-3'>
                          <input type='checkbox' checked={selectedRepaymentExpenses.includes(expense.id)} onChange={(event) => setSelectedRepaymentExpenses(event.target.checked ? [...selectedRepaymentExpenses, expense.id] : selectedRepaymentExpenses.filter((id) => id !== expense.id))} />
                          <span className='min-w-0'>
                            <span className='block truncate font-bold text-slate-900'>{expense.vendorName}</span>
                            <span className='block text-xs text-slate-500'>
                              {formatDate(expense.expenseDate)} · remaining {formatMoney(expense.openBalanceCents / 100)}
                            </span>
                          </span>
                        </span>
                        <span className='shrink-0 text-right'>
                          <span className='block text-xs text-slate-500'>Allocation preview</span>
                          <span className='font-black text-slate-900'>{formatMoney((repaymentAllocations.find((allocation) => allocation.expenseId === expense.id)?.amountCents || 0) / 100)}</span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
              <label className='block'>
                <span className='field-label'>Transfer proof (optional)</span>
                <input type='file' accept='application/pdf,image/jpeg,image/png,image/webp' onChange={(event) => setRepaymentProofFile(event.target.files?.[0] || null)} className='field-input' />
                {repaymentProofFile && <span className='mt-1 block text-xs font-semibold text-emerald-700'>Ready to upload: {repaymentProofFile.name}</span>}
                <span className='mt-1 block text-xs text-slate-500'>Optional bank confirmation or transfer receipt; PDF or photo, up to 10 MB.</span>
              </label>
              <label className='block'>
                <span className='field-label'>Note (optional)</span>
                <textarea
                  rows={2}
                  value={repaymentForm.note}
                  onChange={(event) =>
                    setRepaymentForm({
                      ...repaymentForm,
                      note: event.target.value,
                    })
                  }
                  className='field-input'
                  placeholder='For the accountant or bank reconciliation'
                />
              </label>
              <div className='flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm'>
                <span className='text-slate-600'>Allocated</span>
                <span className={`font-black ${Math.round(Number(repaymentForm.amount || 0) * 100) === repaymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0) ? 'text-emerald-700' : 'text-amber-800'}`}>
                  {formatMoney(repaymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0) / 100)} of {formatMoney(Number(repaymentForm.amount || 0))}
                </span>
              </div>
              <div className='flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end'>
                <button
                  type='button'
                  onClick={() => {
                    setRepaymentOpen(false);
                    setRepaymentProofFile(null);
                  }}
                  className='rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50'
                >
                  Cancel
                </button>
                <button disabled={repaymentSaving || !repaymentAllocations.length || Math.round(Number(repaymentForm.amount || 0) * 100) !== repaymentAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0)} className='rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50'>
                  {repaymentSaving ? 'Saving…' : 'Save repayment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {serviceInvoiceOpen && (
        <div className='fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4'>
          <div className='max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>Customer service invoice</p>
                <h2 className='mt-1 text-2xl font-black text-slate-950'>Issue an invoice to another business</h2>
                <p className='mt-1 text-sm text-slate-500'>This is separate from the biweekly Locksmith partner invoice.</p>
              </div>
              <button onClick={() => setServiceInvoiceOpen(false)} className='rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100' aria-label='Close'>
                ×
              </button>
            </div>
            <form onSubmit={issueServiceInvoice} className='mt-6 space-y-5'>
              <div>
                <p className='mb-3 text-xs font-black uppercase tracking-wide text-slate-500'>Customer details</p>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <label className='block sm:col-span-2'>
                    <span className='field-label'>Business / customer legal name *</span>
                    <input
                      required
                      value={serviceInvoiceForm.customerName}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          customerName: event.target.value,
                        })
                      }
                      className='field-input'
                      placeholder='Example Business Inc.'
                    />
                  </label>
                  <label className='block'>
                    <span className='field-label'>Corporation / account number</span>
                    <input
                      value={serviceInvoiceForm.customerNumber}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          customerNumber: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                  <label className='block'>
                    <span className='field-label'>Email</span>
                    <input
                      type='email'
                      value={serviceInvoiceForm.customerEmail}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          customerEmail: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                  <label className='block sm:col-span-2'>
                    <span className='field-label'>Street address</span>
                    <input
                      value={serviceInvoiceForm.addressLine1}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          addressLine1: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                  <label className='block'>
                    <span className='field-label'>City</span>
                    <input
                      value={serviceInvoiceForm.city}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          city: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                  <label className='block'>
                    <span className='field-label'>Province</span>
                    <input
                      value={serviceInvoiceForm.province}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          province: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                  <label className='block'>
                    <span className='field-label'>Postal code</span>
                    <input
                      value={serviceInvoiceForm.postalCode}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          postalCode: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                  <label className='block'>
                    <span className='field-label'>Country</span>
                    <input
                      value={serviceInvoiceForm.country}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          country: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                </div>
              </div>
              <div>
                <p className='mb-3 text-xs font-black uppercase tracking-wide text-slate-500'>Invoice line</p>
                <div className='grid gap-4 sm:grid-cols-4'>
                  <label className='block sm:col-span-2'>
                    <span className='field-label'>Description *</span>
                    <input
                      required
                      value={serviceInvoiceForm.lineDescription}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          lineDescription: event.target.value,
                        })
                      }
                      className='field-input'
                      placeholder='IT consulting and marketing services'
                    />
                  </label>
                  <label className='block'>
                    <span className='field-label'>Quantity</span>
                    <input
                      required
                      inputMode='decimal'
                      value={serviceInvoiceForm.quantity}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          quantity: event.target.value,
                        })
                      }
                      className='field-input'
                    />
                  </label>
                  <label className='block'>
                    <span className='field-label'>Unit price (CAD) *</span>
                    <input
                      required
                      inputMode='decimal'
                      value={serviceInvoiceForm.unitPrice}
                      onChange={(event) =>
                        setServiceInvoiceForm({
                          ...serviceInvoiceForm,
                          unitPrice: event.target.value,
                        })
                      }
                      className='field-input'
                      placeholder='0.00'
                    />
                  </label>
                </div>
              </div>
              <div className='grid gap-4 sm:grid-cols-2'>
                <label className='block'>
                  <span className='field-label'>Due date</span>
                  <input
                    type='date'
                    value={serviceInvoiceForm.dueDate}
                    onChange={(event) =>
                      setServiceInvoiceForm({
                        ...serviceInvoiceForm,
                        dueDate: event.target.value,
                      })
                    }
                    className='field-input'
                  />
                </label>
                <label className='block'>
                  <span className='field-label'>Payment terms</span>
                  <input
                    value={serviceInvoiceForm.paymentTerms}
                    onChange={(event) =>
                      setServiceInvoiceForm({
                        ...serviceInvoiceForm,
                        paymentTerms: event.target.value,
                      })
                    }
                    className='field-input'
                    placeholder='Due on receipt'
                  />
                </label>
              </div>
              <label className='block'>
                <span className='field-label'>Notes</span>
                <textarea
                  rows={3}
                  value={serviceInvoiceForm.notes}
                  onChange={(event) =>
                    setServiceInvoiceForm({
                      ...serviceInvoiceForm,
                      notes: event.target.value,
                    })
                  }
                  className='field-input'
                  placeholder='Optional note for the customer'
                />
              </label>
              <div className='rounded-xl bg-slate-50 p-4 text-xs text-slate-600'>HST is calculated at 13% and the IT & Marketing HST registration snapshot is included on the invoice. Configure HST before issuing.</div>
              <div className='flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end'>
                <button type='button' onClick={() => setServiceInvoiceOpen(false)} className='rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50'>
                  Cancel
                </button>
                <button disabled={serviceInvoiceSaving || !hstReadyForIssue} className='rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50'>
                  {serviceInvoiceSaving ? 'Issuing…' : hstReadyForIssue ? 'Review and issue invoice' : 'HST setup required'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <div className='fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4'>
          <div className='max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-xs font-black uppercase tracking-[0.16em] text-blue-700'>Invoice detail</p>
                <h2 className='mt-1 text-2xl font-black text-slate-950'>{selectedInvoice.invoiceNumber}</h2>
                <p className='mt-1 text-sm text-slate-500'>{periodLabel(selectedInvoice.periodStart, selectedInvoice.periodEnd)}</p>
              </div>
              <div className='flex items-center gap-2'>
                <button onClick={() => window.print()} className='rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50'>
                  Download / print PDF
                </button>
                <button onClick={() => setSelectedInvoice(null)} className='rounded-xl px-2 py-1 text-2xl text-slate-400 hover:bg-slate-100' aria-label='Close'>
                  ×
                </button>
              </div>
            </div>
            <div className='mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4'>
              <p className='text-sm font-bold text-slate-900'>{selectedInvoice.lineDescription}</p>
              <div className='mt-4 grid gap-3 text-sm sm:grid-cols-3'>
                <div>
                  <p className='text-xs font-bold uppercase text-slate-500'>Service</p>
                  <p className='mt-1 font-black'>{formatMoney(selectedInvoice.serviceAmount)}</p>
                </div>
                <div>
                  <p className='text-xs font-bold uppercase text-slate-500'>HST</p>
                  <p className='mt-1 font-black'>{formatMoney(selectedInvoice.hstAmount)}</p>
                </div>
                <div>
                  <p className='text-xs font-bold uppercase text-slate-500'>Total</p>
                  <p className='mt-1 text-lg font-black text-slate-950'>{formatMoney(selectedInvoice.totalAmount)}</p>
                </div>
              </div>
            </div>
            <div className='mt-5 grid gap-4 text-sm sm:grid-cols-2'>
              <div>
                <p className='text-xs font-black uppercase tracking-wide text-slate-500'>From</p>
                <p className='mt-1 font-bold text-slate-900'>{selectedIssuer?.legalName || 'IT & marketing partner'}</p>
                <p className='text-slate-500'>{selectedIssuer?.corporationNumber ? `OCN: ${selectedIssuer.corporationNumber}` : 'IT & marketing partner'}</p>
                {selectedIssuer?.addressLine1 && <p className='text-slate-500'>{[selectedIssuer.addressLine1, selectedIssuer.city, selectedIssuer.province, selectedIssuer.postalCode, selectedIssuer.country].filter(Boolean).join(', ')}</p>}
              </div>
              <div>
                <p className='text-xs font-black uppercase tracking-wide text-slate-500'>To</p>
                <p className='mt-1 font-bold text-slate-900'>{selectedRecipient?.legalName || 'Better Call Locksmith Inc.'}</p>
                <p className='text-slate-500'>OCN: {selectedRecipient?.corporationNumber || '1001348245'}</p>
                {selectedRecipient?.addressLine1 && <p className='text-slate-500'>{[selectedRecipient.addressLine1, selectedRecipient.city, selectedRecipient.province, selectedRecipient.postalCode, selectedRecipient.country].filter(Boolean).join(', ')}</p>}
              </div>
            </div>
            <div className='mt-5 rounded-2xl border border-slate-100 bg-white p-4'>
              <p className='text-xs font-black uppercase tracking-wide text-slate-500'>History</p>
              <div className='mt-3 space-y-2 text-xs text-slate-600'>
                <p>Issued: {selectedInvoice.issuedAt ? formatDate(selectedInvoice.issuedAt) : 'Pending issue'}</p>
                {selectedInvoice.paymentEvents?.map((event) => (
                  <p key={event.id}>
                    {event.toStatus === 'RECEIVED' ? 'Payment received' : 'Payment pending'}: {formatDate(event.paidAt || event.createdAt)}
                  </p>
                ))}
              </div>
            </div>
            <div className='mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5'>
              <div>
                <p className='text-xs font-bold uppercase tracking-wide text-slate-500'>Payment status</p>
                <div className='mt-2'>
                  <StatusBadge status={selectedInvoice.paymentStatus} />
                </div>
              </div>
              {isAdmin && (
                <button onClick={() => updatePayment(selectedInvoice, selectedInvoice.paymentStatus === 'RECEIVED' ? 'PENDING' : 'RECEIVED')} disabled={paymentUpdating === selectedInvoice.id} className='rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50'>
                  {paymentUpdating === selectedInvoice.id ? 'Saving…' : selectedInvoice.paymentStatus === 'RECEIVED' ? 'Mark payment pending' : 'Mark payment received'}
                </button>
              )}
            </div>
            <p className='mt-6 text-xs leading-5 text-slate-500'>HST is shown from the registration snapshot at issuance. This invoice cannot be recalculated from live job data.</p>
          </div>
        </div>
      )}
      {selectedInvoice && isAdmin && (
        <div className='no-print fixed bottom-5 left-1/2 z-[70] -translate-x-1/2'>
          <button onClick={() => sendInvoiceEmail(selectedInvoice)} disabled={emailSending === selectedInvoice.id} className='rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-900/20 hover:bg-blue-800 disabled:opacity-50'>
            {emailSending === selectedInvoice.id ? 'Sending…' : selectedInvoice.paymentStatus === 'RECEIVED' ? 'Send paid invoice' : 'Email invoice'}
          </button>
        </div>
      )}
      {selectedInvoice && (
        <div className='print-invoice'>
          <InvoiceDocument invoice={selectedInvoice} issuer={selectedIssuer} recipient={selectedRecipient} />
        </div>
      )}
    </main>
  );
}
