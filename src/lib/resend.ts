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
