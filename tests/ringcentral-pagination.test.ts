import assert from 'node:assert/strict';
import { assertRingCentralPaginationComplete, MAX_RINGCENTRAL_PAGES } from '../src/lib/ringcentral-pagination.ts';

assert.equal(MAX_RINGCENTRAL_PAGES, 100);
assert.doesNotThrow(() => assertRingCentralPaginationComplete(101, null, 100, 'call log'));
assert.throws(
  () => assertRingCentralPaginationComplete(101, null, 101, 'call log'),
  /results are incomplete/,
  'Call logs fail closed if the cap truncates pages',
);
assert.throws(
  () => assertRingCentralPaginationComplete(101, 'https://example.test/page=101', null, 'voicemail'),
  /voicemail response exceeded 100 pages/,
  'Voicemail fails closed if a continuation link remains at the cap',
);

console.log('ringcentral-pagination tests passed');
