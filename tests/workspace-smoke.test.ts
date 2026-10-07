import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Repeatable workspace smoke checks. Needs a running dev server (default
 * http://localhost:3000). Optional credentials enable the signed-in checks:
 *   SMOKE_ADMIN_ID / SMOKE_ADMIN_PASSWORD, SMOKE_DISPATCHER_ID / SMOKE_DISPATCHER_PASSWORD
 */
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

// 1. Menu order is fixed and only Google Ads is Admin-only (source check).
const nav = readFileSync(new URL('../src/components/NavigationHeader.tsx', import.meta.url), 'utf8');
const block = nav.slice(nav.indexOf('const operationalNavigation'), nav.indexOf('const intakeDestinations'));
const labels = [...block.matchAll(/label: '([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(labels, ['Dashboard', 'Call Analytics', 'Books', 'Live Map', 'Calendar', 'Google Ads']);
assert.equal([...block.matchAll(/adminOnly: true/g)].length, 1);
assert.match(block, /label: 'Google Ads'[^}]*adminOnly: true/);

const get = (path: string, cookie = '') => fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const loginAs = async (identifier: string, password: string) => {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  assert.equal(response.ok, true, `login failed for ${identifier}`);
  const cookie = (response.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ');
  assert.ok(cookie, 'login returned no session cookie');
  return cookie;
};

// 2. Signed-out visitors cannot reach workspace pages or private APIs.
for (const path of ['/dashboard', '/google-ads', '/owner', '/books', '/admin/team']) {
  const response = await get(path);
  assert.ok([302, 307, 308].includes(response.status), `${path} should redirect when signed out (got ${response.status})`);
}
for (const path of ['/api/dashboard/books-attention', '/api/owner/google-ads/analytics', '/api/dashboard/summary']) {
  const response = await get(path);
  assert.ok([401, 403].includes(response.status), `${path} should be denied when signed out (got ${response.status})`);
}

// 3. Role checks, when credentials are supplied.
if (process.env.SMOKE_ADMIN_ID && process.env.SMOKE_ADMIN_PASSWORD) {
  const cookie = await loginAs(process.env.SMOKE_ADMIN_ID, process.env.SMOKE_ADMIN_PASSWORD);
  assert.equal((await get('/api/owner/google-ads/analytics', cookie)).status, 200);
  assert.equal((await get('/api/dashboard/books-attention', cookie)).status, 200);
  const owner = await get('/owner', cookie);
  assert.match(owner.headers.get('location') || '', /\/dashboard$/);
  const authReturn = await get('/owner?googleAdsAuth=connected', cookie);
  assert.match(authReturn.headers.get('location') || '', /\/google-ads\?googleAdsAuth=connected$/);
  console.log('Admin smoke checks passed');
}
if (process.env.SMOKE_DISPATCHER_ID && process.env.SMOKE_DISPATCHER_PASSWORD) {
  const cookie = await loginAs(process.env.SMOKE_DISPATCHER_ID, process.env.SMOKE_DISPATCHER_PASSWORD);
  assert.equal((await get('/api/owner/google-ads/analytics', cookie)).status, 403);
  assert.equal((await get('/api/dashboard/google-ads-summary', cookie)).status, 403);
  assert.equal((await get('/api/dashboard/summary', cookie)).status, 200);
  const books = await (await get('/api/dashboard/books-attention', cookie)).json();
  assert.equal(books.success, true);
  assert.equal(JSON.stringify(books).includes('IT_MARKETING'), false);
  console.log('Dispatcher smoke checks passed');
}
console.log('workspace-smoke tests passed');
