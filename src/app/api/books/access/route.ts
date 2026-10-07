import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { ACCOUNTING_ENTITY_CODES } from '@/lib/accounting-types';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    const entities = [];
    for (const code of ACCOUNTING_ENTITY_CODES) {
      const access = await getAccountingEntityAccess(code, user);
      if (!access?.canView) continue;
      entities.push({
        code,
        legalName: access.entity.legalName,
        capabilities: {
          view: access.canView,
          manageExpenses: access.canManageExpenses,
          manageReimbursements: access.canManageReimbursements,
          mapAccounts: access.canMapAccounting && (user.role === 'ADMIN' || user.role === 'ACCOUNTANT'),
          issueInvoices: user.role === 'ADMIN' && access.canIssueInvoices,
          markPayments: user.role === 'ADMIN' && access.canMarkPayments,
          isAdmin: user.role === 'ADMIN',
          // The operations report is based on Locksmith job data. Keep its
          // entry point aligned with the route's server-side role gate.
          viewOperationalReport: user.role === 'ADMIN' || user.role === 'DISPATCHER',
        },
      });
    }
    return NextResponse.json({ success: true, entities });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/access', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load Books access') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/books/access', handleGET);
