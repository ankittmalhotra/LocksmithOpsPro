import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDispatcherNotificationMessage,
  buildTechnicianAssignmentDraft,
  buildSmsDraft,
  buildSmsHref,
  buildTechnicianAssignmentMessage,
  buildTechnicianUpdateMessage,
  InvalidSmsPhoneError,
  normalizeNanpPhone,
  technicianAssignmentChanged,
  tryBuildDispatcherNotificationDraft,
} from '../src/lib/sms-draft.ts';

const jobDetails = {
  jobNumber: '1007',
  customerName: 'Alex Customer',
  customerPhone: '416-555-0123',
  customerExtension: '4',
  serviceAddress: '123 Main Street, Toronto',
  serviceType: 'Automotive Lockout',
  problemDescription: 'Customer cannot unlock the vehicle.',
  vehicleYear: '2020',
  vehicleMake: 'Honda',
  vehicleModel: 'Civic',
  keyType: 'Proximity Smart Fob',
  appUrl: 'https://portal.example.test',
};

test('normalizes common NANP phone formats', () => {
  assert.equal(normalizeNanpPhone('4165550123'), '+14165550123');
  assert.equal(normalizeNanpPhone('(416) 555-0123'), '+14165550123');
  assert.equal(normalizeNanpPhone('1-416-555-0123'), '+14165550123');
  assert.equal(normalizeNanpPhone('+1 (416) 555-0123'), '+14165550123');
});

test('rejects invalid or non-NANP phone formats', () => {
  for (const phone of ['', '123', '416555012', '04165550123', '+44 20 1234 5678', '416-555-0123 ext 4']) {
    assert.throws(() => normalizeNanpPhone(phone), InvalidSmsPhoneError);
  }
});

test('builds encoded sms URI and recipient-only fallback', () => {
  const draft = buildSmsDraft({
    to: '4165550123',
    body: 'Job #1007: address is 123 Main St & unit 4\nPlease review.',
  });

  assert.equal(draft.to, '+14165550123');
  assert.equal(draft.recipientHref, 'sms:+14165550123');
  assert.equal(draft.href, 'sms:+14165550123?body=Job%20%231007%3A%20address%20is%20123%20Main%20St%20%26%20unit%204%0APlease%20review.');
  assert.equal(decodeURIComponent(draft.href.split('?body=')[1]), draft.body);
  assert.equal(buildSmsHref('+14165550123'), 'sms:+14165550123');
});

test('scheduled assignment uses scheduled wording and never on-the-way wording', () => {
  const message = buildTechnicianAssignmentMessage({
    ...jobDetails,
    isScheduled: true,
    scheduledFor: '2026-09-12T14:00:00.000Z',
  });

  assert.match(message, /Scheduled:/);
  assert.match(
    message,
    new RegExp(`Scheduled: ${new Intl.DateTimeFormat('en-CA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Toronto',
    }).format(new Date('2026-09-12T14:00:00.000Z')).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`)
  );
  assert.match(message, /Problem: Customer cannot unlock the vehicle\./);
  assert.doesNotMatch(message.toLowerCase(), /on[- ]the[- ]way/);
  assert.match(message, /Open: https:\/\/portal\.example\.test\/tech\/jobs\/1007/);
});

test('missing app URL omits portal link and returns an explicit warning', () => {
  const draft = buildTechnicianAssignmentDraft('4165550123', {
    ...jobDetails,
    appUrl: undefined,
  });

  assert.doesNotMatch(draft.body, /Open:/);
  assert.equal(draft.href.includes('localhost'), false);
  assert.deepEqual(draft.warnings, [
    'Portal link unavailable: configure NEXT_PUBLIC_APP_URL before sending this SMS.',
  ]);

  const invalidUrlDraft = buildTechnicianAssignmentDraft('4165550123', {
    ...jobDetails,
    appUrl: 'not-a-url',
  });
  assert.doesNotMatch(invalidUrlDraft.body, /Open:/);
  assert.deepEqual(invalidUrlDraft.warnings, draft.warnings);
});

test('assignment and update messages exclude sensitive completion fields', () => {
  const assignment = buildTechnicianAssignmentMessage(jobDetails);
  const update = buildTechnicianUpdateMessage(jobDetails);

  assert.match(assignment, /NEW JOB ASSIGNMENT/);
  assert.match(update, /UPDATED JOB ASSIGNMENT/);
  for (const message of [assignment, update]) {
    assert.doesNotMatch(message, /keyBitting|doorDetails|proofPhotoUrl|preWorkSignature|customerSignature|vehicleVin|paymentMethod|amountReceived|commission/i);
  }
});

test('reassignment produces an update draft only when the technician changes', () => {
  assert.equal(technicianAssignmentChanged('tech-a', 'tech-b'), true);
  assert.equal(technicianAssignmentChanged(null, 'tech-b'), true);
  assert.equal(technicianAssignmentChanged('tech-a', null), true);
  assert.equal(technicianAssignmentChanged('tech-a', 'tech-a'), false);
  assert.equal(technicianAssignmentChanged(null, null), false);

  const update = buildTechnicianUpdateMessage({
    ...jobDetails,
    technicianName: 'Taylor Tech',
  });
  assert.match(update, /UPDATED JOB ASSIGNMENT/);
});

test('dispatcher notification messages cover dispatch and completion', () => {
  assert.equal(
    buildDispatcherNotificationMessage({
      kind: 'DISPATCHED',
      jobNumber: '1007',
      technicianName: 'Taylor Tech',
      serviceAddress: '123 Main Street',
    }),
    'Technician Taylor Tech is dispatched to Job #1007 (123 Main Street).'
  );
  assert.equal(
    buildDispatcherNotificationMessage({
      kind: 'COMPLETED',
      jobNumber: '1007',
      technicianName: 'Taylor Tech',
      amountReceived: 166.77,
      paymentMethod: 'Cash',
    }),
    'Job #1007 completed by Taylor Tech. Amount received: $166.77. Payment: Cash.'
  );
  assert.equal(
    buildDispatcherNotificationMessage({
      kind: 'ABANDONED',
      jobNumber: '1007',
      technicianName: 'Taylor Tech',
      amountReceived: 28.25,
      paymentMethod: 'Interac',
    }),
    'Job #1007 abandoned by Taylor Tech. Travel fee: $28.25. Payment: Interac.'
  );
});

test('dispatcher notification drafts are best effort for invalid or missing phones', () => {
  const invalid = tryBuildDispatcherNotificationDraft('not-a-phone', {
    kind: 'COMPLETED',
    jobNumber: '1007',
  });
  assert.equal(invalid.draft, null);
  assert.deepEqual(invalid.warnings, [
    'Dispatcher SMS draft unavailable: dispatcher phone number is invalid.',
  ]);

  const missing = tryBuildDispatcherNotificationDraft(undefined, {
    kind: 'ABANDONED',
    jobNumber: '1007',
  });
  assert.equal(missing.draft, null);
  assert.deepEqual(missing.warnings, [
    'Dispatcher SMS draft unavailable: dispatcher phone number is missing.',
  ]);
});
