'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface TechLedgerItem {
  id: string;
  name: string;
  phone: string;
  cashCollected: number;
  commissionsEarned: number;
  totalSettled: number;
  netCashOwedToCompany: number;
  jobsCount: number;
  settlements: any[];
}

export default function OwnerDashboardPage() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Settlement Modal State
  const [selectedTech, setSelectedTech] = useState<TechLedgerItem | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleNotes, setSettleNotes] = useState('');
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    fetchAuthAndAnalytics();
    const interval = setInterval(fetchAuthAndAnalytics, 6000);
    return () => clearInterval(interval);
  }, []);

  const fetchAuthAndAnalytics = async () => {
    try {
      setLoading(true);
      const authRes = await fetch('/api/auth/me');
      const authData = await authRes.json();
      if (authData.success && authData.user) {
        setCurrentUser(authData.user);
      }

      const res = await fetch('/api/owner/analytics');
      const data = await res.json();
      if (data.success) {
        setAnalytics(data);
      } else {
        setErrorMsg(data.error || 'Failed to fetch analytics');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSettlement = (tech: TechLedgerItem) => {
    setSelectedTech(tech);
    setSettleAmount(Math.max(0, tech.netCashOwedToCompany).toString());
    setSettleNotes(`Cash handover from ${tech.name}`);
  };

  const handleConfirmSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTech || !settleAmount || parseFloat(settleAmount) <= 0) return;

    try {
      setSettling(true);
      setErrorMsg('');
      setSuccessMsg('');

      const res = await fetch('/api/owner/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicianId: selectedTech.id,
          amountSettled: parseFloat(settleAmount),
          notes: settleNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to record settlement');
      }

      setSuccessMsg(data.message);
      setSelectedTech(null);
      fetchAuthAndAnalytics();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSettling(false);
    }
  };

  const handleExportCSV = () => {
    if (!analytics?.recentJobs) return;
    const headers = [
      'Job Number',
      'Customer',
      'Phone',
      'Address',
      'Technician',
      'Service',
      'Status',
      'Payment Method',
      'Subtotal',
      'HST (13%)',
      'Card Surcharge (4%)',
      'Grand Total',
      'Worker Commission',
    ];

    const rows = analytics.recentJobs.map((j: any) => [
      j.jobNumber,
      `"${j.customer.name}"`,
      `"${j.customer.phone}"`,
      `"${j.serviceAddress}"`,
      `"${j.technician?.name || 'N/A'}"`,
      `"${j.serviceType}"`,
      j.status,
      j.invoice?.paymentMethod || 'N/A',
      j.invoice?.subtotal?.toFixed(2) || '0.00',
      j.invoice?.taxAmount?.toFixed(2) || '0.00',
      j.invoice?.cardSurchargeAmount?.toFixed(2) || '0.00',
      j.invoice?.grandTotal?.toFixed(2) || '0.00',
      j.workerCommission?.toFixed(2) || '0.00',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `LockOps_Accounting_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading && !analytics) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center text-slate-400 text-sm">
        Loading Owner Analytics...
      </div>
    );
  }

  const s = analytics?.summary || {};

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <span>📊</span> Owner Executive Hub & Financials
            <span className="text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
              Live Sync
            </span>
          </h1>
          <p className="text-sm text-slate-600">
            Real-time business performance, CRA Ontario HST tracking, and worker cash-in-hand reconciliation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchAuthAndAnalytics}
            className="px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-xs"
          >
            🔄 Refresh
          </button>
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow flex items-center gap-1.5"
          >
            <span>📥</span> Export CSV for Accountant
          </button>
        </div>
      </div>

      {currentUser && currentUser.role !== 'OWNER' && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
            <span className="text-lg">⚠️</span>
            <span>
              Role Notice: You are authenticated as <strong>{currentUser.name} ({currentUser.role})</strong>. The Owner Hub is restricted to Owners.
            </span>
          </div>
          <Link
            href="/login"
            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 shadow-xs"
          >
            Switch to Owner Account &rarr;
          </Link>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold shadow-sm">
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs font-bold shadow-sm">
          {errorMsg}
        </div>
      )}

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Gross Revenue */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            Total Gross Revenue
          </div>
          <div className="text-2xl font-black text-slate-900">
            ${(s.totalGrossRevenue || 0).toFixed(2)}
          </div>
          <div className="mt-2 text-[11px] text-slate-500 space-y-0.5">
            <div className="flex justify-between">
              <span>💵 Cash:</span>
              <span className="font-semibold text-slate-700">
                ${(s.totalCashRevenue || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>💳 Card (Stripe):</span>
              <span className="font-semibold text-slate-700">
                ${(s.totalCardRevenue || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>🏦 Interac:</span>
              <span className="font-semibold text-slate-700">
                ${(s.totalInteracRevenue || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Ontario HST Collected */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Ontario HST (13%)</span>
            <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
              CRA Remittance
            </span>
          </div>
          <div className="text-2xl font-black text-amber-700">
            ${(s.totalTaxHST || 0).toFixed(2)}
          </div>
          <p className="mt-2 text-[11px] text-slate-500 leading-tight">
            Taxes collected from all invoices ready for quarterly CRA tax filing.
          </p>
        </div>

        {/* Worker Commissions Earned */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">
            Tech Commissions
          </div>
          <div className="text-2xl font-black text-blue-700">
            ${(s.totalCommissionsEarned || 0).toFixed(2)}
          </div>
          <p className="mt-2 text-[11px] text-slate-500 leading-tight">
            Total commission allocated to workers by dispatchers for completed jobs.
          </p>
        </div>

        {/* Net Company Profit */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">
            Net Company Revenue
          </div>
          <div className="text-2xl font-black text-emerald-700">
            ${(s.netCompanyProfit || 0).toFixed(2)}
          </div>
          <p className="mt-2 text-[11px] text-slate-500 leading-tight">
            Gross revenue after deducting Ontario HST and technician commissions.
          </p>
        </div>
      </div>

      {/* Worker Cash-in-Hand Ledger & Settlements */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <span>💼</span> Contractor Cash-in-Hand Ledger & Handover Settlement
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Workers who collect cash on site owe the company{' '}
              <strong className="text-slate-800">(Cash Collected - Commission Earned)</strong>. Settle balances when cash is physically received.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px]">
                <th className="py-2.5 px-3">Contractor</th>
                <th className="py-2.5 px-3">Total Cash Collected</th>
                <th className="py-2.5 px-3">Earned Commissions</th>
                <th className="py-2.5 px-3">Previously Settled</th>
                <th className="py-2.5 px-3">Current Net Position</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {analytics?.technicianLedger?.map((tech: TechLedgerItem) => {
                const owesCompany = tech.netCashOwedToCompany > 0;
                const companyOwes = tech.netCashOwedToCompany < 0;

                return (
                  <tr key={tech.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3">
                      <div className="font-extrabold text-slate-900 text-sm">{tech.name}</div>
                      <div className="text-[11px] text-slate-500">{tech.phone}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-700 font-bold">
                      ${tech.cashCollected.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-blue-700 font-bold">
                      ${tech.commissionsEarned.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-semibold">
                      ${tech.totalSettled.toFixed(2)}
                    </td>
                    <td className="py-3 px-3">
                      {owesCompany ? (
                        <span className="inline-flex items-center gap-1 font-extrabold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                          <span>⚠️</span> Worker Owes Company: ${tech.netCashOwedToCompany.toFixed(2)}
                        </span>
                      ) : companyOwes ? (
                        <span className="inline-flex items-center gap-1 font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg">
                          Company Owes Worker: ${Math.abs(tech.netCashOwedToCompany).toFixed(2)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                          ✅ Balanced ($0.00)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {owesCompany ? (
                        <button
                          onClick={() => handleOpenSettlement(tech)}
                          className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm transition"
                        >
                          Settle Cash Handover &rarr;
                        </button>
                      ) : (
                        <button
                          onClick={() => handleOpenSettlement(tech)}
                          className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
                        >
                          Record Handover
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Invoices & Jobs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-base font-black text-slate-900 mb-3 pb-2 border-b border-slate-100 flex items-center justify-between">
          <span>Recent Operational Activity</span>
          <span className="text-xs text-slate-500 font-medium">
            Showing latest {analytics?.recentJobs?.length || 0} jobs
          </span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px]">
                <th className="py-2.5 px-3">Job #</th>
                <th className="py-2.5 px-3">Client</th>
                <th className="py-2.5 px-3">Location</th>
                <th className="py-2.5 px-3">Technician</th>
                <th className="py-2.5 px-3">Payment</th>
                <th className="py-2.5 px-3">HST (13%)</th>
                <th className="py-2.5 px-3">Total Billed</th>
                <th className="py-2.5 px-3">Commission</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {analytics?.recentJobs?.map((job: any) => (
                <tr key={job.id} className="hover:bg-slate-50/80 transition">
                  <td className="py-3 px-3 font-extrabold text-slate-900">
                    #{job.jobNumber}
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-bold text-slate-800">{job.customer.name}</div>
                    <div className="text-[10px] text-slate-500">{job.customer.phone}</div>
                  </td>
                  <td className="py-3 px-3 text-slate-600 max-w-[200px] truncate">
                    {job.serviceAddress}
                  </td>
                  <td className="py-3 px-3 text-slate-700 font-semibold">
                    {job.technician?.name || 'Unassigned'}
                  </td>
                  <td className="py-3 px-3">
                    {job.invoice?.paymentMethod ? (
                      <span className="font-bold text-slate-700 uppercase">
                        {job.invoice.paymentMethod.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Pending</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-600">
                    ${(job.invoice?.taxAmount || 0).toFixed(2)}
                  </td>
                  <td className="py-3 px-3 font-extrabold text-slate-900 text-sm">
                    ${(job.invoice?.grandTotal || 0).toFixed(2)}
                  </td>
                  <td className="py-3 px-3 font-bold text-emerald-700">
                    ${job.workerCommission.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <span
                      className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                        job.status === 'COMPLETED'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : job.status === 'ABANDONED_TRAVEL_FEE'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      {job.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settle Cash Handover Modal */}
      {selectedTech && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-black text-slate-900 mb-1 flex items-center gap-2">
              <span>💵</span> Record Cash Handover Settlement
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              Recording cash received physically from{' '}
              <strong className="text-slate-900">{selectedTech.name}</strong>.
            </p>

            <form onSubmit={handleConfirmSettlement} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Amount Received from Worker ($) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-extrabold text-base">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={settleAmount}
                    onChange={(e) => setSettleAmount(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-base font-black text-slate-900 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <span className="text-[11px] text-slate-500">
                  Current balance owed:{' '}
                  <strong>${selectedTech.netCashOwedToCompany.toFixed(2)}</strong>
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Settlement Notes
                </label>
                <input
                  type="text"
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  placeholder="e.g. Received weekly cash envelope"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedTech(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={settling}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
                >
                  {settling ? 'Recording...' : 'Confirm Cash Received'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
