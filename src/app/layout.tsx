import type { Metadata, Viewport } from 'next';
import './globals.css';
import NavigationHeader from '@/components/NavigationHeader';
import SiteFooter from '@/components/SiteFooter';
import { siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'LockOps Pro | Locksmith Business Management Software',
  description: 'Locksmith business management software for dispatch, field technicians, payments, proof of work, and owner reporting. Run every job from first call to final payment.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'LockOps Pro',
    title: 'LockOps Pro | Locksmith Business Management Software',
    description: 'Locksmith business management software for dispatch, field technicians, payments, proof of work, and owner reporting.',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'LockOps Pro locksmith business management software',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LockOps Pro | Locksmith Business Management Software',
    description: 'Run every locksmith job from first call to final payment.',
    images: ['/opengraph-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
  manifest: '/manifest.json',
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
