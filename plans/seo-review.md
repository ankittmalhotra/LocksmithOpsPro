# LockOps Pro SEO Review

## Review scope

Reviewed the public route, middleware, global metadata, navigation, manifest, and public/private route structure before publishing to Google.

## Issues found and addressed

### 1. The public homepage was not crawlable

`src/middleware.ts` redirected `/` to a login or workspace route. That meant unauthenticated visitors and search crawlers could not see the public homepage.

Status: fixed. `/` now remains public. Private application routes remain protected.

### 2. No sitemap or robots metadata existed

Added:

- `/sitemap.xml` containing only the public homepage and `/contact`.
- `/robots.txt` allowing public pages and disallowing API, login, payment, tracking, dispatch, technician, owner, and accounting routes.

Private operational screens are intentionally excluded from the sitemap because they are not public marketing content.

### 3. Global metadata was too generic

Added a descriptive title, description, canonical URL, Open Graph metadata, Twitter summary metadata, manifest reference, and Google-friendly robots directives.

The canonical base URL is read from `NEXT_PUBLIC_APP_URL`. It falls back to `https://locksmithsnearme.ca`, matching the supplied contact email domain. Set `NEXT_PUBLIC_APP_URL` to the exact production origin if the deployed site uses a different hostname.

### 4. Structured data was missing

Added JSON-LD to the public homepage for:

- `Organization`
- `SoftwareApplication`
- `WebSite`

The organization data includes the contact email and service area `US`, `CA`, and `MX`. No street address or `LocalBusiness` address data is included because the business requested no public address.

### 5. Contact discovery was missing

Added a crawlable `/contact` page with:

- `info@locksmithsnearme.ca`
- `mailto:` actions
- North America coverage language
- Page-specific title, description, canonical, and Open Graph metadata
- Links from the public homepage navigation and footer

## Content and technical SEO recommendations

### Before publishing

- Set `NEXT_PUBLIC_APP_URL` to the final HTTPS production URL.
- Confirm `/`, `/contact`, `/robots.txt`, and `/sitemap.xml` return HTTP 200 in production.
- Add the production domain to Google Search Console and verify ownership.
- Submit `https://your-domain.example/sitemap.xml` in Search Console.
- Use URL Inspection to request indexing for `/` and `/contact` after deployment.
- Add a real Open Graph image once a brand/social preview asset is approved.
- Test structured data with Google’s Rich Results Test and Schema Markup Validator.

### Ongoing SEO work

- Create dedicated pages for high-intent topics such as locksmith dispatch software, locksmith field service management, contractor cash reconciliation, and automotive locksmith operations only when each page has unique, useful content.
- Add customer proof, reviews, or case studies only when real and permissioned.
- Monitor Search Console indexing, queries, impressions, clicks, and Core Web Vitals.
- Keep the public homepage focused on the product; do not index authenticated dashboards or customer/job URLs.
- If the business later wants local locksmith-service SEO, define actual service locations and business details first. Do not add an address or LocalBusiness markup without accurate public information.

## Guidance used

- [Google Search Central developer SEO guide](https://developers.google.com/search/docs/fundamentals/get-started-developers)
- [Google Search Central metadata guidance](https://developers.google.com/search/docs/crawling-indexing/special-tags)
- [Google Search Central sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [Next.js sitemap convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
