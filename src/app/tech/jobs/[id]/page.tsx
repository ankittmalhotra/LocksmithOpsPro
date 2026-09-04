'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  calculateForwardInvoice,
  calculateReverseInvoice,
  calculateTravelFee,
  calculateJobSettlementPosition,
} from '@/lib/calculations';
import SignaturePad from '@/components/SignaturePad';

interface PartItem {
  description: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
}

export default function TechJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Status updates
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Locksmith-specific Field States
  const [keyBitting, setKeyBitting] = useState('');
  const [doorDetails, setDoorDetails] = useState('');
  const [customerSignature, setCustomerSignature] = useState<string>('');
  const [proofPhotoUrl, setProofPhotoUrl] = useState<string>('');

  // Billing Mode: 'REVERSE' (enter total received) or 'FORWARD' (enter labor + parts)
  const [calculationMode, setCalculationMode] = useState<'REVERSE' | 'FORWARD'>('REVERSE');
  const [amountReceived, setAmountReceived] = useState('1661.77'); // default sample from prompt
  const [laborAmount, setLaborAmount] = useState('150.00');

  // Parts (Optional)
  const [parts, setParts] = useState<PartItem[]>([
    { description: '1 HS mortise cylinder', quantity: 1, unitCost: 15, unitPrice: 30 },
  ]);

  // Payment Options
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'INTERAC' | 'STRIPE_CARD'>('CASH');
  const [sendSms, setSendSms] = useState(false);
  const [submittingInvoice, setSubmittingInvoice] = useState(false);
  const [generatedStripeLink, setGeneratedStripeLink] = useState<string | null>(null);

  // Abandoned Job Modal
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [abandonTravelFee, setAbandonTravelFee] = useState<number>(25);
  const [abandonPaymentMethod, setAbandonPaymentMethod] = useState<'CASH' | 'STRIPE_CARD'>('CASH');
  const [abandonSendSms, setAbandonSendSms] = useState(false);

  useEffect(() => {
    fetchJob();
  }, [id]);

  // Adjust default sendSms toggle when paymentMethod changes
  useEffect(() => {
    if (paymentMethod === 'STRIPE_CARD') {
      setSendSms(true);
    } else {
      setSendSms(false);
    }
  }, [paymentMethod]);

  const fetchJob = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/jobs/${id}`);
      const data = await res.json();
      if (data.success && data.job) {
        setJob(data.job);
        setKeyBitting(data.job.keyBitting || '');
        setDoorDetails(data.job.doorDetails || '');
        setCustomerSignature(data.job.customerSignature || '');
        setProofPhotoUrl(data.job.proofPhotoUrl || '');
        if (data.job.invoice) {
          setGeneratedStripeLink(data.job.invoice.stripePaymentUrl || null);
          if (data.job.invoice.calculationMode) {
            setCalculationMode(data.job.invoice.calculationMode);
          }
          if (data.job.invoice.grandTotal) {
            setAmountReceived(data.job.invoice.grandTotal.toString());
          }
        }
      } else {
        setErrorMsg(data.error || 'Failed to load job');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    try {
      setUpdatingStatus(true);
      const res = await fetch(`/api/jobs/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setJob(data.job);
        setActionSuccess(`Status updated to ${newStatus}`);
        setTimeout(() => setActionSuccess(''), 3000);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAddPart = (description: string, price: number, cost = 0) => {
    setParts([...parts, { description, quantity: 1, unitPrice: price, unitCost: cost }]);
  };

  const handleRemovePart = (index: number) => {
    setParts(parts.filter((_, i) => i !== index));
  };

  // Live calculation breakdown
  const partsTotal = parts.reduce((sum, p) => sum + (p.unitPrice || 0) * (p.quantity || 1), 0);
  const liveCalculation =
    calculationMode === 'REVERSE'
      ? calculateReverseInvoice({
          amountReceived: parseFloat(amountReceived) || 0,
          partsTotal,
          paymentMethod,
        })
      : calculateForwardInvoice({
          laborAmount: parseFloat(laborAmount) || 0,
          partsTotal,
          paymentMethod,
        });

  const liveSettlement = calculateJobSettlementPosition({
    paymentMethod,
    grandTotal: liveCalculation.grandTotal,
    workerCommission: job?.workerCommission || 0,
  });

  const handleCompleteInvoice = async () => {
    try {
      setSubmittingInvoice(true);
      setErrorMsg('');
      setActionSuccess('');

      const res = await fetch(`/api/jobs/${id}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calculationMode,
          amountReceived: parseFloat(amountReceived) || 0,
          laborAmount: parseFloat(laborAmount) || 0,
          parts,
          paymentMethod,
          sendSms,
          keyBitting,
          doorDetails,
          customerSignature,
          proofPhotoUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to complete invoice');
      }

      setJob(data.job);
      if (data.stripeLink) {
        setGeneratedStripeLink(data.stripeLink);
        setActionSuccess(
          data.smsResult?.isSimulated
            ? `✅ Stripe Payment link generated! (Simulated Twilio SMS sent to ${job.customer.phone})`
            : `✅ Stripe Payment link sent to customer via SMS!`
        );
      } else {
        setActionSuccess(`✅ Job closed! Payment recorded via ${paymentMethod}.`);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmittingInvoice(false);
    }
  };

  const handleAbandonJob = async () => {
    try {
      setSubmittingInvoice(true);
      const res = await fetch(`/api/jobs/${id}/abandon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          travelFeeAmount: abandonTravelFee,
          paymentMethod: abandonPaymentMethod,
          sendSms: abandonSendSms,
          reason: 'Customer canceled on site',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to mark job as abandoned');
      }

      setShowAbandonModal(false);
      setJob(data.job);
      setActionSuccess(`Job marked abandoned. Travel fee of $${data.breakdown.grandTotal.toFixed(2)} recorded.`);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmittingInvoice(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-md mx-auto p-8 text-center text-slate-500 text-sm">
        Loading job details...
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-md mx-auto p-8 text-center text-rose-500 text-sm">
        {errorMsg || 'Job not found'}
      </div>
    );
  }

  const isClosed = job.status === 'COMPLETED' || job.status === 'ABANDONED_TRAVEL_FEE';

  return (
    <div className="max-w-md mx-auto px-4 py-4 w-full pb-20">
      {/* Top Navigation */}
      <div className="flex items-center justify-between mb-4">
        <Link
          href="/tech"
          className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1"
        >
          &larr; Back to Jobs
        </Link>
        <span
          className={`text-xs font-black uppercase px-2.5 py-0.5 rounded-full border ${
            job.status === 'COMPLETED'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
              : job.status === 'ABANDONED_TRAVEL_FEE'
              ? 'bg-amber-100 text-amber-800 border-amber-300'
              : 'bg-blue-100 text-blue-800 border-blue-300'
          }`}
        >
          {job.status.replace('_', ' ')}
        </span>
      </div>

      {actionSuccess && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold shadow-sm">
          {actionSuccess}
        </div>
      )}

      {errorMsg && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs font-semibold shadow-sm">
          {errorMsg}
        </div>
      )}

      {/* Customer & Location Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm mb-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-xs font-black text-slate-400">JOB #{job.jobNumber}</div>
            <h1 className="text-lg font-black text-slate-900 leading-tight">
              {job.customer.name}
            </h1>
            <div className="text-xs text-slate-600">
              {job.customer.phone}
              {job.customer.extension ? (
                <span className="font-bold text-blue-600"> #{job.customer.extension}</span>
              ) : null}
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
              Your Commission
            </span>
            <span className="text-base font-black text-emerald-600">
              ${job.workerCommission.toFixed(2)}
            </span>
          </div>
        </div>

        {/* 1-Tap Action Buttons for Field Workers */}
        <div className="grid grid-cols-3 gap-1.5 mt-3 pt-3 border-t border-slate-100">
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(job.serviceAddress)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="py-2 px-2 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-sm hover:bg-slate-800 transition"
          >
            <span>🗺️</span>
            <span>Maps</span>
          </a>

          <a
            href={`tel:${job.customer.phone}${job.customer.extension ? `,${job.customer.extension}` : ''}`}
            className="py-2 px-2 rounded-xl bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-sm hover:bg-blue-700 transition"
          >
            <span>📞</span>
            <span>Call</span>
          </a>

          <Link
            href={`/track/${job.jobNumber}`}
            target="_blank"
            className="py-2 px-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-sm transition"
          >
            <span>📲</span>
            <span>Track</span>
          </Link>
        </div>

        <div className="mt-3 text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
          <div className="font-bold text-slate-800 mb-0.5">{job.serviceType}</div>
          <div className="text-slate-600">{job.problemDescription || 'No additional notes'}</div>
        </div>
      </div>

      {/* Progress Status Bar (If Not Closed) */}
      {!isClosed && (
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm mb-4">
          <div className="text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
            <span>Work Progression</span>
            <button
              onClick={() => setShowAbandonModal(true)}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-700 underline"
            >
              Job Abandoned?
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {(['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'] as const).map((st) => (
              <button
                key={st}
                disabled={updatingStatus}
                onClick={() => updateStatus(st)}
                className={`py-2 px-1 rounded-xl text-xs font-bold transition ${
                  job.status === st
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Invoice & Payment Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm mb-4">
        <h2 className="text-sm font-black text-slate-900 mb-3 flex items-center justify-between pb-2 border-b border-slate-100">
          <span>{isClosed ? '🧾 Invoice Summary' : '💳 Complete & Bill Customer'}</span>
          <span className="text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-bold">
            13% HST Ontario
          </span>
        </h2>

        {!isClosed && (
          <>
            {/* Mode Switcher */}
            <div className="flex rounded-xl bg-slate-100 p-1 mb-4 text-xs font-bold">
              <button
                type="button"
                onClick={() => setCalculationMode('REVERSE')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  calculationMode === 'REVERSE'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                ⚡ Amount Received (Lump Sum)
              </button>
              <button
                type="button"
                onClick={() => setCalculationMode('FORWARD')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  calculationMode === 'FORWARD'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                📋 Itemized (Labor + Parts)
              </button>
            </div>

            {/* Input based on mode */}
            {calculationMode === 'REVERSE' ? (
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Total Amount Received from Client ($)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-extrabold text-base">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(e.target.value)}
                    placeholder="1661.77"
                    className="w-full pl-8 pr-3 py-2.5 text-lg font-black text-slate-900 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  System automatically splits Job Subtotal + 13% Ontario HST.
                </p>
              </div>
            ) : (
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Labor / Service Charge ($)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-extrabold text-base">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={laborAmount}
                    onChange={(e) => setLaborAmount(e.target.value)}
                    placeholder="150.00"
                    className="w-full pl-8 pr-3 py-2.5 text-lg font-black text-slate-900 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Parts Section (Optional) */}
            <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700">
                  Parts & Hardware (Optional)
                </span>
                <span className="text-xs font-black text-slate-700">
                  Total Parts: ${partsTotal.toFixed(2)}
                </span>
              </div>

              {parts.length === 0 ? (
                <div className="text-xs text-slate-400 italic py-1">No parts used for this job</div>
              ) : (
                <div className="space-y-1.5 mb-2">
                  {parts.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs bg-white px-2.5 py-1.5 rounded-lg border border-slate-200"
                    >
                      <span className="font-medium text-slate-800">{p.description}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">
                          ${(p.unitPrice * p.quantity).toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemovePart(idx)}
                          className="text-rose-500 hover:text-rose-700 font-bold px-1"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Add Parts Buttons */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <button
                  type="button"
                  onClick={() => handleAddPart('1 HS mortise cylinder', 30, 15)}
                  className="text-[11px] font-semibold bg-white border border-slate-200 hover:border-slate-300 px-2 py-1 rounded-md text-slate-700"
                >
                  + HS mortise ($30)
                </button>
                <button
                  type="button"
                  onClick={() => handleAddPart('Commercial Deadbolt', 45, 20)}
                  className="text-[11px] font-semibold bg-white border border-slate-200 hover:border-slate-300 px-2 py-1 rounded-md text-slate-700"
                >
                  + Deadbolt ($45)
                </button>
                <button
                  type="button"
                  onClick={() => handleAddPart('Key Blanks / Duplicate', 10, 2)}
                  className="text-[11px] font-semibold bg-white border border-slate-200 hover:border-slate-300 px-2 py-1 rounded-md text-slate-700"
                >
                  + Keys ($10)
                </button>
              </div>
            </div>

            {/* Locksmith Hardware Specs */}
            <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                <span>🔑</span> Locksmith Hardware & Pinning Specs
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Key Bitting / Code</label>
                  <input
                    type="text"
                    placeholder="e.g. SC1: 3-5-2-1-4"
                    value={keyBitting}
                    onChange={(e) => setKeyBitting(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Door / Cam Specs</label>
                  <input
                    type="text"
                    placeholder="e.g. Mortise, 1-1/8 backset"
                    value={doorDetails}
                    onChange={(e) => setDoorDetails(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Proof of Work Photo */}
            <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>📷</span> Proof of Work Photo
                </span>
                {proofPhotoUrl && (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                    Photo Attached
                  </span>
                )}
              </div>
              {proofPhotoUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-slate-300 h-28 bg-slate-900 flex items-center justify-center">
                  <img src={proofPhotoUrl} alt="Proof of installation" className="max-h-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setProofPhotoUrl('')}
                    className="absolute top-1 right-1 bg-rose-600 text-white rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setProofPhotoUrl('https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=400&q=80')}
                  className="w-full py-2 border-2 border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-600 hover:border-slate-400 bg-white transition flex items-center justify-center gap-1.5"
                >
                  <span>📸</span> Snap / Attach Lock Photo (Dispute Prevention)
                </button>
              )}
            </div>

            {/* Customer On-Site Digital Signature */}
            <div className="mb-4">
              <SignaturePad
                onSave={setCustomerSignature}
                initialValue={customerSignature}
              />
            </div>

            {/* Payment Method Selector */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Payment Method
              </label>
              <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('CASH')}
                  className={`py-2 px-1 rounded-xl border flex flex-col items-center gap-1 transition ${
                    paymentMethod === 'CASH'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>💵</span>
                  <span>Cash</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('INTERAC')}
                  className={`py-2 px-1 rounded-xl border flex flex-col items-center gap-1 transition ${
                    paymentMethod === 'INTERAC'
                      ? 'bg-blue-50 border-blue-500 text-blue-800 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>🏦</span>
                  <span>Interac (ET)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('STRIPE_CARD')}
                  className={`py-2 px-1 rounded-xl border flex flex-col items-center gap-1 transition ${
                    paymentMethod === 'STRIPE_CARD'
                      ? 'bg-purple-50 border-purple-500 text-purple-800 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>💳</span>
                  <span>Card (+4%)</span>
                </button>
              </div>
            </div>

            {/* Twilio SMS Toggle */}
            <div className="mb-4 p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-800">
                  {paymentMethod === 'STRIPE_CARD'
                    ? 'Send SMS Payment Link via Twilio'
                    : 'Send SMS Receipt to Customer'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {paymentMethod === 'CASH'
                    ? 'Not needed for cash unless client requests'
                    : 'Sends secure link to client phone'}
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendSms}
                  onChange={(e) => setSendSms(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </>
        )}

        {/* Breakdown Display */}
        <div className="p-3.5 bg-slate-900 text-white rounded-xl space-y-1.5 text-xs mb-4">
          <div className="flex justify-between text-slate-300">
            <span>Job Subtotal (Labor + Parts):</span>
            <span className="font-semibold text-white">
              ${liveCalculation.subtotal.toFixed(2)}
            </span>
          </div>
          {liveCalculation.partsTotal > 0 && (
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>↳ Parts Included:</span>
              <span>${liveCalculation.partsTotal.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-300">
            <span>Ontario HST (13%):</span>
            <span className="font-semibold text-white">
              ${liveCalculation.taxAmount.toFixed(2)}
            </span>
          </div>

          {liveCalculation.cardSurchargeAmount > 0 && (
            <div className="flex justify-between text-amber-300 font-medium">
              <span>Card Processing Surcharge (4%):</span>
              <span>+${liveCalculation.cardSurchargeAmount.toFixed(2)}</span>
            </div>
          )}

          <div className="pt-2 border-t border-slate-700 flex justify-between items-baseline">
            <span className="font-black text-sm text-white uppercase">Grand Total:</span>
            <span className="text-xl font-black text-emerald-400">
              ${liveCalculation.grandTotal.toFixed(2)}
            </span>
          </div>

          {/* Cash Ledger Note */}
          {paymentMethod === 'CASH' && (
            <div className="pt-1.5 border-t border-slate-800 text-[11px] text-amber-300/90 font-medium flex justify-between">
              <span>You owe company (Cash - Comm):</span>
              <span className="font-bold">
                ${liveSettlement.cashOwedToCompany.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Generated Stripe Link & Interactive Customer Portal */}
        {generatedStripeLink && (
          <div className="mb-4 p-3 rounded-xl bg-purple-50 border border-purple-200">
            <div className="text-xs font-bold text-purple-900 mb-1 flex items-center gap-1">
              <span>🔗</span> Stripe Payment Link Active:
            </div>
            <div className="text-xs text-purple-700 break-all mb-2">
              {generatedStripeLink}
            </div>
            <div className="flex gap-2">
              <Link
                href={generatedStripeLink}
                target="_blank"
                className="flex-1 py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold text-center transition"
              >
                Open Customer Checkout Screen &rarr;
              </Link>
            </div>
          </div>
        )}

        {/* Action Button */}
        {!isClosed && (
          <button
            type="button"
            disabled={submittingInvoice}
            onClick={handleCompleteInvoice}
            className={`w-full py-3 px-4 rounded-xl font-black text-sm text-white shadow-md transition flex items-center justify-center gap-2 ${
              paymentMethod === 'STRIPE_CARD'
                ? 'bg-purple-600 hover:bg-purple-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {submittingInvoice
              ? 'Processing...'
              : paymentMethod === 'STRIPE_CARD'
              ? '💳 Generate & Send Stripe Link via Twilio'
              : `💵 Confirm ${paymentMethod} ($${liveCalculation.grandTotal.toFixed(2)}) & Close Job`}
          </button>
        )}
      </div>

      {/* Abandoned Job Modal */}
      {showAbandonModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200">
            <h3 className="text-base font-black text-slate-900 mb-1 flex items-center gap-2">
              <span>⚠️</span> Job Abandoned On Site
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              Customer cancelled after arrival. Bill standard technician travel fee:
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => setAbandonTravelFee(20)}
                className={`py-2 rounded-xl text-xs font-black border transition ${
                  abandonTravelFee === 20
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                $20.00 Travel Fee
              </button>
              <button
                type="button"
                onClick={() => setAbandonTravelFee(25)}
                className={`py-2 rounded-xl text-xs font-black border transition ${
                  abandonTravelFee === 25
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                $25.00 Travel Fee
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Travel Fee Payment Method
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setAbandonPaymentMethod('CASH')}
                  className={`py-2 rounded-xl border transition ${
                    abandonPaymentMethod === 'CASH'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  💵 Cash
                </button>
                <button
                  type="button"
                  onClick={() => setAbandonPaymentMethod('STRIPE_CARD')}
                  className={`py-2 rounded-xl border transition ${
                    abandonPaymentMethod === 'STRIPE_CARD'
                      ? 'bg-purple-50 border-purple-500 text-purple-800'
                      : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  💳 Card (+4%)
                </button>
              </div>
            </div>

            <div className="p-3 bg-slate-900 text-white rounded-xl text-xs space-y-1 mb-4">
              <div className="flex justify-between text-slate-300">
                <span>Travel Fee:</span>
                <span>${abandonTravelFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>HST (13%):</span>
                <span>${(abandonTravelFee * 0.13).toFixed(2)}</span>
              </div>
              <div className="pt-1 border-t border-slate-700 flex justify-between font-black text-emerald-400">
                <span>Customer Pays:</span>
                <span>${(abandonTravelFee * 1.13).toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAbandonModal(false)}
                className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAbandonJob}
                className="flex-1 py-2 rounded-xl bg-rose-600 text-white font-bold text-xs shadow"
              >
                Confirm Abandoned
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
