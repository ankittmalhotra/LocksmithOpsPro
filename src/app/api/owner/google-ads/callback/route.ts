import { OAuth2Client } from 'google-auth-library';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getGoogleAdsConfig } from '@/lib/google-ads';
import { saveGoogleAdsRefreshToken } from '@/lib/google-ads-credential-store';

export const runtime = 'nodejs';

function googleAdsRedirect(request: Request, result: 'connected' | 'failed') {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.url;
  const url = new URL('/google-ads', appUrl);
  url.searchParams.set('googleAdsAuth', result);
  return NextResponse.redirect(url);
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set('google_ads_oauth_state', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/api/owner/google-ads',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized: Admin access required' }, { status: 403 });
  }

  const url = new URL(request.url);
  const cookieState = (await cookies()).get('google_ads_oauth_state')?.value;
  const response = clearStateCookie(googleAdsRedirect(request, 'failed'));

  try {
    if (!cookieState || !url.searchParams.get('state') || cookieState !== url.searchParams.get('state')) {
      return response;
    }
    if (url.searchParams.has('error')) return response;
    const code = url.searchParams.get('code');
    if (!code) return response;

    const config = getGoogleAdsConfig();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.url;
    const redirectUri = new URL('/api/owner/google-ads/callback', appUrl).toString();
    const oauthClient = new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.refresh_token) return response;

    await saveGoogleAdsRefreshToken(tokens.refresh_token);
    return clearStateCookie(googleAdsRedirect(request, 'connected'));
  } catch (error) {
    console.error('Google Ads OAuth callback failed:', error);
    return response;
  }
}
