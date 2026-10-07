import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AdminTeamClient from '@/components/AdminTeamClient';

export default async function AdminTeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?redirect=%2Fadmin%2Fteam');
  if (user.role !== 'ADMIN') redirect('/dashboard');
  return <AdminTeamClient />;
}
