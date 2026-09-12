import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/resend';
import { getCurrentUser } from '@/lib/auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }
    const body = await request.json();
    const { to, subject = 'Test Notification from LockOps', message = 'This is a test notification email powered by Resend.' } = body;

    if (!to) {
      return NextResponse.json(
        { success: false, error: 'Recipient email "to" is required' },
        { status: 400 }
      );
    }

    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
        <h2 style="color: #2563eb;">🔐 LockOps Test Notification</h2>
        <p>${message}</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">Locksmith Operations Platform • Powered by Resend</p>
      </div>
    `;

    const result = await sendEmail({
      to,
      subject,
      html,
    });

    return NextResponse.json({
      success: result.success,
      result,
      hasApiKey: !!process.env.RESEND_API_KEY,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/email/test', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Test email failed') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/email/test', handlePOST);
