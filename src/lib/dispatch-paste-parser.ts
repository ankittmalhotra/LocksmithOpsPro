/**
 * Conservative, local-only parser for dispatcher pasted messages.
 *
 * This module only prepares suggested form values. It never creates a job and
 * keeps the complete source plus any lines it could not confidently classify.
 */

export type DispatchPasteField =
  | 'customerName'
  | 'customerPhone'
  | 'customerExtension'
  | 'serviceAddress'
  | 'serviceType'
  | 'problemDescription'
  | 'jobDate'
  | 'isScheduled'
  | 'scheduledFor';

export type DispatchPasteResult = {
  sourceText: string;
  customerName: string;
  customerPhone: string;
  customerExtension: string;
  serviceAddress: string;
  serviceType: string;
  problemDescription: string;
  jobDate: string;
  isScheduled: boolean;
  /** `datetime-local` value in YYYY-MM-DDTHH:mm form, or empty when unclear. */
  scheduledFor: string;
  /** Mean confidence over populated suggestions, from 0 to 1. */
  confidence: number;
  /** Confidence per suggested field, from 0 to 1. Empty/unset fields score 0. */
  fieldConfidence: Record<DispatchPasteField, number>;
  warnings: string[];
  unparsedLines: string[];
  /** Newline-joined form of unparsedLines for simple form review UIs. */
  unparsedText: string;
};

const EMPTY_FIELDS: Omit<DispatchPasteResult, 'sourceText' | 'confidence' | 'fieldConfidence' | 'warnings' | 'unparsedLines' | 'unparsedText'> = {
  customerName: '',
  customerPhone: '',
  customerExtension: '',
  serviceAddress: '',
  serviceType: '',
  problemDescription: '',
  jobDate: '',
  isScheduled: false,
  scheduledFor: '',
};

const FIELD_LABELS: Array<{ field: DispatchPasteField | 'schedule'; pattern: RegExp }> = [
  { field: 'customerName', pattern: /^(?:customer\s+)?(?:name|client)\s*[:\-]\s*(.+)$/i },
  { field: 'customerName', pattern: /^customer\s*[:\-]\s*(.+)$/i },
  { field: 'customerPhone', pattern: /^(?:customer\s*)?(?:phone|telephone|tel|mobile|cell)\s*[:\-]\s*(.+)$/i },
  { field: 'serviceAddress', pattern: /^(?:service\s+)?(?:address|location|site)\s*[:\-]\s*(.+)$/i },
  { field: 'serviceType', pattern: /^(?:service\s*)?(?:type|service|job\s*type)\s*[:\-]\s*(.+)$/i },
  { field: 'problemDescription', pattern: /^(?:notes?|problem|issue|description|details?)\s*[:\-]\s*(.+)$/i },
  { field: 'schedule', pattern: /^(?:appointment|scheduled|schedule|(?:job\s+)?date(?:\s+and\s+time)?|time)\s*[:\-]\s*(.+)$/i },
];

const SERVICE_RULES: Array<{ pattern: RegExp; service: string }> = [
  { pattern: /\b(?:car|automotive|vehicle)\s+(?:door\s+)?lockout\b|\bcar\s+locked\s+out\b/i, service: 'Car Lockout' },
  { pattern: /\b(?:automotive|car|vehicle)\b.*\b(?:key\s+generation|key\s+program(?:ming)?|key\s+replacement|all\s+keys\s+lost)\b/i, service: 'Automotive Lockout / Key Generation' },
  { pattern: /\b(?:transponder|smart\s+key|key\s+fob|push[- ]to[- ]start)\b/i, service: 'Automotive Lockout / Key Generation' },
  { pattern: /\b(?:safe|vault)\b.*\b(?:open|locked|lockout)\b|\bsafe\s+opening\b/i, service: 'Safe Opening' },
  { pattern: /\b(?:master\s+key|master\s+system)\b.*\b(?:rekey|re-key|re-pin|pinning)\b|\bre-?key\b.*\bmaster\b/i, service: 'Rekey Master Key System' },
  { pattern: /\b(?:re-?key|re-pin|rekeying)\b/i, service: 'Rekey Master Key System' },
  { pattern: /\bdeadbolt\b.*\b(?:install|replace|put\s+in)\b|\b(?:install|replace)\b.*\bdeadbolt\b/i, service: 'Deadbolt Installation' },
  { pattern: /\bstorefront\b.*\bmortise\b|\bmortise\s+cylinder\b/i, service: 'Storefront Mortise Cylinder' },
  { pattern: /\bcommercial\b.*\block\s+change\b|\block\s+change\b.*\bcommercial\b/i, service: 'Commercial Lock Change' },
  { pattern: /\b(?:residential|home|house|apartment)\b.*\blockout\b|\blockout\b.*\b(?:residential|home|house|apartment)\b/i, service: 'Residential Lockout' },
];

type ScheduleParts = { date?: string; time?: string; explicitScheduled: boolean };

function parseDate(value: string): string | null {
  const cleaned = value.trim().replace(/^[,\s]+|[,\s]+$/g, '');
  let year: number;
  let month: number;
  let day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned);
  if (match) {
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
  } else {
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(cleaned);
    if (match) {
      // North American numeric dates are month/day/year.
      month = Number(match[1]); day = Number(match[2]); year = Number(match[3]);
    } else {
      match = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(cleaned);
      if (match) {
        month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(match[1].toLowerCase()) + 1;
        day = Number(match[2]); year = Number(match[3]);
      } else {
        match = /^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})$/i.exec(cleaned);
        if (!match) return null;
        day = Number(match[1]);
        month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(match[2].toLowerCase()) + 1;
        year = Number(match[3]);
      }
    }
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTime(value: string): string | null {
  // A datetime-local value is a wall clock time. Never discard an explicit
  // timezone marker and silently reinterpret the value in Toronto time.
  const cleaned = value.trim();
  if (/^(?:noon)$/i.test(cleaned)) return '12:00';
  if (/^(?:midnight)$/i.test(cleaned)) return '00:00';
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(cleaned);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const pm = match[3].toUpperCase() === 'PM';
    hour = (hour % 12) + (pm ? 12 : 0);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const military = /^(\d{1,2}):(\d{2})$/.exec(cleaned);
  if (!military) return null;
  const hour = Number(military[1]);
  const minute = Number(military[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseScheduleText(value: string): { date?: string; time?: string; timezoneQualified?: boolean } {
  const timezoneSuffix = /(?:\s*(?:UTC|GMT|ET|EST|EDT|Z|[+-]\d{2}:?\d{2}))\s*$/i.test(value);
  if (timezoneSuffix) return { timezoneQualified: true };
  const iso = /\b(\d{4}-\d{1,2}-\d{1,2})[T ](\d{1,2}:\d{2})(?:\s*(AM|PM))?\b/i.exec(value);
  if (iso) {
    const date = parseDate(iso[1]);
    const time = parseTime(`${iso[2]}${iso[3] ? ` ${iso[3]}` : ''}`);
    return { ...(date ? { date } : {}), ...(time ? { time } : {}) };
  }
  const dateMatch = /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4}\b/i.exec(value);
  const timeMatch = /\b(?:\d{1,2}:\d{2}\s*(?:AM|PM)|\d{1,2}\s*(?:AM|PM)|\d{1,2}:\d{2}|noon|midnight)(?:\s*(?:UTC|GMT|ET|EST|EDT|Z|[+-]\d{2}:?\d{2}))?\b/i.exec(value);
  const date = dateMatch ? parseDate(dateMatch[0]) : null;
  const time = timeMatch ? parseTime(timeMatch[0]) : null;
  return { ...(date ? { date } : {}), ...(time ? { time } : {}) };
}

function extractPhone(value: string): { phone: string; extension: string; found: boolean } {
  const match = /(?:\+?1[.\s-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[.\s-]*\d{3}[.\s-]*\d{4}(?:\s*(?:ext\.?|extension|x|#)\s*(\d{1,8}))?/i.exec(value);
  if (!match) return { phone: '', extension: '', found: false };
  const digits = match[0].split(/(?:ext\.?|extension|x|#)/i)[0].replace(/\D/g, '');
  const phoneDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (phoneDigits.length !== 10) return { phone: '', extension: '', found: false };
  const extMatch = /(?:ext\.?|extension|x|#)\s*(\d{1,8})/i.exec(match[0]);
  return { phone: phoneDigits, extension: extMatch?.[1] || '', found: true };
}

function labelFor(line: string): { field: DispatchPasteField | 'schedule'; value: string } | null {
  for (const label of FIELD_LABELS) {
    const match = label.pattern.exec(line.trim());
    if (match) return { field: label.field, value: match[1].trim() };
  }
  return null;
}

/** Parse pasted dispatcher text into conservative suggestions for the new-job form. */
export function parseDispatchPaste(rawText: string): DispatchPasteResult {
  const sourceText = typeof rawText === 'string' ? rawText : '';
  const result = { ...EMPTY_FIELDS };
  const warnings: string[] = [];
  const unparsedLines: string[] = [];
  const fieldConfidence: Record<DispatchPasteField, number> = {
    customerName: 0, customerPhone: 0, customerExtension: 0, serviceAddress: 0,
    serviceType: 0, problemDescription: 0, jobDate: 0, isScheduled: 0, scheduledFor: 0,
  };
  const schedule: ScheduleParts = { explicitScheduled: false };
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const put = (field: 'customerName' | 'serviceAddress' | 'problemDescription' | 'serviceType', value: string, confidence: number, sourceLine: string) => {
    if (!value) return;
    if (result[field] && result[field] !== value) {
      warnings.push(`More than one ${field === 'customerName' ? 'customer name' : field === 'serviceAddress' ? 'address' : field === 'problemDescription' ? 'problem description' : 'service type'} was found; kept the first labeled value.`);
      unparsedLines.push(sourceLine);
      return;
    }
    if (result[field]) {
      unparsedLines.push(sourceLine);
      return;
    }
    result[field] = value;
    fieldConfidence[field] = confidence;
  };

  for (const line of lines) {
    const labeled = labelFor(line);
    if (labeled) {
      if (labeled.field === 'customerName' || labeled.field === 'serviceAddress' || labeled.field === 'problemDescription') {
        put(labeled.field, labeled.value, 0.96, line);
      } else if (labeled.field === 'customerPhone') {
        const parsed = extractPhone(labeled.value);
        if (parsed.found) {
          if (result.customerPhone) {
            if (result.customerPhone !== parsed.phone || result.customerExtension !== parsed.extension) {
              warnings.push('More than one phone number was found; kept the first labeled value.');
            }
            unparsedLines.push(line);
          } else {
            result.customerPhone = parsed.phone;
            result.customerExtension = parsed.extension;
            fieldConfidence.customerPhone = 0.96;
            fieldConfidence.customerExtension = parsed.extension ? 0.95 : 0;
          }
        } else {
          warnings.push(`Could not confidently parse the labeled phone number: ${labeled.value}`);
          unparsedLines.push(line);
        }
      } else if (labeled.field === 'serviceType') {
        const inferred = SERVICE_RULES.find(({ pattern }) => pattern.test(labeled.value));
        if (!inferred && /\b(?:lockout|locked\s+out)\b/i.test(labeled.value)) {
          warnings.push(`Lockout type is unclear; confirm whether this is residential, automotive, commercial, or another service: ${labeled.value}`);
        }
        put('serviceType', inferred?.service || labeled.value, inferred ? 0.93 : 0.72, line);
      } else {
        const parsed = parseScheduleText(labeled.value);
        if (parsed.timezoneQualified) {
          warnings.push(`Timezone-qualified schedule left unparsed; enter a Toronto local time: ${labeled.value}`);
          unparsedLines.push(line);
          continue;
        }
        if (!parsed.date && !parsed.time) {
          warnings.push(`Could not confidently parse the schedule detail: ${labeled.value}`);
          unparsedLines.push(line);
          continue;
        }
        const conflicts = Boolean(
          (parsed.date && schedule.date && parsed.date !== schedule.date)
          || (parsed.time && schedule.time && parsed.time !== schedule.time)
        );
        if (conflicts) {
          warnings.push(`Conflicting schedule detail kept for review; retained the first date/time: ${labeled.value}`);
          unparsedLines.push(line);
          continue;
        }
        if (parsed.date && !schedule.date) schedule.date = parsed.date;
        if (parsed.time && !schedule.time) schedule.time = parsed.time;
        schedule.explicitScheduled ||= /appointment|scheduled|schedule/i.test(line);
      }
      continue;
    }

    const phone = extractPhone(line);
    if (phone.found) {
      if (!result.customerPhone) {
        result.customerPhone = phone.phone;
        result.customerExtension = phone.extension;
        fieldConfidence.customerPhone = 0.78;
        fieldConfidence.customerExtension = phone.extension ? 0.78 : 0;
      } else {
        if (result.customerPhone !== phone.phone || result.customerExtension !== phone.extension) {
          warnings.push('An additional phone number was found and left in the source text.');
        }
        unparsedLines.push(line);
        continue;
      }
      // If removing the phone leaves meaningful text, keep that remainder visible.
      const remainder = line.replace(/(?:\+?1[.\s-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[.\s-]*\d{3}[.\s-]*\d{4}(?:\s*(?:ext\.?|extension|x|#)\s*\d{1,8})?/i, '').trim();
      if (remainder) unparsedLines.push(remainder);
      continue;
    }

    const inferred = SERVICE_RULES.find(({ pattern }) => pattern.test(line));
    if (inferred && !result.serviceType) {
      result.serviceType = inferred.service;
      fieldConfidence.serviceType = 0.72;
      // The line may contain useful notes too, so leave it available for review.
      unparsedLines.push(line);
      continue;
    }
    unparsedLines.push(line);
  }

  // A service label may contain an unfamiliar phrase; retain it as a suggestion,
  // but mark it below the confidence of a recognized service category.
  if (schedule.date && schedule.time) {
    result.jobDate = schedule.date;
    fieldConfidence.jobDate = 0.95;
    result.scheduledFor = `${schedule.date}T${schedule.time}`;
    result.isScheduled = true;
    fieldConfidence.scheduledFor = schedule.explicitScheduled ? 0.95 : 0.84;
    fieldConfidence.isScheduled = schedule.explicitScheduled ? 0.95 : 0.84;
  } else if (schedule.date || schedule.time) {
    if (schedule.date) {
      result.jobDate = schedule.date;
      fieldConfidence.jobDate = 0.84;
    }
    result.isScheduled = schedule.explicitScheduled;
    fieldConfidence.isScheduled = schedule.explicitScheduled ? 0.75 : 0;
    warnings.push('A date and time are both required before a scheduled time can be filled.');
  }

  if (unparsedLines.length) warnings.push('Some pasted lines need dispatcher review and were left unparsed.');
  const confidenceValues = Object.entries(fieldConfidence)
    .filter(([field, confidence]) => confidence > 0 && (field === 'isScheduled' ? result.isScheduled : Boolean(result[field as DispatchPasteField])))
    .map(([, confidence]) => confidence);
  const confidence = confidenceValues.length
    ? Math.round((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) * 100) / 100
    : 0;

  const uniqueUnparsedLines = [...new Set(unparsedLines)];
  return {
    sourceText,
    ...result,
    confidence,
    fieldConfidence,
    warnings: [...new Set(warnings)],
    unparsedLines: uniqueUnparsedLines,
    unparsedText: uniqueUnparsedLines.join('\n'),
  };
}

/** Alias matching the UI's message-intake terminology. */
export const parseDispatchMessage = parseDispatchPaste;
