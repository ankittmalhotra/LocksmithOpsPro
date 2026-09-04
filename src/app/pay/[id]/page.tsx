'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';

export default function CustomerPaymentPortalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paidSuccess, setPaidSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Card input mock states
  const [cardNumber, setCardNumber] = useState('•••• •••• •••• 4242');
  const [cardExpiry, setCardExpiry] = useState('12/28');
  const [cardCvc, setCardCvc] = useState('123');
  const [cardholderName, setCardholderName] = useState('');

  useEffect(() => {
    fetchJob();
  }, [id]);

  const fetchJob = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/jobs/${id}`);
      const data = await res.json();
      if (data.success && data.job) {
        setJob(data.job);
        setCardholderName(data.job.customer?.name || '');
        if (data.job.invoice?.paymentStatus === 'PAID') {
          setPaidSuccess(true);
        }
      } else {
        setErrorMsg('Invoice not found or expired.');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setPaying(true);
      setErrorMsg('');

      // Simulate Stripe payment processing & call webhook
      const res = await fetch('/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          sessionId: job.invoice?.stripeSessionId || `cs_test_${Date.now()}`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Payment failed');
      }

      setPaidSuccess(true);
      fetchJob();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-md mx-auto p-12 text-center text-slate-500 text-sm">
        Loading secure payment portal...
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-md mx-auto p-12 text-center text-rose-600 text-sm">
        {errorMsg || 'Job not found'}
      </div>
    );
  }

  const invoice = job.invoice || {
    subtotal: 0,
    taxAmount: 0,
    cardSurchargeAmount: 0,
    grandTotal: 0,
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-8 px-4 sm:px-6">
      <div className="max-w-md mx-auto w-full">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-900 text-white text-2xl shadow-md mb-2">
            🔐
          </div>
          <h1 className="text-xl font-black text-slate-900">LockOps Toronto</h1>
          <p className="text-xs text-slate-500">Secure Client Payment Portal</p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          {/* Top Banner */}
          <div className="bg-slate-900 text-white p-5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Invoice For Job
                </span>
                <div className="text-xl font-black">#{job.jobNumber}</div>
                <div className="text-xs text-slate-300 mt-0.5">{job.customer.name}</div>
              </div>

              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">
                  Amount Due
                </span>
                <div className="text-2xl font-black text-emerald-400">
                  ${invoice.grandTotal.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {paidSuccess ? (
            /* Success State */
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">
                ✓
              </div>
              <h2 className="text-xl font-black text-slate-900 mb-1">
                Payment Confirmed!
              </h2>
              <p className="text-xs text-slate-600 mb-6">
                Thank you, {job.customer.name}! Your payment of{' '}
                <strong className="text-slate-900">
                  ${invoice.grandTotal.toFixed(2)}
                </strong>{' '}
                was successfully processed via Stripe. A receipt has been sent to your phone.
              </p>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-left text-xs space-y-1.5 mb-6">
                <div className="flex justify-between">
                  <span className="text-slate-500">Job Reference:</span>
                  <span className="font-bold text-slate-800">#{job.jobNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Service:</span>
                  <span className="font-semibold text-slate-800">{job.serviceType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Service Address:</span>
                  <span className="font-semibold text-slate-800">{job.serviceAddress}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Technician:</span>
                  <span className="font-semibold text-slate-800">{job.technician?.name}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between font-bold">
                  <span>Status:</span>
                  <span className="text-emerald-600">PAID & COMPLETED</span>
                </div>
              </div>

              <Link
                href="/tech"
                className="inline-block py-2.5 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition"
              >
                Return to System Hub
              </Link>
            </div>
          ) : (
            /* Checkout Form */
            <div className="p-6">
              {errorMsg && (
                <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                  {errorMsg}
                </div>
              )}

              {/* Itemized Bill */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs space-y-1.5 mb-5">
                <div className="flex justify-between text-slate-600">
                  <span>Locksmith Service & Parts:</span>
                  <span className="font-semibold text-slate-900">
                    ${invoice.subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Ontario HST (13%):</span>
                  <span className="font-semibold text-slate-900">
                    ${invoice.taxAmount.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-amber-700 font-medium">
                  <span>Card Processing Surcharge (4%):</span>
                  <span className="font-bold">
                    +${invoice.cardSurchargeAmount.toFixed(2)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between font-black text-sm">
                  <span>Total Due:</span>
                  <span className="text-slate-900">
                    ${invoice.grandTotal.toFixed(2)} CAD
                  </span>
                </div>
              </div>

              {/* Credit Card Form */}
              <form onSubmit={handleProcessPayment} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Cardholder Name
                  </label>
                  <input
                    type="text"
                    required
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:outline-none text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Card Number (Demo Test Mode)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="w-full pl-3 pr-10 py-2 border border-slate-300 rounded-xl font-mono text-slate-900 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                    <span className="absolute right-3 top-2 text-slate-400">💳</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Expiry (MM/YY)
                    </label>
                    <input
                      type="text"
                      required
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-slate-900 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      CVC / CVV
                    </label>
                    <input
                      type="text"
                      required
                      value={cardCvc}
                      onChange={(e) => setCardCvc(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-slate-900 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={paying}
                    className="w-full py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {paying ? (
                      'Processing...'
                    ) : (
                      <>
                        <span>🔒 Pay ${invoice.grandTotal.toFixed(2)} Securely</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-[10px] text-center text-slate-400 mt-2">
                  Secured by 256-bit encryption • Powered by Stripe & Twilio
                </p>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
