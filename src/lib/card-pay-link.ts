/**
 * Card payment links for completed manual jobs.
 *
 * The dispatcher enters the final card total (HST and any card-price
 * difference already included). The customer is texted a stable portal URL,
 * `/pay/<token>`, which creates a Stripe Checkout session only when opened, so
 * the texted link keeps working until the job is paid or changed to another
 * payment method.
 */

/** Invoice.pricingModel for tax-inclusive card totals paid through /pay. */
export const CARD_TOTAL_PRICING_MODEL = 'CARD_TOTAL_V1';

const CARD_LINK_PAYMENT_METHODS = ['CREDIT_CARD', 'DEBIT_CARD'] as const;

/** 24 random bytes as 32 base64url characters (Web Crypto, so this module stays client-safe). */
export function generatePayToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isValidPayTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}

export function isCardLinkPaymentMethod(method: string | null | undefined): boolean {
  return (CARD_LINK_PAYMENT_METHODS as readonly string[]).includes(method || '');
}

export function isPendingCardLinkInvoice(invoice: {
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  pricingModel?: string | null;
} | null | undefined): boolean {
  return Boolean(invoice
    && invoice.paymentStatus === 'PENDING'
    && isCardLinkPaymentMethod(invoice.paymentMethod)
    && invoice.pricingModel === CARD_TOTAL_PRICING_MODEL);
}

/** Public base URL: NEXT_PUBLIC_APP_URL in production, request origin otherwise. */
export function getAppBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return configured || new URL(request.url).origin;
}

export function buildPayUrl(base: string, token: string): string {
  return new URL(`/pay/${encodeURIComponent(token)}`, base).toString();
}

export function firstName(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/)[0] || '';
}

/** Customer-facing SMS text for a pay link. */
export function buildPayLinkSmsBody(params: {
  customerName: string | null | undefined;
  jobNumber: string;
  total: number;
  payUrl: string;
}): string {
  const name = firstName(params.customerName);
  return `${name ? `Hi ${name}, ` : ''}thank you for choosing us. Your total for Job #${params.jobNumber} is $${params.total.toFixed(2)} (HST included). Pay securely by card here: ${params.payUrl}`;
}
