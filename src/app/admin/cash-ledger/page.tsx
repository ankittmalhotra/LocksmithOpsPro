import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AdminCashLedgerClient from '@/components/AdminCashLedgerClient';

export default async function AdminCashLedgerPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?redirect=%2Fadmin%2Fcash-ledger');
  if (user.role !== 'ADMIN') redirect('/dashboard');
  return <AdminCashLedgerClient />;
}
