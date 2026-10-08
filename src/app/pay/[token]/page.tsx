import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { firstName, isPendingCardLinkInvoice, isValidPayTokenFormat } from '@/lib/card-pay-link';
import PayButton from './PayButton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pay your locksmith bill',
  robots: { index: false, follow: false },
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
}

function formatDate(value: Date | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' }).format(value);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-slate-100 flex items-start sm:items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-6 sm:p-8">{children}</div>
    </div>
  );
}

export default async function CustomerPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { token } = await params;
  const { payment } = await searchParams;

  let invoice;
  try {
    invoice = isValidPayTokenFormat(token)
      ? await prisma.invoice.findUnique({
        where: { payToken: token },
        select: {
          grandTotal: true,
          subtotal: true,
          taxAmount: true,
          paymentStatus: true,
          paymentMethod: true,
          pricingModel: true,
          paidAt: true,
          job: { select: { jobNumber: true, serviceType: true, completedAt: true, createdAt: true, customer: { select: { name: true } } } },
        },
      })
      : null;
  } catch {
    return (
      <Shell>
        <h1 className="text-xl font-black text-slate-900">Payment page temporarily unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">Please try again in a few minutes. Your payment link is still valid.</p>
      </Shell>
    );
  }
  const entity = await prisma.accountingEntity.findUnique({
    where: { code: 'LOCKSMITH' },
    select: { legalName: true, email: true },
  }).catch(() => null);
  const businessName = entity?.legalName || 'Your locksmith';

  if (!invoice) {
    return (
      <Shell>
        <h1 className="text-xl font-black text-slate-900">Payment link not found</h1>
        <p className="mt-2 text-sm text-slate-600">This link is not valid. Please check the text message or contact {businessName}.</p>
      </Shell>
    );
  }

  const paid = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(invoice.paymentStatus);
  const name = firstName(invoice.job.customer.name);
  const serviceDate = formatDate(invoice.job.completedAt || invoice.job.createdAt);

  const summary = (
    <dl className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex justify-between gap-4"><dt className="text-slate-500">Job</dt><dd className="font-bold text-slate-900">#{invoice.job.jobNumber}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-slate-500">Service</dt><dd className="font-bold text-slate-900 text-right">{invoice.job.serviceType}</dd></div>
      {serviceDate && <div className="flex justify-between gap-4"><dt className="text-slate-500">Date</dt><dd className="font-bold text-slate-900">{serviceDate}</dd></div>}
      <div className="flex justify-between gap-4 border-t border-slate-200 pt-2"><dt className="text-slate-500">Subtotal</dt><dd className="text-slate-900">{formatMoney(invoice.subtotal)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-slate-500">HST (13%)</dt><dd className="text-slate-900">{formatMoney(invoice.taxAmount)}</dd></div>
      <div className="flex justify-between gap-4 border-t border-slate-200 pt-2"><dt className="font-black text-slate-900">Total</dt><dd className="text-lg font-black text-slate-900">{formatMoney(invoice.grandTotal)}</dd></div>
    </dl>
  );

  if (paid) {
    return (
      <Shell>
        <p className="text-sm font-bold text-emerald-700">{businessName}</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Paid — thank you{name ? `, ${name}` : ''}!</h1>
        <p className="mt-2 text-sm text-slate-600">We received your payment{invoice.paidAt ? ` on ${formatDate(invoice.paidAt)}` : ''}. A receipt was sent by Stripe if you entered your email.</p>
        {summary}
      </Shell>
    );
  }

  if (!isPendingCardLinkInvoice(invoice)) {
    return (
      <Shell>
        <p className="text-sm font-bold text-slate-500">{businessName}</p>
        <h1 className="mt-1 text-xl font-black text-slate-900">This payment link is no longer active</h1>
        <p className="mt-2 text-sm text-slate-600">Your bill for Job #{invoice.job.jobNumber} was updated. Please contact us{entity?.email ? ` at ${entity.email}` : ''} for the current payment details.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-sm font-bold text-blue-700">{businessName}</p>
      <h1 className="mt-1 text-2xl font-black text-slate-900">{name ? `Hi ${name}, ` : ''}here is your bill</h1>
      {payment === 'success' && (
        <p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Payment submitted. It can take a minute to confirm — refresh this page to see it marked paid.</p>
      )}
      {payment === 'cancelled' && (
        <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Payment was not completed. You can try again below.</p>
      )}
      {summary}
      <PayButton token={token} total={formatMoney(invoice.grandTotal)} />
      <p className="mt-3 text-center text-xs text-slate-500">Secure card payment by Stripe. Your card details are never shared with us.</p>
    </Shell>
  );
}
