import type { Metadata, Viewport } from 'next';
import './globals.css';
import NavigationHeader from '@/components/NavigationHeader';

export const metadata: Metadata = {
  title: 'LockOps Pro - Locksmith Operations Management',
  description: 'Mobile-first cloud operations platform for locksmith services',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased flex flex-col">
        <NavigationHeader />

        <main className="flex-1 flex flex-col">{children}</main>

        <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500">
          Locksmith Operations Platform • Ontario HST 13% • Stripe 4% Surcharge • Twilio SMS Integration
        </footer>
      </body>
    </html>
  );
}
