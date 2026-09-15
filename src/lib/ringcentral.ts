import { cookies } from 'next/headers';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';

const RINGCENTRAL_TOKEN_COOKIE = 'lockops_ringcentral_tokens';
const RINGCENTRAL_STATE_COOKIE = 'lockops_ringcentral_oauth_state';
const TORONTO_TIME_ZONE = 'America/Toronto';
// The receiving number shown in the connected RingCentral account. Override it
// with RC_TARGET_PHONE_NUMBER if the business number changes.
const DEFAULT_TARGET_PHONE_NUMBER = '+14162400593';

export type RingCentralTokenData = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt?: number;
  ownerId?: string;
};

export type RingCentralCallRecord = {
  id?: string;
  sessionId?: string;
  telephonySessionId?: string;
  direction?: string;
  type?: string;
  result?: string;
  startTime?: string;
  from?: { phoneNumber?: string; extensionNumber?: string; name?: string };
  to?: { phoneNumber?: string; extensionNumber?: string; name?: string };
  [key: string]: unknown;
};

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
  const clientId = process.env.RC_APP_CLIENT_ID;
  const clientSecret = process.env.RC_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const serverUrl = (process.env.RC_SERVER_URL || 'https://platform.ringcentral.com').replace(/\/$/, '');
  const redirectUri = process.env.RC_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/ringcentral/callback`;
  const targetPhoneNumber = process.env.RC_TARGET_PHONE_NUMBER?.trim() || DEFAULT_TARGET_PHONE_NUMBER;

  return {
    clientId,
    clientSecret,
    serverUrl,
    redirectUri,
    targetPhoneNumber,
    jwt: process.env.RC_USER_JWT,
  };
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

function tokenFromResponse(data: any): RingCentralTokenData {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt: now + Number(data.expires_in || 3600),
    refreshTokenExpiresAt: data.refresh_token_expires_in ? now + Number(data.refresh_token_expires_in) : undefined,
    ownerId: data.owner_id,
  };
}

async function requestToken(config: RingCentralConfig, body: URLSearchParams) {
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
    throw new RingCentralAuthRequiredError('RingCentral authorization expired or was rejected.');
  }

  return tokenFromResponse(await response.json());
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

async function getValidToken() {
  const config = getRingCentralConfig();
  if (!config) throw new Error('RingCentral API credentials are not configured.');

  const stored = await getStoredToken();
  const now = Math.floor(Date.now() / 1000);
  if (stored && stored.accessTokenExpiresAt > now + 60) return { token: stored, refreshed: false };

  if (stored?.refreshToken && (!stored.refreshTokenExpiresAt || stored.refreshTokenExpiresAt > now + 60)) {
    const refreshed = await requestToken(config, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    }));
    return { token: refreshed, refreshed: true };
  }

  if (config.jwt) {
    const token = await requestToken(config, new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: config.jwt,
    }));
    return { token, refreshed: true };
  }

  throw new RingCentralAuthRequiredError();
}

export async function getRingCentralConnectionStatus() {
  const config = getRingCentralConfig();
  if (!config) return { configured: false, connected: false, targetPhoneNumber: null };

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
    targetPhoneNumber: config.targetPhoneNumber || null,
  };
}

export async function listRingCentralInboundCalls(dateFrom: string, dateTo: string) {
  const config = getRingCentralConfig();
  if (!config) throw new Error('RingCentral API credentials are not configured.');

  const { token, refreshed } = await getValidToken();
  const records: RingCentralCallRecord[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 20) {
    const params = new URLSearchParams({
      dateFrom,
      dateTo,
      direction: 'Inbound',
      type: 'Voice',
      view: 'Detailed',
      perPage: '250',
      page: String(page),
    });
    // Filter the receiving number locally. The API's phoneNumber query filter
    // can be format-sensitive, while call-log records may use E.164 or a
    // formatted national number for the same destination.

    const response = await fetch(`${config.serverUrl}/restapi/v1.0/account/~/call-log?${params.toString()}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token.accessToken}` },
      cache: 'no-store',
    });

    if (response.status === 401) throw new RingCentralAuthRequiredError();
    if (!response.ok) throw new Error(`RingCentral call log request failed (${response.status}).`);

    const data = await response.json();
    records.push(...(Array.isArray(data.records) ? data.records : []));
    totalPages = Number(data.paging?.totalPages || page);
    page += 1;
  }

  return { records, token, refreshed };
}

export function ringCentralDateKey(value: string | Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export function ringCentralTorontoRange(days: number) {
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
  startUtc.setUTCDate(startUtc.getUTCDate() - (days - 1));

  // Toronto's current offset is applied by constructing the query boundary
  // from the local calendar date. The API accepts the explicit offset.
  const rawOffset = new Intl.DateTimeFormat('en-US', { timeZone: TORONTO_TIME_ZONE, timeZoneName: 'longOffset' })
    .formatToParts(new Date())
    .find((part) => part.type === 'timeZoneName')?.value.replace('GMT', '') || '-04:00';
  const offset = /^[-+]\d$/.test(rawOffset) ? `${rawOffset[0]}0${rawOffset.slice(1)}:00` : rawOffset;

  const localIso = (date: Date, endOfDay = false) =>
    `${date.toISOString().slice(0, 10)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${offset}`;

  return {
    dateFrom: localIso(startUtc),
    dateTo: localIso(todayUtc, true),
    todayKey,
    startUtc,
    todayUtc,
  };
}

export function isCallForTarget(record: RingCentralCallRecord, targetPhoneNumber?: string) {
  if (!targetPhoneNumber) return true;
  const normalize = (value?: string) => {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  };
  const target = normalize(targetPhoneNumber);
  const destination = normalize(record.to?.phoneNumber);
  return Boolean(target.length >= 7 && destination.length >= 7 && target === destination);
}

export function uniqueInboundCalls(records: RingCentralCallRecord[], targetPhoneNumber?: string) {
  const filtered = records.filter((record) => record.direction?.toLowerCase() === 'inbound' && isCallForTarget(record, targetPhoneNumber));
  const seen = new Set<string>();
  return filtered.filter((record) => {
    const key = record.telephonySessionId || record.sessionId || record.id;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
