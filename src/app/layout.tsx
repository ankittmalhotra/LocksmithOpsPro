import type { Metadata, Viewport } from 'next';
import './globals.css';
import NavigationHeader from '@/components/NavigationHeader';
import SiteFooter from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'LockOps Pro | Locksmith Operations Management',
  description: 'Run every locksmith job from first call to final payment with LockOps Pro: dispatch, field workflows, payments, proof of work, settlements, and owner reporting.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
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

        <SiteFooter />
      </body>
    </html>
  );
}
