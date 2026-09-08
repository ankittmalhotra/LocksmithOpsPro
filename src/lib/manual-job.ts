export const MANUAL_SERVICE_TYPES = [
  'Commercial Lock Change',
  'Storefront Mortise Cylinder',
  'Residential Lockout',
  'Deadbolt Installation',
  'Rekey Master Key System',
  'Automotive Lockout / Key Generation',
  'Car Lockout',
  'Safe Opening',
] as const;

export const MANUAL_PAYMENT_METHODS = [
  'CASH',
  'INTERAC',
  'DEBIT_CARD',
  'CREDIT_CARD',
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
