import { sendEmail, type EmailResult } from './resend.ts';

export const REVENUE_NOTIFICATION_EMAIL = 'mail2mws@gmail.com';

export type RevenueEmailKind = 'CREATED' | 'UPDATED' | 'COMPLETED' | 'ABANDONED';

export interface RevenueEmailJob {
  jobNumber: string;
  serviceType: string;
  status: string;
  completedAt?: Date | string | null;
  customer: { name: string; phone: string };
  technician?: { name: string } | null;
  technicianName?: string | null;
  workerCommission?: number | null;
  invoice?: {
    totalAmountCollected?: number | null;
    grandTotal: number;
    taxAmount: number;
    taxCollected?: boolean | null;
    cogsAmount?: number | null;
    paymentMethod?: string | null;
  } | null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value: unknown): string {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : '$0.00';
}

function completedLabel(value: Date | string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toISOString();
}

export function buildRevenueChangeEmail(job: RevenueEmailJob, kind: RevenueEmailKind) {
  if (!job.invoice) throw new Error('Revenue email requires an invoice');
  const invoice = job.invoice;
  const gross = Number(invoice.totalAmountCollected ?? invoice.grandTotal ?? 0);
  const cogs = Number(invoice.cogsAmount ?? 0);
  const commission = Number(job.workerCommission ?? 0);
  const netBeforeOverhead = gross - cogs - commission;
  const eventLabel = kind === 'CREATED'
    ? 'Manual job created'
    : kind === 'UPDATED'
      ? 'Manual job revenue updated'
      : kind === 'ABANDONED'
        ? 'Job abandoned with travel-fee revenue'
        : 'Job completed';
  const technician = job.technician?.name || job.technicianName || 'Not assigned';
  const subject = `Revenue update: Job #${job.jobNumber} — ${money(gross)}`;
  const rows = [
    ['Event', eventLabel],
    ['Job status', job.status],
    ['Job number', job.jobNumber],
    ['Customer', `${job.customer.name} (${job.customer.phone})`],
    ['Service', job.serviceType],
    ['Technician', technician],
    ['Gross collected', money(gross)],
    ['COGS / parts', money(cogs)],
    ['HST amount', money(invoice.taxAmount)],
    ['Tax status', invoice.taxCollected === false ? 'Off books' : 'On books'],
    ['Payment method', invoice.paymentMethod || 'Not recorded'],
    ['Net before overhead', money(netBeforeOverhead)],
    ['Completed at', completedLabel(job.completedAt)],
  ];
  const text = [
    eventLabel,
    `Job #${job.jobNumber} — ${job.serviceType}`,
    `Customer: ${job.customer.name} (${job.customer.phone})`,
    `Technician: ${technician}`,
    `Gross collected: ${money(gross)}`,
    `COGS / parts: ${money(cogs)}`,
    `HST: ${money(invoice.taxAmount)} (${invoice.taxCollected === false ? 'off books' : 'on books'})`,
    `Payment: ${invoice.paymentMethod || 'Not recorded'}`,
    `Net before overhead: ${money(netBeforeOverhead)}`,
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
    <h2 style="color:#0f766e">${escapeHtml(eventLabel)}</h2>
    <table cellpadding="7" cellspacing="0" style="border-collapse:collapse;min-width:440px">
      ${rows.map(([label, value]) => `<tr><td style="border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600">${escapeHtml(label)}</td><td style="border-bottom:1px solid #e2e8f0;font-weight:700">${escapeHtml(value)}</td></tr>`).join('')}
    </table>
    <p style="color:#64748b;font-size:12px">LockOps revenue notification</p>
  </body></html>`;
  return { subject, html, text };
}

export async function sendRevenueChangeEmail(job: RevenueEmailJob, kind: RevenueEmailKind): Promise<EmailResult> {
  try {
    if (!process.env.RESEND_API_KEY) {
      return {
        success: false,
        to: [REVENUE_NOTIFICATION_EMAIL],
        isSimulated: false,
        error: 'RESEND_API_KEY is not configured',
      };
    }
    const email = buildRevenueChangeEmail(job, kind);
    return sendEmail({ to: REVENUE_NOTIFICATION_EMAIL, ...email });
  } catch (error: any) {
    return {
      success: false,
      to: [REVENUE_NOTIFICATION_EMAIL],
      isSimulated: false,
      error: error?.message || 'Unable to build revenue notification email',
    };
  }
}
