import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getCurrentUser } from '@/lib/auth';
import { getRingCentralConfig, getRingCentralStateCookieName } from '@/lib/ringcentral';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ success: false, error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const config = getRingCentralConfig();
    if (!config) {
      return NextResponse.json({
        success: false,
        error: 'RingCentral API credentials are not configured. Add RC_APP_CLIENT_ID and RC_APP_CLIENT_SECRET first.',
      }, { status: 503 });
    }

    const state = randomBytes(24).toString('hex');
    const authorizeUrl = new URL(`${config.serverUrl}/restapi/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', config.clientId);
    authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
    authorizeUrl.searchParams.set('state', state);

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(getRingCentralStateCookieName(), state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60,
    });
    return response;
  } catch (err) {
    logCaughtRequestError(request, '/api/ringcentral/connect', err);
    return NextResponse.json({ success: false, error: 'Unable to start RingCentral authorization.' }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/ringcentral/connect', handleGET);
