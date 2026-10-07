import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getRingCentralAuthMethod, RingCentralApiError, setRingCentralTokenCookie } from '@/lib/ringcentral';
import type { RingCentralAnalyticsRange } from '@/lib/ringcentral';
import { buildRingCentralCallAnalytics, RingCentralAuthRequiredError } from '@/lib/ringcentral-analytics';
import { refreshRingCentralCallCache } from '@/lib/ringcentral-call-cache';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { formatTorontoDateInput, parseTorontoDateOnly } from '@/lib/timezone';

async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'DISPATCHER')) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Admin or Dispatcher access required' }, { status: 403 });
    }

    const params = new URL(request.url).searchParams;
    const requestedRange = params.get('range') || 'today';
    if (!['today', 'yesterday', 'last-week', 'custom'].includes(requestedRange)) {
      return NextResponse.json({ success: false, error: 'Unsupported call analytics range.' }, { status: 400 });
    }
    const selectedRange = requestedRange as RingCentralAnalyticsRange;
    let bounds: { from: string; to: string } | undefined;
    if (selectedRange === 'custom') {
      const from = params.get('from') || '';
      const to = params.get('to') || '';
      const fromDate = parseTorontoDateOnly(from);
      const toDate = parseTorontoDateOnly(to);
      const dayCount = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
      const earliest = new Date(`${formatTorontoDateInput(new Date())}T00:00:00Z`);
      earliest.setUTCDate(earliest.getUTCDate() - 30);
      if (!fromDate || !toDate || formatTorontoDateInput(fromDate) !== from || formatTorontoDateInput(toDate) !== to || from > to || to > formatTorontoDateInput(new Date()) || from < earliest.toISOString().slice(0, 10) || dayCount > 31) {
        return NextResponse.json({ success: false, error: 'Custom refresh dates must be valid and fall within the last 31 Toronto dates.' }, { status: 400 });
      }
      bounds = { from, to };
    }

    const result = await refreshRingCentralCallCache();
    if (result.busy) {
      return NextResponse.json({ success: false, busy: true, error: 'A call refresh is already in progress.' }, { status: 409 });
    }

    const analytics = await buildRingCentralCallAnalytics(selectedRange, bounds);
    const response = NextResponse.json({ ...analytics.data, refreshed: true, fetched: result.fetched, upserted: result.upserted });
    if (result.refreshedToken) setRingCentralTokenCookie(response, result.refreshedToken);
    return response;
  } catch (err) {
    if (err instanceof RingCentralAuthRequiredError) {
      return NextResponse.json({ success: true, configured: true, connected: false, authMethod: getRingCentralAuthMethod(), connectRequired: true, error: err.message }, { status: 401 });
    }
    if (err instanceof RingCentralApiError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    logCaughtRequestError(request, '/api/ringcentral/call-analytics/refresh', err);
    return NextResponse.json({ success: false, error: 'Unable to refresh call analytics right now.' }, { status: 502 });
  }
}

export const POST = withRequestLogging('/api/ringcentral/call-analytics/refresh', handlePOST);
