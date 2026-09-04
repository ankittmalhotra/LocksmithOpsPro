import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { serializeSession, deserializeSession, AuthSession } from './session';

export type { AuthSession };
export { serializeSession, deserializeSession };

const COOKIE_NAME = 'locksmith_user_session';

export async function getCurrentUser(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  return deserializeSession(sessionToken);
}

export async function setSessionCookie(user: AuthSession) {
  const cookieStore = await cookies();
  const token = serializeSession(user);
  cookieStore.set(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
