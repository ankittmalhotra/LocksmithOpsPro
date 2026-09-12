import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handlePOST(request: Request) {
  try {
    await clearSessionCookie();
    return NextResponse.json({ success: true, message: 'Logged out successfully' });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/auth/logout', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to log out') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/auth/logout', handlePOST);
