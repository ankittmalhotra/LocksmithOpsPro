import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isRevenuePeriod, type RevenuePeriod } from '@/lib/revenue-period';
import DashboardOverviewClient from '@/components/DashboardOverviewClient';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?redirect=%2Fdashboard');
  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') redirect(user.role === 'ACCOUNTANT' ? '/books' : '/tech');

  const params = await searchParams;
  const periodParam = Array.isArray(params.period) ? params.period[0] : params.period;
  const initialPeriod: RevenuePeriod = isRevenuePeriod(periodParam) ? periodParam : 'current-biweekly';
  return <DashboardOverviewClient isAdmin={user.role === 'ADMIN'} initialPeriod={initialPeriod} />;
}
