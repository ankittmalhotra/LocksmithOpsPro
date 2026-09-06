import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deserializeSession } from '@/lib/session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root path handling: direct user to their workspace if authenticated, or login
  if (pathname === '/') {
    const sessionToken = request.cookies.get('locksmith_user_session')?.value;
    const user = sessionToken ? deserializeSession(sessionToken) : null;
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    const target = user.role === 'SUPER_ADMIN' || user.role === 'OWNER'
      ? '/owner'
      : user.role === 'DISPATCHER'
      ? '/dispatch'
      : '/tech';
    return NextResponse.redirect(new URL(target, request.url));
  }

  // Paths that require role protection
  const isOwnerRoute = pathname.startsWith('/owner') || pathname.startsWith('/api/owner');
  const isDispatchRoute = pathname.startsWith('/dispatch');
  const isTechRoute = pathname.startsWith('/tech');

  if (!isOwnerRoute && !isDispatchRoute && !isTechRoute) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get('locksmith_user_session')?.value;
  const user = sessionToken ? deserializeSession(sessionToken) : null;

  // Handle API unauthorized
  if (pathname.startsWith('/api/')) {
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required' }, { status: 401 });
    }
    if (isOwnerRoute && user.role !== 'SUPER_ADMIN' && user.role !== 'OWNER') {
      return NextResponse.json({ success: false, error: 'Forbidden: Owner access required' }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Handle Page redirects
  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role Checks for Pages
  if (isOwnerRoute && user.role !== 'SUPER_ADMIN' && user.role !== 'OWNER') {
    const redirectTarget = user.role === 'DISPATCHER' ? '/dispatch' : '/tech';
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  }

  if (isDispatchRoute && user.role !== 'SUPER_ADMIN' && user.role !== 'OWNER' && user.role !== 'DISPATCHER') {
    return NextResponse.redirect(new URL('/tech', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/owner/:path*',
    '/dispatch/:path*',
    '/tech/:path*',
    '/api/owner/:path*',
  ],
};
