'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Job {
  id: string;
  jobNumber: number;
  serviceType: string;
  serviceAddress: string;
  problemDescription: string;
  workerCommission: number;
  status: string;
  isAbandoned: boolean;
  createdAt: string;
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
  invoice?: {
    grandTotal: number;
    paymentStatus: string;
    paymentMethod: string;
  };
}

export default function DispatchPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Intake Form State
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerExtension, setCustomerExtension] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  const [serviceType, setServiceType] = useState('Commercial Lock Change');
  const [problemDescription, setProblemDescription] = useState('');
  const [workerCommission, setWorkerCommission] = useState('150.00');
  const [technicianId, setTechnicianId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Sample technicians list
  const [technicians, setTechnicians] = useState<any[]>([]);

  useEffect(() => {
    fetchAuthAndJobs();
    const interval = setInterval(fetchAuthAndJobs, 6000);
    return () => clearInterval(interval);
  }, []);

  const fetchAuthAndJobs = async () => {
    try {
      setLoading(true);
      const authRes = await fetch('/api/auth/me');
      const authData = await authRes.json();
      if (authData.success && authData.user) {
        setCurrentUser(authData.user);
      }

      const res = await fetch('/api/jobs');
      const data = await res.json();
      if (data.success) {
        setJobs(data.jobs);
        const techs = data.jobs
          .map((j: any) => j.technician)
          .filter((t: any) => t !== null && t !== undefined);
        const uniqueTechs = Array.from(new Map(techs.map((t: any) => [t.id, t])).values());
        setTechnicians(uniqueTechs);
        if (uniqueTechs.length > 0 && !technicianId) {
          setTechnicianId((uniqueTechs[0] as any).id);
        }
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickIntake = async (e: React.FormEvent) => {
    e.preventDefault();
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
          workerCommission,
          technicianId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch job');
      }

      setSuccessMsg(`✅ Job #${data.job.jobNumber} created and dispatched via Twilio to technician!`);
      // Reset form
      setCustomerName('');
      setCustomerPhone('');
      setCustomerExtension('');
      setServiceAddress('');
      setProblemDescription('');
      setWorkerCommission('150.00');
      fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredJobs = jobs.filter((j) => {
    if (filter === 'ALL') return true;
    if (filter === 'ACTIVE') return ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(j.status);
    if (filter === 'COMPLETED') return j.status === 'COMPLETED';
    if (filter === 'ABANDONED') return j.status === 'ABANDONED_TRAVEL_FEE';
    return j.status === filter;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <span>📞</span> Dispatch Desk & Call Intake
            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Sync
            </span>
          </h1>
          <p className="text-sm text-slate-600">
            Log incoming customer calls, assign worker commissions, and dispatch automatically via Twilio SMS.
          </p>
        </div>

        <button
          onClick={() => {
            // Fill sample Toronto job for instant testing
            setCustomerName('Ativan Bloor');
            setCustomerPhone('6479510901');
            setCustomerExtension('762');
            setServiceAddress('663 Bloor Street West, Toronto, ON M6G 1L1');
            setServiceType('Commercial Lock Change');
            setProblemDescription('Need replaced lock cylinder on the glass door at the bottom');
            setWorkerCommission('300.00');
          }}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 transition flex items-center gap-1.5"
        >
        </button>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Fast Call Intake Form */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center justify-between">
            <span>Incoming Call Intake</span>
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
                  placeholder="(647) 951-0901"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900"
                />
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
              <input
                type="text"
                required
                placeholder="e.g. 663 Bloor Street West, Toronto, ON M6G 1L1"
                value={serviceAddress}
                onChange={(e) => setServiceAddress(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900"
              />
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
                <option value="Commercial Lock Change">Commercial Lock Change</option>
                <option value="Storefront Mortise Cylinder">Storefront Mortise Cylinder</option>
                <option value="Residential Lockout">Residential Lockout</option>
                <option value="Deadbolt Installation">Deadbolt Installation</option>
                <option value="Rekey Master Key System">Rekey Master Key System</option>
                <option value="Car Lockout">Car Lockout</option>
                <option value="Safe Opening">Safe Opening</option>
              </select>
            </div>

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

            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Worker Commission ($) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="150.00"
                    value={workerCommission}
                    onChange={(e) => setWorkerCommission(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded-lg font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <span className="text-[10px] text-slate-500">Initiator sets worker pay</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Assign Contractor *
                </label>
                <select
                  value={technicianId}
                  onChange={(e) => setTechnicianId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  {technicians.length === 0 && <option value="">Dave Miller (Tech)</option>}
                </select>
                <span className="text-[10px] text-emerald-600 font-medium">Dispatches via Twilio SMS</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? 'Dispatching...' : '🚀 Create & Dispatch Job via Twilio'}
            </button>
          </form>
        </div>

        {/* Right Column: Active Dispatch Board / Jobs Queue */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>Live Jobs Board</span>
              <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                {jobs.length} Total
              </span>
            </h2>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 text-xs">
              {(['ALL', 'ACTIVE', 'COMPLETED', 'ABANDONED'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    filter === f
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center py-12 text-slate-400 text-sm">
              Loading jobs...
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-slate-400 text-sm">
              <span>No jobs found for filter: {filter}</span>
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
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-slate-900">
                          #{job.jobNumber}
                        </span>
                        <span className="font-semibold text-sm text-slate-800">
                          {job.customer.name}
                        </span>
                        <span className="text-xs text-slate-500">
                          ({job.customer.phone}
                          {job.customer.extension ? ` #${job.customer.extension}` : ''})
                        </span>
                        <span
                          className={`text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-md border ${statusColor}`}
                        >
                          {job.status.replace('_', ' ')}
                        </span>
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
                            {job.technician?.name || 'Unassigned'}
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          Commission:{' '}
                          <strong className="text-emerald-700">
                            ${job.workerCommission.toFixed(2)}
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
                        href={`/tech/jobs/${job.jobNumber}`}
                        className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition"
                      >
                        Open as Tech &rarr;
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
