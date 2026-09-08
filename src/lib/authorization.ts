import { NextResponse } from 'next/server';
import { getCurrentUser } from './auth';
import type { AppRole, AuthSession } from './session';

export async function requireUser(): Promise<AuthSession | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Authentication required' },
      { status: 401 }
    );
  }
  return user;
}

export function isResponse(value: AuthSession | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export function hasRole(user: AuthSession, ...roles: AppRole[]): boolean {
  return roles.includes(user.role);
}

