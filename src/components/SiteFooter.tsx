'use client';

import { usePathname } from 'next/navigation';

export default function SiteFooter() {
  const pathname = usePathname();

  if (pathname === '/') return null;

  return (
    <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
      LockOps Pro © 2026 • Field Service Operations Platform
    </footer>
  );
}
