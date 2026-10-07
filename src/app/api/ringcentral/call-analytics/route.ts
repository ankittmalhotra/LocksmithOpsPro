import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getRingCentralAuthMethod, persistRingCentralToken, setRingCentralTokenCookie } from '@/lib/ringcentral';
import type { RingCentralAnalyticsRange } from '@/lib/ringcentral';
import { buildRingCentralCallAnalytics, RingCentralAuthRequiredError } from '@/lib/ringcentral-analytics';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { parseTorontoDateOnly, formatTorontoDateInput } from '@/lib/timezone';

const sections = new Set(['overview', 'activity', 'demand', 'linked-jobs']);
const outcomes = new Set(['all', 'answered', 'missed', 'voicemail', 'short', 'callback-recovered', 'unresolved']);

function dateBounds(params: URLSearchParams, range: string) {
  if (range !== 'custom') return { bounds: undefined, error: null };
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const fromDate = parseTorontoDateOnly(from);
  const toDate = parseTorontoDateOnly(to);
  if (!fromDate || !toDate || formatTorontoDateInput(fromDate) !== from || formatTorontoDateInput(toDate) !== to || from > to) {
    return { bounds: undefined, error: 'Custom dates must be valid Toronto dates with From on or before To.' };
  }
  const dayCount = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (dayCount > 31) return { bounds: undefined, error: 'Custom call analytics ranges are limited to 31 days.' };
  const today = formatTorontoDateInput(new Date());
  const earliest = new Date(`${today}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 30);
  const earliestKey = earliest.toISOString().slice(0, 10);
  if (to > today || from < earliestKey) return { bounds: undefined, error: 'Custom call analytics dates must fall within the last 31 Toronto dates.' };
  return { bounds: { from, to }, error: null };
}

async function handleGET(request: Request) {
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
    const { bounds, error: boundsError } = dateBounds(params, requestedRange);
    if (boundsError) return NextResponse.json({ success: false, error: boundsError }, { status: 400 });
    const section = params.get('section') || 'overview';
    if (!sections.has(section)) return NextResponse.json({ success: false, error: 'Unsupported Call Analytics section.' }, { status: 400 });
    const outcome = params.get('outcome') || 'all';
    if (!outcomes.has(outcome)) return NextResponse.json({ success: false, error: 'Unsupported call outcome filter.' }, { status: 400 });
    const page = Number(params.get('page') || 1);
    const pageSize = Number(params.get('pageSize') || 25);
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ success: false, error: 'Invalid call activity pagination. Page size must be 1–100.' }, { status: 400 });
    }
    const search = (params.get('search') || '').trim().slice(0, 100).toLocaleLowerCase();
    const summaryOnly = params.get('summaryOnly') === '1';
    if (summaryOnly && section !== 'overview') return NextResponse.json({ success: false, error: 'Summary-only mode is available for the Dashboard overview.' }, { status: 400 });

    // Cache-only read. RingCentral is invoked only by the explicit refresh POST.
    const result = await buildRingCentralCallAnalytics(selectedRange, bounds, { section: section as 'overview' | 'activity' | 'demand' | 'linked-jobs', summaryOnly });
    const data = { ...result.data, section } as typeof result.data & { activityPagination?: { page: number; pageSize: number; total: number; totalPages: number } };
    if (section === 'activity') {
      const receivingNumber = params.get('receivingNumber');
      if (receivingNumber && !result.data.targetPhoneNumbers?.includes(receivingNumber)) {
        return NextResponse.json({ success: false, error: 'Receiving number is not a tracked RingCentral number.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
      }
      const selectedNumber = receivingNumber && result.data.targetPhoneNumbers?.includes(receivingNumber) ? receivingNumber : null;
      const filtered = (result.data.activityRows || []).filter((call) => {
        if (selectedNumber && call.destinationNumber !== selectedNumber) return false;
        if (outcome === 'answered' && call.activityKind !== 'answered') return false;
        if (outcome === 'missed' && call.activityKind !== 'missed') return false;
        if (outcome === 'voicemail' && call.activityKind !== 'voicemail') return false;
        if (outcome === 'short' && call.activityKind !== 'short') return false;
        if (outcome === 'callback-recovered' && !call.callbackTime) return false;
        if (outcome === 'unresolved' && !call.missedOpportunity) return false;
        return !search || `${call.callerNumber} ${call.callerName || ''} ${call.destinationNumber} ${call.result || ''} ${call.voicemailTranscript || ''}`.toLocaleLowerCase().includes(search);
      });
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      data.activityPagination = { page: Math.min(page, totalPages), pageSize, total: filtered.length, totalPages };
      data.activityRows = filtered.slice((data.activityPagination.page - 1) * pageSize, data.activityPagination.page * pageSize);
      data.callDetails = [];
    } else {
      data.callDetails = [];
      data.activityRows = [];
    }
    if (section === 'linked-jobs') {
      const rows = result.data.linkedJobs || [];
      const filtered = rows.filter((row) => !search || `${row.jobNumber || ''} ${row.callerNumber} ${row.jobStatus}`.toLocaleLowerCase().includes(search));
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      data.linkedJobs = filtered.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize);
      data.activityPagination = { page: Math.min(page, totalPages), pageSize, total: filtered.length, totalPages };
    } else if (section !== 'overview') {
      data.linkedJobs = [];
    } else {
      data.linkedJobs = [];
    }
    if (section !== 'demand') {
      data.demandHeatmap = undefined;
      data.jobCompletionHeatmap = undefined;
    }
    if (section !== 'overview') data.daily = [];
    if (section !== 'overview' && section !== 'linked-jobs') data.linkedConversion = undefined;
    const response = NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
    if (result.refreshedToken) {
      await persistRingCentralToken(result.refreshedToken);
      setRingCentralTokenCookie(response, result.refreshedToken);
    }
    return response;
  } catch (err) {
    if (err instanceof RingCentralAuthRequiredError) {
      return NextResponse.json({ success: true, configured: true, connected: false, authMethod: getRingCentralAuthMethod(), connectRequired: true, error: 'Authorization is required to sync call data.' });
    }
    logCaughtRequestError(request, '/api/ringcentral/call-analytics', err);
    return NextResponse.json({ success: false, error: 'Unable to load call analytics right now.' }, { status: 502 });
  }
}

export const GET = withRequestLogging('/api/ringcentral/call-analytics', handleGET);
