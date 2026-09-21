const configuredSiteUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

// Keep a production-safe fallback for metadata files. Set NEXT_PUBLIC_APP_URL
// to the exact deployed origin when the site is published under another domain.
export const siteUrl = (configuredSiteUrl || 'https://locksmithsnearme.ca').replace(/\/$/, '');
