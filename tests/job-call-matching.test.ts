import {
  canReviewJobCallMatch,
  canonicalizePhone,
  findRecentQualifyingCalls,
  generateJobCallCandidates,
  isJobCallMatchPhoneStale,
  qualifiesAsOriginatingCall,
} from '../src/lib/job-call-matching.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const customerPhone = '(416) 555-0123';
const trackedTargets = ['+1 416 240 0593'];
const canonical = canonicalizePhone(customerPhone);
assert(canonical.ok && canonical.value === '+14165550123', 'NANP presentation should canonicalize');
const explicitNanp = canonicalizePhone('+1 416 555 0123');
const elevenDigitNanp = canonicalizePhone('1 (416) 555-0123');
const internationalPhone = canonicalizePhone('+44 20 7946 0958');
assert(explicitNanp.ok && explicitNanp.value === '+14165550123', 'explicit +1 should match local NANP');
assert(elevenDigitNanp.ok && elevenDigitNanp.value === '+14165550123', '11 digit NANP should preserve country code');
assert(internationalPhone.ok && internationalPhone.value === '+442079460958', 'international + country code should be preserved');
assert(!canonicalizePhone('416555012').ok, 'short number should be invalid');
assert(!canonicalizePhone('4165550123 ext 8').ok, 'extension-bearing number should be invalid for exact matching');
assert(!canonicalizePhone('442079460958').ok, 'long number without + must remain ambiguous');

const baseCall = {
  direction: 'Inbound', result: 'Accepted', reason: null, type: 'Voice', durationSeconds: 45,
  durationMs: 45000, startTime: '2026-10-01T14:00:00.000Z', isVoicemail: false,
  voicemailMessageId: null, callerPhoneNumber: null, destinationPhoneNumber: null,
};
const call = (id: string, phone: string, startTime = baseCall.startTime, durationSeconds = 45) => ({
  ...baseCall,
  id,
  startTime,
  durationSeconds,
  durationMs: durationSeconds * 1000,
  rawPayload: { from: { phoneNumber: phone }, to: { phoneNumber: '+14162400593' } },
});
const job = (id: string, phone = customerPhone, customerId = `customer-${id}`, createdAt = '2026-10-01T14:05:00.000Z', isManual = false) => ({
  id, customerId, createdAt, isManual, customer: { name: id, phone },
});

const ranked = generateJobCallCandidates({
  jobs: [job('job-a'), job('job-b', '+1 647 555 0101', 'customer-b')],
  calls: [
    call('near', customerPhone, '2026-10-01T14:03:00.000Z'),
    call('farther', '+1 416 555 0123', '2026-10-01T13:00:00.000Z'),
    call('other-job', '+1 647 555 0101'),
  ],
  targetPhoneNumbers: trackedTargets,
});
assert(ranked.filter((candidate) => candidate.jobId === 'job-a').length === 2, 'one job may have multiple candidate calls');
assert(ranked.filter((candidate) => candidate.jobId === 'job-b').length === 1, 'different jobs can have their own matching calls');
assert(ranked[0]?.callId === 'near', 'closest same-Toronto-day call should rank first');
assert(ranked[0]?.torontoTime.includes('Oct 1, 2026'), 'candidate time should be rendered in Toronto time');
assert(generateJobCallCandidates({ jobs: [job('future-normal')], calls: [call('future', customerPhone, '2026-10-01T14:10:00.000Z')], targetPhoneNumbers: trackedTargets }).length === 0, 'normal job candidates must precede job creation');
const manualMidnightJob = job('manual-midnight', customerPhone, 'manual-customer', '2026-10-01T04:00:00.000Z', true);
const manualMidnightCandidate = generateJobCallCandidates({ jobs: [manualMidnightJob], calls: [call('manual-day-call', customerPhone, '2026-10-01T22:30:00.000Z')], targetPhoneNumbers: trackedTargets });
assert(manualMidnightCandidate.length === 1 && /search hint only/.test(manualMidnightCandidate[0].rationale), 'manual Toronto-midnight date should search same Toronto day and avoid claiming exact job time');

const duplicateNumberJobs = generateJobCallCandidates({
  jobs: [job('shared-a', customerPhone, 'customer-a'), job('shared-b', '+1 416 555 0123', 'customer-b')],
  calls: [call('shared-call', customerPhone)],
  targetPhoneNumbers: trackedTargets,
});
assert(duplicateNumberJobs.length === 0, 'same canonical phone on distinct customer records is ambiguous');
assert(generateJobCallCandidates({ jobs: [job('invalid', '416555012')], calls: [call('invalid-call', customerPhone)], targetPhoneNumbers: trackedTargets }).length === 0, 'invalid customer number should not produce a candidate');
assert(generateJobCallCandidates({ jobs: [job('wrong-destination')], calls: [{ ...call('wrong-destination-call', customerPhone), rawPayload: { from: { phoneNumber: customerPhone }, to: { phoneNumber: '+1 416 555 0100' } } }], targetPhoneNumbers: trackedTargets }).length === 0, 'inbound calls to untracked numbers must not produce candidates');

const missed = {
  ...call('missed', customerPhone), result: 'Missed', reason: 'No Answer', durationSeconds: 4,
  durationMs: 4000,
};
const callback = {
  ...call('callback', customerPhone, '2026-10-01T14:10:00.000Z', 20), direction: 'Outbound',
  rawPayload: { from: { phoneNumber: '+14162400593' }, to: { phoneNumber: '+1 416 555 0123' } },
};
assert(!qualifiesAsOriginatingCall(missed, []), 'uncalled missed inbound is not qualified');
assert(qualifiesAsOriginatingCall(missed, [callback]), 'missed inbound qualifies when callback connects successfully');
assert(!qualifiesAsOriginatingCall({ ...baseCall, id: 'short', durationSeconds: 29, durationMs: 29000, callerPhoneNumber: customerPhone }, []), 'short answered call is not qualified');
assert(!qualifiesAsOriginatingCall({ ...baseCall, id: 'vm', isVoicemail: true, callerPhoneNumber: customerPhone }, []), 'voicemail is not qualified');
assert(generateJobCallCandidates({ jobs: [job('missed-job')], calls: [missed], callbackCalls: [callback], targetPhoneNumbers: trackedTargets }).length === 1, 'callback-recovered missed inbound can become a candidate');
assert(generateJobCallCandidates({ jobs: [job('missed-job')], calls: [missed], targetPhoneNumbers: trackedTargets }).length === 0, 'missed call without callback cannot become a candidate');
assert(generateJobCallCandidates({ jobs: [job('short-job')], calls: [{ ...call('short', customerPhone), durationSeconds: 10 }], targetPhoneNumbers: trackedTargets }).length === 0, 'short call cannot become a candidate');
const recentWindow = findRecentQualifyingCalls({
  phone: customerPhone,
  targetPhoneNumbers: trackedTargets,
  calls: [call('recent', customerPhone, '2026-10-01T14:00:00.000Z'), call('old', customerPhone, '2026-09-27T14:00:00.000Z')],
  now: new Date('2026-10-01T15:00:00.000Z'),
});
assert(recentWindow.validPhone && recentWindow.candidates.length === 1 && recentWindow.candidates[0].callId === 'recent', 'intake picker only returns exact-phone qualified calls from the last three days');
assert(!findRecentQualifyingCalls({ phone: '123', calls: [], targetPhoneNumbers: trackedTargets, now: new Date('2026-10-01T15:00:00.000Z') }).validPhone, 'invalid intake phone returns no candidates');
assert(findRecentQualifyingCalls({ phone: customerPhone, calls: [], targetPhoneNumbers: trackedTargets, now: new Date('2026-10-01T15:00:00.000Z') }).candidates.length === 0, 'missing call data leaves a normal no-candidate result');

const reviewMatch = { jobId: 'job-a', ringCentralCallLogId: 'near' };
assert(canReviewJobCallMatch('ADMIN', reviewMatch, 'job-a', 'near'), 'Admin may review owned suggestion');
assert(!canReviewJobCallMatch('DISPATCHER', reviewMatch, 'job-a', 'near'), 'non-Admin IDs are not authorized for historical review');
assert(!canReviewJobCallMatch('ADMIN', reviewMatch, 'job-forged', 'near'), 'forged job ID must fail ownership validation');
assert(!canReviewJobCallMatch('ADMIN', reviewMatch, 'job-a', 'call-forged'), 'forged call ID must fail ownership validation');
assert(!isJobCallMatchPhoneStale(customerPhone, call('same', '+14165550123')), 'matching customer phone is not stale');
assert(isJobCallMatchPhoneStale('+1 647 555 0101', call('edited', customerPhone)), 'customer phone edit must surface as stale');

console.log('Job call matching tests passed');
