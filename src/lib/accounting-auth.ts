import { prisma } from './prisma';
import { getCurrentUser } from './auth';
import type { AuthSession } from './session';
import { ACCOUNTING_ENTITY_DEFAULTS, type AccountingEntityCode, type AccountingPermission } from './accounting-types';

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

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002',
  );
}

/**
 * Production deployments may have the additive Books tables but have skipped
 * the one-time seed. Resolve the stable entity from the database, creating
 * only the requested fixed entity when an Admin (or Locksmith Dispatcher)
 * first opens Books. This keeps the access check fail-closed while allowing a
 * deployment to recover from a missing seed without exposing either entity to
 * an unauthorized role.
 */
async function findOrBootstrapEntity(entityCode: AccountingEntityCode, currentUser: AuthSession) {
  const existing = await prisma.accountingEntity.findUnique({
    where: { code: entityCode },
    select: ENTITY_SELECT,
  });
  if (existing && currentUser.role !== 'ADMIN') return existing;
  if (currentUser.role !== 'ADMIN' && !(currentUser.role === 'DISPATCHER' && entityCode === 'LOCKSMITH')) {
    return existing;
  }

  const codes = currentUser.role === 'ADMIN' ? ['IT_MARKETING', 'LOCKSMITH'] as const : [entityCode];
  const entities = await Promise.all(codes.map(async (code) => {
    const defaults = ACCOUNTING_ENTITY_DEFAULTS[code];
    try {
      return await prisma.accountingEntity.upsert({
        where: { code },
        update: {},
        create: {
          code: defaults.code,
          legalName: defaults.legalName,
          corporationNumber: defaults.corporationNumber,
          email: defaults.email,
          addressLine1: defaults.addressLine1,
          city: defaults.city,
          province: defaults.province,
          postalCode: defaults.postalCode,
          country: defaults.country,
          authorizedPersonName: defaults.authorizedPersonName,
          authorizedPersonTitle: defaults.authorizedPersonTitle,
          partnerBillingAnchor: new Date(`${defaults.partnerBillingAnchor}T00:00:00.000Z`),
        },
        select: ENTITY_SELECT,
      });
    } catch (error) {
      // Concurrent Books requests can both observe a missing seed row. Prisma's
      // upsert may surface the losing insert as P2002 instead of returning the
      // row, so resolve the row created by the winning request.
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await prisma.accountingEntity.findUnique({ where: { code }, select: ENTITY_SELECT });
      if (!existing) throw error;
      return existing;
    }
  }));
  return entities.find((entity) => entity.code === entityCode) || existing;
}

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

  const entity = await findOrBootstrapEntity(entityCode, currentUser);
  if (!entity) return null;

  if (currentUser.role === 'ADMIN') {
    return { user: currentUser, entity, canView: true, canManageExpenses: true, canIssueInvoices: true, canMarkPayments: true };
  }

  // The existing Dispatcher role is explicitly limited to the locksmith
  // company's books. Membership rows can tighten this access, but can never
  // grant a dispatcher visibility into the IT/marketing entity.
  if (currentUser.role === 'DISPATCHER' && entityCode !== 'LOCKSMITH') return null;

  let membership = await prisma.accountingEntityMembership.findUnique({
    where: { userId_entityId: { userId: currentUser.id, entityId: entity.id } },
    select: { canView: true, canManageExpenses: true, canIssueInvoices: true, canMarkPayments: true },
  });

  // Existing Dispatchers are also provisioned lazily for the Locksmith book;
  // they never receive a membership for the private IT/marketing entity.
  if (!membership && currentUser.role === 'DISPATCHER' && entityCode === 'LOCKSMITH') {
    try {
      membership = await prisma.accountingEntityMembership.upsert({
        where: { userId_entityId: { userId: currentUser.id, entityId: entity.id } },
        update: {},
        create: { userId: currentUser.id, entityId: entity.id, canView: true, canManageExpenses: true, canIssueInvoices: false, canMarkPayments: false },
        select: { canView: true, canManageExpenses: true, canIssueInvoices: true, canMarkPayments: true },
      });
    } catch (error) {
      // Several Books API requests load in parallel on first visit. If another
      // request wins the composite-key insert, reuse its membership instead of
      // surfacing a false Books access error to the dispatcher.
      if (!isUniqueConstraintError(error)) throw error;
      membership = await prisma.accountingEntityMembership.findUnique({
        where: { userId_entityId: { userId: currentUser.id, entityId: entity.id } },
        select: { canView: true, canManageExpenses: true, canIssueInvoices: true, canMarkPayments: true },
      });
      if (!membership) throw error;
    }
  }

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
