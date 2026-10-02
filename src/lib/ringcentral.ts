import { cookies } from 'next/headers';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';

const RINGCENTRAL_TOKEN_COOKIE = 'lockops_ringcentral_tokens';
const RINGCENTRAL_STATE_COOKIE = 'lockops_ringcentral_oauth_state';
const TORONTO_TIME_ZONE = 'America/Toronto';
const MIN_REAL_CALL_DURATION_SECONDS = 30;
// Receiving numbers tracked by default. The legacy single-number setting can
// still override the primary number; RC_TARGET_PHONE_NUMBERS can add more.
const DEFAULT_TARGET_PHONE_NUMBER = '+14162400593';
export const DEFAULT_TARGET_PHONE_NUMBERS = [
  DEFAULT_TARGET_PHONE_NUMBER,
  '+14372954001',
  '+16477779493',
  '+12894061500',
];

export type RingCentralTokenData = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt?: number;
  ownerId?: string;
  credentialKey?: string;
};

export type RingCentralCallRecord = {
  id?: string;
  sourceKey?: string;
  sessionId?: string;
  telephonySessionId?: string;
  direction?: string;
  type?: string;
  action?: string;
  result?: string;
  reason?: string;
  transport?: string;
  startTime?: string;
  lastModifiedTime?: string;
  duration?: number | string;
  durationMs?: number | string;
  isVoicemail?: boolean;
  voicemailMessageId?: string;
  voicemailTranscriptionStatus?: string;
  voicemailTranscript?: string;
  voicemailReadStatus?: string;
  voicemailMessageStatus?: string;
  voicemailDurationSeconds?: number | string;
  from?: { phoneNumber?: string; extensionNumber?: string; name?: string };
  to?: { phoneNumber?: string; extensionNumber?: string; name?: string };
  [key: string]: unknown;
};

export type RingCentralAnalyticsRange = 'today' | 'yesterday' | 'last-week';

type RingCentralConfig = {
  clientId: string;
  clientSecret: string;
  serverUrl: string;
  redirectUri: string;
  targetPhoneNumber?: string;
  jwt?: string;
};

export class RingCentralAuthRequiredError extends Error {
  constructor(message = 'RingCentral authorization is required.') {
    super(message);
    this.name = 'RingCentralAuthRequiredError';
  }
}

export class RingCentralApiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'RingCentralApiError';
    this.status = status;
  }
}

// Normalize pasted environment values without ever logging credentials.
function credentialValue(value?: string) {
  return (value || '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
}

function credentialKey(config: RingCentralConfig) {
  return createHash('sha256').update(JSON.stringify([config.serverUrl, config.clientId, config.clientSecret, config.jwt || ''])).digest('hex');
}

async function authorizationError(response: Response, config: RingCentralConfig, jwtGrant = false) {
  const data = await response.json().catch(() => ({})) as { error?: string; errorCode?: string; errors?: Array<{ errorCode?: string }> };
  // Provider descriptions may echo request values. Only expose bounded codes.
  const rawCode = data.errorCode || data.errors?.[0]?.errorCode || data.error;
  const code = typeof rawCode === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(rawCode) ? rawCode : null;
  let message = 'RingCentral authorization was rejected. Reconnect the account.';
  if (code === 'invalid_client' || ['OAU-120', 'OAU-121', 'OAU-146'].includes(code || '')) {
    message = 'RingCentral rejected the app credentials. Update RC_APP_CLIENT_ID and RC_APP_CLIENT_SECRET in Vercel using the same production app, then redeploy.';
  } else if (code === 'OAU-473') {
    message = 'The JWT is not authorized for this RingCentral app. Add this app under the credential\'s Authorized Apps in the RingCentral Developer Console, then refresh calls.';
  } else if (['unauthorized_client', 'OAU-112', 'OAU-125'].includes(code || '')) {
    message = 'The RingCentral app does not allow this authentication method. Enable JWT authentication for the app used in Vercel.';
  } else if (jwtGrant || config.jwt) {
    message = 'RingCentral rejected the JWT credential. Verify it is active and authorized for this app; update RC_USER_JWT in Vercel if expired or revoked, then redeploy.';
    if (jwtGrant && config.jwt) {
      try {
        const payload = JSON.parse(Buffer.from(config.jwt.split('.')[1], 'base64url').toString()) as { exp?: number };
        if (typeof payload.exp === 'number' && payload.exp <= Date.now() / 1000) {
          message = 'The RingCentral JWT credential has expired. Create a new JWT authorized for this app, update RC_USER_JWT in Vercel, then redeploy.';
        }
      } catch { /* RingCentral validates malformed JWTs; never expose payloads. */ }
    }
  }
  return new RingCentralAuthRequiredError(`${message}${code ? ` (${code})` : ''}`);
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'local-development-secret';
}

function getEncryptionKey() {
  return createHash('sha256').update(getSessionSecret()).digest();
}

function seal(value: RingCentralTokenData) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function unseal(value: string): RingCentralTokenData | null {
  try {
    const [ivEncoded, tagEncoded, encryptedEncoded] = value.split('.');
    if (!ivEncoded || !tagEncoded || !encryptedEncoded) return null;
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivEncoded, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(decrypted) as RingCentralTokenData;
    return parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export function getRingCentralConfig(): RingCentralConfig | null {
  const clientId = credentialValue(process.env.RC_APP_CLIENT_ID);
  const clientSecret = credentialValue(process.env.RC_APP_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;

  const serverUrl = (credentialValue(process.env.RC_SERVER_URL) || 'https://platform.ringcentral.com').replace(/\/$/, '');
  const redirectUri = process.env.RC_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/ringcentral/callback`;
  const targetPhoneNumber = process.env.RC_TARGET_PHONE_NUMBER?.trim() || DEFAULT_TARGET_PHONE_NUMBER;

  return {
    clientId,
    clientSecret,
    serverUrl,
    redirectUri,
    targetPhoneNumber,
    jwt: credentialValue(process.env.RC_USER_JWT).replace(/^Bearer\s+/i, '') || undefined,
  };
}

export function getRingCentralAuthMethod(): 'jwt' | 'oauth' | null {
  const config = getRingCentralConfig();
  return config ? (config.jwt ? 'jwt' : 'oauth') : null;
}

export function getRingCentralStateCookieName() {
  return RINGCENTRAL_STATE_COOKIE;
}

export function setRingCentralTokenCookie(response: Response, tokenData: RingCentralTokenData) {
  const cookieResponse = response as Response & { cookies?: { set: (name: string, value: string, options: Record<string, unknown>) => void } };
  cookieResponse.cookies?.set(RINGCENTRAL_TOKEN_COOKIE, seal(tokenData), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(60, (tokenData.refreshTokenExpiresAt || tokenData.accessTokenExpiresAt) - Math.floor(Date.now() / 1000)),
  });
}

export async function clearRingCentralTokenCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(RINGCENTRAL_TOKEN_COOKIE);
}

function isMissingConnectionTableError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === 'P2021' && /RingCentralConnection/i.test(candidate.message || '');
}

export async function persistRingCentralToken(tokenData: RingCentralTokenData) {
  try {
    await prisma.ringCentralConnection.upsert({
      where: { id: 'default' },
      create: { id: 'default', encryptedTokenData: seal(tokenData) },
      update: { encryptedTokenData: seal(tokenData) },
    });
  } catch (error) {
    // Keep the cookie fallback usable until the additive production migration
    // has been applied. Once the table exists, all roles share the DB token.
    if (!isMissingConnectionTableError(error)) throw error;
  }
}

async function getStoredToken() {
  try {
    const connection = await prisma.ringCentralConnection.findUnique({ where: { id: 'default' } });
    if (connection?.encryptedTokenData) return unseal(connection.encryptedTokenData);
  } catch (error) {
    if (!isMissingConnectionTableError(error)) throw error;
  }

  const cookieStore = await cookies();
  const value = cookieStore.get(RINGCENTRAL_TOKEN_COOKIE)?.value;
  return value ? unseal(value) : null;
}

function tokenFromResponse(data: any, previous?: RingCentralTokenData): RingCentralTokenData {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: data.access_token,
    // RingCentral normally rotates the single-use refresh token. Preserve the
    // existing one if a compatible response omits it instead of losing future
    // automatic renewals.
    refreshToken: data.refresh_token || previous?.refreshToken,
    accessTokenExpiresAt: now + Number(data.expires_in || 3600),
    refreshTokenExpiresAt: data.refresh_token_expires_in
      ? now + Number(data.refresh_token_expires_in)
      : previous?.refreshTokenExpiresAt,
    ownerId: data.owner_id || previous?.ownerId,
  };
}

async function requestToken(config: RingCentralConfig, body: URLSearchParams, previous?: RingCentralTokenData) {
  const response = await fetch(`${config.serverUrl}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 429) throw new RingCentralApiError('RingCentral is rate limiting requests. Wait a minute, then refresh calls again.', 429);
    if (response.status >= 500) throw new RingCentralApiError('RingCentral is temporarily unavailable. Try refreshing calls again shortly.', 503);
    if ([400, 401, 403].includes(response.status)) {
      throw await authorizationError(response, config, body.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    }
    throw new Error(`RingCentral token request failed (${response.status}).`);
  }

  const data = await response.json();
  if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('RingCentral returned an invalid token response. Try refreshing calls again.');
  return { ...tokenFromResponse(data, previous), credentialKey: credentialKey(config) };
}

export async function exchangeRingCentralCode(code: string) {
  const config = getRingCentralConfig();
  if (!config) throw new Error('RingCentral API credentials are not configured.');

  return requestToken(config, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  }));
}

const tokenRenewals = new Map<string, Promise<{ token: RingCentralTokenData; refreshed: boolean }>>();

async function getValidToken(rejectedAccessToken?: string) {
  const config = getRingCentralConfig();
  if (!config) throw new Error('RingCentral API credentials are not configured.');

  const key = credentialKey(config);
  const pending = tokenRenewals.get(key);
  if (pending) return pending;
  const candidate = await getStoredToken();
  const stored = candidate?.credentialKey && candidate.credentialKey !== key ? null : candidate;
  const now = Math.floor(Date.now() / 1000);
  if (stored && stored.accessToken !== rejectedAccessToken && stored.accessTokenExpiresAt > now + 60) return { token: stored, refreshed: false };
  // Another request may have started renewal while the DB read was pending.
  const started = tokenRenewals.get(key);
  if (started) return started;
  const renewal = renewToken(config, stored).then(async (token) => {
    // Persist before using it: a later call-log or voicemail failure must not
    // discard a rotated, single-use refresh token.
    await persistRingCentralToken(token);
    return { token, refreshed: true };
  });
  tokenRenewals.set(key, renewal);
  try {
    return await renewal;
  } finally {
    if (tokenRenewals.get(key) === renewal) tokenRenewals.delete(key);
  }
}

async function renewToken(config: RingCentralConfig, stored: RingCentralTokenData | null) {
  const now = Math.floor(Date.now() / 1000);
  if (stored?.refreshToken && (!stored.refreshTokenExpiresAt || stored.refreshTokenExpiresAt > now + 60)) {
    try {
      const refreshed = await requestToken(config, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
      }), stored);
      return refreshed;
    } catch (error) {
      // A configured JWT is the durable server-to-server credential. If an
      // older OAuth refresh token has been revoked, fall through and obtain a
      // new access token with JWT instead of requiring a browser callback.
      if (!config.jwt || !(error instanceof RingCentralAuthRequiredError)) throw error;
    }
  }

  if (config.jwt) {
    const token = await requestToken(config, new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: config.jwt,
    }));
    return token;
  }

  throw new RingCentralAuthRequiredError();
}

// Renew once on a server-rejected token, even if its recorded expiry is in
// the future (revocation, session limits, password changes, etc.).
async function authenticatedFetch(url: string, session: { token: RingCentralTokenData; refreshed: boolean }, accept = 'application/json') {
  const request = () => fetch(url, {
    headers: { Accept: accept, Authorization: `Bearer ${session.token.accessToken}` },
    cache: 'no-store',
  });
  let response = await request();
  if (response.status === 401) {
    const renewed = await getValidToken(session.token.accessToken);
    session.token = renewed.token;
    session.refreshed = session.refreshed || renewed.refreshed;
    response = await request();
  }
  if (response.status === 401) {
    throw new RingCentralAuthRequiredError('RingCentral rejected the renewed access token. Verify the account and app authorization in RingCentral.');
  }
  return response;
}

export async function getRingCentralConnectionStatus() {
  const config = getRingCentralConfig();
  if (!config) return { configured: false, connected: false, authMethod: null, targetPhoneNumber: null };

  const stored = await getStoredToken();
  const now = Math.floor(Date.now() / 1000);
  const connected = Boolean(
    config.jwt ||
      (stored && (
        stored.accessTokenExpiresAt > now ||
        (stored.refreshToken && (!stored.refreshTokenExpiresAt || stored.refreshTokenExpiresAt > now))
      )),
  );
  return {
    configured: true,
    connected,
    authMethod: config.jwt ? 'jwt' as const : 'oauth' as const,
    targetPhoneNumber: config.targetPhoneNumber || null,
  };
}

async function listRingCentralCalls(dateFrom: string, dateTo: string, direction?: 'Inbound' | 'Outbound') {
  const config = getRingCentralConfig();
  if (!config) throw new Error('RingCentral API credentials are not configured.');

  const session = await getValidToken();
  const records: RingCentralCallRecord[] = [];
  let page = 1;
  let totalPages: number | null = 1;
  let nextPageUri: string | null = null;

  while ((nextPageUri || totalPages === null || page <= totalPages) && page <= 100) {
    const params = new URLSearchParams({
      dateFrom,
      dateTo,
      type: 'Voice',
      view: 'Detailed',
      perPage: '1000',
      page: String(page),
    });
    if (direction) params.set('direction', direction);
    // Filter the receiving number locally. The API's phoneNumber query filter
    // can be format-sensitive, while call-log records may use E.164 or a
    // formatted national number for the same destination.

    const response = await authenticatedFetch(nextPageUri || `${config.serverUrl}/restapi/v1.0/account/~/call-log?${params.toString()}`, session);
    if (!response.ok) throw new Error(`RingCentral call log request failed (${response.status}).`);

    const data: {
      records?: RingCentralCallRecord[];
      paging?: { totalPages?: number };
      navigation?: { nextPage?: { uri?: string } };
    } = await response.json();
    records.push(...(Array.isArray(data.records) ? data.records : []));
    totalPages = data.paging?.totalPages === undefined ? null : Number(data.paging.totalPages);
    nextPageUri = typeof data.navigation?.nextPage?.uri === 'string' ? data.navigation.nextPage.uri : null;
    page += 1;
    if (!nextPageUri && totalPages === null) break;
  }

  return { records, ...session };
}

export async function listRingCentralInboundCalls(dateFrom: string, dateTo: string) {
  return listRingCentralCalls(dateFrom, dateTo, 'Inbound');
}

export async function listRingCentralOutboundCalls(dateFrom: string, dateTo: string) {
  return listRingCentralCalls(dateFrom, dateTo, 'Outbound');
}

type RingCentralMessageRecipient = {
  phoneNumber?: string;
  extensionNumber?: string;
  name?: string;
};

type RingCentralVoicemailMessage = {
  id?: number | string;
  to?: RingCentralMessageRecipient[];
  from?: RingCentralMessageRecipient;
  type?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  readStatus?: string;
  direction?: string;
  availability?: string;
  subject?: string;
  messageStatus?: string;
  vmTranscriptionStatus?: string;
  attachments?: Array<{
    id?: number | string;
    uri?: string;
    type?: string;
    contentType?: string;
    vmDuration?: number;
  }>;
};

async function fetchVoicemailTranscript(
  message: RingCentralVoicemailMessage,
  session: { token: RingCentralTokenData; refreshed: boolean },
) {
  const status = (message.vmTranscriptionStatus || '').toLowerCase();
  if (!status.includes('complete')) return null;

  const transcriptionAttachment = message.attachments?.find((attachment) =>
    attachment.type?.toLowerCase() === 'audiotranscription',
  );
  if (transcriptionAttachment?.uri) {
    const response = await authenticatedFetch(transcriptionAttachment.uri, session, 'text/plain, application/json');
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const data = await response.json() as { transcript?: string; text?: string; content?: string };
        return data.transcript || data.text || data.content || null;
      }
      const text = (await response.text()).trim();
      return text || null;
    }
  }

  // RingCentral also mirrors completed voicemail transcription in `subject`
  // for some accounts, while others expose it only as AudioTranscription.
  const subject = message.subject?.trim();
  return subject && !/^message$/i.test(subject) ? subject : null;
}

function voicemailMatchesTarget(message: RingCentralVoicemailMessage, targetPhoneNumbers?: string[]) {
  const targets = (targetPhoneNumbers || []).map((value) => normalizePhone(value)).filter((value) => value.length >= 7);
  if (targets.length === 0) return true;
  const recipients = (message.to || []).map((recipient) => normalizePhone(recipient.phoneNumber)).filter(Boolean);
  // A mailbox response may omit the public number and return only the
  // extension. In that case the authenticated mailbox is still in scope.
  return recipients.length === 0 || recipients.some((recipient) => targets.includes(recipient));
}

function normalizePhone(value?: string) {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export async function listRingCentralVoicemails(dateFrom: string, dateTo: string, targetPhoneNumbers?: string[]) {
  const config = getRingCentralConfig();
  if (!config) throw new Error('RingCentral API credentials are not configured.');

  const session = await getValidToken();
  const messages: RingCentralVoicemailMessage[] = [];
  let page = 1;
  let totalPages: number | null = 1;
  let nextPageUri: string | null = null;

  while ((nextPageUri || totalPages === null || page <= totalPages) && page <= 100) {
    const params = new URLSearchParams({
      dateFrom,
      dateTo,
      messageType: 'VoiceMail',
      direction: 'Inbound',
      availability: 'Alive',
      perPage: '1000',
      page: String(page),
    });
    const response = await authenticatedFetch(nextPageUri || `${config.serverUrl}/restapi/v1.0/account/~/extension/~/message-store?${params.toString()}`, session);
    if (response.status === 403) return { records: [], ...session, permissionDenied: true as const };
    if (!response.ok) throw new Error(`RingCentral voicemail request failed (${response.status}).`);

    const data: {
      records?: RingCentralVoicemailMessage[];
      paging?: { totalPages?: number };
      navigation?: { nextPage?: { uri?: string } };
    } = await response.json();
    messages.push(...(Array.isArray(data.records) ? data.records : []));
    totalPages = data.paging?.totalPages === undefined ? null : Number(data.paging.totalPages);
    nextPageUri = typeof data.navigation?.nextPage?.uri === 'string' ? data.navigation.nextPage.uri : null;
    page += 1;
    if (!nextPageUri && totalPages === null) break;
  }

  const records: RingCentralCallRecord[] = [];
  for (const message of messages.filter((candidate) => voicemailMatchesTarget(candidate, targetPhoneNumbers))) {
    const messageId = message.id === undefined ? '' : String(message.id);
    if (!messageId) continue;
    const recipient = (message.to || []).find((candidate) => normalizePhone(candidate.phoneNumber)) || message.to?.[0] || {};
    const audioAttachment = message.attachments?.find((attachment) => attachment.type?.toLowerCase() === 'audiorecording');
    let transcript: string | null = null;
    try {
      transcript = await fetchVoicemailTranscript(message, session);
    } catch (error) {
      if (error instanceof RingCentralAuthRequiredError) throw error;
      // A transcript can be temporarily unavailable while RingCentral is
      // still processing it. Keep the voicemail metadata and retry next sync.
    }
    records.push({
      id: `voicemail:${messageId}`,
      sourceKey: `voicemail:${messageId}`,
      direction: message.direction || 'Inbound',
      type: message.type || 'VoiceMail',
      result: 'Voicemail',
      startTime: message.creationTime,
      lastModifiedTime: message.lastModifiedTime,
      duration: audioAttachment?.vmDuration,
      isVoicemail: true,
      voicemailMessageId: messageId,
      voicemailTranscriptionStatus: message.vmTranscriptionStatus,
      voicemailTranscript: transcript || undefined,
      voicemailReadStatus: message.readStatus,
      voicemailMessageStatus: message.messageStatus,
      voicemailDurationSeconds: audioAttachment?.vmDuration,
      from: message.from,
      to: recipient,
    });
  }

  return { records, ...session, permissionDenied: false as const };
}

export function ringCentralDateKey(value: string | Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export function ringCentralTorontoRange(range: RingCentralAnalyticsRange | number = 'last-week') {
  const isLegacyDayCount = typeof range === 'number';
  const selectedRange = isLegacyDayCount ? 'last-week' : range;
  const dayCount = isLegacyDayCount ? Math.max(1, Math.floor(range)) : 7;
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayKey = dateFormatter.format(new Date());
  const [year, month, day] = todayKey.split('-').map(Number);
  const todayUtc = new Date(Date.UTC(year, month - 1, day));
  const startUtc = new Date(todayUtc);
  const endUtc = new Date(todayUtc);
  if (selectedRange === 'today') {
    // Keep today's local date as both boundaries.
  } else if (selectedRange === 'yesterday') {
    startUtc.setUTCDate(startUtc.getUTCDate() - 1);
    endUtc.setUTCDate(endUtc.getUTCDate() - 1);
  } else {
    startUtc.setUTCDate(startUtc.getUTCDate() - (dayCount - 1));
  }

  const offsetForDate = (date: Date) => {
    const rawOffset = new Intl.DateTimeFormat('en-US', { timeZone: TORONTO_TIME_ZONE, timeZoneName: 'longOffset' })
      .formatToParts(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)))
      .find((part) => part.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00';
    return /^[-+]\d$/.test(rawOffset) ? `${rawOffset[0]}0${rawOffset.slice(1)}:00` : rawOffset;
  };

  const localIso = (date: Date, endOfDay = false) =>
    `${date.toISOString().slice(0, 10)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${offsetForDate(date)}`;

  return {
    dateFrom: localIso(startUtc),
    dateTo: localIso(endUtc, true),
    todayKey,
    startUtc,
    endUtc,
  };
}

export function ringCentralTorontoWeekToDateRange() {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayKey = dateFormatter.format(new Date());
  const [year, month, day] = todayKey.split('-').map(Number);
  const endUtc = new Date(Date.UTC(year, month - 1, day));
  const startUtc = new Date(endUtc);
  const daysSinceMonday = (startUtc.getUTCDay() + 6) % 7;
  startUtc.setUTCDate(startUtc.getUTCDate() - daysSinceMonday);

  const offsetForDate = (date: Date) => {
    const rawOffset = new Intl.DateTimeFormat('en-US', { timeZone: TORONTO_TIME_ZONE, timeZoneName: 'longOffset' })
      .formatToParts(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)))
      .find((part) => part.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00';
    return /^[-+]\d$/.test(rawOffset) ? `${rawOffset[0]}0${rawOffset.slice(1)}:00` : rawOffset;
  };

  const localIso = (date: Date, endOfDay = false) =>
    `${date.toISOString().slice(0, 10)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${offsetForDate(date)}`;

  return {
    dateFrom: localIso(startUtc),
    dateTo: localIso(endUtc, true),
    startUtc,
    endUtc,
    todayKey,
  };
}

export function isCallForTarget(record: RingCentralCallRecord, targetPhoneNumber?: string | string[]) {
  if (!targetPhoneNumber || (Array.isArray(targetPhoneNumber) && targetPhoneNumber.length === 0)) return true;
  const normalize = (value?: string) => {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  };
  const targets = (Array.isArray(targetPhoneNumber) ? targetPhoneNumber : [targetPhoneNumber]).map(normalize);
  const direction = record.direction?.toLowerCase();
  const endpoint = direction === 'outbound' ? normalize(record.from?.phoneNumber) : normalize(record.to?.phoneNumber);
  return Boolean(endpoint.length >= 7 && targets.some((target) => target.length >= 7 && target === endpoint));
}

export function getCallDurationSeconds(record: RingCentralCallRecord) {
  const duration = record.duration === undefined ? Number.NaN : Number(record.duration);
  if (Number.isFinite(duration)) return duration;
  const durationMs = record.durationMs === undefined ? Number.NaN : Number(record.durationMs);
  if (Number.isFinite(durationMs)) return durationMs / 1000;
  return null;
}

export function isRingCentralVoicemail(record: RingCentralCallRecord) {
  return Boolean(record.isVoicemail || record.voicemailMessageId || /voicemail/i.test(record.type || '') || /voicemail/i.test(record.result || ''));
}

export function isRingCentralMissedInboundCall(record: RingCentralCallRecord) {
  if (record.direction?.toLowerCase() !== 'inbound' || isRingCentralVoicemail(record)) return false;
  const result = `${record.result || ''} ${record.reason || ''}`.toLowerCase();
  return /missed|no[ -]?answer|busy|failed|cancelled/.test(result) || (getCallDurationSeconds(record) !== null && (getCallDurationSeconds(record) || 0) < MIN_REAL_CALL_DURATION_SECONDS);
}

function normalizeCallerPhone(value?: string) {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function isQualifyingRingCentralInboundCall(record: RingCentralCallRecord) {
  // Unknown durations remain eligible for older cached payloads. Explicitly
  // missed calls and voicemails never count, even if ringing lasted 30+ seconds.
  return record.direction?.toLowerCase() === 'inbound'
    && !isRingCentralVoicemail(record)
    && !isRingCentralMissedInboundCall(record);
}

export function groupRingCentralInboundCalls(records: RingCentralCallRecord[], targetPhoneNumber?: string | string[]) {
  const inbound = records.filter((record) => record.direction?.toLowerCase() === 'inbound'
    && isCallForTarget(record, targetPhoneNumber)
    && record.startTime && Number.isFinite(new Date(record.startTime).getTime()));
  const sessionKey = (record: RingCentralCallRecord) => {
    const identity = record.telephonySessionId ? `telephony:${record.telephonySessionId}`
      : record.sessionId ? `session:${record.sessionId}`
      : record.id ? `id:${record.id}`
      : record.sourceKey ? `source:${record.sourceKey}` : null;
    return identity ? `${ringCentralDateKey(record.startTime!)}:${identity}` : null;
  };

  // A leg with hidden caller ID can still belong to a session whose other leg
  // provides the number. Resolve those sessions before grouping daily leads.
  const sessionCallers = new Map<string, string>();
  for (const record of inbound) {
    const caller = normalizeCallerPhone(record.from?.phoneNumber);
    const session = sessionKey(record);
    if (caller.length >= 7 && session && !sessionCallers.has(session)) sessionCallers.set(session, caller);
  }

  const grouped = new Map<string, RingCentralCallRecord[]>();
  inbound.forEach((record, index) => {
    const session = sessionKey(record);
    const caller = (session && sessionCallers.get(session)) || normalizeCallerPhone(record.from?.phoneNumber);
    const date = ringCentralDateKey(record.startTime!);
    // Never group every anonymous caller together, or infer identity from a
    // caller name. Without a number, deduplicate only a known session/record.
    const key = caller.length >= 7 ? `${date}:phone:${caller}`
      : session || `${date}:anonymous:${index}`;
    const group = grouped.get(key) || [];
    group.push(record);
    grouped.set(key, group);
  });
  return Array.from(grouped.values()).map((group) => group.sort((left, right) =>
    new Date(left.startTime!).getTime() - new Date(right.startTime!).getTime()));
}

export function uniqueInboundCalls(records: RingCentralCallRecord[], targetPhoneNumber?: string | string[]) {
  return groupRingCentralInboundCalls(records, targetPhoneNumber)
    .map((group) => group.find(isQualifyingRingCentralInboundCall))
    .filter((record): record is RingCentralCallRecord => Boolean(record))
    .sort((left, right) => new Date(left.startTime!).getTime() - new Date(right.startTime!).getTime());
}
