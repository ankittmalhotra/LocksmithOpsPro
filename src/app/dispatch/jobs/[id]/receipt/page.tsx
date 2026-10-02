import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { getJobReceiptState, getLocksmithReceiptIssuer } from '@/lib/job-receipt';
import { isPaymentDateOnOrAfterEffectiveDate } from '@/lib/job-receipt-policy';
import { prisma } from '@/lib/prisma';
import ReceiptAdminControls from './ReceiptAdminControls';

export const dynamic = 'force-dynamic';

function money(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `CAD $${amount.toFixed(2)}` : 'Not available';
}

function unavailableReason(state: string) {
  const reasons: Record<string, string> = {
    payment_pending: 'Payment is still pending. The receipt becomes available after the payment is confirmed.',
    off_books: 'This transaction is marked off books, so the portal will not issue a Locksmith tax receipt.',
    provider_missing: 'The payment provider record is not verified. A manually marked card payment cannot be used to create a Stripe receipt.',
    refunded: 'The payment was fully refunded. The original receipt is not available as a current payment receipt.',
    ineligible: 'This job does not have an eligible completed payment record.',
  };
  return reasons[state] || 'The receipt is not currently available.';
}

export default async function JobReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') redirect('/dispatch');

  const { id } = await params;
  const job = await findJobByIdOrNumber(id);
  if (!job) redirect('/dispatch');

  const state = getJobReceiptState(job);
  const invoice = job.invoice;
  let issuer: Awaited<ReturnType<typeof getLocksmithReceiptIssuer>> | null = null;
  let activeReceipt: any = null;
  let voidedReceipts: Array<{ id: string; receiptNumber: string; voidedAt: Date | null; voidReason: string | null }> = [];
  let issuerIssue: string | null = null;
  if (state === 'local_ready' && invoice) {
    try {
      [issuer, activeReceipt, voidedReceipts] = await Promise.all([
        getLocksmithReceiptIssuer(),
        prisma.jobPaymentReceipt.findFirst({
          where: { invoiceId: invoice.id, voidedAt: null },
          select: { id: true, receiptNumber: true, snapshot: true },
        }),
        user.role === 'ADMIN'
          ? prisma.jobPaymentReceipt.findMany({
              where: { invoiceId: invoice.id, voidedAt: { not: null } },
              orderBy: { revision: 'desc' },
              select: { id: true, receiptNumber: true, voidedAt: true, voidReason: true },
            })
          : Promise.resolve([]),
      ]);
    } catch {
      issuer = null;
      issuerIssue = 'Locksmith issuer configuration is incomplete; verify the legal identity, address, HST registration, and effective date before issuing a receipt.';
    }
    if (issuer && !isPaymentDateOnOrAfterEffectiveDate(invoice.paidAt, issuer.hstEffectiveDate)) {
      issuerIssue = 'Receipt requires an authoritative payment date on or after Locksmith’s HST registration effective date.';
    }
  }

  const snapshot = activeReceipt?.snapshot as any;
  const subtotal = snapshot?.amounts?.subtotal ?? invoice?.subtotal;
  const tax = snapshot?.amounts?.tax ?? invoice?.taxAmount;
  const total = snapshot?.amounts?.total ?? invoice?.totalAmountCollected ?? invoice?.grandTotal;
  const available = (state === 'local_ready' && Boolean(issuer) && !issuerIssue)
    || ['stripe_ready', 'stripe_partial_refund'].includes(state);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <div>
        <Link href={`/dispatch/jobs/${job.id}`} className="text-xs font-bold text-blue-700 hover:underline">← Back to Job #{job.jobNumber}</Link>
        <h1 className="mt-2 text-2xl font-black text-slate-900">Receipt · Job #{job.jobNumber}</h1>
        <p className="mt-1 text-sm text-slate-600">Review the payment source and document details before opening or downloading.</p>
      </div>

      {available ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Payment receipt preview</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">{job.customer.name}</h2>
              <p className="text-xs text-slate-600">Job #{job.jobNumber} · {job.serviceType} · {job.serviceAddress}</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">{invoice?.paymentStatus?.replaceAll('_', ' ')}</span>
          </div>

          {state === 'local_ready' && issuer && invoice ? (
            <>
              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Issued by</p>
                <p className="mt-1 font-black text-slate-900">{snapshot?.issuer?.legalName || issuer.legalName}</p>
                <p className="text-xs text-slate-600">Business / corporation ID: {snapshot?.issuer?.corporationNumber || issuer.corporationNumber}</p>
                <p className="text-xs text-slate-600">HST registration: {snapshot?.issuer?.hstRegistrationNumber || issuer.hstRegistrationNumber}</p>
                <p className="text-xs text-slate-600">{snapshot?.issuer?.address || [issuer.addressLine1, issuer.city, issuer.province, issuer.postalCode, issuer.country].filter(Boolean).join(', ')}</p>
                <p className="text-xs text-slate-600">{snapshot?.issuer?.email || issuer.email}</p>
              </div>
              <dl className="mt-4 divide-y divide-slate-100 text-sm">
                <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Service and parts</dt><dd className="font-semibold text-slate-900">{money(subtotal)}</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">HST ({((snapshot?.amounts?.taxRate ?? invoice.taxRate ?? 0) * 100).toFixed(0)}%)</dt><dd className="font-semibold text-slate-900">{money(tax)}</dd></div>
                <div className="flex justify-between gap-4 py-2 text-base"><dt className="font-black text-slate-900">Total paid</dt><dd className="font-black text-slate-900">{money(total)}</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Payment method</dt><dd className="font-semibold text-slate-900">{invoice.paymentMethod?.replaceAll('_', ' ')}</dd></div>
                {activeReceipt && <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Receipt number</dt><dd className="font-semibold text-slate-900">{activeReceipt.receiptNumber}</dd></div>}
              </dl>
              <a href={`/api/jobs/${job.id}/receipt`} className="mt-5 inline-flex rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800">Download receipt as PDF</a>
              {!activeReceipt && <p className="mt-2 text-[11px] text-slate-500">The immutable receipt number and PDF are created when you download.</p>}
              <ReceiptAdminControls
                jobId={job.id}
                isAdmin={user.role === 'ADMIN'}
                activeReceipt={activeReceipt ? { id: activeReceipt.id, receiptNumber: activeReceipt.receiptNumber } : null}
                voidedReceipts={voidedReceipts.map((receipt) => ({
                  id: receipt.id,
                  receiptNumber: receipt.receiptNumber,
                  voidedAt: receipt.voidedAt?.toISOString() || '',
                  voidReason: receipt.voidReason,
                }))}
              />
            </>
          ) : (
            <>
              <dl className="mt-4 divide-y divide-slate-100 text-sm">
                <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Document source</dt><dd className="font-semibold text-slate-900">Stripe</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Amount paid</dt><dd className="font-semibold text-slate-900">{money(invoice?.totalAmountCollected ?? invoice?.grandTotal)}</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-slate-600">Payment method</dt><dd className="font-semibold text-slate-900">{invoice?.paymentMethod?.replaceAll('_', ' ') || 'Card'}</dd></div>
              </dl>
              {state === 'stripe_partial_refund' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">A partial refund is recorded. These are Stripe’s original documents and may not show the refund.</p>}
              <div className="mt-5 flex flex-wrap gap-2">
                <a target="_blank" rel="noopener noreferrer" href={`/api/jobs/${job.id}/receipt/stripe?kind=receipt`} className="inline-flex rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800">View Stripe receipt</a>
                {invoice?.stripeInvoiceId && <a target="_blank" rel="noopener noreferrer" href={`/api/jobs/${job.id}/receipt/stripe?kind=invoice`} className="inline-flex rounded-xl bg-slate-800 px-4 py-3 text-sm font-black text-white hover:bg-slate-900">Download Stripe invoice PDF</a>}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <h2 className="font-black">Receipt unavailable</h2>
          <p className="mt-1">{issuerIssue || unavailableReason(state)}</p>
        </section>
      )}
    </main>
  );
}
