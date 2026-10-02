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

/** Two-hour intake windows used by the manual completed-job form. */
export const MANUAL_JOB_RECEIVED_TIME_SLOTS = [
  '12:00 AM - 02:00 AM',
  '02:00 AM - 04:00 AM',
  '04:00 AM - 06:00 AM',
  '06:00 AM - 08:00 AM',
  '08:00 AM - 10:00 AM',
  '10:00 AM - 12:00 PM',
  '12:00 PM - 02:00 PM',
  '02:00 PM - 04:00 PM',
  '04:00 PM - 06:00 PM',
  '06:00 PM - 08:00 PM',
  '08:00 PM - 10:00 PM',
  '10:00 PM - 12:00 AM',
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
      paymentStatus?: string | null;
      paymentMethod?: string | null;
      paymentProvider?: string | null;
    } | null;
  }
>(job: T): T {
  if (!job.isManual || !job.invoice) return job;

  // Pending dual-price card quotes store the accepted card service price
  // before Stripe Tax. No separate card-fee line is added. Once paid, the
  // webhook stores Stripe's authoritative tax and total. Never reinterpret
  // either shape as a legacy tax-inclusive manual amount while reading jobs.
  const isPendingCard = job.invoice.paymentStatus === 'PENDING'
    && ['CREDIT_CARD', 'DEBIT_CARD'].includes(job.invoice.paymentMethod || '');
  if (isPendingCard || job.invoice.paymentProvider === 'STRIPE') return job;

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
