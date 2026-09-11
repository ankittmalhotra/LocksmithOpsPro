import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TERMINAL_JOB_STATUSES,
  FINANCIAL_TERMINAL_JOB_STATUSES,
  buildJobCloseoutClaimWhere,
  canTransitionJobStatus,
  canMutateJob,
  isTerminalJobStatus,
  normalizeTechnicianId,
} from '../src/lib/job-workflow.ts';

test('terminal statuses match the supported Prisma job lifecycle', () => {
  assert.deepEqual(TERMINAL_JOB_STATUSES, [
    'ABANDONED_TRAVEL_FEE',
    'INVOICED',
    'COMPLETED',
    'CANCELLED',
  ]);
});

test('terminal status detection is strict and null-safe', () => {
  for (const status of TERMINAL_JOB_STATUSES) {
    assert.equal(isTerminalJobStatus(status), true);
  }

  assert.equal(isTerminalJobStatus('IN_PROGRESS'), false);
  assert.equal(isTerminalJobStatus('completed'), false);
  assert.equal(isTerminalJobStatus(null), false);
  assert.equal(isTerminalJobStatus(undefined), false);
  assert.equal(isTerminalJobStatus('UNSUPPORTED_STATUS'), false);
});

test('closeout claim includes the current technician assignment', () => {
  assert.deepEqual(
    buildJobCloseoutClaimWhere({
      id: 'job-1',
      status: 'IN_PROGRESS',
      workerCommissionRate: 25,
      technicianId: 'tech-1',
    }),
    {
      id: 'job-1',
      status: 'IN_PROGRESS',
      workerCommissionRate: 25,
      technicianId: 'tech-1',
    }
  );

  assert.equal(
    buildJobCloseoutClaimWhere({
      id: 'job-2',
      status: 'NEW',
      workerCommissionRate: 0,
      technicianId: null,
    }).technicianId,
    null
  );
});

test('empty technician assignments normalize to an unassigned job', () => {
  assert.equal(normalizeTechnicianId(''), null);
  assert.equal(normalizeTechnicianId('   '), null);
  assert.equal(normalizeTechnicianId(null), null);
  assert.equal(normalizeTechnicianId('tech-1'), 'tech-1');
  assert.equal(normalizeTechnicianId(42), 42);
});

test('open statuses may be mutated and terminal statuses may not', () => {
  assert.equal(canMutateJob('NEW'), true);
  assert.equal(canMutateJob('IN_PROGRESS'), true);

  for (const status of TERMINAL_JOB_STATUSES) {
    assert.equal(canMutateJob(status), false);
  }

  assert.equal(canMutateJob('UNSUPPORTED_STATUS'), false);
  assert.equal(canMutateJob(null), false);
  assert.equal(canMutateJob(undefined), false);
});

test('operational transitions allow forward progress and cancellation only', () => {
  assert.equal(canTransitionJobStatus('NEW', 'DISPATCHED'), true);
  assert.equal(canTransitionJobStatus('DISPATCHED', 'ON_SITE'), true);
  assert.equal(canTransitionJobStatus('ON_SITE', 'IN_PROGRESS'), true);
  assert.equal(canTransitionJobStatus('IN_PROGRESS', 'CANCELLED'), true);
  assert.equal(canTransitionJobStatus('IN_PROGRESS', 'DISPATCHED'), false);
  assert.equal(canTransitionJobStatus('CANCELLED', 'NEW'), false);
  assert.equal(canTransitionJobStatus('UNKNOWN', 'NEW'), false);
});

test('financial terminal targets are never generic status transitions', () => {
  for (const status of FINANCIAL_TERMINAL_JOB_STATUSES) {
    assert.equal(canTransitionJobStatus('IN_PROGRESS', status), false);
    assert.equal(canTransitionJobStatus('NEW', status), false);
  }

  // Same-status operational requests are safe no-ops for callers that avoid
  // repeating side effects.
  assert.equal(canTransitionJobStatus('IN_PROGRESS', 'IN_PROGRESS'), true);
});
