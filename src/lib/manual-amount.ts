import { roundToTwo } from './calculations.ts';

export class ManualJobInputError extends Error {}

export function parseManualAmount(value: unknown, field: string, allowZero = true): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  const rounded = roundToTwo(parsed);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    !Number.isFinite(rounded) ||
    (!allowZero && rounded <= 0)
  ) {
    throw new ManualJobInputError(
      `${field} must be a valid ${allowZero ? 'non-negative' : 'positive'} amount`,
    );
  }

  return rounded;
}

/** Parses a dispatcher-entered percentage (e.g. 4 means 4%) into a rate. */
export function parseManualPercentage(value: unknown, field: string, maxPercent = 100): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  const roundedPercent = roundToTwo(parsed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxPercent) {
    throw new ManualJobInputError(`${field} must be between 0% and ${maxPercent}%`);
  }
  // Preserve the two decimal places entered as a percentage: 4.01% is a
  // 0.0401 rate. Rounding the rate itself to two decimals would turn it into
  // 4% and allow values above the server-side cap to pass validation.
  return Math.round((roundedPercent + Number.EPSILON) * 100) / 10_000;
}
