import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { persistRingCentralToken, setRingCentralTokenCookie } from '@/lib/ringcentral';
import { buildRingCentralCallAnalytics, RingCentralAuthRequiredError } from '@/lib/ringcentral-analytics';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'DISPATCHER')) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Admin or Dispatcher access required' }, { status: 403 });
    }

    const result = await buildRingCentralCallAnalytics();
    const response = NextResponse.json(result.data);
    if (result.refreshedToken) {
      await persistRingCentralToken(result.refreshedToken);
      setRingCentralTokenCookie(response, result.refreshedToken);
    }
    return response;
  } catch (err) {
    if (err instanceof RingCentralAuthRequiredError) {
      return NextResponse.json({ success: true, configured: true, connected: false, connectRequired: true, error: err.message });
    }
    logCaughtRequestError(request, '/api/ringcentral/call-analytics', err);
    return NextResponse.json({ success: false, error: 'Unable to load RingCentral call analytics right now.' }, { status: 502 });
  }
}

export const GET = withRequestLogging('/api/ringcentral/call-analytics', handleGET);
