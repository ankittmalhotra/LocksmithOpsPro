export type JobReceiptState = 'local_ready' | 'stripe_ready' | 'stripe_partial_refund' | 'payment_pending' | 'off_books' | 'provider_missing' | 'refunded' | 'ineligible';

export function requiresCurrentStripeIssuerVerification(invoice: any): boolean {
  return invoice?.pricingModel === 'DUAL_PRICE_V1';
}

export function requireLocksmithReceiptIssuer(entity: any) {
  const required = [entity?.legalName, entity?.corporationNumber, entity?.email, entity?.addressLine1, entity?.city,
    entity?.province, entity?.postalCode, entity?.country, entity?.hstRegistrationNumber];
  const hstNumber = typeof entity?.hstRegistrationNumber === 'string'
    ? entity.hstRegistrationNumber.replace(/\s/g, '').toUpperCase()
    : '';
  const effectiveDate = entity?.hstEffectiveDate instanceof Date
    ? entity.hstEffectiveDate
    : new Date(entity?.hstEffectiveDate || Number.NaN);
  if (!entity || entity.code !== 'LOCKSMITH' || required.some((value) => typeof value !== 'string' || !value.trim())
    || !/^\d{9}RT\d{4}$/.test(hstNumber) || !entity.hstEnabled
    || Number.isNaN(effectiveDate.getTime())) {
    throw new Error('Receipt unavailable: Locksmith issuer configuration requires verified HST registration, effective date, business identity, and address.');
  }
  return { ...entity, hstRegistrationNumber: hstNumber, hstEffectiveDate: effectiveDate };
}

export function getJobReceiptState(job: any): JobReceiptState {
  if (!job?.invoice || job.status !== 'COMPLETED') return 'ineligible';
  const invoice = job.invoice;
  if (invoice.paymentStatus === 'REFUNDED') return 'refunded';
  if (invoice.taxCollected !== true) return 'off_books';
  if (invoice.paymentStatus !== 'PAID' && invoice.paymentStatus !== 'PARTIALLY_REFUNDED') return 'payment_pending';
  if (invoice.paymentProvider === 'STRIPE') {
    if (!['STRIPE_CARD', 'CREDIT_CARD', 'DEBIT_CARD'].includes(invoice.paymentMethod)) return 'provider_missing';
    return invoice.paymentStatus === 'PARTIALLY_REFUNDED' ? 'stripe_partial_refund' : 'stripe_ready';
  }
  if (invoice.paymentStatus === 'PARTIALLY_REFUNDED') return 'provider_missing';
  if (invoice.paymentMethod === 'CASH' || invoice.paymentMethod === 'INTERAC') return 'local_ready';
  return 'provider_missing';
}

/**
 * Compare a payment instant with a database DATE effective date in the
 * business's timezone. Prisma represents PostgreSQL DATE values as midnight
 * UTC, while the registration date is a Toronto calendar date.
 */
export function isPaymentDateOnOrAfterEffectiveDate(
  paidAt: Date | string | null | undefined,
  effectiveDate: Date | string | null | undefined,
  timeZone = 'America/Toronto',
): boolean {
  if (!paidAt || !effectiveDate) return false;
  const paymentDate = paidAt instanceof Date ? paidAt : new Date(paidAt);
  const effectiveDateValue = effectiveDate instanceof Date ? effectiveDate : new Date(effectiveDate);
  if (Number.isNaN(paymentDate.getTime()) || Number.isNaN(effectiveDateValue.getTime())) return false;

  const dateParts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).formatToParts(paymentDate);
  const parts = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const paymentDateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const effectiveDateKey = effectiveDateValue.toISOString().slice(0, 10);
  return paymentDateKey >= effectiveDateKey;
}
