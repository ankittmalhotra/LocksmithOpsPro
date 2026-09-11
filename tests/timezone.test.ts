import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTorontoDateTime, torontoDateTimeToIso } from '../src/lib/timezone.ts';

test('parses Toronto datetime-local values consistently across server timezones', () => {
  assert.equal(torontoDateTimeToIso('2026-01-15T14:00'), '2026-01-15T19:00:00.000Z');
  assert.equal(torontoDateTimeToIso('2026-07-15T14:00'), '2026-07-15T18:00:00.000Z');
  assert.equal(parseTorontoDateTime('not-a-date'), null);
  assert.equal(parseTorontoDateTime('2026-02-30T10:00'), null);
  assert.equal(parseTorontoDateTime('2026-03-08T02:30'), null);
});
