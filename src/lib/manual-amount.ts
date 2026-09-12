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
