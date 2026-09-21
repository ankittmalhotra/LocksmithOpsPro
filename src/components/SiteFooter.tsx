'use client';

import { usePathname } from 'next/navigation';

export default function SiteFooter() {
  const pathname = usePathname();

  const publicMarketingPaths = new Set([
    '/',
    '/contact',
    '/features',
    '/locksmith-dispatch-software',
    '/locksmith-field-service-management',
    '/locksmith-business-management',
    '/automotive-locksmith-software',
    '/commercial-locksmith-software',
    '/locksmith-job-costing',
  ]);

  if (publicMarketingPaths.has(pathname)) return null;

  return (
    <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
      LockOps Pro © 2026 • Field Service Operations Platform
    </footer>
  );
}
