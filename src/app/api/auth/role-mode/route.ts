import { NextResponse } from 'next/server';
import { getCurrentUser, setSessionCookie } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Sign in again to change role mode.' }, { status: 401 });

    const body = await request.json();
    const requestedMode = body?.mode;
    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, phone: true, role: true, active: true },
    });
    if (!account?.active || account.role !== 'ADMIN') {
      return NextResponse.json({ success: false, error: 'Only an active Admin account can switch role mode.' }, { status: 403 });
    }

    if (requestedMode === 'DISPATCHER' && user.role === 'ADMIN' && !user.originalRole) {
      const switchedUser = { id: user.id, name: account.name, phone: account.phone, role: 'DISPATCHER' as const, originalRole: 'ADMIN' as const };
      await setSessionCookie(switchedUser);
      return NextResponse.json({ success: true, user: switchedUser });
    }

    if (requestedMode === 'ADMIN' && user.role === 'DISPATCHER' && user.originalRole === 'ADMIN') {
      const adminUser = { id: user.id, name: account.name, phone: account.phone, role: 'ADMIN' as const };
      await setSessionCookie(adminUser);
      return NextResponse.json({ success: true, user: adminUser });
    }

    return NextResponse.json({ success: false, error: 'That role mode is not available for this session.' }, { status: 403 });
  } catch (error) {
    logCaughtRequestError(request, '/api/auth/role-mode', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to change role mode.') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/auth/role-mode', handlePOST);
