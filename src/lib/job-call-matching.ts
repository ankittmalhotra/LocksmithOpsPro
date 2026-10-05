export type CanonicalPhoneResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'ambiguous' };

/** Canonicalize an exact phone identity without using lossy cache columns. */
export function canonicalizePhone(value: string | null | undefined): CanonicalPhoneResult {
  if (!value?.trim()) return { ok: false, reason: 'empty' };
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits || /[A-Za-z]/.test(trimmed)) return { ok: false, reason: 'invalid' };

  // A plus sign says the supplied digits already include their country code.
  if (trimmed.startsWith('+')) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return { ok: false, reason: 'invalid' };
    return { ok: true, value: `+${digits}` };
  }

  // Accept ordinary North American presentation, including explicit country code.
  if (digits.length === 10) {
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return { ok: false, reason: 'invalid' };
    return { ok: true, value: `+1${digits}` };
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    if (!/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return { ok: false, reason: 'invalid' };
    return { ok: true, value: `+${digits}` };
  }

  // Without an explicit +, longer numbers are ambiguous: they may be a local
  // number with a trunk prefix or a country-code number.
  if (digits.length >= 8 && digits.length <= 15) return { ok: false, reason: 'ambiguous' };
  return { ok: false, reason: 'invalid' };
}

export type MatchCall = {
  id: string;
  direction: string | null;
  result: string | null;
  reason: string | null;
  type: string | null;
  durationSeconds: number | null;
  durationMs: number | null;
  startTime: Date | string | null;
  isVoicemail: boolean;
  voicemailMessageId: string | null;
  callerPhoneNumber: string | null;
  destinationPhoneNumber: string | null;
  rawPayload?: unknown;
};

export type MatchJob = {
  id: string;
  customerId: string;
  createdAt: Date | string;
  isManual: boolean;
  customer: { name: string; phone: string };
};

export type JobCallCandidate = {
  jobId: string;
  callId: string;
  phoneCanonical: string;
  callTime: string;
  torontoTime: string;
  durationSeconds: number | null;
  method: 'PHONE_TIME_RULE';
  role: 'ORIGINATING_INBOUND';
  rationale: string;
  timeDeltaMs: number;
};

export type RecentCallCandidate = {
  callId: string;
  phoneCanonical: string;
  callTime: string;
  torontoTime: string;
  durationSeconds: number | null;
  result: string | null;
};

function rawEndpointPhone(call: MatchCall, endpoint: 'from' | 'to') {
  const payload = call.rawPayload && typeof call.rawPayload === 'object'
    ? call.rawPayload as Record<string, unknown>
    : {};
  const rawEndpoint = payload[endpoint] && typeof payload[endpoint] === 'object'
    ? payload[endpoint] as Record<string, unknown>
    : {};
  const rawNumber = typeof rawEndpoint.phoneNumber === 'string' ? rawEndpoint.phoneNumber : null;
  return endpoint === 'from'
    ? call.callerPhoneNumber || rawNumber
    : call.destinationPhoneNumber || rawNumber;
}

export function rawCallerPhone(call: MatchCall) {
  return rawEndpointPhone(call, 'from');
}

export function rawDestinationPhone(call: MatchCall) {
  return rawEndpointPhone(call, 'to');
}

export function isInboundCallForTrackedTarget(call: MatchCall, targetPhoneNumbers: string[]) {
  if (call.direction?.toLowerCase() !== 'inbound' || targetPhoneNumbers.length === 0) return false;
  const destination = canonicalizePhone(rawDestinationPhone(call));
  if (!destination.ok) return false;
  return targetPhoneNumbers.some((target) => {
    const canonicalTarget = canonicalizePhone(target);
    return canonicalTarget.ok && canonicalTarget.value === destination.value;
  });
}

export function isMissedInboundMatchCall(call: MatchCall) {
  if (call.direction?.toLowerCase() !== 'inbound' || call.isVoicemail || call.voicemailMessageId
    || /voicemail/i.test(call.type || '') || /voicemail/i.test(call.result || '')) return false;
  return /missed|no[ -]?answer|busy|failed|cancelled/.test(`${call.result || ''} ${call.reason || ''}`.toLowerCase());
}

function successfulOutboundCallback(call: MatchCall) {
  if (call.direction?.toLowerCase() !== 'outbound') return false;
  const result = `${call.result || ''} ${call.reason || ''}`.toLowerCase();
  if (/missed|no[ -]?answer|busy|failed|cancelled|voicemail/.test(result)) return false;
  const duration = call.durationSeconds ?? (call.durationMs === null ? null : call.durationMs / 1000);
  return /accept|connect|answer/.test(result) || (duration !== null && duration > 0);
}

export type SuccessfulCallbackIndex = Map<string, number[]>;

export function indexSuccessfulCallbacks(callbackCalls: MatchCall[]): SuccessfulCallbackIndex {
  const index: SuccessfulCallbackIndex = new Map();
  for (const callback of callbackCalls) {
    if (!successfulOutboundCallback(callback)) continue;
    const destination = canonicalizePhone(rawDestinationPhone(callback));
    const time = callback.startTime ? new Date(callback.startTime).getTime() : Number.NaN;
    if (!destination.ok || !Number.isFinite(time)) continue;
    const times = index.get(destination.value) || [];
    times.push(time);
    index.set(destination.value, times);
  }
  for (const times of index.values()) times.sort((left, right) => left - right);
  return index;
}

function hasIndexedCallbackAfter(index: SuccessfulCallbackIndex, destination: string, callTime: number) {
  const times = index.get(destination) || [];
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (times[mid] <= callTime) low = mid + 1;
    else high = mid;
  }
  return low < times.length;
}

function callDuration(call: MatchCall) {
  if (call.durationSeconds !== null) return call.durationSeconds;
  return call.durationMs === null ? null : call.durationMs / 1000;
}

export function qualifiesAsOriginatingCall(call: MatchCall, callbackCalls: MatchCall[], callbackIndex?: SuccessfulCallbackIndex) {
  if (call.direction?.toLowerCase() !== 'inbound' || call.isVoicemail || call.voicemailMessageId
    || /voicemail/i.test(call.type || '') || /voicemail/i.test(call.result || '')) return false;
  const startedAt = call.startTime ? new Date(call.startTime).getTime() : Number.NaN;
  if (!Number.isFinite(startedAt)) return false;

  if (isMissedInboundMatchCall(call)) {
    const caller = canonicalizePhone(rawCallerPhone(call));
    if (!caller.ok) return false;
    if (callbackIndex) return hasIndexedCallbackAfter(callbackIndex, caller.value, startedAt);
    return callbackCalls.some((callback) => {
      const callbackTime = callback.startTime ? new Date(callback.startTime).getTime() : Number.NaN;
      const destination = canonicalizePhone(rawDestinationPhone(callback));
      return successfulOutboundCallback(callback)
        && Number.isFinite(callbackTime)
        && callbackTime > startedAt
        && destination.ok
        && destination.value === caller.value;
    });
  }

  // The shared originating-call rule requires an answered call lasting 30s+.
  return callDuration(call) !== null && callDuration(call)! >= 30;
}

function torontoDateKey(value: Date | string | number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function formatCandidateTorontoTime(value: Date | string | number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

/** Pure ranked candidates. Caller/customer canonical collisions are rejected as ambiguous. */
export function generateJobCallCandidates(args: {
  jobs: MatchJob[];
  calls: MatchCall[];
  callbackCalls?: MatchCall[];
  targetPhoneNumbers: string[];
  confirmedCallIds?: Set<string>;
  maxDeltaMs?: number;
  perJobLimit?: number;
}): JobCallCandidate[] {
  const maxDeltaMs = args.maxDeltaMs ?? 24 * 60 * 60 * 1000;
  const callbacks = args.callbackCalls || [];
  const callbackIndex = indexSuccessfulCallbacks(callbacks);
  const customerPhones = new Map<string, Set<string>>();
  for (const job of args.jobs) {
    const phone = canonicalizePhone(job.customer.phone);
    if (!phone.ok) continue;
    const ids = customerPhones.get(phone.value) || new Set<string>();
    ids.add(job.customerId);
    customerPhones.set(phone.value, ids);
  }

  const results: JobCallCandidate[] = [];
  const inboundByCaller = new Map<string, MatchCall[]>();
  for (const call of args.calls) {
    if (!isInboundCallForTrackedTarget(call, args.targetPhoneNumbers)) continue;
    const caller = canonicalizePhone(rawCallerPhone(call));
    if (!caller.ok) continue;
    const calls = inboundByCaller.get(caller.value) || [];
    calls.push(call);
    inboundByCaller.set(caller.value, calls);
  }
  for (const job of args.jobs) {
    const customerPhone = canonicalizePhone(job.customer.phone);
    if (!customerPhone.ok || (customerPhones.get(customerPhone.value)?.size || 0) !== 1) continue;
    const createdAt = new Date(job.createdAt).getTime();
    if (!Number.isFinite(createdAt)) continue;
    const jobCandidates = (inboundByCaller.get(customerPhone.value) || []).flatMap((call) => {
      if (args.confirmedCallIds?.has(call.id) || !qualifiesAsOriginatingCall(call, callbacks, callbackIndex)) return [];
      const callerPhone = canonicalizePhone(rawCallerPhone(call));
      const callAt = call.startTime ? new Date(call.startTime).getTime() : Number.NaN;
      if (!callerPhone.ok || callerPhone.value !== customerPhone.value || !Number.isFinite(callAt)) return [];
      const timeDeltaMs = Math.abs(callAt - createdAt);
      if (timeDeltaMs > maxDeltaMs) return [];
      const sameTorontoDay = torontoDateKey(callAt) === torontoDateKey(createdAt);
      // Normal job timestamps are actual record creation times, so a possible
      // originating call must precede creation. Manual records commonly use
      // Toronto midnight as a date placeholder and only support same-day search.
      if (job.isManual ? !sameTorontoDay : callAt > createdAt) return [];
      return [{
        jobId: job.id,
        callId: call.id,
        phoneCanonical: customerPhone.value,
        callTime: new Date(callAt).toISOString(),
        torontoTime: formatCandidateTorontoTime(callAt),
        durationSeconds: callDuration(call),
        method: 'PHONE_TIME_RULE' as const,
        role: 'ORIGINATING_INBOUND' as const,
        rationale: job.isManual
          ? `Exact canonical caller/customer phone; manual job date ${torontoDateKey(createdAt)} is a Toronto-calendar search hint only, not call-time evidence. Requires human review.`
          : `Exact canonical caller/customer phone; inbound call preceded job record creation by ${Math.round(timeDeltaMs / 60000)} minutes. Job creation time is only a ranking hint. Requires human review.`,
        timeDeltaMs,
      }];
    });
    jobCandidates.sort((left, right) => {
      const leftSameTorontoDay = torontoDateKey(left.callTime) === torontoDateKey(job.createdAt) ? 0 : 1;
      const rightSameTorontoDay = torontoDateKey(right.callTime) === torontoDateKey(job.createdAt) ? 0 : 1;
      return leftSameTorontoDay - rightSameTorontoDay || left.timeDeltaMs - right.timeDeltaMs || left.callTime.localeCompare(right.callTime);
    });
    results.push(...jobCandidates.slice(0, args.perJobLimit ?? 5));
  }
  return results;
}

export function findRecentQualifyingCalls(args: {
  phone: string;
  calls: MatchCall[];
  targetPhoneNumbers: string[];
  callbackCalls?: MatchCall[];
  now?: Date | number;
  windowMs?: number;
  limit?: number;
}): { validPhone: boolean; candidates: RecentCallCandidate[] } {
  const phone = canonicalizePhone(args.phone);
  if (!phone.ok) return { validPhone: false, candidates: [] };
  const now = args.now instanceof Date ? args.now.getTime() : args.now ?? Date.now();
  const start = now - (args.windowMs ?? 3 * 24 * 60 * 60 * 1000);
  const callbackIndex = indexSuccessfulCallbacks(args.callbackCalls || []);
  const candidates = args.calls.flatMap((call) => {
    const callAt = call.startTime ? new Date(call.startTime).getTime() : Number.NaN;
    const caller = canonicalizePhone(rawCallerPhone(call));
    if (!Number.isFinite(callAt) || callAt < start || callAt > now || !caller.ok || caller.value !== phone.value
      || !isInboundCallForTrackedTarget(call, args.targetPhoneNumbers)
      || !qualifiesAsOriginatingCall(call, args.callbackCalls || [], callbackIndex)) return [];
    return [{
      callId: call.id,
      phoneCanonical: phone.value,
      callTime: new Date(callAt).toISOString(),
      torontoTime: formatCandidateTorontoTime(callAt),
      durationSeconds: callDuration(call),
      result: call.result,
    }];
  });
  candidates.sort((left, right) => right.callTime.localeCompare(left.callTime));
  return { validPhone: true, candidates: candidates.slice(0, args.limit ?? candidates.length) };
}

export function validateReviewOwnership(match: { jobId: string; ringCentralCallLogId: string }, requestedJobId: string, requestedCallId: string) {
  return match.jobId === requestedJobId && match.ringCentralCallLogId === requestedCallId;
}

export function canReviewJobCallMatch(role: string, match: { jobId: string; ringCentralCallLogId: string }, requestedJobId: string, requestedCallId: string) {
  return role === 'ADMIN' && validateReviewOwnership(match, requestedJobId, requestedCallId);
}

export function isJobCallMatchPhoneStale(customerPhone: string, call: MatchCall, candidatePhoneCanonical?: string | null) {
  const customer = canonicalizePhone(customerPhone);
  const caller = canonicalizePhone(rawCallerPhone(call));
  return !customer.ok || !caller.ok || customer.value !== caller.value
    || Boolean(candidatePhoneCanonical && customer.value !== candidatePhoneCanonical);
}
