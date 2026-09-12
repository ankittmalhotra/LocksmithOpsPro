import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { setSessionCookie } from '@/lib/auth';
import type { AppRole } from '@/lib/session';
import { verifyPassword } from '@/lib/password';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handlePOST(request: Request) {
  try {
    const body = await request.json();
    const { phone, username, password, identifier } = body;

    // Handle credential / identifier normalization
    const loginIdentifier = (identifier || username || phone || '').trim();
    const loginPassword = typeof password === 'string' ? password : '';

    // Admin authentication uses the deployment secret rather than a client-
    // supplied role or user id. The development fallback is never accepted
    // when NODE_ENV is production.
    if (loginIdentifier.toLowerCase() === 'admin') {
      const configuredAdminPassword = process.env.ADMIN_PASSWORD;
      if (!configuredAdminPassword && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ success: false, error: 'Admin authentication is not configured.' }, { status: 503 });
      }
      if (loginPassword === (configuredAdminPassword || 'admin123')) {
        const adminUser = await prisma.user.findFirst({
          where: { role: 'ADMIN', active: true },
        });
        if (!adminUser) {
          return NextResponse.json(
            { success: false, error: 'No active Admin account is configured.' },
            { status: 503 }
          );
        }

        const sessionData = {
          id: adminUser.id,
          name: adminUser.name,
          phone: adminUser.phone,
          role: 'ADMIN' as const,
        };

        await setSessionCookie(sessionData);

        return NextResponse.json({
          success: true,
          user: sessionData,
          redirectUrl: '/dispatch',
          message: 'Logged in as Admin',
        });
      } else {
        return NextResponse.json(
          { success: false, error: 'Invalid password for admin' },
          { status: 401 }
        );
      }
    }

    let user = null;

    if (loginIdentifier) {
      const cleanPhone = loginIdentifier.replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 7) {
        user = await prisma.user.findFirst({
          where: {
            phone: { contains: cleanPhone.slice(-10) },
          },
        });
      }
      if (!user) {
        user = await prisma.user.findFirst({
          where: {
            OR: [
              { phone: loginIdentifier },
              { name: { equals: loginIdentifier, mode: 'insensitive' } },
              { email: { equals: loginIdentifier, mode: 'insensitive' } },
            ],
          },
        });
      }
    }

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found. Please verify your phone number or credentials.' },
        { status: 404 }
      );
    }

    if (!loginPassword || !verifyPassword(loginPassword, user.passwordHash)) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }

    if (user.active === false) {
      return NextResponse.json(
        { success: false, error: 'This account is inactive. Contact an Admin.' },
        { status: 403 }
      );
    }

    const sessionData = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role as AppRole,
    };

    await setSessionCookie(sessionData);

    const redirectUrl =
      user.role === 'ADMIN' || user.role === 'DISPATCHER'
        ? '/dispatch'
        : '/tech';

    return NextResponse.json({
      success: true,
      user: sessionData,
      redirectUrl,
      message: `Logged in as ${user.name} (${user.role})`,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/auth/login', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Authentication service unavailable') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/auth/login', handlePOST);
