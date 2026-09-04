/**
 * Financial Calculation Engine for Locksmith Operations
 * - Ontario 13% HST (Tax)
 * - Fixed 4% Credit Card Surcharge for Stripe
 * - Forward calculation (Items -> Subtotal + Tax + Surcharge)
 * - Reverse calculation (Lump sum received -> Subtotal + Tax breakdown)
 * - Contractor Commission & Cash-in-hand Settlement Ledger
 */

export const ONTARIO_HST_RATE = 0.13;
export const STRIPE_CARD_SURCHARGE_RATE = 0.04;

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

export function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Forward Mode:
 * Given labor amount and parts items, calculates subtotal, 13% HST,
 * and optional 4% Stripe card surcharge.
 */
export function calculateForwardInvoice(params: {
  laborAmount: number;
  partsTotal?: number;
  paymentMethod: 'CASH' | 'INTERAC' | 'STRIPE_CARD';
}): CalculationBreakdown {
  const partsTotal = roundToTwo(params.partsTotal || 0);
  const laborTotal = roundToTwo(params.laborAmount || 0);
  const subtotal = roundToTwo(laborTotal + partsTotal);
  const taxAmount = roundToTwo(subtotal * ONTARIO_HST_RATE);

  let cardSurchargeAmount = 0;
  if (params.paymentMethod === 'STRIPE_CARD') {
    cardSurchargeAmount = roundToTwo((subtotal + taxAmount) * STRIPE_CARD_SURCHARGE_RATE);
  }

  const grandTotal = roundToTwo(subtotal + taxAmount + cardSurchargeAmount);

  return {
    subtotal,
    partsTotal,
    laborTotal,
    taxRate: ONTARIO_HST_RATE,
    taxAmount,
    cardSurchargeRate: params.paymentMethod === 'STRIPE_CARD' ? STRIPE_CARD_SURCHARGE_RATE : 0,
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
  paymentMethod?: 'CASH' | 'INTERAC' | 'STRIPE_CARD';
}): CalculationBreakdown {
  const grandTotal = roundToTwo(params.amountReceived);
  const partsTotal = roundToTwo(params.partsTotal || 0);

  // If card payment in reverse mode: Total = (Subtotal + Tax) * 1.04
  let basePlusTax = grandTotal;
  let cardSurchargeAmount = 0;

  if (params.paymentMethod === 'STRIPE_CARD') {
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
    cardSurchargeRate: params.paymentMethod === 'STRIPE_CARD' ? STRIPE_CARD_SURCHARGE_RATE : 0,
    cardSurchargeAmount,
    grandTotal,
  };
}

/**
 * Abandoned Job Travel Fee Calculator:
 * Standard $20 or $25 travel fee + 13% HST (+ optional 4% Stripe card fee)
 */
export function calculateTravelFee(params: {
  travelFeeAmount: number; // e.g. 20 or 25
  paymentMethod: 'CASH' | 'INTERAC' | 'STRIPE_CARD';
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
  paymentMethod: 'CASH' | 'INTERAC' | 'STRIPE_CARD';
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
    // Interac or Stripe
    return {
      cashOwedToCompany: 0,
      companyOwesWorker: commission,
      netWorkerBalanceChange: -commission,
    };
  }
}
