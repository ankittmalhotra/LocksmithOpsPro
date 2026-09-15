import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeRingCentralCode, getRingCentralConfig, getRingCentralStateCookieName, persistRingCentralToken, setRingCentralTokenCookie } from '@/lib/ringcentral';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(getRingCentralStateCookieName())?.value;
  const ownerUrl = new URL('/owner', url.origin);

  if (error || !code || !state || !expectedState || state !== expectedState) {
    ownerUrl.searchParams.set('ringcentral', 'error');
    return NextResponse.redirect(ownerUrl);
  }

  try {
    if (!getRingCentralConfig()) throw new Error('RingCentral API credentials are not configured.');
    const token = await exchangeRingCentralCode(code);
    await persistRingCentralToken(token);
    const response = NextResponse.redirect(ownerUrl);
    setRingCentralTokenCookie(response, token);
    response.cookies.delete(getRingCentralStateCookieName());
    ownerUrl.searchParams.set('ringcentral', 'connected');
    response.headers.set('Location', ownerUrl.toString());
    return response;
  } catch {
    ownerUrl.searchParams.set('ringcentral', 'error');
    return NextResponse.redirect(ownerUrl);
  }
}
