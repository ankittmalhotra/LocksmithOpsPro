import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { persistRingCentralToken, setRingCentralTokenCookie } from '@/lib/ringcentral';
import type { RingCentralAnalyticsRange } from '@/lib/ringcentral';
import { buildRingCentralCallAnalytics, RingCentralAuthRequiredError } from '@/lib/ringcentral-analytics';
import { refreshRingCentralCallCache } from '@/lib/ringcentral-call-cache';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'DISPATCHER')) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Admin or Dispatcher access required' }, { status: 403 });
    }

    const requestedRange = new URL(request.url).searchParams.get('range');
    const selectedRange: RingCentralAnalyticsRange = requestedRange === 'today' || requestedRange === 'yesterday' || requestedRange === 'last-week'
      ? requestedRange
      : 'last-week';

    const result = await refreshRingCentralCallCache();
    if (result.busy) {
      return NextResponse.json({ success: false, busy: true, error: 'A call refresh is already in progress.' }, { status: 409 });
    }

    if (result.refreshedToken) {
      await persistRingCentralToken(result.refreshedToken);
    }
    const analytics = await buildRingCentralCallAnalytics(selectedRange);
    const response = NextResponse.json({ ...analytics.data, refreshed: true, fetched: result.fetched, upserted: result.upserted });
    if (result.refreshedToken) setRingCentralTokenCookie(response, result.refreshedToken);
    return response;
  } catch (err) {
    if (err instanceof RingCentralAuthRequiredError) {
      return NextResponse.json({ success: true, configured: true, connected: false, connectRequired: true, error: 'Authorization is required to sync call data.' }, { status: 401 });
    }
    logCaughtRequestError(request, '/api/ringcentral/call-analytics/refresh', err);
    return NextResponse.json({ success: false, error: 'Unable to refresh call analytics right now.' }, { status: 502 });
  }
}

export const POST = withRequestLogging('/api/ringcentral/call-analytics/refresh', handlePOST);
