import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getRoleDestination } from '@/lib/role-destination';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?redirect=%2Fdashboard');
  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') {
    redirect(getRoleDestination(user.role));
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-black tracking-tight text-slate-950">Dashboard</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Your shared operations dashboard is being prepared.
      </p>
    </section>
  );
}
