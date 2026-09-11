const TORONTO_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

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
