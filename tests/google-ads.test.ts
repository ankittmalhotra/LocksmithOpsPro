import assert from 'node:assert/strict';
import {
  calculateGoogleAdsRoi,
  dateKeyToUtcDate,
  fetchGoogleAdsDailyMetrics,
  getDateKeyInTimeZone,
  getGoogleAdsDateKeys,
  getYesterdayDateKey,
} from '../src/lib/google-ads.ts';

const roi = calculateGoogleAdsRoi(250, 100);
assert.equal(roi.adSpend, 100);
assert.equal(roi.netReturn, 150);
assert.equal(roi.roiPercent, 150);
assert.equal(roi.roas, 2.5);

const noSpend = calculateGoogleAdsRoi(250, 0);
assert.equal(noSpend.netReturn, 250);
assert.equal(noSpend.roiPercent, null);
assert.equal(noSpend.roas, null);

const missingSpend = calculateGoogleAdsRoi(250, null);
assert.equal(missingSpend.netReturn, null);
assert.equal(missingSpend.roiPercent, null);

const negativeProfit = calculateGoogleAdsRoi(-50, 100);
assert.equal(negativeProfit.netReturn, -150);
assert.equal(negativeProfit.roiPercent, -150);

const instant = new Date('2026-09-16T02:30:00.000Z');
assert.equal(getDateKeyInTimeZone(instant, 'America/Toronto'), '2026-09-15');
assert.equal(getYesterdayDateKey(new Date('2026-09-16T15:00:00.000Z'), 'America/Toronto'), '2026-09-15');
assert.equal(dateKeyToUtcDate('2026-09-15').toISOString(), '2026-09-15T00:00:00.000Z');
assert.deepEqual(getGoogleAdsDateKeys('today', new Date('2026-09-16T15:00:00.000Z')), ['2026-09-16']);
assert.deepEqual(getGoogleAdsDateKeys('yesterday', new Date('2026-09-16T15:00:00.000Z')), ['2026-09-15']);
assert.deepEqual(getGoogleAdsDateKeys('last-week', new Date('2026-09-16T15:00:00.000Z')), [
  '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16',
]);
assert.deepEqual(getGoogleAdsDateKeys('current-biweekly', new Date('2026-09-23T16:00:00.000Z')), [
  '2026-09-21', '2026-09-22', '2026-09-23',
]);
assert.deepEqual(getGoogleAdsDateKeys('previous-biweekly', new Date('2026-09-23T16:00:00.000Z')), [
  '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13',
  '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
]);
assert.deepEqual(getGoogleAdsDateKeys('all-time', new Date('2026-09-16T15:00:00.000Z')), [
  '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16',
]);

const originalFetch = globalThis.fetch;
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.toString();
  fetchCalls.push({ init, url });

  if (url === 'https://oauth2.googleapis.com/token') {
    return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
  }

  return new Response(JSON.stringify([{
    results: [{
      metrics: {
        clicks: '7',
        conversionsValue: 123.45,
        costMicros: '25000000',
        impressions: '1000',
      },
    }],
  }]), { status: 200 });
};

try {
  const metrics = await fetchGoogleAdsDailyMetrics('2026-09-15', {
    apiVersion: 'v25',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    customerId: '1234567890',
    developerToken: 'developer-token',
    loginCustomerId: '0987654321',
    refreshToken: 'refresh-token',
  });
  assert.equal(metrics.costMicros, 25000000);
  assert.equal(metrics.clicks, 7);
  assert.equal(metrics.impressions, 1000);
  assert.equal(metrics.conversionsValue, 123.45);
  assert.match(fetchCalls[1].url, /\/v25\/customers\/1234567890\/googleAds:searchStream$/);
  assert.equal(new Headers(fetchCalls[1].init?.headers).get('login-customer-id'), '0987654321');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Google Ads ROI tests passed.');
