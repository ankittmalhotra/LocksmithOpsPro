export interface ReimbursementAllocationInput {
  expenseId: string;
  amountCents: number;
}

function assertCents(value: number, label: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer number of cents`);
  }
  return value;
}

export function validateReimbursementAllocations(paymentCents: number, allocations: ReimbursementAllocationInput[]) {
  assertCents(paymentCents, 'Payment amount', false);
  if (allocations.length === 0) throw new Error('Allocate the payment to at least one expense');
  const seen = new Set<string>();
  let total = 0;
  for (const allocation of allocations) {
    if (!allocation.expenseId || seen.has(allocation.expenseId)) throw new Error('Each expense must appear once in the allocation list');
    seen.add(allocation.expenseId);
    total += assertCents(allocation.amountCents, 'Allocation amount', false);
    if (!Number.isSafeInteger(total)) throw new Error('Allocation total is out of range');
  }
  if (total !== paymentCents) throw new Error('Allocation amounts must add up to the payment amount');
  return total;
}

export function openReimbursementBalanceCents(totalCents: number, allocatedCents: number) {
  const total = assertCents(totalCents, 'Expense total');
  const allocated = assertCents(allocatedCents, 'Allocated amount');
  if (allocated > total) throw new Error('Reimbursements cannot exceed the expense total');
  return total - allocated;
}
