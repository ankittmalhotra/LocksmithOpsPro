import { getStoredGoogleAdsRefreshToken } from '@/lib/google-ads-credential-store';

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GOOGLE_ADS_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_API_URL = 'https://googleads.googleapis.com';
const DEFAULT_GOOGLE_ADS_API_VERSION = 'v25';

export const GOOGLE_ADS_TIME_ZONE = 'America/Toronto';
export const GOOGLE_ADS_PARTNER_COUNT = 2;
export const GOOGLE_ADS_BUSINESS_START_DATE = '2026-09-07';

export const GOOGLE_ADS_RANGE_OPTIONS = ['today', 'yesterday', 'last-week', 'all-time'] as const;
export type GoogleAdsRoiRange = (typeof GOOGLE_ADS_RANGE_OPTIONS)[number];

export const GOOGLE_ADS_RANGE_LABELS: Record<GoogleAdsRoiRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'last-week': 'Last week',
  'all-time': 'All time',
};

export type GoogleAdsConfig = {
  apiVersion: string;
  clientId: string;
  clientSecret: string;
  customerId: string;
  developerToken: string;
  loginCustomerId?: string;
  refreshToken?: string;
};

export type GoogleAdsDailyMetrics = {
  clicks: number;
  conversionsValue: number;
  costMicros: number;
  date: string;
  customerId: string;
  impressions: number;
};

export type GoogleAdsRoi = {
  adSpend: number | null;
  netReturn: number | null;
  profit: number;
  roiPercent: number | null;
  roas: number | null;
};

export class GoogleAdsConfigurationError extends Error {
  readonly missingVariables: string[];

  constructor(missingVariables: string[]) {
    super(`Google Ads is not configured. Missing: ${missingVariables.join(', ')}`);
    this.name = 'GoogleAdsConfigurationError';
    this.missingVariables = missingVariables;
  }
}

export class GoogleAdsApiError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = 'GoogleAdsApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

export class GoogleAdsReauthRequiredError extends GoogleAdsApiError {
  constructor() {
    super(
      'Google Ads access has expired or was revoked. Reconnect the Google Ads account from the Admin dashboard to restore access.',
      400,
    );
    this.name = 'GoogleAdsReauthRequiredError';
  }
}

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function normalizeCustomerId(value: string, variableName: string): string {
  const normalized = value.replace(/[-\s]/g, '');
  if (!/^\d{10}$/.test(normalized)) {
    throw new GoogleAdsConfigurationError([`${variableName} (must be a 10-digit customer ID)`]);
  }
  return normalized;
}

export function getGoogleAdsConfig(): GoogleAdsConfig {
  const requiredVariables = [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_CUSTOMER_ID',
  ];
  const missingVariables = requiredVariables.filter((name) => !getEnv(name));

  if (missingVariables.length > 0) {
    throw new GoogleAdsConfigurationError(missingVariables);
  }

  const customerId = normalizeCustomerId(getEnv('GOOGLE_ADS_CUSTOMER_ID')!, 'GOOGLE_ADS_CUSTOMER_ID');
  const loginCustomerId = getEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID');

  return {
    apiVersion: getEnv('GOOGLE_ADS_API_VERSION') || DEFAULT_GOOGLE_ADS_API_VERSION,
    clientId: getEnv('GOOGLE_ADS_CLIENT_ID')!,
    clientSecret: getEnv('GOOGLE_ADS_CLIENT_SECRET')!,
    customerId,
    developerToken: getEnv('GOOGLE_ADS_DEVELOPER_TOKEN')!,
    loginCustomerId: loginCustomerId
      ? normalizeCustomerId(loginCustomerId, 'GOOGLE_ADS_LOGIN_CUSTOMER_ID')
      : undefined,
    refreshToken: getEnv('GOOGLE_ADS_REFRESH_TOKEN'),
  };
}

export function getMissingGoogleAdsConfigVariables(): string[] {
  return [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_CUSTOMER_ID',
  ].filter((name) => !getEnv(name));
}

export function getDateKeyInTimeZone(date: Date, timeZone = GOOGLE_ADS_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dateKeyToUtcDate(dateKey: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function getYesterdayDateKey(now = new Date(), timeZone = GOOGLE_ADS_TIME_ZONE): string {
  const todayDateKey = getDateKeyInTimeZone(now, timeZone);
  const todayUtc = dateKeyToUtcDate(todayDateKey);
  todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
  return todayUtc.toISOString().slice(0, 10);
}

export function getGoogleAdsDateKeys(range: GoogleAdsRoiRange = 'today', now = new Date()): string[] {
  const todayKey = getDateKeyInTimeZone(now);
  const todayUtc = dateKeyToUtcDate(todayKey);
  const endUtc = range === 'yesterday'
    ? new Date(todayUtc.getTime() - 86400000)
    : todayUtc;
  const startUtc = range === 'all-time'
    ? dateKeyToUtcDate(GOOGLE_ADS_BUSINESS_START_DATE)
    : range === 'last-week'
      ? new Date(endUtc.getTime() - (6 * 86400000))
      : endUtc;
  const dayCount = Math.max(1, Math.floor((endUtc.getTime() - startUtc.getTime()) / 86400000) + 1);

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(startUtc);
    date.setUTCDate(startUtc.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function calculateGoogleAdsRoi(profit: number, adSpend: number | null): GoogleAdsRoi {
  const safeProfit = Number.isFinite(profit) ? profit : 0;
  if (adSpend === null || !Number.isFinite(adSpend)) {
    return { adSpend: null, netReturn: null, profit: safeProfit, roiPercent: null, roas: null };
  }

  const safeSpend = Math.max(0, adSpend);
  return {
    adSpend: safeSpend,
    netReturn: safeProfit - safeSpend,
    profit: safeProfit,
    roiPercent: safeSpend > 0 ? ((safeProfit - safeSpend) / safeSpend) * 100 : null,
    roas: safeSpend > 0 ? safeProfit / safeSpend : null,
  };
}

async function getAccessToken(config: GoogleAdsConfig): Promise<string> {
  const refreshToken = await getStoredGoogleAdsRefreshToken() || config.refreshToken;
  if (!refreshToken) {
    throw new GoogleAdsConfigurationError(['Connect Google Ads from the Admin dashboard']);
  }
  const response = await fetch(GOOGLE_ADS_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: GOOGLE_ADS_SCOPE,
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });

  if (!response.ok) {
    const body = await response.text();
    let oauthError: string | undefined;
    try {
      oauthError = (JSON.parse(body) as { error?: string }).error;
    } catch {
      // Keep the provider response below for errors that are not recognized.
    }
    if (response.status === 400 && oauthError === 'invalid_grant') {
      throw new GoogleAdsReauthRequiredError();
    }
    throw new GoogleAdsApiError(
      `Google OAuth token refresh failed (${response.status}): ${body.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) {
    throw new GoogleAdsApiError('Google OAuth token response did not include an access token.', response.status);
  }
  return payload.access_token;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchGoogleAdsDailyMetrics(
  date: string,
  configuredClient?: GoogleAdsConfig,
): Promise<GoogleAdsDailyMetrics> {
  const config = configuredClient || getGoogleAdsConfig();
  const accessToken = await getAccessToken(config);
  const query = `
    SELECT
      segments.date,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions_value,
      metrics.impressions
    FROM customer
    WHERE segments.date = '${date}'
  `;
  const endpoint = `${GOOGLE_ADS_API_URL}/${config.apiVersion}/customers/${config.customerId}/googleAds:searchStream`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'developer-token': config.developerToken,
  };
  if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId;

  const response = await fetch(endpoint, {
    body: JSON.stringify({ query }),
    headers,
    method: 'POST',
  });

  if (!response.ok) {
    const body = await response.text();
    const requestId = response.headers.get('request-id') || response.headers.get('google-ads-request-id') || undefined;
    throw new GoogleAdsApiError(
      `Google Ads report failed (${response.status}): ${body.slice(0, 500)}`,
      response.status,
      requestId,
    );
  }

  const chunks = await response.json() as Array<{
    results?: Array<{
      metrics?: {
        clicks?: string | number;
        conversionsValue?: string | number;
        costMicros?: string | number;
        impressions?: string | number;
      };
      segments?: { date?: string };
    }>;
  }>;
  const metrics = (Array.isArray(chunks) ? chunks : []).flatMap((chunk) => chunk.results || []);

  return metrics.reduce<GoogleAdsDailyMetrics>((total, row) => {
    const rowMetrics = row.metrics || {};
    total.costMicros += asNumber(rowMetrics.costMicros);
    total.conversionsValue += asNumber(rowMetrics.conversionsValue);
    total.clicks += asNumber(rowMetrics.clicks);
    total.impressions += asNumber(rowMetrics.impressions);
    return total;
  }, {
    clicks: 0,
    conversionsValue: 0,
    costMicros: 0,
    date,
    customerId: config.customerId,
    impressions: 0,
  });
}

export function googleAdsErrorMessage(error: unknown): string {
  if (error instanceof GoogleAdsConfigurationError) {
    return `Google Ads setup is incomplete. Add: ${error.missingVariables.join(', ')}`;
  }
  if (error instanceof GoogleAdsApiError) {
    return error.requestId
      ? `${error.message} Request ID: ${error.requestId}`
      : error.message;
  }
  return error instanceof Error ? error.message : 'Google Ads sync failed.';
}
