import { siteUrl } from '@/lib/site';

export const dynamic = 'force-static';

export function GET() {
  const body = `# LockOps Pro

> LockOps Pro is locksmith business management software for owners, dispatchers, and field technicians.

## Official pages

- Home: ${siteUrl}/
- Contact: ${siteUrl}/contact

## Product summary

LockOps Pro connects locksmith call intake, dispatch, mobile technician workflows, job closeout, payments, proof of work, commission tracking, cash handovers, and owner reporting in one workspace.

## Current capabilities

- Dispatch and call intake with customer, service, scheduling, assignment, and status details.
- Mobile technician workflows with maps, customer calling, job status, door and key details, signatures, and proof-of-work photos.
- Payment and closeout workflows for labor, parts, tax, cash, Interac, payment status, and configured Stripe-hosted payment links.
- Owner reporting for revenue, HST, payment splits, technician commissions, contractor cash handovers, call conversion, marketing performance, exports, and role-based access.
- Support for residential, commercial, and automotive locksmith work.

## Accuracy notes

Roadmap items are labeled on the public website and should not be described as current functionality. Product availability can depend on deployment configuration and integrations.

## Contact

Email: info@locksmithsnearme.ca
Operations: North America, including the United States, Canada, and Mexico.
`;

  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
