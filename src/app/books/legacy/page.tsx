import { redirect } from 'next/navigation';

/** The advanced workspace has been split into the task routes; keep old links alive. */
export default async function LegacyBooksRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === 'string') query.set(key, value);
  const target = query.has('openExpense') || query.has('editExpense') ? '/books/expenses' : '/books/reimbursements';
  redirect(`${target}${query.size ? `?${query.toString()}` : ''}`);
}
