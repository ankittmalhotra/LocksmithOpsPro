import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { getJobReceiptState, getLocksmithReceiptIssuer } from '@/lib/job-receipt';
import { requiresCurrentStripeIssuerVerification } from '@/lib/job-receipt-policy';
import { StripeApiError, stripeGet } from '@/lib/stripe';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

function idOf(value: any): string | null { return typeof value === 'string' ? value : typeof value?.id === 'string' ? value.id : null; }
function amountCents(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null; }
function normalizeIdentifier(value: unknown) { return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase(); }
function stripeUrl(value: unknown, hosts: string[]) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname) ? url : null;
  } catch { return null; }
}

async function verifyLocksmithStripeIssuer(issuer: any) {
  const account = await verifyStripeAccountPin();
  const businessName = account.business_profile?.name || account.company?.name;
  if (businessName !== issuer.legalName) throw new Error('Stripe receipt unavailable: Stripe legal name does not match the Locksmith issuer.');
  const stripeAddress = account.company?.address || account.business_profile?.support_address;
  if (!stripeAddress || stripeAddress.line1 !== issuer.addressLine1 || stripeAddress.city !== issuer.city
    || stripeAddress.state !== issuer.province || normalizeIdentifier(stripeAddress.postal_code) !== normalizeIdentifier(issuer.postalCode)
    || (stripeAddress.country && stripeAddress.country !== 'CA')) {
    throw new Error('Stripe receipt unavailable: Stripe business address does not match the Locksmith issuer.');
  }
  const taxList = await stripeGet('/tax_ids?limit=100');
  const hstMatch = Array.isArray(taxList.data) && taxList.data.some((tax: any) => tax.type === 'ca_gst_hst' && normalizeIdentifier(tax.value) === normalizeIdentifier(issuer.hstRegistrationNumber));
  if (!hstMatch) throw new Error('Stripe receipt unavailable: the verified Locksmith HST number is not configured on the Stripe account.');
  return account;
}

async function verifyStripeAccountPin() {
  const configuredAccountId = process.env.LOCKSMITH_STRIPE_ACCOUNT_ID?.trim();
  const account = await stripeGet('/account');
  if (configuredAccountId && account.id !== configuredAccountId) throw new Error('Stripe receipt unavailable: payment account does not match the configured Locksmith account.');
  return account;
}

async function resolveCharge(invoice: any, jobId: string) {
  let chargeId = invoice.stripeChargeId || null;
  let intent: any = null;
  if (!chargeId && invoice.stripePaymentIntentId) {
    intent = await stripeGet(`/payment_intents/${encodeURIComponent(invoice.stripePaymentIntentId)}?expand[]=latest_charge`);
    chargeId = idOf(intent.latest_charge);
  }
  if (!chargeId && invoice.stripeSessionId) {
    const session = await stripeGet(`/checkout/sessions/${encodeURIComponent(invoice.stripeSessionId)}?expand[]=payment_intent`);
    if (session.payment_status !== 'paid' || session.client_reference_id !== invoice.id
      || session.metadata?.invoiceId !== invoice.id || session.metadata?.jobId !== jobId) {
      throw new Error('Stripe receipt unavailable: Checkout session does not verify this paid invoice.');
    }
    intent = typeof session.payment_intent === 'object' ? session.payment_intent : null;
    if (!intent && typeof session.payment_intent === 'string') intent = await stripeGet(`/payment_intents/${encodeURIComponent(session.payment_intent)}?expand[]=latest_charge`);
    chargeId = idOf(intent?.latest_charge);
  }
  if (!chargeId) throw new Error('Stripe receipt unavailable: no verified Stripe charge is linked to this job.');
  const charge = await stripeGet(`/charges/${encodeURIComponent(chargeId)}`);
  const expected = amountCents(Number(invoice.totalAmountCollected || invoice.grandTotal) * 100);
  const chargedAmount = amountCents(charge.amount);
  const refundedAmount = amountCents(charge.amount_refunded ?? 0);
  if (expected === null || charge.paid !== true || charge.status && charge.status !== 'succeeded' || charge.currency !== 'cad'
    || chargedAmount !== expected || refundedAmount === null || refundedAmount >= expected) {
    throw new Error('Stripe receipt unavailable: payment amount, status, or refund state does not match the recorded invoice.');
  }
  const chargeIntentId = idOf(charge.payment_intent);
  if (!chargeIntentId || (invoice.stripePaymentIntentId && chargeIntentId !== invoice.stripePaymentIntentId)) {
    throw new Error('Stripe receipt unavailable: the charge is not bound to the saved payment intent.');
  }
  intent = await stripeGet(`/payment_intents/${encodeURIComponent(chargeIntentId)}?expand[]=latest_charge`);
  if (intent.status !== 'succeeded' || amountCents(intent.amount_received) !== expected || idOf(intent.latest_charge) !== chargeId) {
    throw new Error('Stripe receipt unavailable: payment metadata does not match this invoice.');
  }
  const paymentIntentMetadataMatches = intent.metadata?.invoiceId === invoice.id && intent.metadata?.jobId === jobId;
  if (!paymentIntentMetadataMatches) {
    // Older Checkout Sessions only stored invoice/job metadata on the Session
    // (or were persisted locally before every metadata field was added).
    // The locally saved Session ID is the primary binding; require Stripe to
    // return that exact paid Session and bind it to the exact verified intent.
    // Any legacy metadata that is present must still agree with this invoice.
    if (!invoice.stripeSessionId) throw new Error('Stripe receipt unavailable: payment metadata does not match this invoice.');
    const session = await stripeGet(`/checkout/sessions/${encodeURIComponent(invoice.stripeSessionId)}?expand[]=payment_intent`);
    const sessionIntentId = idOf(session.payment_intent);
    if (session.id !== invoice.stripeSessionId || session.payment_status !== 'paid'
      || (session.client_reference_id && session.client_reference_id !== invoice.id)
      || (session.metadata?.invoiceId && session.metadata.invoiceId !== invoice.id)
      || (session.metadata?.jobId && session.metadata.jobId !== jobId)
      || sessionIntentId !== chargeIntentId) {
      throw new Error('Stripe receipt unavailable: saved Checkout Session does not verify this paid invoice and payment intent.');
    }
  }
  return charge;
}

async function paidStripeInvoice(invoice: any, expectedAmount: number, issuer: any | null, jobId: string, verifiedPaymentIntentId: string | null) {
  if (!invoice.stripeInvoiceId) throw new Error('Paid Stripe invoice PDF is not available for this payment.');
  const remote = await stripeGet(`/invoices/${encodeURIComponent(invoice.stripeInvoiceId)}?expand[]=account_tax_ids&expand[]=payment_intent`);
  if (remote.status !== 'paid' || remote.currency !== 'cad' || amountCents(remote.amount_paid) !== expectedAmount) {
    throw new Error('Stripe invoice unavailable: status or amount does not match the recorded payment.');
  }
  const remoteIntentId = idOf(remote.payment_intent);
  if (!remoteIntentId || !verifiedPaymentIntentId || remoteIntentId !== verifiedPaymentIntentId
    || remote.metadata?.invoiceId !== invoice.id || remote.metadata?.jobId !== jobId) {
    throw new Error('Stripe invoice unavailable: invoice metadata or payment intent does not match this job and payment.');
  }
  if (issuer && remote.account_name && remote.account_name !== issuer.legalName) {
    throw new Error('Stripe invoice unavailable: seller name does not match the Locksmith issuer.');
  }
  if (issuer) {
    const taxIds = Array.isArray(remote.account_tax_ids) ? remote.account_tax_ids : [];
    const values = await Promise.all(taxIds.map(async (tax: any) => {
      if (tax && typeof tax === 'object') return tax;
      return stripeGet(`/tax_ids/${encodeURIComponent(String(tax))}`);
    }));
    if (!values.some((tax: any) => tax.type === 'ca_gst_hst' && normalizeIdentifier(tax.value) === normalizeIdentifier(issuer.hstRegistrationNumber))) {
      throw new Error('Stripe invoice unavailable: its HST registration does not match Locksmith.');
    }
  }
  return stripeUrl(remote.invoice_pdf, ['invoice.stripe.com', 'pay.stripe.com']);
}

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
    if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') return NextResponse.json({ success: false, error: 'Admin or Dispatcher access required' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    const receiptState = getJobReceiptState(job);
    if (!['stripe_ready', 'stripe_partial_refund'].includes(receiptState)) return NextResponse.json({ success: false, error: 'Receipt unavailable: this job is not a verified paid, on-books Stripe payment.' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
    if (!job.invoice) return NextResponse.json({ success: false, error: 'Stripe invoice not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    const invoice = job.invoice;
    const verifyNewQuoteIssuer = requiresCurrentStripeIssuerVerification(invoice);
    const issuer = verifyNewQuoteIssuer ? await getLocksmithReceiptIssuer() : null;
    // These are Stripe's existing, already-issued documents. Preserve their
    // original tax treatment and allow older paid jobs to retrieve them; only
    // new portal-generated on-books receipts are constrained by the HST
    // registration effective date.
    if (issuer) await verifyLocksmithStripeIssuer(issuer);
    else await verifyStripeAccountPin();
    const query = new URL(request.url).searchParams;
    const kind = query.get('kind') || 'receipt';
    if (kind !== 'receipt' && kind !== 'invoice') return NextResponse.json({ success: false, error: 'kind must be receipt or invoice' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    const charge = await resolveCharge(invoice, job.id);
    if (kind === 'receipt') {
      const destination = stripeUrl(charge.receipt_url, ['pay.stripe.com']);
      if (!destination) return NextResponse.json({ success: false, error: 'Stripe hosted receipt is unavailable.' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
      return NextResponse.redirect(destination, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const expected = amountCents(Number(invoice.totalAmountCollected || invoice.grandTotal) * 100);
    if (expected === null) throw new Error('Stripe invoice unavailable: recorded invoice amount is invalid.');
    const destination = await paidStripeInvoice(invoice, expected, issuer, job.id, idOf(charge.payment_intent));
    if (!destination) return NextResponse.json({ success: false, error: 'Stripe paid invoice PDF is unavailable.' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    return NextResponse.redirect(destination, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof StripeApiError) {
      logCaughtRequestError(request, '/api/jobs/[id]/receipt/stripe', error);
      return NextResponse.json({ success: false, error: 'Stripe could not verify the payment document.' }, { status: error.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'private, no-store' } });
    }
    logCaughtRequestError(request, '/api/jobs/[id]/receipt/stripe', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Stripe receipt unavailable' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export const GET = withRequestLogging('/api/jobs/[id]/receipt/stripe', handleGET);
