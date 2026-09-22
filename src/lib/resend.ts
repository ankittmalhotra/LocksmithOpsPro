/**
 * Resend Email Gateway for Locksmith Operations
 * Directly uses Resend's REST API endpoint (https://api.resend.com/emails)
 * via native fetch.
 *
 * Supports:
 * - Contractor onboarding & approval notifications
 * - Job assignment dispatch notifications
 * - Customer digital invoice & receipt emails
 * - Simulation mode when RESEND_API_KEY is not configured
 */

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  id?: string;
  to: string[];
  isSimulated: boolean;
  error?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  from,
  replyTo,
  text,
}: SendEmailOptions): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  // Resend requires a verified domain in production, or 'onboarding@resend.dev' during testing
  const defaultFrom = process.env.RESEND_FROM_EMAIL || 'LockOps Notifications <onboarding@resend.dev>';
  const fromAddress = from || defaultFrom;
  const recipients = Array.isArray(to) ? to : [to];

  // 1. If API key is present, send live request to Resend API
  if (apiKey) {
    try {
      const payload: Record<string, any> = {
        from: fromAddress,
        to: recipients,
        subject,
        html,
      };

      if (replyTo) payload.reply_to = replyTo;
      if (text) payload.text = text;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error?.message || 'Resend API request failed');
      }

      console.log(`[Resend LIVE EMAIL] Sent to ${recipients.join(', ')} (ID: ${data.id}) | Subject: ${subject}`);
      return {
        success: true,
        id: data.id,
        to: recipients,
        isSimulated: false,
      };
    } catch (err: any) {
      console.error('[Resend Error]', err);
      return {
        success: false,
        to: recipients,
        isSimulated: false,
        error: err.message,
      };
    }
  }

  // 2. Simulation mode for development/testing without active API keys
  const mockId = `email_sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  console.log(`\n================== [RESEND SIMULATED EMAIL] ==================`);
  console.log(`FROM:    ${fromAddress}`);
  console.log(`TO:      ${recipients.join(', ')}`);
  console.log(`SUBJECT: ${subject}`);
  console.log(`ID:      ${mockId}`);
  console.log(`BODY (HTML Preview):\n${html.replace(/<[^>]*>?/gm, '').trim().slice(0, 300)}...`);
  console.log(`==============================================================\n`);

  return {
    success: true,
    id: mockId,
    to: recipients,
    isSimulated: true,
  };
}

/**
 * Branded HTML Templates for LockOps Notifications
 */

export function buildContractorApprovedEmail(contractorName: string, appUrl: string): { subject: string; html: string } {
  const loginUrl = `${appUrl}/login`;
  return {
    subject: '🎉 Your LockOps Contractor Account Has Been Approved!',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            .header { background: #0f172a; padding: 28px; text-align: center; color: #ffffff; }
            .content { padding: 32px 28px; line-height: 1.6; font-size: 15px; }
            .btn { display: inline-block; background: #2563eb; color: #ffffff !important; font-weight: 700; padding: 12px 28px; border-radius: 10px; text-decoration: none; margin-top: 16px; }
            .badge { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-weight: bold; padding: 4px 10px; border-radius: 9999px; font-size: 12px; }
            .footer { padding: 20px 28px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 22px;">🔐 LockOps Operations</h1>
            </div>
            <div class="content">
              <p><span class="badge">✓ Account Activated</span></p>
              <h2>Welcome to the Team, ${contractorName}!</h2>
              <p>Your locksmith contractor account has been reviewed and officially approved by management.</p>
              <p>You can now sign in using your registered mobile phone number to view dispatches, log work, and manage your invoices in real time.</p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${loginUrl}" class="btn">Enter Contractor Workspace &rarr;</a>
              </div>
              <p style="color: #64748b; font-size: 13px;">If you have any questions, reach out directly to your dispatch manager.</p>
            </div>
            <div class="footer">
              LockOps Operations Platform • Field Service Operations
            </div>
          </div>
        </body>
      </html>
    `,
  };
}

export function buildJobDispatchedEmail(params: {
  technicianName: string;
  jobNumber: string;
  customerName: string;
  customerPhone: string;
  customerExtension?: string;
  serviceAddress: string;
  serviceType: string;
  commissionRate: number;
  problemDescription?: string;
  appUrl: string;
}): { subject: string; html: string } {
  const jobUrl = `${params.appUrl}/tech/jobs/${params.jobNumber}`;
  return {
    subject: `🚨 New Job Assigned: #${params.jobNumber} - ${params.serviceType}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
            .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; }
            .header { background: #1e293b; padding: 24px; color: #ffffff; }
            .card { background: #f1f5f9; border-radius: 12px; padding: 18px; margin: 18px 0; }
            .btn { display: inline-block; background: #0284c7; color: #ffffff !important; font-weight: 700; padding: 12px 24px; border-radius: 10px; text-decoration: none; }
            .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
            .label { color: #64748b; font-weight: 600; }
            .val { font-weight: 700; color: #0f172a; text-align: right; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin: 0;">📞 New Dispatch Assignment #${params.jobNumber}</h2>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">Technician: ${params.technicianName}</p>
            </div>
            <div style="padding: 24px;">
              <p>You have been assigned to an incoming service call:</p>
              <div class="card">
                <div class="row"><span class="label">Service:</span> <span class="val">${params.serviceType}</span></div>
                <div class="row"><span class="label">Customer:</span> <span class="val">${params.customerName} (${params.customerPhone}${params.customerExtension ? ' ext. ' + params.customerExtension : ''})</span></div>
                <div class="row"><span class="label">Address:</span> <span class="val">${params.serviceAddress}</span></div>
                <div class="row"><span class="label">Commission Rate:</span> <span class="val" style="color: #059669;">${params.commissionRate.toFixed(2)}%</span></div>
                ${params.problemDescription ? `<div class="row"><span class="label">Notes:</span> <span class="val">${params.problemDescription}</span></div>` : ''}
              </div>
              <div style="text-align: center; margin-top: 24px;">
                <a href="${jobUrl}" class="btn">Open Job Details & Invoicing &rarr;</a>
              </div>
            </div>
          </div>
        </body>
      </html>
    `,
  };
}

export function buildInvoiceReceiptEmail(params: {
  customerName: string;
  jobNumber: string;
  serviceType: string;
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentUrl?: string;
  technicianName?: string;
}): { subject: string; html: string } {
  const isPaid = params.paymentStatus === 'PAID';
  return {
    subject: isPaid
      ? `🧾 Payment Receipt: Locksmith Job #${params.jobNumber}`
      : `💳 Invoice for Locksmith Job #${params.jobNumber}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
            .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; }
            .header { background: ${isPaid ? '#047857' : '#1e293b'}; padding: 24px; color: #ffffff; text-align: center; }
            .content { padding: 28px; }
            .totals-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0; }
            .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
            .grand-total { border-top: 2px solid #cbd5e1; margin-top: 8px; padding-top: 8px; font-weight: 800; font-size: 18px; }
            .btn { display: inline-block; background: #6366f1; color: #ffffff !important; font-weight: 700; padding: 12px 28px; border-radius: 10px; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 20px;">${isPaid ? '✅ Payment Receipt' : 'Invoice Statement'}</h1>
              <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Job #${params.jobNumber}</p>
            </div>
            <div class="content">
              <p>Hi <strong>${params.customerName}</strong>,</p>
              <p>${isPaid ? 'Thank you for your business! Here is the summary of your completed service:' : 'Here is the invoice breakdown for your completed service call:'}</p>

              <div class="totals-box">
                <div class="total-row"><span>Service:</span> <strong>${params.serviceType}</strong></div>
                ${params.technicianName ? `<div class="total-row"><span>Technician:</span> <strong>${params.technicianName}</strong></div>` : ''}
                <div class="total-row"><span>Subtotal:</span> <strong>$${params.subtotal.toFixed(2)}</strong></div>
                <div class="total-row"><span>Tax (13%):</span> <strong>$${params.taxAmount.toFixed(2)}</strong></div>
                <div class="total-row grand-total">
                  <span>Grand Total:</span>
                  <span style="color: ${isPaid ? '#047857' : '#0f172a'};">$${params.grandTotal.toFixed(2)}</span>
                </div>
                <div class="total-row" style="font-size: 12px; color: #64748b; margin-top: 6px;">
                  <span>Payment Status:</span>
                  <strong style="color: ${isPaid ? '#047857' : '#d97706'};">${params.paymentStatus} (${params.paymentMethod})</strong>
                </div>
              </div>

              ${!isPaid && params.paymentUrl ? `
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${params.paymentUrl}" class="btn">Pay Invoice Online &rarr;</a>
                </div>
              ` : ''}

              <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: 32px;">
                CRA Ontario HST Reg #83921 4092 RT0001 • LockOps Field Service
              </p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
}

function escapeEmailHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildAccountingInvoiceEmail(params: {
  invoiceNumber: string;
  recipientName: string;
  recipientEmail: string;
  issuerName: string;
  issuerAddress?: string;
  issuerEmail?: string;
  issuerHstNumber?: string;
  description: string;
  quantity: number;
  serviceAmount: number;
  hstRate: number;
  hstAmount: number;
  totalAmount: number;
  paymentStatus: 'PENDING' | 'RECEIVED';
  paidAt?: string;
  issuedAt?: string;
  dueAt?: string;
  paymentTerms?: string;
  notes?: string;
  currency?: string;
}): { subject: string; html: string; text: string } {
  const money = (value: number) => `${params.currency || 'CAD'} ${value.toFixed(2)}`;
  const date = (value?: string) => value ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : 'Due on receipt';
  const issuerAddress = params.issuerAddress ? `<div>${escapeEmailHtml(params.issuerAddress)}</div>` : '';
  const hstLabel = params.hstRate > 0 ? `HST (${(params.hstRate * 100).toFixed(0)}%)` : 'HST';
  const paid = params.paymentStatus === 'RECEIVED';
  const subject = paid ? `Payment received — invoice ${params.invoiceNumber}` : `Invoice ${params.invoiceNumber} from ${params.issuerName}`;
  const text = [
    `Invoice ${params.invoiceNumber}`,
    `From: ${params.issuerName}`,
    `To: ${params.recipientName}`,
    `Issued: ${date(params.issuedAt)}`,
    `Due: ${date(params.dueAt)}`,
    `${params.description} — ${params.quantity} × ${money(params.quantity ? params.serviceAmount / params.quantity : params.serviceAmount)} = ${money(params.serviceAmount)}`,
    `Subtotal: ${money(params.serviceAmount)}`,
    `${hstLabel}: ${money(params.hstAmount)}`,
    `Total: ${money(params.totalAmount)}`,
    `Payment status: ${paid ? `Paid${params.paidAt ? ` on ${date(params.paidAt)}` : ''}` : 'Payment pending'}`,
    params.paymentTerms ? `Payment terms: ${params.paymentTerms}` : '',
    params.notes ? `Notes: ${params.notes}` : '',
  ].filter(Boolean).join('\n');
  return {
    subject,
    text,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a}.card{max-width:680px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden}.header{padding:28px 32px;border-bottom:1px solid #e2e8f0}.content{padding:28px 32px}.parties{display:flex;gap:32px;margin-bottom:28px}.party{flex:1;font-size:13px;line-height:1.55}.label{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#64748b}.items{width:100%;border-collapse:collapse;font-size:13px}.items th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#64748b;border-bottom:1px solid #e2e8f0;padding:10px 0}.items td{padding:16px 0;border-bottom:1px solid #f1f5f9}.right{text-align:right}.totals{margin:24px 0 0 auto;width:260px;font-size:13px}.totals div{display:flex;justify-content:space-between;padding:5px 0}.total{border-top:2px solid #cbd5e1;margin-top:8px;padding-top:10px!important;font-size:18px;font-weight:800}.payment{margin:20px 0 0;padding:12px 14px;border-radius:10px;background:${paid ? '#ecfdf5' : '#fffbeb'};color:${paid ? '#047857' : '#92400e'};font-weight:800}.notes{margin-top:28px;padding-top:18px;border-top:1px solid #e2e8f0;color:#475569;font-size:12px;line-height:1.55}.footer{padding:18px 32px;background:#f8fafc;color:#64748b;font-size:11px}</style></head><body><div class="card"><div class="header"><div style="font-size:30px;font-weight:800">INVOICE</div><div style="margin-top:6px;color:#64748b;font-size:13px">${escapeEmailHtml(params.invoiceNumber)} · Issued ${escapeEmailHtml(date(params.issuedAt))} · Due ${escapeEmailHtml(date(params.dueAt))}</div></div><div class="content"><div class="parties"><div class="party"><div class="label">From</div><strong>${escapeEmailHtml(params.issuerName)}</strong>${issuerAddress}${params.issuerEmail ? `<div>${escapeEmailHtml(params.issuerEmail)}</div>` : ''}${params.issuerHstNumber ? `<div>HST: ${escapeEmailHtml(params.issuerHstNumber)}</div>` : ''}</div><div class="party"><div class="label">Bill to</div><strong>${escapeEmailHtml(params.recipientName)}</strong><div>${escapeEmailHtml(params.recipientEmail)}</div></div></div><table class="items"><thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Amount</th></tr></thead><tbody><tr><td>${escapeEmailHtml(params.description)}</td><td class="right">${params.quantity.toFixed(2).replace(/\\.00$/, '')}</td><td class="right">${escapeEmailHtml(money(params.serviceAmount))}</td></tr></tbody></table><div class="totals"><div><span>Subtotal</span><strong>${escapeEmailHtml(money(params.serviceAmount))}</strong></div><div><span>${escapeEmailHtml(hstLabel)}</span><strong>${escapeEmailHtml(money(params.hstAmount))}</strong></div><div class="total"><span>Total ${escapeEmailHtml(params.currency || 'CAD')}</span><span>${escapeEmailHtml(money(params.totalAmount))}</span></div></div><div class="payment">${paid ? `Paid${params.paidAt ? ` on ${escapeEmailHtml(date(params.paidAt))}` : ''}` : 'Payment pending'}</div>${params.paymentTerms || params.notes ? `<div class="notes">${params.paymentTerms ? `<div><strong>Payment terms:</strong> ${escapeEmailHtml(params.paymentTerms)}</div>` : ''}${params.notes ? `<div>${escapeEmailHtml(params.notes)}</div>` : ''}</div>` : ''}</div><div class="footer">Thank you for your business. Please reply to this email with any billing questions.</div></div></body></html>`,
  };
}
