import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({ success: true, user });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/auth/me', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to read session') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/auth/me', handleGET);
