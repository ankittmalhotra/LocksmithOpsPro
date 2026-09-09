import { calculateManualInvoice } from './calculations';

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

/**
 * Rebuilds accounting fields for manual jobs when reading legacy records that
 * were created before tax-inclusive HST extraction was introduced.
 */
export function normalizeManualJobInvoice<
  T extends {
    isManual: boolean;
    invoice: {
      totalAmountCollected: number;
      grandTotal: number;
      taxCollected: boolean;
    } | null;
  }
>(job: T): T {
  if (!job.isManual || !job.invoice) return job;

  const calculation = calculateManualInvoice({
    amountCollected: job.invoice.totalAmountCollected || job.invoice.grandTotal,
    taxCollected: job.invoice.taxCollected !== false,
  });

  return {
    ...job,
    invoice: {
      ...job.invoice,
      subtotal: calculation.subtotal,
      laborTotal: calculation.laborTotal,
      taxRate: calculation.taxRate,
      taxAmount: calculation.taxAmount,
      grandTotal: calculation.grandTotal,
    },
  };
}
