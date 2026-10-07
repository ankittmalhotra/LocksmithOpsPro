import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';

export default async function GoogleAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ googleAdsAuth?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?redirect=%2Fgoogle-ads');
  if (user.role !== 'ADMIN') redirect(user.role === 'ACCOUNTANT' ? '/books' : user.role === 'TECHNICIAN' ? '/tech' : '/dashboard');
  const params = await searchParams;
  const googleAdsAuth = typeof params.googleAdsAuth === 'string' ? params.googleAdsAuth : '';

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Admin only</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Google Ads</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">This is the Admin-only home for advertising performance. The replacement reports are being built with verified account and attribution definitions; the current Admin analytics remain available below.</p>
        {googleAdsAuth === 'connected' && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Google Ads authorization completed successfully.</p>}
        {googleAdsAuth === 'failed' && <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">Google Ads authorization did not complete. Review the account access and OAuth setup before retrying.</p>}
        <Link href={`/owner${googleAdsAuth ? `?googleAdsAuth=${encodeURIComponent(googleAdsAuth)}` : ''}`} className="mt-6 inline-flex rounded-xl bg-violet-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-violet-800">Open current Google Ads analytics ↗</Link>
      </div>
    </section>
  );
}
