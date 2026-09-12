const TORONTO_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

const TORONTO_DATE_INPUT_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a datetime-local value as Toronto wall-clock time, independent of server timezone. */
export function parseTorontoDateTime(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const explicit = new Date(value);
    return Number.isNaN(explicit.getTime()) ? null : explicit;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const targetMs = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (Number.isNaN(targetMs)) return null;
  const targetDate = new Date(targetMs);
  if (targetDate.getUTCFullYear() !== Number(year)
    || targetDate.getUTCMonth() + 1 !== Number(month)
    || targetDate.getUTCDate() !== Number(day)
    || targetDate.getUTCHours() !== Number(hour)
    || targetDate.getUTCMinutes() !== Number(minute)
    || targetDate.getUTCSeconds() !== Number(second)) return null;
  let guessMs = targetMs;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(TORONTO_FORMATTER.formatToParts(new Date(guessMs)).map(({ type, value: part }) => [type, part]));
    const renderedMs = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    if (Number.isNaN(renderedMs)) return null;
    const delta = targetMs - renderedMs;
    guessMs += delta;
    if (delta === 0) break;
  }
  const finalParts = Object.fromEntries(TORONTO_FORMATTER.formatToParts(new Date(guessMs)).map(({ type, value: part }) => [type, part]));
  if (finalParts.year !== year || finalParts.month !== month || finalParts.day !== day
    || finalParts.hour !== hour || finalParts.minute !== minute || finalParts.second !== second) return null;
  const result = new Date(guessMs);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function torontoDateTimeToIso(value: unknown): string | null {
  return parseTorontoDateTime(value)?.toISOString() || null;
}

/** Parse a YYYY-MM-DD value as midnight in the Toronto business timezone. */
export function parseTorontoDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return null;
  return parseTorontoDateTime(`${value}T00:00`);
}

/** Convert a YYYY-MM-DD Toronto date to the UTC ISO value stored by Prisma. */
export function torontoDateToMidnightIso(value: unknown): string | null {
  return parseTorontoDateOnly(value)?.toISOString() || null;
}

/** Format a timestamp as a YYYY-MM-DD value suitable for an HTML date input. */
export function formatTorontoDateInput(value: unknown = new Date()): string {
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value)) {
    return parseTorontoDateOnly(value) ? value : '';
  }
  if (value === null || (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date))) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return '';

  const parts = Object.fromEntries(
    TORONTO_DATE_INPUT_FORMATTER.formatToParts(date).map(({ type, value: part }) => [type, part])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
