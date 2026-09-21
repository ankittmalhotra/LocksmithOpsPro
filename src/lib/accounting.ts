import type { AccountingEntityCode } from './accounting-types';

export const PARTNER_BILLING_ANCHOR = '2026-09-07';
export const PARTNER_BILLING_PERIOD_DAYS = 14;
export const PARTNER_SHARE_RATE_BPS = 5_000; // 50.00%
export const ONTARIO_HST_RATE_BPS = 1_300; // 13.00%
export const PARTNER_INVOICE_DESCRIPTION_PREFIX = 'IT Services for Locksmith';

export interface PartnerBillingCalculationInput {
  revenueCents: number;
  hstDeductedCents: number;
  cogsCents: number;
  technicianCommissionsCents: number;
  priorNegativeCarryForwardCents?: number;
  shareRateBps?: number;
  hstRateBps?: number;
}

export interface PartnerBillingCalculation {
  operationalProfitCents: number;
  priorNegativeCarryForwardCents: number;
  adjustedProfitCents: number;
  negativeCarryForwardCents: number;
  partnerFeeCents: number;
  hstCents: number;
  invoiceTotalCents: number;
}

function assertSafeCents(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer number of cents`);
  }
  return value;
}

function assertNonNegativeCents(value: number, label: string): number {
  assertSafeCents(value, label);
  if (value < 0) throw new Error(`${label} cannot be negative`);
  return value;
}

function roundBps(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / 10_000);
}

/**
 * Calculates the partner invoice from the agreed period snapshot.
 *
 * A loss is stored as a positive carry-forward amount. It reduces the next
 * period before the 50% split and cannot generate a negative invoice.
 */
export function calculatePartnerBilling(input: PartnerBillingCalculationInput): PartnerBillingCalculation {
  const revenue = assertNonNegativeCents(input.revenueCents, 'revenueCents');
  const hstDeducted = assertNonNegativeCents(input.hstDeductedCents, 'hstDeductedCents');
  const cogs = assertNonNegativeCents(input.cogsCents, 'cogsCents');
  const technicianCommissions = assertNonNegativeCents(
    input.technicianCommissionsCents,
    'technicianCommissionsCents',
  );
  const priorCarry = assertNonNegativeCents(input.priorNegativeCarryForwardCents ?? 0, 'priorNegativeCarryForwardCents');
  const shareRateBps = input.shareRateBps ?? PARTNER_SHARE_RATE_BPS;
  const hstRateBps = input.hstRateBps ?? ONTARIO_HST_RATE_BPS;
  assertNonNegativeCents(shareRateBps, 'shareRateBps');
  assertNonNegativeCents(hstRateBps, 'hstRateBps');
  if (shareRateBps > 10_000) throw new Error('shareRateBps cannot exceed 10000');
  if (hstRateBps > 10_000) throw new Error('hstRateBps cannot exceed 10000');

  const operationalProfit = revenue - hstDeducted - cogs - technicianCommissions;
  const adjustedProfit = operationalProfit - priorCarry;
  const negativeCarry = Math.max(0, -adjustedProfit);
  const taxableProfit = Math.max(0, adjustedProfit);
  const partnerFee = roundBps(taxableProfit, shareRateBps);
  const hst = roundBps(partnerFee, hstRateBps);

  return {
    operationalProfitCents: operationalProfit,
    priorNegativeCarryForwardCents: priorCarry,
    adjustedProfitCents: adjustedProfit,
    negativeCarryForwardCents: negativeCarry,
    partnerFeeCents: partnerFee,
    hstCents: hst,
    invoiceTotalCents: partnerFee + hst,
  };
}

function parseIsoDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Expected an ISO date (YYYY-MM-DD)');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid ISO date');
  if (parsed.toISOString().slice(0, 10) !== date) throw new Error('Invalid ISO date');
  return parsed;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns the fixed 14-day period containing a Toronto-local calendar date. */
export function getPartnerBillingPeriod(date: string, anchor = PARTNER_BILLING_ANCHOR) {
  const target = parseIsoDate(date);
  const anchorDate = parseIsoDate(anchor);
  const daysFromAnchor = Math.floor((target.getTime() - anchorDate.getTime()) / 86_400_000);
  const periodIndex = Math.floor(daysFromAnchor / PARTNER_BILLING_PERIOD_DAYS);
  const start = new Date(anchorDate.getTime() + periodIndex * PARTNER_BILLING_PERIOD_DAYS * 86_400_000);
  const end = new Date(start.getTime() + (PARTNER_BILLING_PERIOD_DAYS - 1) * 86_400_000);
  return { periodIndex, periodStart: isoDate(start), periodEnd: isoDate(end) };
}

export function buildPartnerInvoiceDescription(partnerFeeCents: number): string {
  assertSafeCents(partnerFeeCents, 'partnerFeeCents');
  return `${PARTNER_INVOICE_DESCRIPTION_PREFIX} - C$ ${(partnerFeeCents / 100).toFixed(2)}`;
}

export function isAccountingEntityCode(value: unknown): value is AccountingEntityCode {
  return value === 'IT_MARKETING' || value === 'LOCKSMITH';
}
