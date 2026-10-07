import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { findJobsWithDetails, findTechniciansWithSettlements } from '@/lib/job-helper';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { calculateTechnicianCashLedger, type ReportingJob } from '@/lib/operations-reporting';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });

    const [rawJobs, technicians] = await Promise.all([
      findJobsWithDetails({ where: { invoice: { is: { paymentStatus: 'PAID' } } } }),
      findTechniciansWithSettlements(),
    ]);
    const jobs = rawJobs.map(normalizeManualJobInvoice) as ReportingJob[];
    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      currencyCode: 'CAD',
      ledger: calculateTechnicianCashLedger(jobs, technicians),
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error: any) {
    logCaughtRequestError(request, '/api/admin/cash-ledger', error);
    return NextResponse.json(
      { success: false, error: getApiErrorMessage(error, 'Unable to load the cash settlement ledger') },
      { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    );
  }
}

export const GET = withRequestLogging('/api/admin/cash-ledger', handleGET);
