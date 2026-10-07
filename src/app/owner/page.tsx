import { redirect } from 'next/navigation';

/**
 * Legacy Admin hub. Analytics and Ads moved to /dashboard and /google-ads,
 * staff to /admin/team and cash settlement to /admin/cash-ledger. Existing
 * bookmarks and the Google Ads OAuth return keep working.
 */
export default async function LegacyOwnerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const googleAdsAuth = params.googleAdsAuth;
  if (googleAdsAuth === 'connected' || googleAdsAuth === 'failed') redirect(`/google-ads?googleAdsAuth=${googleAdsAuth}`);
  redirect('/dashboard');
}
