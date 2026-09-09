'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MANUAL_SERVICE_TYPES } from '@/lib/manual-job';

interface Job {
  id: string;
  jobNumber: number;
  serviceType: string;
  serviceAddress: string;
  problemDescription: string;
  workerCommission: number;
  workerCommissionRate: number;
  status: string;
  isAbandoned: boolean;
  isManual?: boolean;
  createdAt: string;
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
  invoice?: {
    grandTotal: number;
    taxAmount?: number;
    totalAmountCollected?: number;
    cogsAmount?: number;
    paymentStatus: string;
    paymentMethod: string;
    taxCollected?: boolean;
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
  const [showManualJob, setShowManualJob] = useState(false);
  const [editingManualId, setEditingManualId] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [deletingManualId, setDeletingManualId] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<Record<string, string>>({
    jobNumber: '',
    customerName: '',
    customerPhone: '',
    customerExtension: '',
    serviceAddress: '',
    serviceType: MANUAL_SERVICE_TYPES[0],
    otherServiceType: '',
    description: '',
    paymentMethod: 'CASH',
    cogsAmount: '0.00',
    totalAmountCollected: '',
    taxCollected: 'yes',
    technicianId: '',
    otherTechnicianName: '',
    technicianCommission: '0.00',
  });

  useEffect(() => {
    fetchAuthAndJobs();
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
      }

      // Fetch only active technicians with their commission rates.
      const usersRes = await fetch('/api/auth/users?role=TECHNICIAN&activeOnly=true');
      const usersData = await usersRes.json();
      if (usersData.success && usersData.users.length > 0) {
        setTechnicians(usersData.users);
        const selectedTech = usersData.users.find((tech: any) => tech.id === technicianId) || usersData.users[0];
        setTechnicianId(selectedTech.id);
        setWorkerCommissionRate(Number(selectedTech.commissionRate || 0).toFixed(2));
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
          technicianId,
          isScheduled,
          scheduledFor: isScheduled && scheduledFor ? scheduledFor : null,
          vehicleYear: vehicleYear || null,
          vehicleMake: vehicleMake || null,
          vehicleModel: vehicleModel || null,
          vehicleVin: vehicleVin || null,
          keyType: keyType || null,
          fccId: fccId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch job');
      }

      setSuccessMsg(`✅ Job #${data.job.jobNumber} created! Technician and customer on-the-way notifications sent.`);
      // Reset form
      setCustomerName('');
      setCustomerPhone('');
      setCustomerExtension('');
      setServiceAddress('');
      setProblemDescription('');
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
      setSuccessMsg(`✅ ${data.message}`);
      fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setDeletingTechnicianId(null);
    }
  };

  const updateManualField = (field: string, value: string) => {
    setManualForm((current) => ({ ...current, [field]: value }));
  };

  const resetManualJob = () => {
    setManualForm({
      jobNumber: '', customerName: '', customerPhone: '', customerExtension: '', serviceAddress: '',
      serviceType: MANUAL_SERVICE_TYPES[0], otherServiceType: '', description: '', paymentMethod: 'CASH',
      cogsAmount: '0.00', totalAmountCollected: '', taxCollected: 'yes', technicianId: technicians[0]?.id || '',
      otherTechnicianName: '',
      technicianCommission: '0.00',
    });
  };

  const openNewManualJob = () => {
    setEditingManualId(null);
    resetManualJob();
    setShowManualJob(true);
  };

  const openEditManualJob = (job: Job) => {
    const knownType = MANUAL_SERVICE_TYPES.includes(job.serviceType as (typeof MANUAL_SERVICE_TYPES)[number]);
    setEditingManualId(job.id);
    setManualForm({
      jobNumber: String(job.jobNumber),
      customerName: job.customer.name,
      customerPhone: job.customer.phone,
      customerExtension: job.customer.extension || '',
      serviceAddress: job.serviceAddress,
      serviceType: knownType ? job.serviceType : 'Other',
      otherServiceType: knownType ? '' : job.serviceType,
      description: job.problemDescription,
      paymentMethod: job.invoice?.paymentMethod || 'CASH',
      cogsAmount: Number(job.invoice?.cogsAmount || 0).toFixed(2),
      totalAmountCollected: Number(job.invoice?.totalAmountCollected || job.invoice?.grandTotal || 0).toFixed(2),
      taxCollected: job.invoice?.taxCollected === false ? 'no' : 'yes',
      technicianId: job.technician?.id || (job.technicianName ? 'OTHER' : ''),
      otherTechnicianName: job.technicianName || '',
      technicianCommission: Number(job.workerCommission || 0).toFixed(2),
    });
    setShowManualJob(true);
  };

  const handleManualJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch(editingManualId ? `/api/jobs/manual/${editingManualId}` : '/api/jobs/manual', {
        method: editingManualId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...manualForm, taxCollected: manualForm.taxCollected === 'yes' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to record manual job');
      setSuccessMsg(`✅ ${data.message}`);
      setShowManualJob(false);
      setEditingManualId(null);
      resetManualJob();
      fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setManualSubmitting(false);
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
        setShowManualJob(false);
        setEditingManualId(null);
      }
      fetchAuthAndJobs();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setDeletingManualId(null);
    }
  };

  const filteredJobs = jobs.filter((j) => {
    if (filter === 'ALL') return true;
    if (filter === 'ACTIVE') return ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(j.status) && !j.isScheduled;
    if (filter === 'SCHEDULED') return !!j.isScheduled;
    if (filter === 'COMPLETED') return j.status === 'COMPLETED';
    if (filter === 'ABANDONED') return j.status === 'ABANDONED_TRAVEL_FEE';
    return j.status === filter;
  });
  const manualJobs = jobs.filter((j) => j.isManual);
  const canManageManualJobs = currentUser?.role === 'ADMIN' || currentUser?.role === 'DISPATCHER';
  const canManageTechnicians = currentUser?.role === 'ADMIN' || currentUser?.role === 'DISPATCHER';

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <span>📞</span> Dispatch Desk & Call Intake
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
              onClick={openNewManualJob}
              className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-extrabold shadow-md transition"
            >
              + Add Manual Job
            </button>
          </div>
        )}
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

      {canManageManualJobs && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">Manual Job Entries</h2>
              <p className="text-xs text-slate-500 mt-0.5">All manually recorded completed jobs. Admins and Dispatchers can edit or delete these entries.</p>
            </div>
            <span className="text-xs font-black text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1">{manualJobs.length} entries</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px]">
                  <th className="py-2.5 px-4">Job #</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Technician</th>
                  <th className="py-2.5 px-4">Payment</th>
                  <th className="py-2.5 px-4">Total Collected</th>
                  <th className="py-2.5 px-4">COGS (Parts, etc.)</th>
                  <th className="py-2.5 px-4">HST Amount</th>
                  <th className="py-2.5 px-4">Tax Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {manualJobs.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 px-4 text-center text-slate-500">No manual job entries yet.</td>
                  </tr>
                )}
                {manualJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-black text-slate-900">#{job.jobNumber}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-800">{job.customer.name}</div>
                      <div className="text-[10px] text-slate-500">{job.customer.phone}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-[180px]">{job.serviceType}</td>
                    <td className="py-3 px-4 text-slate-700">{job.technician?.name || job.technicianName || 'Unassigned'}</td>
                    <td className="py-3 px-4 font-bold text-slate-700">{(job.invoice?.paymentMethod || '—').replace('_', ' ')}</td>
                    <td className="py-3 px-4 font-black text-slate-900">${Number(job.invoice?.totalAmountCollected || job.invoice?.grandTotal || 0).toFixed(2)}</td>
                    <td className="py-3 px-4 text-slate-700">${Number(job.invoice?.cogsAmount || 0).toFixed(2)}</td>
                    <td className="py-3 px-4 font-black text-amber-700">${Number(job.invoice?.taxAmount || 0).toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <span className={job.invoice?.taxCollected === false ? 'font-bold text-rose-700' : 'font-bold text-emerald-700'}>
                        {job.invoice?.taxCollected === false ? 'Off Books' : 'On Books'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button type="button" onClick={() => openEditManualJob(job)} className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold mr-1.5">Edit</button>
                      <button type="button" disabled={deletingManualId === job.id} onClick={() => handleDeleteManualJob(job)} className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold disabled:opacity-50">{deletingManualId === job.id ? 'Deleting…' : 'Delete'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
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
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? 'Dispatching...' : isScheduled ? '📅 Schedule Appointment & Notify Tech' : '🚀 Create & Dispatch Job'}
            </button>
          </form>
        </div>

        {/* Right Column: Active Dispatch Board / Jobs Queue */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>Jobs Board</span>
              <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                {jobs.length} Total
              </span>
            </h2>

            {/* Filter Pills */}
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

      {showManualJob && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="manual-job-title" className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl border border-slate-200">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 id="manual-job-title" className="text-xl font-black text-slate-900">{editingManualId ? 'Edit Manual Job' : 'Add Manual Job'}</h2>
                <p className="text-xs text-slate-500 mt-1">{editingManualId ? 'Update this completed manual entry.' : 'Record a completed job without dispatch notifications.'}</p>
              </div>
              <button type="button" onClick={() => setShowManualJob(false)} className="text-slate-400 hover:text-slate-900 text-xl" aria-label="Close">×</button>
            </div>
            <form onSubmit={handleManualJob} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
              <div>
                <label className="field-label">Job number *</label>
                <input aria-label="Job number" required type="number" min="1" step="1" value={manualForm.jobNumber} onChange={(e) => updateManualField('jobNumber', e.target.value)} className="field-input" />
              </div>
              <div>
                <label className="field-label">Customer name *</label>
                <input aria-label="Customer name" required value={manualForm.customerName} onChange={(e) => updateManualField('customerName', e.target.value)} className="field-input" />
              </div>
              <div>
                <label className="field-label">Customer phone number *</label>
                <input aria-label="Customer phone number" required value={manualForm.customerPhone} onChange={(e) => updateManualField('customerPhone', e.target.value)} className="field-input" />
              </div>
              <div>
                <label className="field-label">Extension (optional)</label>
                <input aria-label="Customer phone extension" value={manualForm.customerExtension} onChange={(e) => updateManualField('customerExtension', e.target.value)} className="field-input" />
              </div>
              <div className="sm:col-span-2">
                <label className="field-label">Service address *</label>
                <input aria-label="Service address" required value={manualForm.serviceAddress} onChange={(e) => updateManualField('serviceAddress', e.target.value)} className="field-input" />
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
                <label className="field-label">Total amount collected *</label>
                <input aria-label="Total amount collected" required type="number" min="0.01" step="0.01" value={manualForm.totalAmountCollected} onChange={(e) => updateManualField('totalAmountCollected', e.target.value)} className="field-input" />
              </div>
              <div>
                <label className="field-label">COGS (Parts, etc.) amount *</label>
                <input aria-label="COGS (Parts, etc.) amount" required type="number" min="0" step="0.01" value={manualForm.cogsAmount} onChange={(e) => updateManualField('cogsAmount', e.target.value)} className="field-input" />
              </div>
              <div>
                <label className="field-label">Tax collected *</label>
                <select aria-label="Tax collected status" value={manualForm.taxCollected} onChange={(e) => updateManualField('taxCollected', e.target.value)} className="field-input bg-white">
                  <option value="yes">Yes — on books</option><option value="no">No — off books transaction</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Bookkeeping status only; this does not calculate Ontario tax.</p>
              </div>
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
                <button type="button" onClick={() => setShowManualJob(false)} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-bold">Cancel</button>
                <button type="submit" disabled={manualSubmitting} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50">{manualSubmitting ? 'Saving...' : editingManualId ? 'Save Changes' : 'Save Manual Job'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
