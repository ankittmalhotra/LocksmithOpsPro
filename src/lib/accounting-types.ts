/** Stable Books entity identifiers. These values are safe to expose to the UI. */
export const ACCOUNTING_ENTITY_CODES = ['IT_MARKETING', 'LOCKSMITH'] as const;
export type AccountingEntityCode = (typeof ACCOUNTING_ENTITY_CODES)[number];

export const ACCOUNTING_PERMISSIONS = [
  'view',
  'manage_expenses',
  'manage_reimbursements',
  'map_accounting',
  'issue_invoices',
  'mark_payments',
] as const;
export type AccountingPermission = (typeof ACCOUNTING_PERMISSIONS)[number];

export interface AccountingEntitySummary {
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
  hstEffectiveDate: string | null;
  hstEnabled: boolean;
  currency: string;
}

/** Values used when an entity has not yet been inserted by the seed/bootstrap. */
export const ACCOUNTING_ENTITY_DEFAULTS: Record<
  AccountingEntityCode,
  Omit<AccountingEntitySummary, 'id' | 'currency'> & {
    partnerBillingAnchor: string;
  }
> = {
  IT_MARKETING: {
    code: 'IT_MARKETING',
    legalName: '1001744934 ONTARIO INC.',
    corporationNumber: '1001744934',
    email: null,
    addressLine1: null,
    city: null,
    province: 'Ontario',
    postalCode: null,
    country: 'Canada',
    authorizedPersonName: null,
    authorizedPersonTitle: null,
    hstRegistrationNumber: '752857771RT0001',
    hstEffectiveDate: null,
    hstEnabled: false,
    partnerBillingAnchor: '2026-09-07',
  },
  LOCKSMITH: {
    code: 'LOCKSMITH',
    legalName: '1001348245 ONTARIO INC.',
    corporationNumber: '1001348245',
    email: 'bcltoronto1@gmail.com',
    addressLine1: '27 Knollside Drive',
    city: 'Richmond Hill',
    province: 'Ontario',
    postalCode: 'L4C4W7',
    country: 'Canada',
    authorizedPersonName: 'UMAR QURESHI',
    authorizedPersonTitle: 'Director',
    // Locksmith registration supplied by the business; normalized to the
    // CRA/Stripe identifier form without display spaces.
    hstRegistrationNumber: '702291725RT0001',
    hstEffectiveDate: '2026-01-01',
    hstEnabled: true,
    partnerBillingAnchor: '2026-09-07',
  },
};
