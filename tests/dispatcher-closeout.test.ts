import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORTED_CLOSEOUT_PAYMENT_METHODS } from '../src/lib/calculations.ts';
import { canMutateJob, isOpenJobStatus } from '../src/lib/job-workflow.ts';

test('dispatcher closeout only marks integrated payment methods as paid', () => {
  assert.deepEqual([...SUPPORTED_CLOSEOUT_PAYMENT_METHODS], ['CASH', 'INTERAC']);
});

test('dispatcher closeout is limited to open jobs', () => {
  for (const status of ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS']) {
    assert.equal(isOpenJobStatus(status), true);
    assert.equal(canMutateJob(status), true);
  }
  for (const status of ['ABANDONED_TRAVEL_FEE', 'INVOICED', 'COMPLETED', 'CANCELLED']) {
    assert.equal(isOpenJobStatus(status), false);
    assert.equal(canMutateJob(status), false);
  }
});
