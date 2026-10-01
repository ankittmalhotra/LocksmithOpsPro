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
    throw new RingCentralAuthRequiredError('RingCentral authorization expired or was rejected.');
  }

  return tokenFromResponse(await response.json(), previous);
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
    }), stored);
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

async function listRingCentralCalls(dateFrom: string, dateTo: string, direction?: 'Inbound' | 'Outbound') {
  const config = getRingCentralConfig();
  if (!config) throw new Error('RingCentral API credentials are not configured.');

  const { token, refreshed } = await getValidToken();
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

    const response: Response = await fetch(nextPageUri || `${config.serverUrl}/restapi/v1.0/account/~/call-log?${params.toString()}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token.accessToken}` },
      cache: 'no-store',
    });

    if (response.status === 401) throw new RingCentralAuthRequiredError();
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

  return { records, token, refreshed };
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
  token: RingCentralTokenData,
) {
  const status = (message.vmTranscriptionStatus || '').toLowerCase();
  if (!status.includes('complete')) return null;

  const transcriptionAttachment = message.attachments?.find((attachment) =>
    attachment.type?.toLowerCase() === 'audiotranscription',
  );
  if (transcriptionAttachment?.uri) {
    const response = await fetch(transcriptionAttachment.uri, {
      headers: { Accept: 'text/plain, application/json', Authorization: `Bearer ${token.accessToken}` },
      cache: 'no-store',
    });
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

  const { token, refreshed } = await getValidToken();
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
    const response: Response = await fetch(nextPageUri || `${config.serverUrl}/restapi/v1.0/account/~/extension/~/message-store?${params.toString()}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token.accessToken}` },
      cache: 'no-store',
    });
    if (response.status === 401) throw new RingCentralAuthRequiredError();
    if (response.status === 403) return { records: [], token, refreshed, permissionDenied: true as const };
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
      transcript = await fetchVoicemailTranscript(message, token);
    } catch {
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

  return { records, token, refreshed, permissionDenied: false as const };
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

export function uniqueInboundCalls(records: RingCentralCallRecord[], targetPhoneNumber?: string | string[]) {
  const filtered = records
    .filter((record) => record.direction?.toLowerCase() === 'inbound' && isCallForTarget(record, targetPhoneNumber))
    .filter((record) => !isRingCentralVoicemail(record))
    .filter((record) => {
      const duration = getCallDurationSeconds(record);
      // Keep records with no duration for backwards compatibility with older
      // call-log payloads, but exclude known calls shorter than 30 seconds.
      return duration === null || duration >= MIN_REAL_CALL_DURATION_SECONDS;
    });

  const seenSessions = new Set<string>();
  const sessionDeduped = filtered.filter((record) => {
    const key = record.telephonySessionId || record.sessionId || record.id;
    if (!key) return true;
    if (seenSessions.has(key)) return false;
    seenSessions.add(key);
    return true;
  });

  // Preserve the earliest qualifying call so a later job on the same day can
  // still be matched to the lead's first call.
  sessionDeduped.sort((left, right) => {
    const leftTime = left.startTime ? new Date(left.startTime).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startTime ? new Date(right.startTime).getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });

  const seenLeads = new Set<string>();
  return sessionDeduped.filter((record) => {
    const callerPhone = normalizeCallerPhone(record.from?.phoneNumber);
    if (!callerPhone || callerPhone.length < 7 || !record.startTime) return true;

    const leadKey = `${ringCentralDateKey(record.startTime)}:${callerPhone}`;
    if (seenLeads.has(leadKey)) return false;
    seenLeads.add(leadKey);
    return true;
  });
}
