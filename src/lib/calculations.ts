/**
 * Financial Calculation Engine for Locksmith Operations
 * - Ontario 13% HST (Tax)
 * - Fixed 4% Credit Card Surcharge for Stripe
 * - Forward calculation (Items -> Subtotal + Tax + Surcharge)
 * - Reverse calculation (Lump sum received -> Subtotal + Tax breakdown)
 * - Contractor Commission & Cash-in-hand Settlement Ledger
 */

export const ONTARIO_HST_RATE = 0.13;
export const STRIPE_CARD_SURCHARGE_RATE = 0.024; // 2.4% Canadian Code of Conduct compliant merchant acceptance cap
export const CRA_HST_BUSINESS_NUMBER = '83921 4092 RT0001';

export interface CalculationBreakdown {
  subtotal: number;
  partsTotal: number;
  laborTotal: number;
  taxRate: number;
  taxAmount: number;
  cardSurchargeRate: number;
  cardSurchargeAmount: number;
  grandTotal: number;
}

export const SUPPORTED_PAYMENT_METHODS = [
  'CASH',
  'INTERAC',
  'STRIPE_CARD',
  'DEBIT_CARD',
  'CREDIT_CARD',
] as const;

// Closeout is intentionally narrower than calculation support until a card
// processor reference can be persisted and audited by this application.
export const SUPPORTED_CLOSEOUT_PAYMENT_METHODS = ['CASH', 'INTERAC'] as const;

export type SupportedPaymentMethod = (typeof SUPPORTED_PAYMENT_METHODS)[number];

export function isCardPaymentMethod(method?: string): boolean {
  return method === 'STRIPE_CARD' || method === 'CREDIT_CARD' || method === 'DEBIT_CARD';
}

export function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Forward Mode:
 * Given labor amount and parts items, calculates subtotal, 13% HST,
 * and optional Stripe card surcharge.
 */
export function calculateForwardInvoice(params: {
  laborAmount: number;
  partsTotal?: number;
  paymentMethod: SupportedPaymentMethod;
}): CalculationBreakdown {
  const partsTotal = roundToTwo(params.partsTotal || 0);
  const laborTotal = roundToTwo(params.laborAmount || 0);
  const subtotal = roundToTwo(laborTotal + partsTotal);
  const taxAmount = roundToTwo(subtotal * ONTARIO_HST_RATE);

  const isCard = isCardPaymentMethod(params.paymentMethod);
  let cardSurchargeAmount = 0;
  if (isCard) {
    cardSurchargeAmount = roundToTwo((subtotal + taxAmount) * STRIPE_CARD_SURCHARGE_RATE);
  }

  const grandTotal = roundToTwo(subtotal + taxAmount + cardSurchargeAmount);

  return {
    subtotal,
    partsTotal,
    laborTotal,
    taxRate: ONTARIO_HST_RATE,
    taxAmount,
    cardSurchargeRate: isCard ? STRIPE_CARD_SURCHARGE_RATE : 0,
    cardSurchargeAmount,
    grandTotal,
  };
}

/**
 * Reverse Mode:
 * Given total amount received (e.g. $1,661.77 cash/Interac),
 * back-calculates Subtotal (Job) + 13% HST.
 * Also accounts for any parts specified to deduce labor charge.
 */
export function calculateReverseInvoice(params: {
  amountReceived: number;
  partsTotal?: number;
  paymentMethod?: SupportedPaymentMethod;
}): CalculationBreakdown {
  const grandTotal = roundToTwo(params.amountReceived);
  const partsTotal = roundToTwo(params.partsTotal || 0);

  const isCard = isCardPaymentMethod(params.paymentMethod);
  let basePlusTax = grandTotal;
  let cardSurchargeAmount = 0;

  if (isCard) {
    basePlusTax = roundToTwo(grandTotal / (1 + STRIPE_CARD_SURCHARGE_RATE));
    cardSurchargeAmount = roundToTwo(grandTotal - basePlusTax);
  }

  // basePlusTax = Subtotal * 1.13
  const subtotal = roundToTwo(basePlusTax / (1 + ONTARIO_HST_RATE));
  const taxAmount = roundToTwo(basePlusTax - subtotal);
  const laborTotal = roundToTwo(Math.max(0, subtotal - partsTotal));

  return {
    subtotal,
    partsTotal,
    laborTotal,
    taxRate: ONTARIO_HST_RATE,
    taxAmount,
    cardSurchargeRate: isCard ? STRIPE_CARD_SURCHARGE_RATE : 0,
    cardSurchargeAmount,
    grandTotal,
  };
}

/**
 * Manual invoice mode:
 * The amount entered by the dispatcher is the final, tax-inclusive amount
 * collected from the customer. When the job is on books, extract the 13% HST
 * component from that amount. COGS is tracked separately as a direct cost.
 */
export function calculateManualInvoice(params: {
  amountCollected: number;
  taxCollected: boolean;
}): CalculationBreakdown {
  const grandTotal = roundToTwo(params.amountCollected);
  const taxRate = params.taxCollected ? ONTARIO_HST_RATE : 0;
  const subtotal = params.taxCollected
    ? roundToTwo(grandTotal / (1 + taxRate))
    : grandTotal;
  const taxAmount = roundToTwo(grandTotal - subtotal);

  return {
    subtotal,
    partsTotal: 0,
    laborTotal: subtotal,
    taxRate,
    taxAmount,
    cardSurchargeRate: 0,
    cardSurchargeAmount: 0,
    grandTotal,
  };
}

/**
 * Abandoned Job Travel Fee Calculator:
 * Standard $20 or $25 travel fee + 13% HST (+ optional Stripe card fee)
 */
export function calculateTravelFee(params: {
  travelFeeAmount: number; // e.g. 20 or 25
  paymentMethod: SupportedPaymentMethod;
}): CalculationBreakdown {
  return calculateForwardInvoice({
    laborAmount: params.travelFeeAmount,
    partsTotal: 0,
    paymentMethod: params.paymentMethod,
  });
}

/**
 * Cash Ledger Position Calculator:
 * Calculates what the worker owes the company (or company owes worker) for a job.
 * - If Paid by Cash: Worker collected physical cash.
 *   Worker owes company = Total Cash Collected - Worker's Commission.
 * - If Paid by Card / Interac: Funds go directly to company.
 *   Company owes worker = Worker's Commission (net position: -commission).
 */
export function calculateJobSettlementPosition(params: {
  paymentMethod: SupportedPaymentMethod;
  grandTotal: number;
  workerCommission: number;
}): {
  cashOwedToCompany: number;
  companyOwesWorker: number;
  netWorkerBalanceChange: number; // Positive = worker owes company, Negative = company owes worker
} {
  const grandTotal = roundToTwo(params.grandTotal);
  const commission = roundToTwo(params.workerCommission);

  if (params.paymentMethod === 'CASH') {
    const cashOwed = roundToTwo(grandTotal - commission);
    return {
      cashOwedToCompany: Math.max(0, cashOwed),
      companyOwesWorker: cashOwed < 0 ? roundToTwo(Math.abs(cashOwed)) : 0,
      netWorkerBalanceChange: cashOwed,
    };
  } else {
    // Interac, Debit or Credit Card
    return {
      cashOwedToCompany: 0,
      companyOwesWorker: commission,
      netWorkerBalanceChange: -commission,
    };
  }
}
