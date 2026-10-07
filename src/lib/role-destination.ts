import type { AppRole } from '@/lib/session';

/** Canonical home page for each persisted account profile. */
export function getRoleDestination(role: AppRole): string {
  switch (role) {
    case 'ADMIN':
    case 'DISPATCHER':
      return '/dashboard';
    case 'ACCOUNTANT':
      return '/books';
    case 'TECHNICIAN':
      return '/tech';
  }
}
