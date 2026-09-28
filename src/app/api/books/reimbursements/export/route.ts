import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { decimalToCents, isBooksEntityCode } from '@/lib/books-api';

function csv(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function handleGET(request: Request) {
  try {
    const code = new URL(request.url).searchParams.get('entityCode');
    if (!isBooksEntityCode(code)) return NextResponse.json({ success: false, error: 'entityCode must be IT_MARKETING or LOCKSMITH' }, { status: 400 });
    const access = await getAccountingEntityAccess(code);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    const expenses = await prisma.accountingExpense.findMany({
      where: { entityId: access.entity.id, fundingSource: 'PERSONAL' },
      include: { reimbursementAllocations: { include: { payment: true } } },
      orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
    });
    const headers = [
      'entity_code', 'expense_id', 'vendor', 'business_purpose', 'expense_date', 'subtotal_cents', 'hst_cents', 'expense_total_cents',
      'personal_payee', 'personal_payment_method', 'personal_card_last4', 'original_payment_date', 'pre_incorporation',
      'payment_id', 'payment_date', 'payment_method', 'business_account_label', 'bank_reference', 'payment_cents', 'allocation_cents',
      'payment_voided', 'expense_voided', 'open_balance_cents', 'receipt_status', 'receipt_filename', 'expense_mapping_status', 'expense_account_name',
      'expense_account_code', 'expense_mapping_notes', 'payment_mapping_status', 'payment_account_name', 'payment_account_code', 'payment_mapping_notes',
    ];
    const rows: string[][] = [];
    const emittedExpenseTotals = new Set<string>();
    const emittedPaymentTotals = new Set<string>();
    for (const expense of expenses) {
      const totalCents = decimalToCents(expense.totalAmount);
      const activeAllocated = expense.reimbursementAllocations.filter((row) => !row.payment.voidedAt).reduce((sum, row) => sum + decimalToCents(row.amount), 0);
      const allocations = expense.reimbursementAllocations.length ? expense.reimbursementAllocations : [null];
      for (const allocation of allocations) {
        const payment = allocation?.payment;
        const includeExpenseTotals = !emittedExpenseTotals.has(expense.id);
        if (includeExpenseTotals) emittedExpenseTotals.add(expense.id);
        const includePaymentTotal = Boolean(payment && !emittedPaymentTotals.has(payment.id));
        if (includePaymentTotal && payment) emittedPaymentTotals.add(payment.id);
        const fields = [
          code, expense.id, expense.vendorName, expense.businessPurpose || '', expense.expenseDate.toISOString().slice(0, 10),
          includeExpenseTotals ? decimalToCents(expense.subtotalAmount) : '', includeExpenseTotals ? decimalToCents(expense.hstAmount) : '', includeExpenseTotals ? totalCents : '',
          expense.personalPayeeName || '', expense.personalPaymentMethod || '', expense.personalCardLast4 || '', expense.paidAt?.toISOString().slice(0, 10) || '',
          expense.paidBeforeIncorporation, payment?.id || '', payment?.paymentDate.toISOString().slice(0, 10) || '', payment?.paymentMethod || '',
          payment?.sourceAccountLabel || '', payment?.bankReference || '', payment && includePaymentTotal ? decimalToCents(payment.amount) : '', allocation ? decimalToCents(allocation.amount) : '',
          payment ? Boolean(payment.voidedAt) : '', Boolean(expense.voidedAt), includeExpenseTotals ? Math.max(0, totalCents - activeAllocated) : '', expense.receiptStatus, expense.receiptFileName || '',
          expense.mappingStatus, expense.mappingAccountName || '', expense.mappingAccountCode || '', expense.mappingNotes || '',
          payment?.mappingStatus || '', payment?.mappingAccountName || '', payment?.mappingAccountCode || '', payment?.mappingNotes || '',
        ];
        rows.push(fields.map(csv));
      }
    }
    const content = [headers.map(csv).join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    return new NextResponse(content, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${code.toLowerCase()}-reimbursements.csv"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/reimbursements/export', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to export reimbursement records') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/books/reimbursements/export', handleGET);
