import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import GoogleAdsOverviewClient from '@/components/GoogleAdsOverviewClient';

export default async function GoogleAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ googleAdsAuth?: string | string[]; range?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?redirect=%2Fgoogle-ads');
  if (user.role !== 'ADMIN') redirect(user.role === 'ACCOUNTANT' ? '/books' : user.role === 'TECHNICIAN' ? '/tech' : '/dashboard');
  const params = await searchParams;
  const authResult = typeof params.googleAdsAuth === 'string' ? params.googleAdsAuth : '';
  const range = typeof params.range === 'string' ? params.range : 'last-week';
  return <GoogleAdsOverviewClient initialRange={range} authResult={authResult} />;
}
