import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestSequenceGuard } from '../src/lib/request-sequence.ts';

test('Ads range requests cannot apply data or loading/error state after a newer request starts', () => {
  const guard = createRequestSequenceGuard();
  const first = guard.begin();
  const firstController = new AbortController();
  const second = guard.begin();
  assert.equal(guard.isCurrent(first, firstController.signal), false);
  assert.equal(guard.isCurrent(second), true);
  firstController.abort();
  assert.equal(guard.isCurrent(second), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(second), false);
});
