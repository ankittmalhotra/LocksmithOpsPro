'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import SmsComposerModal from '@/components/SmsComposerModal';
import type { SmsDraft } from '@/lib/sms-draft';
import { buildSmsDraft } from '@/lib/sms-draft';

type PaymentMethod = 'CASH' | 'INTERAC' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'STRIPE_CARD';

const OPEN_STATUSES = ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'] as const;
const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'INTERAC', label: 'Interac' },
];

interface Job {
  id: string;
  jobNumber: string;
  updatedAt: string;
  status: string;
  isManual?: boolean;
  serviceType: string;
  problemDescription: string;
  serviceAddress: string;
  isScheduled: boolean;
  scheduledFor?: string | null;
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleVin?: string | null;
  keyType?: string | null;
  fccId?: string | null;
  keyBitting?: string | null;
  doorDetails?: string | null;
  technicianId?: string | null;
  technician?: { id: string; name: string; phone: string; commissionRate?: number } | null;
  customer: { id: string; name: string; phone: string; extension?: string | null };
  invoice?: {
    grandTotal: number;
    paymentMethod?: PaymentMethod | null;
    paymentStatus: string;
    stripeSessionStatus?: string | null;
    stripeSessionExpiresAt?: string | null;
    stripePaymentUrl?: string | null;
    stripePaymentLinkExpiresAt?: string | null;
    paymentUrl?: string | null;
    paymentLink?: string | null;
    paymentLinkExpiresAt?: string | null;
  } | null;
}

function getPaymentLinkUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  const nested = value.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : null;
  const payment = value.payment && typeof value.payment === 'object' ? value.payment as Record<string, unknown> : null;
  const invoice = value.invoice && typeof value.invoice === 'object' ? value.invoice as Record<string, unknown> : null;
  const job = value.job && typeof value.job === 'object' ? value.job as Record<string, unknown> : null;
  const jobInvoice = job?.invoice && typeof job.invoice === 'object' ? job.invoice as Record<string, unknown> : null;
  const candidates = [
    value.paymentUrl,
    value.paymentLink,
    value.url,
    nested?.paymentUrl,
    nested?.paymentLink,
    payment?.paymentUrl,
    payment?.paymentLink,
    invoice?.stripePaymentUrl,
    jobInvoice?.stripePaymentUrl,
    jobInvoice?.paymentUrl,
    jobInvoice?.paymentLink,
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) || null;
}

function getPaymentLinkSmsBody(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  const nested = value.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : null;
  return [value.smsBody, nested?.smsBody].find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0) || null;
}

function isCardPaymentMethod(paymentMethod: PaymentMethod | null | undefined) {
  return paymentMethod === 'CREDIT_CARD' || paymentMethod === 'DEBIT_CARD' || paymentMethod === 'STRIPE_CARD';
}

function getPersistedPaymentLink(job: Job): { url: string | null; expiresAt: string | null; sessionStatus: string | null } {
  const invoice = job.invoice;
  if (!invoice) return { url: null, expiresAt: null, sessionStatus: null };
  const url = [invoice.stripePaymentUrl, invoice.paymentUrl, invoice.paymentLink]
    .find((candidate): candidate is string => typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) || null;
  return {
    url,
    expiresAt: invoice.stripePaymentLinkExpiresAt || invoice.stripeSessionExpiresAt || invoice.paymentLinkExpiresAt || null,
    sessionStatus: invoice.stripeSessionStatus || null,
  };
}

function isActivePaymentLink(expiresAt: string | null, sessionStatus: string | null) {
  if (sessionStatus && sessionStatus.toLowerCase() !== 'open') return false;
  if (!expiresAt) return true;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

interface EditForm {
  customerName: string;
  customerPhone: string;
  customerExtension: string;
  serviceAddress: string;
  serviceType: string;
  problemDescription: string;
  technicianId: string;
  status: string;
  isScheduled: boolean;
  scheduledFor: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleVin: string;
  keyType: string;
  fccId: string;
  keyBitting: string;
  doorDetails: string;
}

function toLocalDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formFromJob(job: Job): EditForm {
  return {
    customerName: job.customer.name || '',
    customerPhone: job.customer.phone || '',
    customerExtension: job.customer.extension || '',
    serviceAddress: job.serviceAddress || '',
    serviceType: job.serviceType || '',
    problemDescription: job.problemDescription || '',
    technicianId: job.technicianId || '',
    status: job.status,
    isScheduled: Boolean(job.isScheduled),
    scheduledFor: toLocalDateTime(job.scheduledFor),
    vehicleYear: job.vehicleYear || '',
    vehicleMake: job.vehicleMake || '',
    vehicleModel: job.vehicleModel || '',
    vehicleVin: job.vehicleVin || '',
    keyType: job.keyType || '',
    fccId: job.fccId || '',
    keyBitting: job.keyBitting || '',
    doorDetails: job.doorDetails || '',
  };
}

export default function DispatcherJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [technicians, setTechnicians] = useState<Array<{ id: string; name: string; phone: string; commissionRate?: number }>>([]);
  const [form, setForm] = useState<EditForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [smsDraft, setSmsDraft] = useState<SmsDraft | null>(null);
  const [smsWarnings, setSmsWarnings] = useState<string[]>([]);
  const [smsAutoOpen, setSmsAutoOpen] = useState(false);
  const [paymentLinkBusy, setPaymentLinkBusy] = useState(false);
  const [paymentLinkError, setPaymentLinkError] = useState('');
  const [paymentLinkCopyState, setPaymentLinkCopyState] = useState('');
  const [paymentLinkUrlOverride, setPaymentLinkUrlOverride] = useState<string | null>(null);

  const [calculationMode, setCalculationMode] = useState<'REVERSE' | 'FORWARD'>('REVERSE');
  const [amountReceived, setAmountReceived] = useState('');
  const [laborAmount, setLaborAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [completePaymentConfirmed, setCompletePaymentConfirmed] = useState(false);
  const [abandonPaymentConfirmed, setAbandonPaymentConfirmed] = useState(false);
  const [travelFee, setTravelFee] = useState('25');
  const [abandonReason, setAbandonReason] = useState('Customer canceled on site');

  const load = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const [jobRes, techRes] = await Promise.all([
        fetch(`/api/jobs/${id}`, { cache: 'no-store' }),
        fetch('/api/auth/users?role=TECHNICIAN&activeOnly=true', { cache: 'no-store' }),
      ]);
      const jobData = await jobRes.json();
      const techData = await techRes.json();
      if (!jobRes.ok || !jobData.success || !jobData.job) throw new Error(jobData.error || 'Unable to load job');
      setJob(jobData.job);
      setForm(formFromJob(jobData.job));
      if (jobData.job.invoice?.paymentMethod) setPaymentMethod(jobData.job.invoice.paymentMethod);
      setPaymentLinkUrlOverride(null);
      if (jobData.job.invoice?.grandTotal) setAmountReceived(String(jobData.job.invoice.grandTotal));
      if (techRes.ok && techData.success) setTechnicians(techData.users || []);
    } catch (error: any) {
      setErrorMsg(error.message || 'Unable to load job');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const updateField = <K extends keyof EditForm>(field: K, value: EditForm[K]) => {
    setForm((current) => current ? { ...current, [field]: value } : current);
  };

  const hasUnsavedDispatchEdits = () => {
    const current = form;
    if (!current || !job) return false;
    return current.customerName !== job.customer.name
      || current.customerPhone !== job.customer.phone
      || current.customerExtension !== (job.customer.extension || '')
      || current.serviceAddress !== job.serviceAddress
      || current.serviceType !== job.serviceType
      || current.problemDescription !== job.problemDescription
      || current.technicianId !== (job.technicianId || '')
      || current.status !== job.status
      || current.isScheduled !== Boolean(job.isScheduled)
      || current.scheduledFor !== toLocalDateTime(job.scheduledFor)
      || current.vehicleYear !== (job.vehicleYear || '')
      || current.vehicleMake !== (job.vehicleMake || '')
      || current.vehicleModel !== (job.vehicleModel || '')
      || current.vehicleVin !== (job.vehicleVin || '')
      || current.keyType !== (job.keyType || '')
      || current.fccId !== (job.fccId || '')
      || current.keyBitting !== (job.keyBitting || '')
      || current.doorDetails !== (job.doorDetails || '');
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || !job) return;
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      if (!form.customerName.trim() || !form.customerPhone.trim() || !form.serviceAddress.trim() || !form.serviceType.trim()) {
        throw new Error('Customer name, phone, address, and service type are required.');
      }
      if (form.isScheduled && !form.scheduledFor) throw new Error('Choose a scheduled date and time.');
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          expectedUpdatedAt: job.updatedAt,
          customerName: form.customerName.trim(),
          customerPhone: form.customerPhone.trim(),
          customerExtension: form.customerExtension.trim() || null,
          serviceAddress: form.serviceAddress.trim(),
          serviceType: form.serviceType.trim(),
          problemDescription: form.problemDescription.trim(),
          scheduledFor: form.isScheduled && form.scheduledFor ? new Date(form.scheduledFor).toISOString() : null,
          vehicleYear: form.vehicleYear.trim() || null,
          vehicleMake: form.vehicleMake.trim() || null,
          vehicleModel: form.vehicleModel.trim() || null,
          vehicleVin: form.vehicleVin.trim() || null,
          keyType: form.keyType.trim() || null,
          fccId: form.fccId.trim() || null,
          keyBitting: form.keyBitting.trim() || null,
          doorDetails: form.doorDetails.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to save job');
      setJob(data.job);
      setForm(formFromJob(data.job));
      setSmsDraft(data.smsDraft || null);
      setSmsWarnings(Array.isArray(data.smsDraftWarnings) ? data.smsDraftWarnings : []);
      setSuccessMsg(data.smsDraft ? 'Job updated. A technician SMS draft is ready for review.' : 'Job updated successfully.');
    } catch (error: any) {
      setErrorMsg(error.message || 'Unable to save job');
    } finally {
      setSaving(false);
    }
  };

  const copyPaymentLink = async () => {
    if (!job) return;
    const persisted = getPersistedPaymentLink(job);
    const paymentUrl = paymentLinkUrlOverride || persisted.url;
    if (!paymentUrl) return;
    try {
      await navigator.clipboard.writeText(paymentUrl);
      setPaymentLinkCopyState('Payment link copied.');
    } catch {
      setPaymentLinkCopyState('Copy was unavailable. Select the link and copy it manually.');
    }
  };

  const preparePaymentLinkSms = (paymentUrl: string, smsBody?: string | null) => {
    if (!job) return;
    try {
      const body = smsBody
        ? (smsBody.includes(paymentUrl) ? smsBody : `${smsBody}\nPayment link: ${paymentUrl}`)
        : `Payment link for Job #${job.jobNumber}: ${paymentUrl}`;
      const draft = buildSmsDraft({
        to: job.customer.phone,
        body,
      });
      setSmsDraft(draft);
      setSmsWarnings([]);
      setSmsAutoOpen(true);
      setSuccessMsg('Payment link SMS draft is ready. Review the message and tap Send in Messages.');
      setPaymentLinkError('');
    } catch {
      setPaymentLinkError('Payment link is available, but the customer phone number cannot open an SMS draft. Copy the link and send it manually.');
    }
  };

  const sendPaymentLinkSms = () => {
    if (!job) return;
    const persisted = getPersistedPaymentLink(job);
    const paymentUrl = paymentLinkUrlOverride || persisted.url;
    if (!paymentUrl || !isActivePaymentLink(persisted.expiresAt, persisted.sessionStatus)) {
      setPaymentLinkError('No active payment link is available. Generate a new link and retry.');
      return;
    }
    preparePaymentLinkSms(paymentUrl);
  };

  const generatePaymentLink = async (sendSms: boolean) => {
    if (!job) return;
    setPaymentLinkBusy(true);
    setPaymentLinkError('');
    setPaymentLinkCopyState('');
    try {
      const res = await fetch(`/api/jobs/${id}/payment-link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || 'Unable to generate payment link');
      const paymentUrl = getPaymentLinkUrl(data);
      if (!paymentUrl) throw new Error('Payment link was generated without a usable URL. Retry.');
      setPaymentLinkUrlOverride(paymentUrl);
      setJob((current) => current && current.invoice ? {
        ...current,
        invoice: { ...current.invoice, stripePaymentUrl: paymentUrl },
      } : current);
      if (sendSms) {
        preparePaymentLinkSms(paymentUrl, getPaymentLinkSmsBody(data));
      } else {
        setSuccessMsg('Payment link generated. You can now send it by SMS or copy it for another channel.');
      }
    } catch (error: any) {
      setPaymentLinkError(error.message || 'Unable to generate payment link');
    } finally {
      setPaymentLinkBusy(false);
    }
  };

  const closeJob = async (kind: 'complete' | 'abandon') => {
    if (!job || !form) return;
    setClosing(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      if (hasUnsavedDispatchEdits()) throw new Error('Save job changes before closing the job.');
      let endpoint = `/api/jobs/${id}/invoice`;
      let body: Record<string, unknown>;
      if (kind === 'complete') {
        if (!completePaymentConfirmed) throw new Error('Confirm that payment was collected before closing the job.');
        const amount = calculationMode === 'REVERSE' ? Number(amountReceived) : Number(laborAmount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error(calculationMode === 'REVERSE' ? 'Enter the amount received.' : 'Enter the labor amount.');
        body = {
          calculationMode,
          amountReceived: calculationMode === 'REVERSE' ? amount : 0,
          laborAmount: calculationMode === 'FORWARD' ? amount : 0,
          parts: [],
          paymentMethod,
          keyBitting: form.keyBitting.trim() || null,
          doorDetails: form.doorDetails.trim() || null,
        };
      } else {
        if (!abandonPaymentConfirmed) throw new Error('Confirm that the travel fee was collected before closing the job.');
        endpoint = `/api/jobs/${id}/abandon`;
        const fee = Number(travelFee);
        if (!Number.isFinite(fee) || fee <= 0) throw new Error('Travel fee must be greater than zero.');
        body = { travelFeeAmount: fee, paymentMethod, reason: abandonReason.trim() || 'Customer canceled on site' };
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to close job');
      setJob(data.job);
      setForm(formFromJob(data.job));
      setSmsDraft(data.dispatcherNotification || null);
      setSmsWarnings(Array.isArray(data.dispatcherNotificationWarnings) ? data.dispatcherNotificationWarnings : []);
      const label = kind === 'complete' ? 'completed' : 'abandoned';
      setSuccessMsg(data.dispatcherNotification ? `Job ${label}. Dispatcher SMS draft is ready for review.${data.revenueEmail?.success === false ? ` Revenue email failed: ${data.revenueEmail.error || 'check Resend configuration.'}` : ''}` : `Job ${label} successfully.${data.revenueEmail?.success === false ? ` Revenue email failed: ${data.revenueEmail.error || 'check Resend configuration.'}` : ''}`);
    } catch (error: any) {
      setErrorMsg(error.message || 'Unable to close job');
    } finally {
      setClosing(false);
    }
  };

  if (loading) return <main className="max-w-5xl mx-auto w-full p-5 text-sm text-slate-500">Loading job…</main>;
  if (!job || !form) return <main className="max-w-5xl mx-auto w-full p-5"><p className="text-sm text-rose-700">{errorMsg || 'Job unavailable.'}</p><Link href="/dispatch" className="text-sm text-blue-700 underline">Back to dispatch</Link></main>;

  const isOpen = OPEN_STATUSES.includes(job.status as (typeof OPEN_STATUSES)[number]);
  const selectedTech = technicians.find((technician) => technician.id === form.technicianId);
  const persistedPaymentLink = getPersistedPaymentLink(job);
  const activePaymentLinkUrl = paymentLinkUrlOverride || persistedPaymentLink.url;
  const canManagePaymentLink = Boolean(
    job.isManual
    && job.invoice?.paymentStatus === 'PENDING'
    && isCardPaymentMethod(job.invoice.paymentMethod)
  );
  const hasActivePaymentLink = Boolean(
    canManagePaymentLink
    && activePaymentLinkUrl
    && (paymentLinkUrlOverride ? true : isActivePaymentLink(persistedPaymentLink.expiresAt, persistedPaymentLink.sessionStatus))
  );

  return (
    <main className="max-w-6xl mx-auto w-full p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dispatch" className="text-xs font-bold text-blue-700 hover:underline">← Back to dispatch desk</Link>
          <h1 className="text-2xl font-black text-slate-900 mt-1">Job #{job.jobNumber}</h1>
          <p className="text-xs text-slate-500">Dispatcher job editor • {job.status.replaceAll('_', ' ')}</p>
        </div>
        <span className={`px-3 py-1 rounded-lg text-xs font-black border ${isOpen ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-slate-100 text-slate-700 border-slate-300'}`}>{isOpen ? 'OPEN' : 'CLOSED'}</span>
      </div>

      {errorMsg && <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{errorMsg}</div>}
      {successMsg && <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{successMsg}</div>}

      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div><h2 className="font-black text-slate-900">Edit open job</h2><p className="text-xs text-slate-500">Dispatchers can update the assignment and job details. This does not open the technician portal.</p></div>
          <button disabled={!isOpen || saving} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
        <fieldset disabled={!isOpen || saving} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="field-label">Customer name *<input className="field-input" value={form.customerName} onChange={(e) => updateField('customerName', e.target.value)} required /></label>
            <label className="field-label">Customer phone *<input className="field-input" value={form.customerPhone} onChange={(e) => updateField('customerPhone', e.target.value)} required /></label>
            <label className="field-label">Extension<input className="field-input" value={form.customerExtension} onChange={(e) => updateField('customerExtension', e.target.value)} /></label>
            <label className="field-label">Service type *<input className="field-input" value={form.serviceType} onChange={(e) => updateField('serviceType', e.target.value)} required /></label>
            <label className="field-label md:col-span-2">Service address *<input className="field-input" value={form.serviceAddress} onChange={(e) => updateField('serviceAddress', e.target.value)} required /></label>
            <label className="field-label md:col-span-2">Problem description<textarea className="field-input min-h-20" value={form.problemDescription} onChange={(e) => updateField('problemDescription', e.target.value)} /></label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="field-label">Technician<select className="field-input" value={form.technicianId} onChange={(e) => updateField('technicianId', e.target.value)}><option value="">Unassigned</option>{technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.name} ({Number(technician.commissionRate || 0).toFixed(2)}%)</option>)}</select>{selectedTech && <span className="text-[10px] text-slate-500">{selectedTech.phone}</span>}</label>
            <label className="field-label">Operational status<select className="field-input" value={form.status} onChange={(e) => updateField('status', e.target.value)}>{OPEN_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
            <label className="field-label flex-row items-center gap-2 pt-6"><input type="checkbox" checked={form.isScheduled} onChange={(e) => updateField('isScheduled', e.target.checked)} /> Scheduled appointment</label>
            {form.isScheduled && <label className="field-label md:col-span-3">Scheduled for<input type="datetime-local" className="field-input" value={form.scheduledFor} onChange={(e) => updateField('scheduledFor', e.target.value)} required /></label>}
          </div>
          <div><h3 className="text-sm font-black text-slate-800 mb-2">Vehicle / locksmith details</h3><div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <label className="field-label">Vehicle year<input className="field-input" value={form.vehicleYear} onChange={(e) => updateField('vehicleYear', e.target.value)} /></label>
            <label className="field-label">Vehicle make<input className="field-input" value={form.vehicleMake} onChange={(e) => updateField('vehicleMake', e.target.value)} /></label>
            <label className="field-label">Vehicle model<input className="field-input" value={form.vehicleModel} onChange={(e) => updateField('vehicleModel', e.target.value)} /></label>
            <label className="field-label">VIN<input className="field-input" value={form.vehicleVin} onChange={(e) => updateField('vehicleVin', e.target.value)} /></label>
            <label className="field-label">Key type<input className="field-input" value={form.keyType} onChange={(e) => updateField('keyType', e.target.value)} /></label>
            <label className="field-label">FCC ID<input className="field-input" value={form.fccId} onChange={(e) => updateField('fccId', e.target.value)} /></label>
            <label className="field-label">Key bitting<input className="field-input" value={form.keyBitting} onChange={(e) => updateField('keyBitting', e.target.value)} /></label>
            <label className="field-label sm:col-span-2">Door details<input className="field-input" value={form.doorDetails} onChange={(e) => updateField('doorDetails', e.target.value)} /></label>
          </div></div>
        </fieldset>
      </form>

      {canManagePaymentLink && (
        <section className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 space-y-3">
          <div>
            <h2 className="font-black text-blue-900">Customer payment link</h2>
            <p className="text-xs text-slate-600">This job is still pending. Opening Messages prepares a draft; it does not confirm that an SMS was sent.</p>
          </div>
          {paymentLinkError && (
            <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
              <div>{paymentLinkError}</div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" disabled={paymentLinkBusy} onClick={() => generatePaymentLink(Boolean(activePaymentLinkUrl))} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">{paymentLinkBusy ? 'Retrying…' : 'Retry'}</button>
                {activePaymentLinkUrl && <button type="button" onClick={copyPaymentLink} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 font-bold">Copy Payment Link</button>}
              </div>
              {paymentLinkCopyState && <div className="mt-2 text-[11px] font-semibold">{paymentLinkCopyState}</div>}
            </div>
          )}
          {hasActivePaymentLink && activePaymentLinkUrl ? (
            <>
              <a href={activePaymentLinkUrl} target="_blank" rel="noreferrer" className="block break-all text-xs text-blue-700 underline">{activePaymentLinkUrl}</a>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={paymentLinkBusy} onClick={sendPaymentLinkSms} className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black disabled:opacity-50">Send Payment Link via SMS</button>
                <button type="button" onClick={copyPaymentLink} className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-black">Copy Payment Link</button>
              </div>
              {paymentLinkCopyState && <p className="text-[11px] text-emerald-700 font-semibold">{paymentLinkCopyState}</p>}
            </>
          ) : (
            <button type="button" disabled={paymentLinkBusy} onClick={() => generatePaymentLink(false)} className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-black disabled:opacity-50">{paymentLinkBusy ? 'Generating…' : 'Generate Payment Link'}</button>
          )}
        </section>
      )}

      {isOpen && <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 space-y-4">
          <div><h2 className="font-black text-emerald-900">Close as successful</h2><p className="text-xs text-slate-500">Record Cash or Interac collected. Card payments are unavailable until processor integration is added.</p></div>
          <div className="grid grid-cols-2 gap-3"><label className="field-label">Calculation<select className="field-input" value={calculationMode} onChange={(e) => setCalculationMode(e.target.value as 'REVERSE' | 'FORWARD')}><option value="REVERSE">Total received</option><option value="FORWARD">Labor + parts</option></select></label><label className="field-label">Payment method<select className="field-input" value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value as PaymentMethod); setCompletePaymentConfirmed(false); }}>{PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label></div>
          {calculationMode === 'REVERSE' ? <label className="field-label">Total amount received *<input className="field-input" type="number" min="0.01" step="0.01" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} /></label> : <label className="field-label">Labor amount *<input className="field-input" type="number" min="0.01" step="0.01" value={laborAmount} onChange={(e) => setLaborAmount(e.target.value)} /></label>}
          <div className="grid grid-cols-2 gap-3"><label className="field-label">Key bitting<input className="field-input" value={form.keyBitting} onChange={(e) => updateField('keyBitting', e.target.value)} /></label><label className="field-label">Door details<input className="field-input" value={form.doorDetails} onChange={(e) => updateField('doorDetails', e.target.value)} /></label></div>
          <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={completePaymentConfirmed} onChange={(e) => setCompletePaymentConfirmed(e.target.checked)} /><span>I confirm this Cash or Interac payment was collected.</span></label>
          <button type="button" disabled={closing || !completePaymentConfirmed} onClick={() => closeJob('complete')} className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black disabled:opacity-50">{closing ? 'Saving…' : 'Complete job and record payment'}</button>
        </section>
        <section className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5 space-y-4">
          <div><h2 className="font-black text-amber-900">Close as abandoned</h2><p className="text-xs text-slate-500">Apply a travel fee and record how it was collected.</p></div>
          <div className="grid grid-cols-2 gap-3"><label className="field-label">Travel fee *<input className="field-input" type="number" min="0.01" step="0.01" value={travelFee} onChange={(e) => setTravelFee(e.target.value)} /></label><label className="field-label">Payment method<select className="field-input" value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value as PaymentMethod); setAbandonPaymentConfirmed(false); }}>{PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label></div>
          <label className="field-label">Reason<textarea className="field-input min-h-20" value={abandonReason} onChange={(e) => setAbandonReason(e.target.value)} /></label>
          <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={abandonPaymentConfirmed} onChange={(e) => setAbandonPaymentConfirmed(e.target.checked)} /><span>I confirm the Cash or Interac travel fee was collected.</span></label>
          <button type="button" disabled={closing || !abandonPaymentConfirmed} onClick={() => closeJob('abandon')} className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-black disabled:opacity-50">{closing ? 'Saving…' : 'Abandon job and record travel fee'}</button>
        </section>
      </div>}

      {!isOpen && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">This job is closed and is read-only. Dispatcher edits and closeout actions are available only while the job is open.</div>}
      <SmsComposerModal draft={smsDraft} warnings={smsWarnings} title={smsAutoOpen ? 'Payment link SMS ready' : 'SMS draft ready'} autoOpen={smsAutoOpen} onClose={() => { setSmsDraft(null); setSmsWarnings([]); setSmsAutoOpen(false); }} />
    </main>
  );
}
