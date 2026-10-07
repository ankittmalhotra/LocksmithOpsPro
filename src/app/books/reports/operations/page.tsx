import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import OperationsReportClient from '@/components/OperationsReportClient';

export default async function OperationsReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?redirect=%2Fbooks%2Freports%2Foperations');
  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') redirect('/books');
  const params = await searchParams;
  return <OperationsReportClient initialParams={params} />;
}
