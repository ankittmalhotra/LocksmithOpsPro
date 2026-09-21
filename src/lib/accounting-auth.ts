import { prisma } from './prisma';
import { getCurrentUser } from './auth';
import type { AuthSession } from './session';
import type { AccountingEntityCode, AccountingPermission } from './accounting-types';

export interface AccountingEntityAccess {
  user: AuthSession;
  entity: {
    id: string;
    code: AccountingEntityCode;
    legalName: string;
    corporationNumber: string | null;
    email: string | null;
    addressLine1: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string;
    authorizedPersonName: string | null;
    authorizedPersonTitle: string | null;
    hstRegistrationNumber: string | null;
    hstEffectiveDate: Date | null;
    hstEnabled: boolean;
    currency: string;
  };
  canView: boolean;
  canManageExpenses: boolean;
  canIssueInvoices: boolean;
  canMarkPayments: boolean;
}

const ENTITY_SELECT = {
  id: true,
  code: true,
  legalName: true,
  corporationNumber: true,
  email: true,
  addressLine1: true,
  city: true,
  province: true,
  postalCode: true,
  country: true,
  authorizedPersonName: true,
  authorizedPersonTitle: true,
  hstRegistrationNumber: true,
  hstEffectiveDate: true,
  hstEnabled: true,
  currency: true,
} as const;

/**
 * Resolve Books access on the server. Never trust an entity id supplied by a
 * browser: callers should pass the stable code and this function resolves it
 * against the database.
 */
export async function getAccountingEntityAccess(
  entityCode: AccountingEntityCode,
  user: AuthSession | null = null,
): Promise<AccountingEntityAccess | null> {
  const currentUser = user ?? await getCurrentUser();
  if (!currentUser) return null;

  const entity = await prisma.accountingEntity.findUnique({
    where: { code: entityCode },
    select: ENTITY_SELECT,
  });
  if (!entity) return null;

  if (currentUser.role === 'ADMIN') {
    return { user: currentUser, entity, canView: true, canManageExpenses: true, canIssueInvoices: true, canMarkPayments: true };
  }

  // The existing Dispatcher role is explicitly limited to the locksmith
  // company's books. Membership rows can tighten this access, but can never
  // grant a dispatcher visibility into the IT/marketing entity.
  if (currentUser.role === 'DISPATCHER' && entityCode !== 'LOCKSMITH') return null;

  const membership = await prisma.accountingEntityMembership.findUnique({
    where: { userId_entityId: { userId: currentUser.id, entityId: entity.id } },
    select: { canView: true, canManageExpenses: true, canIssueInvoices: true, canMarkPayments: true },
  });

  // Membership is the source of truth for entity-level Books access. The
  // deployment seed provisions existing Admins and Dispatchers; a missing row
  // must remain denied so a revoked membership cannot silently regain access.
  if (!membership) return null;
  if (!membership.canView) return null;

  return { user: currentUser, entity, ...membership };
}

export async function requireAccountingEntityAccess(
  entityCode: AccountingEntityCode,
  permission: AccountingPermission = 'view',
  user: AuthSession | null = null,
): Promise<AccountingEntityAccess> {
  const access = await getAccountingEntityAccess(entityCode, user);
  const currentUser = user ?? await getCurrentUser();
  // Partner invoices are issued by the IT/marketing Admin, and only Admin
  // may mark their payment as received. Membership flags cannot elevate
  // either capability for another application role.
  if ((permission === 'issue_invoices' || permission === 'mark_payments') && currentUser?.role !== 'ADMIN') {
    throw new Error('Forbidden: Admin access required');
  }
  const allowed = access && (
    permission === 'view' ? access.canView
      : permission === 'manage_expenses' ? access.canManageExpenses
        : permission === 'issue_invoices' ? access.canIssueInvoices
          : access.canMarkPayments
  );
  if (!access || !allowed) {
    throw new Error('Forbidden: Books access required');
  }
  return access;
}

export function assertPartnerInvoiceTaxConfiguration(
  entity: Pick<AccountingEntityAccess['entity'], 'hstEnabled' | 'hstRegistrationNumber' | 'hstEffectiveDate'>,
  hstRateBps: number,
): void {
  if (!Number.isSafeInteger(hstRateBps) || hstRateBps < 0 || hstRateBps > 10_000) {
    throw new Error('Invoice HST rate must be an integer between 0 and 10000 basis points');
  }
  // A deliberate zero rate is permitted for a non-taxable invoice. Any
  // non-zero HST charge requires all registration details to be configured.
  if (hstRateBps === 0) return;
  if (!entity.hstEnabled || !entity.hstRegistrationNumber?.trim() || !entity.hstEffectiveDate) {
    throw new Error('HST registration number, effective date, and enabled status are required before charging HST');
  }
}

/** Use this from every partner-invoice issuance endpoint. */
export async function requirePartnerInvoiceIssuanceAccess(
  entityCode: AccountingEntityCode,
  hstRateBps: number,
  user: AuthSession | null = null,
): Promise<AccountingEntityAccess> {
  const access = await requireAccountingEntityAccess(entityCode, 'issue_invoices', user);
  assertPartnerInvoiceTaxConfiguration(access.entity, hstRateBps);
  return access;
}

export async function canMarkPartnerInvoicePayment(user: AuthSession | null = null): Promise<boolean> {
  const currentUser = user ?? await getCurrentUser();
  return currentUser?.role === 'ADMIN';
}
