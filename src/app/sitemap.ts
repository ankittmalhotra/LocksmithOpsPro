import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';
import { publicSeoPages } from '@/lib/public-seo-pages';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const publicMarketingPages = Object.values(publicSeoPages).map((page) => ({
    url: `${siteUrl}${page.path}`,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  return [
    { url: siteUrl, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${siteUrl}/contact`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    ...publicMarketingPages,
  ];
}
