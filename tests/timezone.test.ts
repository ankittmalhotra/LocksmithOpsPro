import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTorontoDateInput,
  parseTorontoDateOnly,
  parseTorontoDateTime,
  torontoDateTimeToIso,
  torontoDateToMidnightIso,
} from '../src/lib/timezone.ts';

test('parses Toronto datetime-local values consistently across server timezones', () => {
  assert.equal(torontoDateTimeToIso('2026-01-15T14:00'), '2026-01-15T19:00:00.000Z');
  assert.equal(torontoDateTimeToIso('2026-07-15T14:00'), '2026-07-15T18:00:00.000Z');
  assert.equal(parseTorontoDateTime('not-a-date'), null);
  assert.equal(parseTorontoDateTime('2026-02-30T10:00'), null);
  assert.equal(parseTorontoDateTime('2026-03-08T02:30'), null);
});

test('parses Toronto date-only values at local midnight with DST-aware UTC conversion', () => {
  assert.equal(torontoDateToMidnightIso('2026-01-15'), '2026-01-15T05:00:00.000Z');
  assert.equal(torontoDateToMidnightIso('2026-07-15'), '2026-07-15T04:00:00.000Z');
  assert.equal(parseTorontoDateOnly('2026-02-30'), null);
  assert.equal(parseTorontoDateOnly('2026-01-15T00:00'), null);
  assert.equal(parseTorontoDateOnly('not-a-date'), null);
});

test('formats timestamps as Toronto calendar dates for HTML date inputs', () => {
  assert.equal(formatTorontoDateInput('2026-01-15T04:59:59.999Z'), '2026-01-14');
  assert.equal(formatTorontoDateInput('2026-01-15T05:00:00.000Z'), '2026-01-15');
  assert.equal(formatTorontoDateInput('2026-07-15T03:59:59.999Z'), '2026-07-14');
  assert.equal(formatTorontoDateInput('2026-07-15T04:00:00.000Z'), '2026-07-15');
  assert.equal(formatTorontoDateInput('2026-09-12'), '2026-09-12');
  assert.equal(formatTorontoDateInput('2026-02-30'), '');
  assert.equal(formatTorontoDateInput(null), '');
  assert.equal(formatTorontoDateInput('not-a-date'), '');
});
