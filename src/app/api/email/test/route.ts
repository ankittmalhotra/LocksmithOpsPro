import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/resend';

export async function POST(request: Request) {
  try {
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
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

