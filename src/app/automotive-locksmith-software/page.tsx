import type { Metadata } from 'next';
import MarketingContentPage from '@/components/MarketingContentPage';
import { publicSeoPages } from '@/lib/public-seo-pages';
import { siteUrl } from '@/lib/site';

const page = publicSeoPages.automotive;

export const metadata: Metadata = {
  title: page.seoTitle,
  description: page.description,
  alternates: { canonical: page.path },
  openGraph: { title: page.seoTitle, description: page.description, url: `${siteUrl}${page.path}`, type: 'website', images: ['/opengraph-image'] },
};

export default function AutomotiveLocksmithSoftwarePage() {
  return <MarketingContentPage page={page} />;
}
