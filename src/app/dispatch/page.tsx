'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { MANUAL_JOB_RECEIVED_TIME_SLOTS, MANUAL_SERVICE_TYPES } from '@/lib/manual-job';
import { calculateDualPriceManualCardQuote, DEFAULT_CARD_PRICE_DIFFERENCE_RATE, MAX_CARD_PRICE_DIFFERENCE_RATE, roundToTwo } from '@/lib/calculations';
import SmsComposerModal from '@/components/SmsComposerModal';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import RingCentralCallAnalytics from '@/components/RingCentralCallAnalytics';
import PeriodComparisonWidget, { type PeriodComparisonMode, type PeriodComparisons } from '@/components/PeriodComparisonWidget';
import type { SmsDraft } from '@/lib/sms-draft';
import { buildSmsDraft } from '@/lib/sms-draft';
import { parseDispatchPaste } from '@/lib/dispatch-paste-parser';
import { formatTorontoDateInput, parseTorontoDateOnly, torontoDateTimeToIso } from '@/lib/timezone';
import {
  isInRevenuePeriod,
  REVENUE_PERIOD_LABELS,
  REVENUE_PERIOD_OPTIONS,
  type RevenuePeriod,
} from '@/lib/revenue-period';

const PHONE_INPUT_PATTERN = '(?=.*[0-9])[0-9()+\\-\\s]{7,}';
function sanitizePhoneInput(value: string) {
  return value.replace(/[^0-9()+\-\s]/g, '');
}

function phoneDigitCount(value: string) {
  return value.replace(/\D/g, '').length;
}

function validateManualForm(form: Record<string, string>) {
  const pendingCardPayment = form.paymentStatus === 'PENDING'
    && (form.paymentMethod === 'CREDIT_CARD' || form.paymentMethod === 'DEBIT_CARD');
  if (!parseTorontoDateOnly(form.jobDate)) {
    return 'Job date must be a valid date.';
  }
  if (!/^\d+$/.test(form.jobNumber.trim()) || BigInt(form.jobNumber.trim() || '0') <= 0n) {
    return 'Job number must be a positive whole number.';
  }
  if (!form.customerName.trim() || !form.serviceAddress.trim() || !form.description.trim()) {
    return 'Customer name, address, and description are required.';
  }
  if (phoneDigitCount(form.customerPhone) < 7) {
    return 'Enter a valid customer phone number with at least 7 digits.';
  }
  if (form.serviceType === 'Other' && !form.otherServiceType.trim()) {
    return 'Enter the other job type.';
  }
  if (!Number.isFinite(Number(form.totalAmountCollected)) || Number(form.totalAmountCollected) <= 0) {
    return pendingCardPayment
      ? 'Non-card price before tax must be greater than 0.'
      : 'Total amount collected must be greater than 0.';
  }
  if (!Number.isFinite(Number(form.cogsAmount)) || Number(form.cogsAmount) < 0) {
    return 'COGS must be a valid non-negative amount.';
  }
  if (!Number.isFinite(Number(form.technicianCommission)) || Number(form.technicianCommission) < 0) {
    return 'Technician commission must be a valid non-negative amount.';
  }
  if (pendingCardPayment) {
    const priceDifferencePercent = Number(form.cardPriceDifferenceRate);
    if (!Number.isFinite(priceDifferencePercent) || priceDifferencePercent < 0 || priceDifferencePercent > MAX_CARD_PRICE_DIFFERENCE_RATE * 100) {
      return `Card-price difference must be between 0% and ${MAX_CARD_PRICE_DIFFERENCE_RATE * 100}%.`;
    }
    if (form.customerAcceptedCardPrice !== 'yes') {
      return 'Confirm that the customer explicitly accepted the card price shown above.';
    }
    if (!['VERBAL', 'WRITTEN'].includes(form.quoteAcceptanceMethod)) {
      return 'Select whether the customer accepted verbally or in writing.';
    }
    if (!form.quoteAcceptanceEvidence?.trim()) {
      return 'Add a note recording how the customer accepted the card price.';
    }
  }
  if (!form.technicianId) {
    return 'Select a technician or choose Other.';
  }
  if (form.technicianId === 'OTHER' && !form.otherTechnicianName.trim()) {
    return 'Enter the other technician name.';
  }
  return null;
}

interface Job {
  id: string;
  jobNumber: string;
  updatedAt: string;
  serviceType: string;
  serviceAddress: string;
  problemDescription: string;
  jobReceivedTimeSlot?: string | null;
  workerCommission: number;
  workerCommissionRate: number;
  status: string;
  receiptState?: 'local_ready' | 'stripe_ready' | 'stripe_partial_refund' | 'payment_pending' | 'off_books' | 'provider_missing' | 'refunded' | 'ineligible';
  isAbandoned: boolean;
  isManual?: boolean;
  createdAt: string;
  completedAt?: string | null;
  isScheduled?: boolean;
  scheduledFor?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleVin?: string;
  keyType?: string;
  fccId?: string;
  customer: {
    name: string;
    phone: string;
    extension?: string;
  };
  technician?: {
    id: string;
    name: string;
    phone: string;
  };
  technicianName?: string;
  items?: Array<{
    unitCost: number;
    quantity: number;
    isPart: boolean;
  }>;
  invoice?: {
    grandTotal: number;
    taxAmount?: number;
    totalAmountCollected?: number;
    cogsAmount?: number;
    paymentMethod: string;
    taxCollected?: boolean;
    cardSurchargeRate?: number;
    cardPriceDifferenceRate?: number | null;
    pricingModel?: string | null;
    nonCardPrice?: number | null;
    cardPrice?: number | null;
    acceptedPriceOption?: string | null;
    quoteAcceptanceMethod?: string | null;
    quoteAcceptanceEvidence?: string | null;
    paidAt?: string | null;
    paymentStatus: string;
    paymentProvider?: string | null;
    stripeInvoiceId?: string | null;
    stripePaymentUrl?: string | null;
    stripePaymentLinkExpiresAt?: string | null;
    paymentUrl?: string | null;
    paymentLink?: string | null;
  };
}

type ManualPaymentStatus = 'PAID' | 'PENDING';
type JobEntryMode = 'NEW' | 'ASSIGNED' | 'COMPLETED';
type JobsView = 'BOARD' | 'TABLE';

interface PaymentLinkPrompt {
  jobId: string;
  jobNumber: string;
  customerName: string;
  customerPhone: string;
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

function isCardPaymentMethod(paymentMethod: string | null | undefined) {
  return paymentMethod === 'CREDIT_CARD' || paymentMethod === 'DEBIT_CARD';
}

export default function DispatchPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [jobsView, setJobsView] = useState<JobsView>('TABLE');
  const [jobSearch, setJobSearch] = useState('');
  const [revenuePeriod, setRevenuePeriod] = useState<RevenuePeriod>('all-time');
  const [comparisonMode, setComparisonMode] = useState<PeriodComparisonMode>('week');
  const [comparisons, setComparisons] = useState<PeriodComparisons | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(true);
  const [comparisonError, setComparisonError] = useState('');
  const comparisonRequestId = useRef(0);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Intake Form State
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerExtension, setCustomerExtension] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  const [serviceType, setServiceType] = useState('Commercial Lock Change');
  const [problemDescription, setProblemDescription] = useState('');
  const [dispatchPasteText, setDispatchPasteText] = useState('');
  const [pasteNeedsReview, setPasteNeedsReview] = useState(false);
  const [pasteReview, setPasteReview] = useState<{
    warnings: string[];
    unparsedText: string;
    confidence: number;
  } | null>(null);
  const [pasteError, setPasteError] = useState('');
  const [workerCommissionRate, setWorkerCommissionRate] = useState('0.00');
  const [technicianId, setTechnicianId] = useState('');
  
  // Scheduled Booking State
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');

  // Automotive Locksmith State
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleVin, setVehicleVin] = useState('');
  const [keyType, setKeyType] = useState('Transponder Chip Key');
  const [fccId, setFccId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [smsDraft, setSmsDraft] = useState<SmsDraft | null>(null);
  const [smsWarnings, setSmsWarnings] = useState<string[]>([]);
  const [smsAutoOpen, setSmsAutoOpen] = useState(false);

  const [showAddTechnician, setShowAddTechnician] = useState(false);
  const [newTechnicianName, setNewTechnicianName] = useState('');
  const [newTechnicianPhone, setNewTechnicianPhone] = useState('');
  const [newTechnicianEmail, setNewTechnicianEmail] = useState('');
  const [newTechnicianPassword, setNewTechnicianPassword] = useState('');
  const [newTechnicianCommission, setNewTechnicianCommission] = useState('0.00');
  const [addingTechnician, setAddingTechnician] = useState(false);
  const [editingTechnicianId, setEditingTechnicianId] = useState<string | null>(null);
  const [deletingTechnicianId, setDeletingTechnicianId] = useState<string | null>(null);

  const [technicians, setTechnicians] = useState<any[]>([]);
  const [showAddJob, setShowAddJob] = useState(false);
  const [jobEntryMode, setJobEntryMode] = useState<JobEntryMode>('COMPLETED');
  const [editingManualId, setEditingManualId] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [paymentLinkPrompt, setPaymentLinkPrompt] = useState<PaymentLinkPrompt | null>(null);
  const [paymentLinkGenerating, setPaymentLinkGenerating] = useState(false);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const [paymentLinkError, setPaymentLinkError] = useState('');
  const [paymentLinkCopyState, setPaymentLinkCopyState] = useState('');
  const [deletingManualId, setDeletingManualId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<Record<string, string>>({
    jobNumber: '',
    jobDate: formatTorontoDateInput(),
    customerName: '',
    customerPhone: '',
    customerExtension: '',
    serviceAddress: '',
    serviceType: MANUAL_SERVICE_TYPES[0],
    jobReceivedTimeSlot: '',
    otherServiceType: '',
    description: '',
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    cardPriceDifferenceRate: String(DEFAULT_CARD_PRICE_DIFFERENCE_RATE * 100),
    customerAcceptedCardPrice: 'no',
    quoteAcceptanceMethod: 'VERBAL',
    quoteAcceptanceEvidence: '',
    cogsAmount: '0.00',
    totalAmountCollected: '',
    taxCollected: 'yes',
    technicianId: '',
    otherTechnicianName: '',
    technicianCommission: '0.00',
  });

  const fetchPeriodComparison = async () => {
    const requestId = ++comparisonRequestId.current;
    setComparisonLoading(true);
    setComparisonError('');
    try {
      const res = await fetch('/api/analytics/period-comparison', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to load period comparison');
      if (requestId === comparisonRequestId.current) setComparisons(data.comparisons as PeriodComparisons);
    } catch (err: any) {
      if (requestId === comparisonRequestId.current) setComparisonError(err.message || 'Unable to load period comparison');
    } finally {
      if (requestId === comparisonRequestId.current) setComparisonLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthAndJobs();
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('addJob') === '1') {
      setShowAddJob(true);
      setJobEntryMode('COMPLETED');
    }
  }, []);

  useEffect(() => {
    if (currentUser?.role !== 'ADMIN' && currentUser?.role !== 'DISPATCHER') return;
    void fetchPeriodComparison();
    return () => { comparisonRequestId.current += 1; };
  }, [currentUser?.role]);

  const fetchAuthAndJobs = async () => {
    try {
      setLoading(true);
      if (currentUser?.role === 'ADMIN' || currentUser?.role === 'DISPATCHER') {
        void fetchPeriodComparison();
      }
      const authRes = await fetch('/api/auth/me');
      const authData = await authRes.json();
      if (authData.success && authData.user) {
        setCurrentUser(authData.user);
      }

      const res = await fetch('/api/jobs');
      const data = await res.json();
      if (data.success) {
        setJobs(data.jobs);
        setErrorMsg('');
      } else {
        setErrorMsg(data.error || 'Unable to load jobs');
      }

      // Fetch only active technicians with their commission rates.
      const usersRes = await fetch('/api/auth/users?role=TECHNICIAN&activeOnly=true');
      const usersData = await usersRes.json();
      if (usersData.success && usersData.users.length > 0) {
        setTechnicians(usersData.users);
        const selectedTech = usersData.users.find((tech: any) => tech.id === technicianId) || usersData.users[0];
        setTechnicianId(selectedTech.id);
        setWorkerCommissionRate(Number(selectedTech.commissionRate || 0).toFixed(2));
        setManualForm((current) => current.technicianId ? current : { ...current, technicianId: selectedTech.id });
      } else {
        setTechnicians([]);
        setTechnicianId('');
        setWorkerCommissionRate('0.00');
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pasteNeedsReview) {
      setPasteError('The pasted message changed after review. Review the updated message or clear it before creating this job.');
      return;
    }
    if (phoneDigitCount(customerPhone) < 7) {
      setErrorMsg('Enter a valid customer phone number with at least 7 digits.');
      setSuccessMsg('');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerExtension,
          serviceAddress,
          serviceType,
          problemDescription,
          technicianId: jobEntryMode === 'ASSIGNED' ? technicianId : null,
          isScheduled,
          scheduledFor: isScheduled && scheduledFor ? torontoDateTimeToIso(scheduledFor) : null,
          vehicleYear: vehicleYear || null,
          vehicleMake: vehicleMake || null,
          vehicleModel: vehicleModel || null,
          vehicleVin: vehicleVin || null,
          keyType: keyType || null,
          fccId: fccId || null,
          ...(pasteReview ? { intakeMessage: dispatchPasteText } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch job');
      }

      setSuccessMsg(jobEntryMode === 'ASSIGNED'
        ? `✅ Job #${data.job.jobNumber} created and assigned. Technician SMS draft is ready for review.`
        : `✅ Job #${data.job.jobNumber} added to the unassigned queue.`);
      setSmsDraft(data.smsDraft || null);
      setSmsWarnings(Array.isArray(data.smsDraftWarnings) ? data.smsDraftWarnings : []);
      setSmsAutoOpen(false);
      // Reset form
      setCustomerName('');
      setCustomerPhone('');
      setCustomerExtension('');
      setServiceAddress('');
      setProblemDescription('');
      setDispatchPasteText('');
      setPasteReview(null);
      setPasteNeedsReview(false);
      setPasteError('');
      setShowAddJob(false);
      setIsScheduled(false);
      setScheduledFor('');
      setVehicleYear('');
      setVehicleMake('');
      setVehicleModel('');
      setVehicleVin('');
      setFccId('');
      fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleParseDispatchPaste = () => {
    setPasteError('');
    if (!dispatchPasteText.trim()) {
      setPasteError('Paste a customer or dispatch message first.');
      return;
    }

    try {
      const parsed = parseDispatchPaste(dispatchPasteText);
      setCustomerName(parsed.customerName || '');
      setCustomerPhone(parsed.customerPhone || '');
      setCustomerExtension(parsed.customerExtension || '');
      setServiceAddress(parsed.serviceAddress || '');
      setServiceType(parsed.serviceType || MANUAL_SERVICE_TYPES[0]);
      const unparsedText = (parsed.unparsedLines || []).join('\n').trim();
      setProblemDescription(parsed.problemDescription?.trim() || '');
      setIsScheduled(Boolean(parsed.isScheduled));
      setScheduledFor(parsed.scheduledFor || '');
      setManualForm((current) => {
        const suggestedServiceType = parsed.serviceType.trim();
        const isKnownServiceType = MANUAL_SERVICE_TYPES.includes(suggestedServiceType as (typeof MANUAL_SERVICE_TYPES)[number]);
        return {
          ...current,
          ...(parsed.customerName ? { customerName: parsed.customerName } : {}),
          ...(parsed.customerPhone ? { customerPhone: parsed.customerPhone } : {}),
          ...(parsed.customerExtension ? { customerExtension: parsed.customerExtension } : {}),
          ...(parsed.serviceAddress ? { serviceAddress: parsed.serviceAddress } : {}),
          ...(suggestedServiceType ? {
            serviceType: isKnownServiceType ? suggestedServiceType : 'Other',
            otherServiceType: isKnownServiceType ? '' : suggestedServiceType,
          } : {}),
          ...(parsed.problemDescription ? { description: parsed.problemDescription.trim() } : {}),
          ...(parsed.jobDate || parsed.scheduledFor ? { jobDate: parsed.jobDate || parsed.scheduledFor.slice(0, 10) } : {}),
        };
      });
      setPasteReview({
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        unparsedText,
        confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0,
      });
      setPasteNeedsReview(false);
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : 'Unable to parse this message.');
      setPasteReview(null);
    }
  };

  const handleAddTechnician = async (e: React.FormEvent) => {
    e.preventDefault();
    const isEditing = Boolean(editingTechnicianId);
    setAddingTechnician(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const payload = {
        ...(isEditing ? { userId: editingTechnicianId } : { role: 'TECHNICIAN' }),
        name: newTechnicianName.trim(),
        phone: newTechnicianPhone.trim(),
        email: newTechnicianEmail.trim() || null,
        commissionRate: Number(newTechnicianCommission),
        ...(newTechnicianPassword ? { password: newTechnicianPassword } : {}),
      };
      const res = await fetch('/api/auth/users', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEditing ? payload : { ...payload, password: newTechnicianPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to add technician');
      }

      setSuccessMsg(`✅ Technician ${data.user.name} ${isEditing ? 'updated' : 'added'} successfully.`);
      setNewTechnicianName('');
      setNewTechnicianPhone('');
      setNewTechnicianEmail('');
      setNewTechnicianPassword('');
      setNewTechnicianCommission('0.00');
      setEditingTechnicianId(null);
      setShowAddTechnician(false);
      fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setAddingTechnician(false);
    }
  };

  const openAddTechnician = () => {
    setEditingTechnicianId(null);
    setNewTechnicianName('');
    setNewTechnicianPhone('');
    setNewTechnicianEmail('');
    setNewTechnicianPassword('');
    setNewTechnicianCommission('0.00');
    setShowAddTechnician(true);
  };

  const openEditTechnician = (technician: any) => {
    setEditingTechnicianId(technician.id);
    setNewTechnicianName(technician.name || '');
    setNewTechnicianPhone(technician.phone || '');
    setNewTechnicianEmail(technician.email || '');
    setNewTechnicianPassword('');
    setNewTechnicianCommission(Number(technician.commissionRate || 0).toFixed(2));
    setShowAddTechnician(true);
  };

  const handleDeleteTechnician = async (technician: any) => {
    if (!window.confirm(`Delete ${technician.name}? They will no longer be available for job assignment, but historical jobs will be preserved.`)) return;

    setDeletingTechnicianId(technician.id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/auth/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: technician.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete technician');
      }

      if (technicianId === technician.id) setTechnicianId('');
      setSuccessMsg(data.revenueEmail?.success === false
        ? `✅ ${data.message} Revenue email failed: ${data.revenueEmail.error || 'check Resend configuration.'}`
        : `✅ ${data.message}`);
      fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setDeletingTechnicianId(null);
    }
  };

  const updateManualField = (field: string, value: string) => {
    const changesQuote = ['totalAmountCollected', 'cardPriceDifferenceRate', 'paymentMethod', 'paymentStatus'].includes(field);
    setManualForm((current) => ({
      ...current,
      [field]: value,
      ...(changesQuote && current[field] !== value
        ? { customerAcceptedCardPrice: 'no', quoteAcceptanceEvidence: '' }
        : {}),
    }));
  };

  const resetManualJob = () => {
    setManualForm({
      jobNumber: '', jobDate: formatTorontoDateInput(), customerName: '', customerPhone: '', customerExtension: '', serviceAddress: '',
      serviceType: MANUAL_SERVICE_TYPES[0], jobReceivedTimeSlot: '', otherServiceType: '', description: '', paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      cardPriceDifferenceRate: String(DEFAULT_CARD_PRICE_DIFFERENCE_RATE * 100),
      customerAcceptedCardPrice: 'no',
      quoteAcceptanceMethod: 'VERBAL',
      quoteAcceptanceEvidence: '',
      cogsAmount: '0.00', totalAmountCollected: '', taxCollected: 'yes', technicianId: technicians[0]?.id || '',
      otherTechnicianName: '',
      technicianCommission: '0.00',
    });
  };

  const openAddJob = () => {
    setEditingManualId(null);
    setErrorMsg('');
    setSuccessMsg('');
    resetManualJob();
    setDispatchPasteText('');
    setPasteReview(null);
    setPasteNeedsReview(false);
    setPasteError('');
    setJobEntryMode('COMPLETED');
    setShowAddJob(true);
  };

  const openEditManualJob = (job: Job) => {
    const knownType = MANUAL_SERVICE_TYPES.includes(job.serviceType as (typeof MANUAL_SERVICE_TYPES)[number]);
    setEditingManualId(job.id);
    setErrorMsg('');
    setSuccessMsg('');
    setManualForm({
      jobNumber: String(job.jobNumber),
      jobDate: formatTorontoDateInput(job.completedAt || job.invoice?.paidAt || job.createdAt),
      customerName: job.customer.name,
      customerPhone: job.customer.phone,
      customerExtension: job.customer.extension || '',
      serviceAddress: job.serviceAddress,
      serviceType: knownType ? job.serviceType : 'Other',
      jobReceivedTimeSlot: job.jobReceivedTimeSlot || '',
      otherServiceType: knownType ? '' : job.serviceType,
      description: job.problemDescription,
      paymentMethod: job.invoice?.paymentMethod || 'CASH',
      paymentStatus: job.invoice?.paymentStatus === 'PENDING' ? 'PENDING' : 'PAID',
      cardPriceDifferenceRate: (job.invoice?.paymentStatus === 'PENDING'
        && isCardPaymentMethod(job.invoice?.paymentMethod || '')
        ? Number(job.invoice?.cardPriceDifferenceRate ?? DEFAULT_CARD_PRICE_DIFFERENCE_RATE) * 100
        : DEFAULT_CARD_PRICE_DIFFERENCE_RATE * 100).toFixed(2),
      customerAcceptedCardPrice: job.invoice?.acceptedPriceOption === 'CARD' ? 'yes' : 'no',
      quoteAcceptanceMethod: job.invoice?.quoteAcceptanceMethod || 'VERBAL',
      quoteAcceptanceEvidence: job.invoice?.quoteAcceptanceEvidence || '',
      cogsAmount: Number(job.invoice?.cogsAmount || 0).toFixed(2),
      totalAmountCollected: Number(job.invoice?.totalAmountCollected || job.invoice?.grandTotal || 0).toFixed(2),
      taxCollected: job.invoice?.taxCollected === false ? 'no' : 'yes',
      technicianId: job.technician?.id || (job.technicianName ? 'OTHER' : ''),
      otherTechnicianName: job.technicianName || '',
      technicianCommission: Number(job.workerCommission || 0).toFixed(2),
    });
    setJobEntryMode('COMPLETED');
    setShowAddJob(true);
  };

  const handleManualJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pasteNeedsReview) {
      setPasteError('The pasted message changed after review. Extract the updated details or clear the paste before saving this job.');
      return;
    }
    const validationError = validateManualForm(manualForm);
    if (validationError) {
      setErrorMsg(validationError);
      setSuccessMsg('');
      return;
    }
    setManualSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const shouldOfferPaymentLink = manualForm.paymentStatus === 'PENDING' && isCardPaymentMethod(manualForm.paymentMethod);
      const res = await fetch(editingManualId ? `/api/jobs/manual/${editingManualId}` : '/api/jobs/manual', {
        method: editingManualId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...manualForm, taxCollected: manualForm.taxCollected === 'yes' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const exactError = typeof data.error === 'string' && data.error.trim()
          ? data.error
          : `Request returned HTTP ${res.status}`;
        throw new Error(exactError);
      }
      setSuccessMsg(`✅ ${data.message}`);
      setShowAddJob(false);
      setEditingManualId(null);
      resetManualJob();
      fetchAuthAndJobs();
      const paymentLinkJobId = data.job?.id || editingManualId;
      if (shouldOfferPaymentLink && paymentLinkJobId) {
        setPaymentLinkUrl(null);
        setPaymentLinkError('');
        setPaymentLinkCopyState('');
        setPaymentLinkPrompt({
          jobId: paymentLinkJobId,
          jobNumber: String(data.job.jobNumber || manualForm.jobNumber),
          customerName: manualForm.customerName,
          customerPhone: manualForm.customerPhone,
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setManualSubmitting(false);
    }
  };

  const copyPaymentLink = async () => {
    if (!paymentLinkUrl) return;
    try {
      await navigator.clipboard.writeText(paymentLinkUrl);
      setPaymentLinkCopyState('Payment link copied.');
    } catch {
      setPaymentLinkCopyState('Copy was unavailable. Select the link and copy it manually.');
    }
  };

  const generatePaymentLinkAndSend = async () => {
    if (!paymentLinkPrompt) return;
    setPaymentLinkGenerating(true);
    setPaymentLinkError('');
    setPaymentLinkCopyState('');
    try {
      const res = await fetch(`/api/jobs/${paymentLinkPrompt.jobId}/payment-link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to generate payment link');

      const paymentUrl = getPaymentLinkUrl(data);
      if (!paymentUrl) throw new Error('Payment link was generated without a usable URL. Retry from the job details page.');
      setPaymentLinkUrl(paymentUrl);

      const responseBody = getPaymentLinkSmsBody(data);
      const body = responseBody
        ? (responseBody.includes(paymentUrl) ? responseBody : `${responseBody}\nPayment link: ${paymentUrl}`)
        : `Payment link for Job #${paymentLinkPrompt.jobNumber}: ${paymentUrl}`;
      let draft: SmsDraft;
      try {
        draft = buildSmsDraft({ to: paymentLinkPrompt.customerPhone, body });
      } catch {
        throw new Error('Payment link generated, but the customer phone number cannot open an SMS draft. Copy the link below and send it manually.');
      }
      setSmsDraft(draft);
      setSmsWarnings([]);
      setSmsAutoOpen(true);
      setPaymentLinkPrompt(null);
      setSuccessMsg(`✅ Payment link generated for Job #${paymentLinkPrompt.jobNumber}. Review the SMS draft and tap Send in Messages.`);
    } catch (error: any) {
      setPaymentLinkError(error.message || 'Unable to generate payment link');
    } finally {
      setPaymentLinkGenerating(false);
    }
  };

  const handleDeleteManualJob = async (job: Job) => {
    if (!window.confirm(`Delete manual Job #${job.jobNumber}? This cannot be undone.`)) return;
    setDeletingManualId(job.id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/jobs/manual/${job.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete manual job');
      setSuccessMsg(`✅ ${data.message}`);
      if (editingManualId === job.id) {
        setShowAddJob(false);
        setEditingManualId(null);
      }
      fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setDeletingManualId(null);
    }
  };

  const handleRemoveDispatchedJob = async (job: Job) => {
    const reason = window.prompt(`Why should Job #${job.jobNumber} be removed? It will be removed from current totals, and an audit copy will be kept.`);
    if (reason === null) return;
    if (reason.trim().length < 8) {
      setErrorMsg('Enter a removal reason of at least 8 characters.');
      return;
    }
    if (!window.confirm(`Remove Job #${job.jobNumber} for ${job.customer.name}? This removes its invoice from current operational and Books totals and cannot be undone in the app.`)) return;

    setDeletingJobId(job.id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), expectedUpdatedAt: job.updatedAt }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to remove job');
      setSuccessMsg(`✅ ${data.message}`);
      await fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message || 'Unable to remove job');
    } finally {
      setDeletingJobId(null);
    }
  };

  const filteredJobs = jobs.filter((j) => {
    const matchesFilter = filter === 'ALL'
      || (filter === 'ACTIVE' && ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(j.status) && !j.isScheduled)
      || (filter === 'SCHEDULED' && !!j.isScheduled)
      || (filter === 'COMPLETED' && j.status === 'COMPLETED')
      || (filter === 'ABANDONED' && j.status === 'ABANDONED_TRAVEL_FEE')
      || j.status === filter;
    if (!matchesFilter) return false;
    const query = jobSearch.trim().toLocaleLowerCase().replace(/^#\s*/, '');
    if (!query) return true;
    const phoneQuery = query.replace(/\D/g, '');
    return [j.jobNumber, j.customer.name, j.customer.phone, j.serviceAddress]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query))
      || (phoneQuery.length >= 4 && j.customer.phone.replace(/\D/g, '').includes(phoneQuery));
  });
  const activeJobs = jobs.filter((job) => ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(job.status) && !job.isScheduled);
  const scheduledJobs = jobs.filter((job) =>
    job.isScheduled
    && ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(job.status)
    && job.scheduledFor
    && new Date(job.scheduledFor).getTime() > Date.now()
  );
  const unassignedJobs = activeJobs.filter((job) => !job.technician?.id && !job.technicianName);
  const paymentAttentionJobs = jobs.filter((job) => job.invoice?.paymentStatus === 'PENDING');
  const canManageManualJobs = currentUser?.role === 'ADMIN' || currentUser?.role === 'DISPATCHER';
  const canManageTechnicians = currentUser?.role === 'ADMIN' || currentUser?.role === 'DISPATCHER';
  const financialSummary = useMemo(() => {
    const summary = {
      totalGrossRevenue: 0,
      totalCashRevenue: 0,
      totalInteracRevenue: 0,
      totalCardRevenue: 0,
      totalTaxHST: 0,
      totalCommissionsEarned: 0,
      totalPartsCost: 0,
    };

    for (const job of jobs) {
      const invoice = job.invoice;
      if (!invoice || invoice.paymentStatus !== 'PAID') continue;
      if (!isInRevenuePeriod(job, revenuePeriod)) continue;

      const grossTotal = Number(invoice.grandTotal || 0);
      const isOnBooks = invoice.taxCollected !== false;
      const cogsAmount = Number(invoice.cogsAmount || 0);
      const itemPartsCost = (job.items || []).reduce(
        (sum, item) => sum + (item.isPart ? Number(item.unitCost || 0) * Number(item.quantity || 1) : 0),
        0
      );

      summary.totalGrossRevenue += grossTotal;
      if (isOnBooks) summary.totalTaxHST += Number(invoice.taxAmount || 0);
      summary.totalCommissionsEarned += Number(job.workerCommission || 0);
      summary.totalPartsCost += cogsAmount > 0 ? cogsAmount : itemPartsCost;

      if (invoice.paymentMethod === 'CASH') {
        summary.totalCashRevenue += grossTotal;
      } else if (invoice.paymentMethod === 'INTERAC') {
        summary.totalInteracRevenue += grossTotal;
      } else if (['STRIPE_CARD', 'DEBIT_CARD', 'CREDIT_CARD'].includes(invoice.paymentMethod)) {
        summary.totalCardRevenue += grossTotal;
      }
    }

    return {
      totalGrossRevenue: roundToTwo(summary.totalGrossRevenue),
      totalCashRevenue: roundToTwo(summary.totalCashRevenue),
      totalInteracRevenue: roundToTwo(summary.totalInteracRevenue),
      totalCardRevenue: roundToTwo(summary.totalCardRevenue),
      totalTaxHST: roundToTwo(summary.totalTaxHST),
      totalPartsCost: roundToTwo(summary.totalPartsCost),
      totalCommissionsEarned: roundToTwo(summary.totalCommissionsEarned),
      netCompanyProfit: roundToTwo(
        summary.totalGrossRevenue - summary.totalTaxHST - summary.totalCommissionsEarned - summary.totalPartsCost
      ),
    };
  }, [jobs, revenuePeriod]);

  const pastePrefillPanel = (
          <section className="mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-3" aria-label="Prefill job details">
            <label htmlFor="dispatch-paste-message" className="block text-xs font-extrabold text-slate-800">Paste to prefill job details</label>
            <p className="mt-1 text-[11px] text-slate-600">Paste a customer, WhatsApp, or partner message to prefill the form. Review every suggested field before saving.</p>
            <textarea
              id="dispatch-paste-message"
              value={dispatchPasteText}
              maxLength={10_000}
              onChange={(event) => {
                setDispatchPasteText(event.target.value);
                if (pasteReview) setPasteNeedsReview(true);
                setPasteError('');
              }}
              rows={3}
              placeholder="Paste a WhatsApp, SMS, email, or call note…"
              className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleParseDispatchPaste} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white hover:bg-blue-800">Extract details</button>
                {(dispatchPasteText || pasteNeedsReview) && (
                  <button
                    type="button"
                    onClick={() => {
                      setDispatchPasteText('');
                      setPasteReview(null);
                      setPasteNeedsReview(false);
                      setPasteError('');
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                  >Clear paste</button>
                )}
              </div>
              {pasteReview && !pasteNeedsReview && <span className="text-[11px] font-bold text-emerald-700">Reviewed · check every field below</span>}
            </div>
            {pasteNeedsReview && (
              <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] font-semibold text-rose-800">
                The source changed after parsing. Review the updated message before creating the job, or clear the paste to continue with the current form values.
              </p>
            )}
            {dispatchPasteText && <p className="mt-1 text-right text-[10px] text-slate-500">{dispatchPasteText.length.toLocaleString()} / 10,000 characters</p>}
            {pasteError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{pasteError}</p>}
            {pasteReview && (
              <div className={`mt-3 rounded-lg border p-3 ${pasteNeedsReview ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`} aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-amber-900">{pasteNeedsReview ? 'Previous parse · stale' : 'Review the suggested details'}</div>
                  <span className="text-[10px] font-semibold text-amber-800">Extracted-field confidence: {Math.round(pasteReview.confidence * 100)}%</span>
                </div>
                {pasteReview.warnings.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-900">
                    {pasteReview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] text-amber-900">Check names, contact details, address, service, and timing before submitting.</p>
                )}
                {pasteReview.unparsedText && (
                  <p className="mt-2 text-[11px] text-slate-700">Some message text could not be placed automatically. Review it and add relevant details to the job description.</p>
                )}
              </div>
            )}
          </section>
  );

  const pendingCardQuote = manualForm.paymentStatus === 'PENDING' && isCardPaymentMethod(manualForm.paymentMethod);
  const enteredNonCardPrice = Number(manualForm.totalAmountCollected);
  const enteredCardDifference = Number(manualForm.cardPriceDifferenceRate) / 100;
  const manualDualPriceQuote = pendingCardQuote && Number.isFinite(enteredNonCardPrice) && enteredNonCardPrice > 0
    && Number.isFinite(enteredCardDifference) && enteredCardDifference >= 0 && enteredCardDifference <= MAX_CARD_PRICE_DIFFERENCE_RATE
    ? calculateDualPriceManualCardQuote({ nonCardPrice: enteredNonCardPrice, cardPriceDifferenceRate: enteredCardDifference })
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <span>📞</span> Dispatch Desk
            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            </span>
          </h1>
          <p className="text-sm text-slate-600">
            Log incoming customer calls, assign technician commissions, and dispatch active jobs.
          </p>
        </div>
        {currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'DISPATCHER') && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openAddTechnician}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold shadow-md transition"
            >
              + Add Technician
            </button>
            <button
              type="button"
              onClick={openAddJob}
              className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-extrabold shadow-md transition"
            >
              + Add Job
            </button>
          </div>
        )}
      </div>

      {canManageManualJobs && (
        <section aria-label="Dispatch status" className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Active jobs', value: activeJobs.length, detail: 'Open jobs not marked scheduled', tone: 'blue' },
            { label: 'Scheduled', value: scheduledJobs.length, detail: 'Upcoming appointments', tone: 'violet' },
            { label: 'Unassigned', value: unassignedJobs.length, detail: 'Active jobs without a tech', tone: 'amber' },
            { label: 'Payment follow-up', value: paymentAttentionJobs.length, detail: 'Invoices still pending', tone: 'rose' },
          ].map((card) => (
            <div key={card.label} className={`rounded-2xl border bg-white px-4 py-3 shadow-sm ${
              card.tone === 'blue' ? 'border-blue-200' : card.tone === 'violet' ? 'border-violet-200' : card.tone === 'amber' ? 'border-amber-200' : 'border-rose-200'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{card.label}</span>
                <span className={`text-2xl font-black ${
                  card.tone === 'blue' ? 'text-blue-700' : card.tone === 'violet' ? 'text-violet-700' : card.tone === 'amber' ? 'text-amber-700' : 'text-rose-700'
                }`}>{card.value}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{card.detail}</p>
            </div>
          ))}
        </section>
      )}

      {canManageManualJobs && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor="dispatch-revenue-period" className="text-sm font-bold text-slate-700">Financial period</label>
          <select
            id="dispatch-revenue-period"
            value={revenuePeriod}
            onChange={(event) => setRevenuePeriod(event.target.value as RevenuePeriod)}
            className="w-full sm:w-auto rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            {REVENUE_PERIOD_OPTIONS.map((period) => (
              <option key={period} value={period}>{REVENUE_PERIOD_LABELS[period]}</option>
            ))}
          </select>
        </div>
      )}

      {canManageManualJobs && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 mb-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Gross Revenue</div>
            <div className="text-2xl font-black text-slate-900">${financialSummary.totalGrossRevenue.toFixed(2)}</div>
            <div className="mt-2 text-[11px] text-slate-500 space-y-0.5">
              <div className="flex justify-between"><span>💵 Cash:</span><span className="font-semibold text-slate-700">${financialSummary.totalCashRevenue.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>💳 Card:</span><span className="font-semibold text-slate-700">${financialSummary.totalCardRevenue.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>🏦 Interac:</span><span className="font-semibold text-slate-700">${financialSummary.totalInteracRevenue.toFixed(2)}</span></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1 flex items-center justify-between gap-2">
              <span>Sales Tax (13%)</span>
              <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">CRA Remittance</span>
            </div>
            <div className="text-2xl font-black text-amber-700">${financialSummary.totalTaxHST.toFixed(2)}</div>
            <p className="mt-2 text-[11px] text-slate-500 leading-tight">On-books HST extracted from tax-inclusive payments.</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="text-xs font-bold text-rose-600 uppercase tracking-wider mb-1 flex items-center justify-between gap-2">
              <span>Hardware COGS</span>
              <span className="text-[10px] bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-bold">Parts Cost</span>
            </div>
            <div className="text-2xl font-black text-rose-700">${financialSummary.totalPartsCost.toFixed(2)}</div>
            <p className="mt-2 text-[11px] text-slate-500 leading-tight">Wholesale hardware costs deducted from company margin.</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Tech Commissions</div>
            <div className="text-2xl font-black text-blue-700">${financialSummary.totalCommissionsEarned.toFixed(2)}</div>
            <p className="mt-2 text-[11px] text-slate-500 leading-tight">Total commission allocated to workers.</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm col-span-2 lg:col-span-1">
            <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">Net Company Profit</div>
            <div className="text-2xl font-black text-emerald-700">${financialSummary.netCompanyProfit.toFixed(2)}</div>
            <p className="mt-2 text-[11px] text-slate-500 leading-tight">Gross revenue less HST, contractor payouts, and wholesale parts.</p>
          </div>
        </div>
      )}

      {canManageManualJobs && <RingCentralCallAnalytics canManageConnection={currentUser?.role === 'ADMIN'} refreshOnLoad />}

      {canManageManualJobs && (
        <PeriodComparisonWidget mode={comparisonMode} onModeChange={setComparisonMode} comparison={comparisons?.[comparisonMode] || null} loading={comparisonLoading} error={comparisonError} />
      )}

      {currentUser && currentUser.role === 'TECHNICIAN' && (
        <div className="mb-6 p-4 rounded-2xl bg-blue-50 border-2 border-blue-200 text-blue-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
            <span className="text-lg">ℹ️</span>
            <span>
              Technician Notice: You are authenticated as <strong>{currentUser.name} (Field Technician)</strong>. Jobs are dispatched by Operators.
            </span>
          </div>
          <Link
            href="/tech"
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shrink-0 shadow-xs"
          >
            Go to My Field Jobs &rarr;
          </Link>
        </div>
      )}

      {canManageTechnicians && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">Technician Roster</h2>
              <p className="text-xs text-slate-500 mt-0.5">Edit technician details or remove a technician from future assignments.</p>
            </div>
            <span className="text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              {technicians.length} active
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {technicians.length === 0 ? (
              <div className="py-8 px-5 text-center text-slate-500 text-sm">No active technicians found.</div>
            ) : (
              technicians.map((technician) => (
                <div key={technician.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-extrabold text-sm text-slate-900">{technician.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {technician.phone}{technician.email ? ` · ${technician.email}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-slate-600">{Number(technician.commissionRate || 0).toFixed(2)}%</span>
                    <button
                      type="button"
                      onClick={() => openEditTechnician(technician)}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-xs"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={deletingTechnicianId === technician.id}
                      onClick={() => handleDeleteTechnician(technician)}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold text-xs disabled:opacity-50"
                    >
                      {deletingTechnicianId === technician.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showAddTechnician && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <span>🛠️</span> {editingTechnicianId ? 'Edit Technician' : 'Add Technician'}
              </h2>
              <button
                type="button"
                onClick={() => setShowAddTechnician(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-black"
                aria-label="Close add technician form"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {editingTechnicianId
                ? 'Update this technician’s account details and assignment commission.'
                : 'Create an active field technician account for job assignment.'}
            </p>

            <form onSubmit={handleAddTechnician} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newTechnicianName}
                  onChange={(e) => setNewTechnicianName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number *</label>
                <input
                  type="text"
                  required
                  value={newTechnicianPhone}
                  onChange={(e) => setNewTechnicianPhone(e.target.value)}
                  placeholder="e.g. 647-555-0303"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email Address <span className="text-slate-400 font-normal">(Optional)</span></label>
                <input
                  type="email"
                  value={newTechnicianEmail}
                  onChange={(e) => setNewTechnicianEmail(e.target.value)}
                  placeholder="e.g. technician@example.com"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {editingTechnicianId ? 'New Password (Optional)' : 'Initial Password *'}
                </label>
                <input
                  type="password"
                  required={!editingTechnicianId}
                  minLength={8}
                  value={newTechnicianPassword}
                  onChange={(e) => setNewTechnicianPassword(e.target.value)}
                  placeholder={editingTechnicianId ? 'Leave blank to keep current password' : 'At least 8 characters'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Initial Commission Rate (%) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  max="100"
                  step="0.01"
                  value={newTechnicianCommission}
                  onChange={(e) => setNewTechnicianCommission(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddTechnician(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingTechnician}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow transition disabled:opacity-50"
                >
                  {addingTechnician ? 'Saving...' : editingTechnicianId ? 'Save Changes' : 'Add Technician'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {showAddJob && jobEntryMode !== 'COMPLETED' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="add-job-title" className="w-full max-w-3xl max-h-[94vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 id="add-job-title" className="text-lg font-black text-slate-900">Add Job</h2>
              <p className="text-xs text-slate-500 mt-1">Choose where this job is in the workflow, then enter its details.</p>
            </div>
            <button type="button" onClick={() => setShowAddJob(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800" aria-label="Close Add Job">×</button>
          </div>
          {pastePrefillPanel}
          <div className="grid grid-cols-3 gap-2 mb-4" role="group" aria-label="Job stage">
            {([
              { value: 'NEW', title: 'New call', detail: 'Add to the queue' },
              { value: 'ASSIGNED', title: 'Assigned', detail: 'Choose a technician' },
              { value: 'COMPLETED', title: 'Completed', detail: 'Record closeout' },
            ] as const).map((option) => (
              <button key={option.value} type="button" onClick={() => setJobEntryMode(option.value)} className={`rounded-xl border p-2.5 text-left transition ${jobEntryMode === option.value ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <span className="block text-xs font-extrabold text-slate-900">{option.title}</span>
                <span className="block text-[10px] text-slate-500 mt-0.5">{option.detail}</span>
              </button>
            ))}
          </div>
          <h2 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center justify-between">
            <span>{jobEntryMode === 'ASSIGNED' ? 'Assigned job details' : 'New job details'}</span>
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              &lt; 30 sec entry
            </span>
          </h2>


          {successMsg && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
              {successMsg}
            </div>
          )}

          {errorMsg && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleQuickIntake} className="space-y-3.5 text-sm">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Customer / Business Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Ativan / John Doe"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phone Number *
                </label>
                <input
                  type="text"
                  required
                  inputMode="tel"
                  minLength={7}
                  maxLength={25}
                  pattern={PHONE_INPUT_PATTERN}
                  title="Enter a phone number containing at least 7 digits."
                  placeholder="(647) 951-0901"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(sanitizePhoneInput(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900"
                />
                <p className="mt-1 text-[10px] text-slate-500">Use at least 7 digits; letters are removed automatically.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Extension
                </label>
                <input
                  type="text"
                  placeholder="#762"
                  value={customerExtension}
                  onChange={(e) => setCustomerExtension(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Service Location / Address *
              </label>
              <AddressAutocomplete
                required
                placeholder="e.g. 663 Bloor Street West, Toronto, ON M6G 1L1"
                value={serviceAddress}
                onChange={setServiceAddress}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900"
              />
            </div>

            {/* Dispatch Mode: Immediate vs Scheduled */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                Dispatch Mode *
              </label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setIsScheduled(false)}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition ${
                    !isScheduled
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  ⚡ Immediate Emergency
                </button>
                <button
                  type="button"
                  onClick={() => setIsScheduled(true)}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition ${
                    isScheduled
                      ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  📅 Scheduled Booking
                </button>
              </div>

              {isScheduled && (
                <div>
                  <label className="block text-[11px] font-bold text-purple-900 mb-1">
                    Select Appointment Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    required={isScheduled}
                    value={scheduledFor}
                    onChange={(e) => setScheduledFor(e.target.value)}
                    className="w-full px-3 py-1.5 border border-purple-300 rounded-lg text-xs bg-white text-slate-900 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Service Category *
              </label>
              <select
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900 bg-white"
              >
                {!MANUAL_SERVICE_TYPES.includes(serviceType as (typeof MANUAL_SERVICE_TYPES)[number]) && (
                  <option value={serviceType}>{serviceType}</option>
                )}
                <option value="Commercial Lock Change">Commercial Lock Change</option>
                <option value="Storefront Mortise Cylinder">Storefront Mortise Cylinder</option>
                <option value="Residential Lockout">Residential Lockout</option>
                <option value="Deadbolt Installation">Deadbolt Installation</option>
                <option value="Rekey Master Key System">Rekey Master Key System</option>
                <option value="Automotive Lockout / Key Generation">Automotive Lockout / Key Generation</option>
                <option value="Car Lockout">Car Lockout</option>
                <option value="Safe Opening">Safe Opening</option>
              </select>
            </div>

            {/* Automotive Specs Suite (Shown when service involves automotive) */}
            {(serviceType.includes('Car') || serviceType.includes('Auto')) && (
              <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200 space-y-2">
                <div className="text-xs font-black text-amber-900 flex items-center gap-1">
                  <span>🚗</span> Automotive Specs & Programming
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-amber-800 mb-0.5">Year</label>
                    <input
                      type="text"
                      placeholder="e.g. 2021"
                      value={vehicleYear}
                      onChange={(e) => setVehicleYear(e.target.value)}
                      className="w-full px-2 py-1 border border-amber-300 rounded-lg text-xs text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-amber-800 mb-0.5">Make</label>
                    <input
                      type="text"
                      placeholder="e.g. Honda"
                      value={vehicleMake}
                      onChange={(e) => setVehicleMake(e.target.value)}
                      className="w-full px-2 py-1 border border-amber-300 rounded-lg text-xs text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-amber-800 mb-0.5">Model</label>
                    <input
                      type="text"
                      placeholder="e.g. Civic"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      className="w-full px-2 py-1 border border-amber-300 rounded-lg text-xs text-slate-900 bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-amber-800 mb-0.5">Key / Fob Type</label>
                    <select
                      value={keyType}
                      onChange={(e) => setKeyType(e.target.value)}
                      className="w-full px-2 py-1 border border-amber-300 rounded-lg text-xs text-slate-900 bg-white"
                    >
                      <option value="Transponder Chip Key">Transponder Chip Key</option>
                      <option value="Proximity Smart Key (Push-to-Start)">Proximity Smart Key (Push-to-Start)</option>
                      <option value="Laser Cut High-Security Key">Laser Cut High-Security Key</option>
                      <option value="Standard Mechanical Metal Key">Standard Mechanical Metal Key</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-amber-800 mb-0.5">VIN (Optional)</label>
                    <input
                      type="text"
                      placeholder="17-digit VIN"
                      value={vehicleVin}
                      onChange={(e) => setVehicleVin(e.target.value.toUpperCase())}
                      className="w-full px-2 py-1 border border-amber-300 rounded-lg text-xs font-mono text-slate-900 bg-white"
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Problem Description / Job Notes
              </label>
              <textarea
                rows={2}
                placeholder="Need replaced lock cylinder on the glass door at the bottom..."
                value={problemDescription}
                onChange={(e) => setProblemDescription(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900"
              />
            </div>

            {jobEntryMode === 'ASSIGNED' && <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Technician Commission Rate (%)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400 font-bold">%</span>
                    <input
                      type="text"
                      readOnly
                      value={workerCommissionRate ? `${workerCommissionRate}%` : 'Select a technician'}
                      className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded-lg font-bold text-slate-900 bg-slate-100 focus:outline-none"
                    />
                </div>
                <span className="text-[10px] text-slate-500">Percentage of the completed job total</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Assign Technician *
                </label>
                <select
                  value={technicianId}
                  required
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    setTechnicianId(selectedId);
                    const found = technicians.find((t) => t.id === selectedId);
                    if (found && found.commissionRate !== undefined) {
                      setWorkerCommissionRate(Number(found.commissionRate).toFixed(2));
                    }
                  }}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({Number(t.commissionRate || 0).toFixed(2)}%)
                    </option>
                  ))}
                  {technicians.length === 0 && <option value="">No active technicians available</option>}
                </select>
              </div>
            </div>}

            <button
              type="submit"
              disabled={submitting || pasteNeedsReview}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : pasteNeedsReview ? 'Review paste to continue' : isScheduled ? '📅 Schedule & Assign Job' : jobEntryMode === 'ASSIGNED' ? 'Assign Job' : 'Add to New Jobs'}
            </button>
          </form>
        </div>
        </div>
        )}

        {/* Right Column: Active Dispatch Board / Jobs Queue */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>Jobs</span>
              <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                {jobs.length} Total
              </span>
            </h2>

            <div className="flex items-center rounded-lg bg-slate-100 p-1 text-xs" role="group" aria-label="Jobs view">
              {(['TABLE', 'BOARD'] as const).map((view) => (
                <button key={view} type="button" onClick={() => setJobsView(view)} aria-pressed={jobsView === view} className={`rounded-md px-2.5 py-1.5 font-bold transition ${jobsView === view ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {view === 'TABLE' ? 'Table' : 'Board'}
                </button>
              ))}
            </div>

            {/* Status filters */}
            <div className="flex items-center gap-1 text-xs">
              {(['ALL', 'ACTIVE', 'SCHEDULED', 'COMPLETED', 'ABANDONED'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    filter === f
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f === 'ACTIVE' ? '⚡ Emergency' : f === 'SCHEDULED' ? '📅 Scheduled' : f}
                </button>
              ))}
            </div>
          </div>

          <label htmlFor="dispatch-job-search" className="sr-only">Search jobs by number, customer, phone, or address</label>
          <div className="relative mb-3">
            <span aria-hidden="true" className="absolute left-3 top-2.5 text-slate-400">⌕</span>
            <input
              id="dispatch-job-search"
              type="search"
              value={jobSearch}
              onChange={(event) => setJobSearch(event.target.value)}
              placeholder="Search job number, customer, phone, or address"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center py-12 text-slate-400 text-sm">
              Loading jobs...
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-slate-400 text-sm">
              <span>{jobSearch.trim() ? 'No jobs match your search.' : `No jobs found for filter: ${filter}`}</span>
            </div>
          ) : (
            jobsView === 'TABLE' ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1220px] text-left text-xs">
                  <thead><tr className="border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Job</th><th className="py-2.5 px-3">Date / Received</th><th className="py-2.5 px-3">Customer / Address</th><th className="py-2.5 px-3">Service</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-3">Technician</th><th className="py-2.5 px-3">Payment</th><th className="py-2.5 px-3">Total</th><th className="py-2.5 px-3">COGS</th><th className="py-2.5 px-3">HST</th><th className="py-2.5 px-3">Tax status</th><th className="py-2.5 px-3 text-right">Actions</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredJobs.map((job) => (
                      <tr key={job.id} className="align-top hover:bg-slate-50/80">
                        <td className="py-3 px-3 font-black text-slate-900">#{job.jobNumber}{job.isManual && <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] text-violet-800">Manual</span>}</td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-600">{formatTorontoDateInput(job.completedAt || job.scheduledFor || job.createdAt) || '—'}{job.jobReceivedTimeSlot && <div className="mt-1 text-[10px]">{job.jobReceivedTimeSlot}</div>}</td>
                        <td className="py-3 px-3"><div className="font-bold text-slate-800">{job.customer.name}</div><div className="text-[10px] text-slate-500">{job.customer.phone}</div><div className="mt-1 max-w-[240px] truncate text-[10px] text-slate-500" title={job.serviceAddress}>{job.serviceAddress}</div></td>
                        <td className="py-3 px-3 text-slate-700">{job.serviceType}</td>
                        <td className="py-3 px-3"><span className="rounded-md bg-slate-100 px-2 py-1 font-bold text-slate-700">{job.status.replaceAll('_', ' ')}</span>{job.isScheduled && <div className="mt-1 text-[10px] text-violet-700">Scheduled</div>}</td>
                        <td className="py-3 px-3 text-slate-700">{job.technician?.name || job.technicianName || 'Unassigned'}</td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-700">{job.invoice ? <><div className="font-bold">{(job.invoice.paymentMethod || '—').replaceAll('_', ' ')}</div><div className="text-[10px]">{job.invoice.paymentStatus}</div></> : '—'}</td>
                        <td className="py-3 px-3 whitespace-nowrap font-bold text-slate-800">{job.invoice ? `$${Number(job.invoice.totalAmountCollected || job.invoice.grandTotal || 0).toFixed(2)}` : '—'}</td>
                        <td className="py-3 px-3 whitespace-nowrap text-slate-700">{job.invoice ? `$${Number(job.invoice.cogsAmount || 0).toFixed(2)}` : '—'}</td>
                        <td className="py-3 px-3 whitespace-nowrap text-amber-700">{job.invoice ? `$${Number(job.invoice.taxAmount || 0).toFixed(2)}` : '—'}</td>
                        <td className="py-3 px-3 whitespace-nowrap">{job.invoice ? <span className={job.invoice.taxCollected === false ? 'font-bold text-rose-700' : 'font-bold text-emerald-700'}>{job.invoice.taxCollected === false ? 'Off books' : 'On books'}</span> : '—'}</td>
                        <td className="py-3 px-3 text-right whitespace-nowrap"><Link href={`/dispatch/jobs/${job.id}`} className="rounded-lg bg-blue-50 px-2.5 py-1.5 font-bold text-blue-700 hover:bg-blue-100">View</Link>{job.status === 'COMPLETED' && <Link href={`/dispatch/jobs/${job.id}/receipt`} className="ml-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 font-bold text-emerald-700 hover:bg-emerald-100" aria-label={`Open receipt preview for job ${job.jobNumber}`}>Receipt</Link>}{job.isManual && <><button type="button" onClick={() => openEditManualJob(job)} className="ml-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-200">Edit</button><button type="button" disabled={deletingManualId === job.id} onClick={() => handleDeleteManualJob(job)} className="ml-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50">Delete</button></>}{currentUser?.role === 'ADMIN' && !job.isManual && <button type="button" disabled={deletingJobId === job.id} onClick={() => handleRemoveDispatchedJob(job)} className="ml-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50">{deletingJobId === job.id ? 'Removing…' : 'Remove'}</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
            <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1">
              {filteredJobs.map((job) => {
                const isPaid = job.invoice?.paymentStatus === 'PAID';
                const statusColor =
                  job.status === 'COMPLETED'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : job.status === 'ABANDONED_TRAVEL_FEE'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : job.status === 'ON_SITE'
                    ? 'bg-indigo-100 text-indigo-800 border-indigo-300'
                    : 'bg-blue-100 text-blue-800 border-blue-300';

                return (
                  <div
                    key={job.id}
                    className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-white transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-sm text-slate-900">
                          #{job.jobNumber}
                        </span>
                        <span className="font-semibold text-sm text-slate-800">
                          {job.customer.name}
                        </span>
                        {job.isManual && (
                          <span className="text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-md border bg-violet-100 text-violet-800 border-violet-300">
                            Manual
                          </span>
                        )}
                        {job.invoice?.taxCollected === false && (
                          <span className="text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-md border bg-rose-100 text-rose-800 border-rose-300">
                            Off Books
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          ({job.customer.phone}
                          {job.customer.extension ? ` #${job.customer.extension}` : ''})
                        </span>
                        <span
                          className={`text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-md border ${statusColor}`}
                        >
                          {job.status.replace('_', ' ')}
                        </span>
                        {job.isScheduled && job.scheduledFor && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-300">
                            📅 {new Date(job.scheduledFor).toLocaleDateString()} {new Date(job.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {job.vehicleMake && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300">
                            🚗 {job.vehicleYear || ''} {job.vehicleMake} {job.vehicleModel || ''}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-600 flex items-center gap-1.5">
                        <span className="text-slate-400">📍</span>
                        <span className="line-clamp-1">{job.serviceAddress}</span>
                      </div>

                      <div className="text-xs text-slate-500 italic line-clamp-1">
                        "{job.problemDescription || job.serviceType}"
                      </div>

                      <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500 pt-1">
                        <span>
                          Tech:{' '}
                          <strong className="text-slate-700">
                            {job.technician?.name || job.technicianName || 'Unassigned'}
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          Commission:{' '}
                          <strong className="text-emerald-700">
                            {job.workerCommissionRate.toFixed(2)}%
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Right Action / Billing Pill */}
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                      {job.invoice ? (
                        <div className="text-right">
                          <div className="font-extrabold text-sm text-slate-900">
                            ${job.invoice.grandTotal.toFixed(2)}
                          </div>
                          <div className="text-[10px] font-semibold text-slate-500 uppercase">
                            {job.invoice.paymentMethod?.replace('_', ' ')} •{' '}
                            <span
                              className={
                                isPaid ? 'text-emerald-600' : 'text-amber-600'
                              }
                            >
                              {job.invoice.paymentStatus}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">
                          Awaiting Tech
                        </span>
                      )}

                      <Link
                        href={`/dispatch/jobs/${job.id}`}
                        className="px-3 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-black transition"
                      >
                        View / Edit
                      </Link>
                      {currentUser?.role === 'ADMIN' && !job.isManual && <button type="button" disabled={deletingJobId === job.id} onClick={() => handleRemoveDispatchedJob(job)} className="px-3 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-black disabled:opacity-50">{deletingJobId === job.id ? 'Removing…' : 'Remove'}</button>}
                      {job.status === 'COMPLETED' && <Link href={`/dispatch/jobs/${job.id}/receipt`} className="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 hover:bg-emerald-100" aria-label={`Open receipt preview for job ${job.jobNumber}`}>Receipt</Link>}
                      {job.status === 'COMPLETED' && job.receiptState && !['local_ready', 'stripe_ready', 'stripe_partial_refund'].includes(job.receiptState) && <span className="text-[10px] text-slate-500">{job.receiptState === 'payment_pending' ? 'Receipt unavailable: payment pending' : job.receiptState === 'off_books' ? 'Receipt unavailable: off books' : job.receiptState === 'provider_missing' ? 'Receipt unavailable: payment provider not verified' : job.receiptState === 'refunded' ? 'Receipt unavailable: refunded' : ''}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            )
          )}
        </div>
      </div>

      {showAddJob && jobEntryMode === 'COMPLETED' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="manual-job-title" className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl border border-slate-200">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 id="manual-job-title" className="text-xl font-black text-slate-900">{editingManualId ? 'Edit Completed Job' : 'Add Job · Completed'}</h2>
                <p className="text-xs text-slate-500 mt-1">{editingManualId ? 'Update this completed job entry.' : 'Record job details, payment, parts cost, and technician closeout.'}</p>
              </div>
              <button type="button" onClick={() => setShowAddJob(false)} className="text-slate-400 hover:text-slate-900 text-xl" aria-label="Close">×</button>
            </div>
            {pastePrefillPanel}
            {!editingManualId && <div className="grid grid-cols-3 gap-2 mb-4" role="group" aria-label="Job stage">
              {([
                { value: 'NEW', title: 'New call', detail: 'Add to the queue' },
                { value: 'ASSIGNED', title: 'Assigned', detail: 'Choose a technician' },
                { value: 'COMPLETED', title: 'Completed', detail: 'Record closeout' },
              ] as const).map((option) => <button key={option.value} type="button" onClick={() => setJobEntryMode(option.value)} className={`rounded-xl border p-2.5 text-left transition ${jobEntryMode === option.value ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <span className="block text-xs font-extrabold text-slate-900">{option.title}</span><span className="block text-[10px] text-slate-500 mt-0.5">{option.detail}</span>
              </button>)}
            </div>}
            {errorMsg && (
              <div role="alert" className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium break-words">
                {errorMsg}
              </div>
            )}
            <form onSubmit={handleManualJob} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
              <div>
                <label className="field-label">Job number *</label>
                <input aria-label="Job number" required type="text" inputMode="numeric" pattern="[0-9]+" title="Enter a positive whole-number job number." value={manualForm.jobNumber} onChange={(e) => updateManualField('jobNumber', e.target.value.replace(/\D/g, ''))} className="field-input" />
              </div>
              <div>
                <label className="field-label">Job date *</label>
                <input aria-label="Job date" required type="date" value={manualForm.jobDate} onChange={(e) => updateManualField('jobDate', e.target.value)} className="field-input" />
                <p className="mt-1 text-[10px] text-slate-500">Stored at 12:00 AM Toronto time.</p>
              </div>
              <div>
                <label className="field-label">Customer name *</label>
                <input aria-label="Customer name" required value={manualForm.customerName} onChange={(e) => updateManualField('customerName', e.target.value)} className="field-input" />
              </div>
              <div>
                <label className="field-label">Job received time</label>
                <select aria-label="Job received time" value={manualForm.jobReceivedTimeSlot} onChange={(e) => updateManualField('jobReceivedTimeSlot', e.target.value)} className="field-input bg-white">
                  <option value="">Not recorded</option>
                  {MANUAL_JOB_RECEIVED_TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Customer phone number *</label>
                <input aria-label="Customer phone number" required type="tel" inputMode="tel" minLength={7} maxLength={25} pattern={PHONE_INPUT_PATTERN} title="Enter a phone number containing at least 7 digits." value={manualForm.customerPhone} onChange={(e) => updateManualField('customerPhone', sanitizePhoneInput(e.target.value))} className="field-input" />
                <p className="mt-1 text-[10px] text-slate-500">Use at least 7 digits; letters are removed automatically.</p>
              </div>
              <div>
                <label className="field-label">Extension (optional)</label>
                <input aria-label="Customer phone extension" value={manualForm.customerExtension} onChange={(e) => updateManualField('customerExtension', e.target.value)} className="field-input" />
              </div>
              <div className="sm:col-span-2">
                <label className="field-label">Service address *</label>
                <AddressAutocomplete aria-label="Service address" required value={manualForm.serviceAddress} onChange={(value) => updateManualField('serviceAddress', value)} className="field-input" />
              </div>
              <div>
                <label className="field-label">Type of job *</label>
                <select aria-label="Type of job" value={manualForm.serviceType} onChange={(e) => updateManualField('serviceType', e.target.value)} className="field-input bg-white">
                  {MANUAL_SERVICE_TYPES.map((type) => <option key={type}>{type}</option>)}
                  <option>Other</option>
                </select>
              </div>
              {manualForm.serviceType === 'Other' && (
                <div>
                  <label className="field-label">Other job type *</label>
                  <input aria-label="Other job type" required value={manualForm.otherServiceType} onChange={(e) => updateManualField('otherServiceType', e.target.value)} className="field-input" />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="field-label">Description of job *</label>
                <textarea aria-label="Description of job" required rows={3} value={manualForm.description} onChange={(e) => updateManualField('description', e.target.value)} className="field-input" />
              </div>
              <div>
                <label className="field-label">Mode of payment *</label>
                <select aria-label="Mode of payment" value={manualForm.paymentMethod} onChange={(e) => updateManualField('paymentMethod', e.target.value)} className="field-input bg-white">
                  <option value="CASH">Cash</option><option value="INTERAC">Interac</option><option value="DEBIT_CARD">Debit Card</option><option value="CREDIT_CARD">Credit Card</option>
                </select>
              </div>
              <div>
                <label className="field-label">Payment status *</label>
                <select aria-label="Payment status" value={manualForm.paymentStatus} onChange={(e) => updateManualField('paymentStatus', e.target.value as ManualPaymentStatus)} className="field-input bg-white">
                  <option value="PAID">Received</option>
                  <option value="PENDING">Pending</option>
                </select>
                {pendingCardQuote && (
                  <p className="mt-1 text-[10px] text-blue-700">After saving, you can generate a payment link and prepare an SMS for the customer. The link uses the card price the customer accepted.</p>
                )}
              </div>
              <div>
                <label className="field-label">
                  {pendingCardQuote
                    ? 'Non-card price before tax *'
                    : 'Total amount collected *'}
                </label>
                <input
                  aria-label={pendingCardQuote
                    ? 'Non-card price before tax'
                    : 'Total amount collected'}
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={manualForm.totalAmountCollected}
                  onChange={(e) => updateManualField('totalAmountCollected', e.target.value)}
                  className="field-input"
                />
                {pendingCardQuote && (
                  <p className="mt-1 text-[10px] text-blue-700">Enter the lower non-card price before HST. Both options and estimated Ontario HST totals are shown below before recording acceptance.</p>
                )}
              </div>
              {pendingCardQuote && (
                <div>
                  <label className="field-label">Card-price difference (%) *</label>
                  <input aria-label="Card-price difference percentage" required type="number" min="0" max={MAX_CARD_PRICE_DIFFERENCE_RATE * 100} step="0.01" value={manualForm.cardPriceDifferenceRate} onChange={(e) => updateManualField('cardPriceDifferenceRate', e.target.value)} className="field-input" />
                  <p className="mt-1 text-[10px] text-slate-500">This sets the separately quoted card price. It is not added as a card surcharge, processing fee, or admin fee line.</p>
                </div>
              )}
              {pendingCardQuote && manualDualPriceQuote && (
                <section className="sm:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-3" aria-live="polite" aria-label="Customer price options">
                  <h3 className="text-xs font-black text-slate-900">Show both prices and estimated tax before the customer approves</h3>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-[11px] font-bold text-slate-600">Non-card price</p>
                      <p className="text-base font-black text-slate-900">${manualDualPriceQuote.nonCardPrice.toFixed(2)} + ${manualDualPriceQuote.nonCardTaxEstimate.toFixed(2)} estimated HST</p>
                      <p className="text-xs font-bold text-slate-700">Estimated total: ${manualDualPriceQuote.nonCardTotalEstimate.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg border border-blue-300 bg-white p-3">
                      <p className="text-[11px] font-bold text-blue-800">Card price · {Number(manualForm.cardPriceDifferenceRate || 0).toFixed(2)}% price difference</p>
                      <p className="text-base font-black text-slate-900">${manualDualPriceQuote.cardPrice.toFixed(2)} + ${manualDualPriceQuote.cardTaxEstimate.toFixed(2)} estimated HST</p>
                      <p className="text-xs font-bold text-slate-700">Estimated total: ${manualDualPriceQuote.cardTotalEstimate.toFixed(2)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-700">For an Ontario taxable service, these totals estimate 13% HST. Stripe calculates final tax using the customer’s billing location. The customer must see and accept the selected price before approval; this portal form records the dispatcher’s acceptance record and does not itself send the quote.</p>
                  <label className="mt-3 flex items-start gap-2 text-[11px] font-bold text-slate-800">
                    <input type="checkbox" className="mt-0.5" checked={manualForm.customerAcceptedCardPrice === 'yes'} onChange={(e) => updateManualField('customerAcceptedCardPrice', e.target.checked ? 'yes' : 'no')} />
                    Customer explicitly accepted the displayed card price and was shown both options and the estimated tax-inclusive totals.
                  </label>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-[10px] font-bold text-slate-700">Acceptance method
                      <select aria-label="Quote acceptance method" className="field-input mt-1 bg-white" value={manualForm.quoteAcceptanceMethod} onChange={(e) => updateManualField('quoteAcceptanceMethod', e.target.value)}>
                        <option value="VERBAL">Verbal</option><option value="WRITTEN">Written</option>
                      </select>
                    </label>
                    <label className="text-[10px] font-bold text-slate-700">Acceptance note *
                      <input aria-label="Quote acceptance note" required maxLength={500} className="field-input mt-1" value={manualForm.quoteAcceptanceEvidence} onChange={(e) => updateManualField('quoteAcceptanceEvidence', e.target.value)} placeholder="When/how the customer accepted" />
                    </label>
                  </div>
                  <p className="mt-2 text-[10px] text-amber-800">Use this dual-price presentation only after Locksmith’s processor and accountant confirm the pricing and HST treatment.</p>
                </section>
              )}
              <div>
                <label className="field-label">COGS (Parts, etc.) amount *</label>
                <input aria-label="COGS (Parts, etc.) amount" required type="number" min="0" step="0.01" value={manualForm.cogsAmount} onChange={(e) => updateManualField('cogsAmount', e.target.value)} className="field-input" />
              </div>
              {!(manualForm.paymentStatus === 'PENDING' && isCardPaymentMethod(manualForm.paymentMethod)) && <div>
                <label className="field-label">Tax collected *</label>
                <select aria-label="Tax collected status" value={manualForm.taxCollected} onChange={(e) => updateManualField('taxCollected', e.target.value)} className="field-input bg-white">
                  <option value="yes">Yes — on books</option><option value="no">No — off books transaction</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Bookkeeping status only; this does not calculate Ontario tax.</p>
              </div>}
              <div>
                <label className="field-label">Technician name *</label>
                <select aria-label="Technician name" required value={manualForm.technicianId} onChange={(e) => updateManualField('technicianId', e.target.value)} className="field-input bg-white">
                  <option value="" disabled>Select technician</option>
                  <option value="OTHER">Other</option>
                  {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Choose Other to enter a custom technician name.</p>
              </div>
              {manualForm.technicianId === 'OTHER' && (
                <div>
                  <label className="field-label">Other technician name *</label>
                  <input aria-label="Other technician name" required value={manualForm.otherTechnicianName} onChange={(e) => updateManualField('otherTechnicianName', e.target.value)} className="field-input" placeholder="Enter technician name" />
                </div>
              )}
              <div>
                <label className="field-label">Technician commission *</label>
                <input aria-label="Technician commission" required type="number" min="0" step="0.01" value={manualForm.technicianCommission} onChange={(e) => updateManualField('technicianCommission', e.target.value)} className="field-input" />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowAddJob(false)} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-bold">Cancel</button>
                <button type="submit" disabled={manualSubmitting} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50">{manualSubmitting ? 'Saving...' : editingManualId ? 'Save Changes' : 'Save Completed Job'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {paymentLinkPrompt && (
        <div className="fixed inset-0 z-[55] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="payment-link-prompt-title" className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h2 id="payment-link-prompt-title" className="text-lg font-black text-slate-900">Generate payment link?</h2>
                <p className="text-xs text-slate-600 mt-1">Job #{paymentLinkPrompt.jobNumber} is pending by card. Generate a link and prepare an SMS for {paymentLinkPrompt.customerName}?</p>
              </div>
              <button type="button" disabled={paymentLinkGenerating} onClick={() => setPaymentLinkPrompt(null)} className="text-slate-400 hover:text-slate-900 text-xl disabled:opacity-50" aria-label="Close payment link prompt">×</button>
            </div>
            {paymentLinkError && (
              <div role="alert" className="mb-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
                <div>{paymentLinkError}</div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" disabled={paymentLinkGenerating} onClick={generatePaymentLinkAndSend} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">{paymentLinkGenerating ? 'Retrying…' : 'Retry'}</button>
                  {paymentLinkUrl && <button type="button" onClick={copyPaymentLink} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 font-bold">Copy Payment Link</button>}
                </div>
                {paymentLinkCopyState && <div className="mt-2 text-[11px] font-semibold">{paymentLinkCopyState}</div>}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-3">
              <button type="button" disabled={paymentLinkGenerating} onClick={() => { setPaymentLinkPrompt(null); setPaymentLinkError(''); setPaymentLinkUrl(null); setSuccessMsg(`✅ Job #${paymentLinkPrompt.jobNumber} remains pending.`); }} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-bold disabled:opacity-50">No, leave pending</button>
              <button type="button" disabled={paymentLinkGenerating} onClick={generatePaymentLinkAndSend} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50">{paymentLinkGenerating ? 'Generating…' : 'Yes, generate and text link'}</button>
            </div>
          </div>
        </div>
      )}
      <SmsComposerModal
        draft={smsDraft}
        warnings={smsWarnings}
        title={smsAutoOpen ? 'Payment link SMS ready' : 'Technician assignment SMS'}
        autoOpen={smsAutoOpen}
        onClose={() => {
          setSmsDraft(null);
          setSmsWarnings([]);
          setSmsAutoOpen(false);
        }}
      />
    </div>
  );
}
