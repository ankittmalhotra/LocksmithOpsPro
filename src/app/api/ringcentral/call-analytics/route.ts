import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { persistRingCentralToken, setRingCentralTokenCookie } from '@/lib/ringcentral';
import type { RingCentralAnalyticsRange } from '@/lib/ringcentral';
import { buildRingCentralCallAnalytics, RingCentralAuthRequiredError } from '@/lib/ringcentral-analytics';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'DISPATCHER')) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Admin or Dispatcher access required' }, { status: 403 });
    }

    const requestedRange = new URL(request.url).searchParams.get('range');
    const selectedRange: RingCentralAnalyticsRange = requestedRange === 'yesterday' || requestedRange === 'last-week'
      ? requestedRange
      : 'today';

    // Cache-only read. RingCentral is invoked only by the explicit refresh POST.
    const result = await buildRingCentralCallAnalytics(selectedRange);
    const response = NextResponse.json(result.data);
    if (result.refreshedToken) {
      await persistRingCentralToken(result.refreshedToken);
      setRingCentralTokenCookie(response, result.refreshedToken);
    }
    return response;
  } catch (err) {
    if (err instanceof RingCentralAuthRequiredError) {
      return NextResponse.json({ success: true, configured: true, connected: false, connectRequired: true, error: 'Authorization is required to sync call data.' });
    }
    logCaughtRequestError(request, '/api/ringcentral/call-analytics', err);
    return NextResponse.json({ success: false, error: 'Unable to load call analytics right now.' }, { status: 502 });
  }
}

export const GET = withRequestLogging('/api/ringcentral/call-analytics', handleGET);
