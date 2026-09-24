import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getGoogleAdsConfig } from '@/lib/google-ads';
import { assertGoogleAdsCredentialStoreReady } from '@/lib/google-ads-credential-store';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized: Admin access required' }, { status: 403 });
  }

  try {
    await assertGoogleAdsCredentialStoreReady();
    const config = getGoogleAdsConfig();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.url;
    const redirectUri = new URL('/api/owner/google-ads/callback', appUrl).toString();
    const oauthClient = new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
    const state = randomBytes(32).toString('base64url');
    const authorizationUrl = oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent select_account',
      scope: ['https://www.googleapis.com/auth/adwords'],
      state,
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set('google_ads_oauth_state', state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/api/owner/google-ads',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start Google Ads authorization.';
    return NextResponse.json({ success: false, error: message }, { status: 503 });
  }
}
