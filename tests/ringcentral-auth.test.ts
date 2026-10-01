import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

// Exercise the actual client against mocked network/storage, without Next's
// request context or any real RingCentral credentials/database.
const storage = { encryptedTokenData: null as string | null, writes: 0 };
Object.assign(globalThis, { __ringCentralAuthTestStorage: storage });
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/prisma' || specifier === 'next/headers') {
      return { url: `ringcentral-test:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'ringcentral-test:@/lib/prisma') {
      return { format: 'module', shortCircuit: true, source: `
        const storage = globalThis.__ringCentralAuthTestStorage;
        export const prisma = { ringCentralConnection: {
          async findUnique() { return storage.encryptedTokenData ? { encryptedTokenData: storage.encryptedTokenData } : null; },
          async upsert({update}) { storage.encryptedTokenData = update.encryptedTokenData; storage.writes++; }
        }};
      ` };
    }
    if (url === 'ringcentral-test:next/headers') {
      return { format: 'module', shortCircuit: true, source: 'export async function cookies() { return { get() { return undefined; } }; }' };
    }
    return nextLoad(url, context);
  },
});

const {
  getRingCentralConfig,
  listRingCentralInboundCalls,
  listRingCentralOutboundCalls,
  listRingCentralVoicemails,
  persistRingCentralToken,
  RingCentralApiError,
  RingCentralAuthRequiredError,
} = await import('../src/lib/ringcentral.ts');

process.env.RC_APP_CLIENT_ID = 'test-client';
process.env.RC_APP_CLIENT_SECRET = 'test-secret';
process.env.RC_USER_JWT = 'test-jwt';
process.env.RC_SERVER_URL = 'https://platform.ringcentral.com';
process.env.SESSION_SECRET = 'test-encryption-key';

const originalFetch = globalThis.fetch;
let responses: Response[] = [];
let requests: Array<{ url: string; grant: string | null; authorization: string | null }> = [];
globalThis.fetch = async (input, options) => {
  requests.push({
    url: String(input),
    grant: options?.body instanceof URLSearchParams ? options.body.get('grant_type') : null,
    authorization: new Headers(options?.headers).get('Authorization'),
  });
  const response = responses.shift();
  assert.ok(response, 'Unexpected extra API request');
  return response;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const token = (value: string) => json({ access_token: value, refresh_token: `refresh-${value}`, expires_in: 3600, refresh_token_expires_in: 604800 });
const calls = () => json({ records: [{ id: 'call-1' }], paging: { totalPages: 1 } });
const range = ['2026-10-01T04:00:00Z', '2026-10-02T03:59:59Z'] as const;

function reset() {
  storage.encryptedTokenData = null;
  storage.writes = 0;
  responses = [];
  requests = [];
  process.env.RC_USER_JWT = 'test-jwt';
  process.env.RC_APP_CLIENT_SECRET = 'test-secret';
}

async function seed(expired = false, refresh = true) {
  await persistRingCentralToken({
    accessToken: 'old-access',
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600),
    ...(refresh ? { refreshToken: 'old-refresh', refreshTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400 } : {}),
  });
  storage.writes = 0;
}

function storedAccessToken() {
  assert.ok(storage.encryptedTokenData);
  const [iv, tag, ciphertext] = storage.encryptedTokenData.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update('test-encryption-key').digest(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString()).accessToken;
}

try {
  // Token can be revoked before its recorded expiry: retry the failed page.
  reset();
  await seed();
  responses = [json({}, 401), token('renewed'), calls()];
  const recovered = await listRingCentralInboundCalls(...range);
  assert.equal(recovered.records.length, 1);
  assert.equal(recovered.token.accessToken, 'renewed');
  assert.equal(recovered.refreshed, true);
  assert.deepEqual(requests.map((request) => request.grant), [null, 'refresh_token', null]);
  assert.equal(requests[2].authorization, 'Bearer renewed');
  assert.equal(storedAccessToken(), 'renewed');

  // Rejected refresh tokens fall back to JWT, without browser authorization.
  reset();
  await seed(true);
  responses = [json({ error: 'invalid_grant' }, 400), token('jwt-access'), calls()];
  await listRingCentralInboundCalls(...range);
  assert.deepEqual(requests.map((request) => request.grant), ['refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer', null]);

  // Rotated refresh tokens survive a later API outage.
  reset();
  await seed(true);
  responses = [token('saved-before-failure'), json({}, 500)];
  await assert.rejects(listRingCentralInboundCalls(...range), /call log request failed/);
  assert.equal(storedAccessToken(), 'saved-before-failure');
  responses = [calls()];
  await listRingCentralOutboundCalls(...range);
  assert.equal(requests.at(-1)?.authorization, 'Bearer saved-before-failure');

  // Concurrent callers share a single renewal and persist once.
  reset();
  await seed(true);
  responses = [token('shared'), calls(), calls()];
  await Promise.all([listRingCentralInboundCalls(...range), listRingCentralOutboundCalls(...range)]);
  assert.equal(requests.filter((request) => request.grant).length, 1);
  assert.equal(storage.writes, 1);

  // Stop after one authentication retry when the replacement is also rejected.
  reset();
  await seed(false, false);
  responses = [json({}, 401), token('also-rejected'), json({}, 401)];
  await assert.rejects(listRingCentralInboundCalls(...range), RingCentralAuthRequiredError);
  assert.equal(requests.length, 3);

  // Voicemail metadata and transcription use the same renewal path.
  reset();
  await seed(false, false);
  responses = [json({}, 401), token('voicemail-access'), json({ records: [{
    id: 'vm-1', vmTranscriptionStatus: 'Completed',
    attachments: [{ type: 'AudioTranscription', uri: 'https://platform.ringcentral.com/transcript' }],
  }], paging: { totalPages: 1 } }), json({}, 401), token('transcript-access'), new Response('Customer needs a lock repair.')];
  const voicemail = await listRingCentralVoicemails(...range);
  assert.equal(voicemail.records[0].voicemailTranscript, 'Customer needs a lock repair.');
  assert.equal(voicemail.token.accessToken, 'transcript-access');

  // Transient failures must not become a credential warning or trigger JWT.
  for (const status of [429, 503]) {
    reset();
    await seed(true);
    responses = [json({}, status)];
    await assert.rejects(listRingCentralInboundCalls(...range), (error: unknown) => error instanceof RingCentralApiError && !(error instanceof RingCentralAuthRequiredError));
    assert.equal(requests.length, 1);
  }

  // App errors are actionable and do not expose upstream descriptions/secrets.
  reset();
  responses = [json({ error: 'invalid_client', errors: [{ errorCode: 'OAU-146' }], error_description: 'secret-value' }, 401)];
  await assert.rejects(listRingCentralInboundCalls(...range), (error: unknown) => {
    assert.ok(error instanceof RingCentralAuthRequiredError);
    assert.match(error.message, /RC_APP_CLIENT_ID.*RC_APP_CLIENT_SECRET/);
    assert.match(error.message, /OAU-146/);
    assert.ok(!error.message.includes('secret-value'));
    return true;
  });

  reset();
  responses = [json({ error: 'invalid_request', errors: [{ errorCode: 'OAU-473' }] }, 400)];
  await assert.rejects(listRingCentralInboundCalls(...range), /not authorized.*Authorized Apps.*OAU-473/);

  reset();
  process.env.RC_USER_JWT = `header.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.signature`;
  responses = [json({ error: 'invalid_grant' }, 400)];
  await assert.rejects(listRingCentralInboundCalls(...range), /JWT credential has expired.*RC_USER_JWT/);

  // Pasted spaces/quotes/Bearer are normalized; changed app secrets ignore the
  // old stored session and obtain a token for the new configuration.
  reset();
  process.env.RC_USER_JWT = ' "Bearer test-jwt"\n';
  assert.equal(getRingCentralConfig()?.jwt, 'test-jwt');
  responses = [token('original-config'), calls()];
  await listRingCentralInboundCalls(...range);
  process.env.RC_APP_CLIENT_SECRET = 'new-test-secret';
  responses = [token('new-config'), calls()];
  await listRingCentralInboundCalls(...range);
  assert.equal(storedAccessToken(), 'new-config');
  assert.equal(requests.filter((request) => request.grant).length, 2);

  console.log('RingCentral authentication recovery tests passed');
} finally {
  globalThis.fetch = originalFetch;
  hooks.deregister();
  Reflect.deleteProperty(globalThis, '__ringCentralAuthTestStorage');
}
