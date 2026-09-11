/**
 * Device-SMS drafts.
 *
 * The portal cannot send or confirm an SMS without a provider.  These helpers
 * only prepare a message and an sms: URI for the user's device to review and
 * send in its native Messages application.
 */

export interface SmsDraft {
  /** Destination in normalized NANP E.164 form. */
  to: string;
  /** Message text that the user can review before sending. */
  body: string;
  /** URI with the message body prefilled where the device supports it. */
  href: string;
  /** Recipient-only URI fallback for devices that do not prefill body text. */
  recipientHref: string;
  /** Non-fatal issues the UI should show alongside the draft. */
  warnings: string[];
}

export interface OptionalSmsDraftResult {
  draft: SmsDraft | null;
  warnings: string[];
}

export function technicianAssignmentChanged(
  previousTechnicianId: string | null | undefined,
  nextTechnicianId: string | null | undefined
): boolean {
  return (previousTechnicianId || null) !== (nextTechnicianId || null);
}

export interface JobSmsDetails {
  jobNumber: string;
  customerName: string;
  customerPhone?: string | null;
  customerExtension?: string | null;
  serviceAddress: string;
  serviceType: string;
  problemDescription?: string | null;
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  keyType?: string | null;
  isScheduled?: boolean;
  scheduledFor?: Date | string | null;
  technicianName?: string | null;
  appUrl?: string | null;
}

export type DispatcherNotificationKind = 'DISPATCHED' | 'COMPLETED' | 'ABANDONED';

export interface DispatcherNotificationDetails {
  jobNumber: string;
  technicianName?: string | null;
  serviceAddress?: string | null;
  kind: DispatcherNotificationKind;
  amountReceived?: number | null;
  paymentMethod?: string | null;
}

export class InvalidSmsPhoneError extends Error {
  constructor(phone: unknown) {
    super(`Invalid NANP phone number: ${String(phone ?? '')}`);
    this.name = 'InvalidSmsPhoneError';
  }
}

/**
 * Normalize a North American phone number to E.164.
 *
 * We accept common punctuation and spaces, plus either a ten-digit number,
 * an eleven-digit number beginning with 1, or the same number prefixed by
 * +1.  Other values are rejected instead of being silently rewritten.
 */
export function normalizeNanpPhone(phone: unknown): string {
  if (typeof phone !== 'string') throw new InvalidSmsPhoneError(phone);

  const value = phone.trim();
  if (!value || !/^\+?[\d\s().-]+$/.test(value)) {
    throw new InvalidSmsPhoneError(phone);
  }

  const digits = value.replace(/[\s().-]/g, '');
  const nationalNumber = digits.startsWith('+') ? digits.slice(1) : digits;

  if (digits.startsWith('+') && !value.startsWith('+')) {
    throw new InvalidSmsPhoneError(phone);
  }

  const nanpNumber = nationalNumber.length === 10
    ? nationalNumber
    : nationalNumber.length === 11 && nationalNumber.startsWith('1')
      ? nationalNumber.slice(1)
      : null;

  // NANP area codes and central-office codes cannot begin with 0 or 1.
  if (!nanpNumber || !/^[2-9]\d{2}[2-9]\d{6}$/.test(nanpNumber)) {
    throw new InvalidSmsPhoneError(phone);
  }

  return `+1${nanpNumber}`;
}

export function buildSmsHref(phone: unknown, body?: string): string {
  const normalizedPhone = normalizeNanpPhone(phone);
  const recipientHref = `sms:${normalizedPhone}`;
  if (body === undefined) return recipientHref;
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('SMS body must be a non-empty string');
  }
  return `${recipientHref}?body=${encodeURIComponent(body)}`;
}

export function buildSmsDraft({ to, body }: { to: unknown; body: string }): SmsDraft {
  const normalizedPhone = normalizeNanpPhone(to);
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('SMS body must be a non-empty string');
  }

  return {
    to: normalizedPhone,
    body,
    href: buildSmsHref(normalizedPhone, body),
    recipientHref: buildSmsHref(normalizedPhone),
    warnings: [],
  };
}

function formatScheduledFor(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Toronto',
  }).format(date);
}

function jobLink(appUrl: string | null | undefined, jobNumber: string): string | null {
  if (!appUrl) return null;

  try {
    const baseUrl = new URL(appUrl);
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') return null;
    return new URL(`/tech/jobs/${encodeURIComponent(jobNumber)}`, baseUrl).toString();
  } catch {
    return null;
  }
}

function jobDetails(details: JobSmsDetails): string {
  const extension = details.customerExtension ? ` #${details.customerExtension}` : '';
  const customerPhone = details.customerPhone ? ` (${details.customerPhone}${extension})` : '';
  const vehicle = details.vehicleMake
    ? `\nVehicle: ${[details.vehicleYear, details.vehicleMake, details.vehicleModel].filter(Boolean).join(' ')}`
      + (details.keyType ? `, ${details.keyType}` : '')
    : '';
  const schedule = details.isScheduled && details.scheduledFor
    ? `\nScheduled: ${formatScheduledFor(details.scheduledFor)}`
    : '';
  const problem = details.problemDescription?.trim()
    ? `\nProblem: ${details.problemDescription.trim()}`
    : '';

  return `Job #${details.jobNumber}
Customer: ${details.customerName}${customerPhone}
Address: ${details.serviceAddress}
Service: ${details.serviceType}${problem}${vehicle}${schedule}`;
}

export function buildTechnicianAssignmentMessage(details: JobSmsDetails): string {
  const link = jobLink(details.appUrl, details.jobNumber);
  return `NEW JOB ASSIGNMENT\n${jobDetails(details)}\nPlease open and acknowledge in the portal.${link ? `\nOpen: ${link}` : ''}`;
}

export function buildTechnicianUpdateMessage(details: JobSmsDetails): string {
  const link = jobLink(details.appUrl, details.jobNumber);
  return `UPDATED JOB ASSIGNMENT\n${jobDetails(details)}\nPlease review the updated details in the portal.${link ? `\nOpen: ${link}` : ''}`;
}

export function buildDispatcherNotificationMessage(details: DispatcherNotificationDetails): string {
  const technician = details.technicianName || 'Technician';
  if (details.kind === 'COMPLETED') {
    const amount = typeof details.amountReceived === 'number' && Number.isFinite(details.amountReceived)
      ? ` Amount received: $${details.amountReceived.toFixed(2)}.`
      : '';
    const method = details.paymentMethod ? ` Payment: ${details.paymentMethod}.` : '';
    return `Job #${details.jobNumber} completed by ${technician}.${amount}${method}`;
  }

  if (details.kind === 'ABANDONED') {
    const amount = typeof details.amountReceived === 'number' && Number.isFinite(details.amountReceived)
      ? ` Travel fee: $${details.amountReceived.toFixed(2)}.`
      : '';
    const method = details.paymentMethod ? ` Payment: ${details.paymentMethod}.` : '';
    return `Job #${details.jobNumber} abandoned by ${technician}.${amount}${method}`;
  }

  const address = details.serviceAddress ? ` (${details.serviceAddress})` : '';
  return `Technician ${technician} is dispatched to Job #${details.jobNumber}${address}.`;
}

export function buildTechnicianAssignmentDraft(
  phone: unknown,
  details: JobSmsDetails
): SmsDraft {
  return addPortalLinkWarning(
    buildSmsDraft({ to: phone, body: buildTechnicianAssignmentMessage(details) }),
    details.appUrl
  );
}

export function buildTechnicianUpdateDraft(
  phone: unknown,
  details: JobSmsDetails
): SmsDraft {
  return addPortalLinkWarning(
    buildSmsDraft({ to: phone, body: buildTechnicianUpdateMessage(details) }),
    details.appUrl
  );
}

export function buildDispatcherNotificationDraft(
  phone: unknown,
  details: DispatcherNotificationDetails
): SmsDraft {
  return buildSmsDraft({ to: phone, body: buildDispatcherNotificationMessage(details) });
}

export function tryBuildDispatcherNotificationDraft(
  phone: unknown,
  details: DispatcherNotificationDetails
): OptionalSmsDraftResult {
  if (typeof phone !== 'string' || phone.trim() === '') {
    return {
      draft: null,
      warnings: ['Dispatcher SMS draft unavailable: dispatcher phone number is missing.'],
    };
  }

  try {
    return { draft: buildDispatcherNotificationDraft(phone, details), warnings: [] };
  } catch {
    return {
      draft: null,
      warnings: ['Dispatcher SMS draft unavailable: dispatcher phone number is invalid.'],
    };
  }
}

function addPortalLinkWarning(draft: SmsDraft, appUrl: string | null | undefined): SmsDraft {
  if (jobLink(appUrl, 'portal-check')) return draft;

  return {
    ...draft,
    warnings: [
      'Portal link unavailable: configure NEXT_PUBLIC_APP_URL before sending this SMS.',
    ],
  };
}
