const JOB_NUMBER_PATTERN = /^\d+$/;

/**
 * Job numbers are identifiers, not quantities. Keep them as strings so
 * leading zeroes and values larger than PostgreSQL's 32-bit Int are preserved.
 */
export function normalizeJobNumber(value: unknown): string | null {
  const candidate = typeof value === 'string'
    ? value.trim()
    : typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : '';

  if (!candidate || !JOB_NUMBER_PATTERN.test(candidate)) return null;

  try {
    return BigInt(candidate) > 0n ? candidate : null;
  } catch {
    return null;
  }
}

export function nextJobNumber(jobNumbers: string[]): string {
  // Preserve the previous fresh-database sequence, which started at 9816.
  let highest = 9815n;

  for (const value of jobNumbers) {
    const normalized = normalizeJobNumber(value);
    if (!normalized) continue;

    const numericValue = BigInt(normalized);
    if (numericValue > highest) highest = numericValue;
  }

  return String(highest + 1n);
}
