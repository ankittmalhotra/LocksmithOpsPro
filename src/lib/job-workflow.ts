import type { JobStatus } from '@prisma/client';

/**
 * Statuses that represent a job which has been closed and must not be edited
 * through an open-job mutation route.
 *
 * Keep this list aligned with the Prisma JobStatus enum.  It is intentionally
 * kept in a pure module so API routes and tests can share the same rule
 * without touching the database or request/session code.
 */
export const TERMINAL_JOB_STATUSES = [
  'ABANDONED_TRAVEL_FEE',
  'INVOICED',
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly JobStatus[];

const KNOWN_JOB_STATUSES = [
  'NEW',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'ABANDONED_TRAVEL_FEE',
  'INVOICED',
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly JobStatus[];

/**
 * Operational statuses are the only statuses that the generic job/status
 * routes may write.  Financial closeout statuses are owned by their
 * dedicated closeout endpoints so that invoice/commission data cannot be
 * bypassed with a plain status update.
 */
export const OPEN_JOB_STATUSES = [
  'NEW',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
] as const satisfies readonly JobStatus[];

export const FINANCIAL_TERMINAL_JOB_STATUSES = [
  'ABANDONED_TRAVEL_FEE',
  'INVOICED',
  'COMPLETED',
] as const satisfies readonly JobStatus[];

/**
 * Keeps an explicitly cleared technician assignment compatible with the
 * nullable Prisma relation.  Empty strings are not valid foreign keys and
 * would otherwise become a database error instead of an unassigned job.
 */
export function normalizeTechnicianId(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

/**
 * Claim predicate shared by both closeout endpoints.  Including the
 * technician assignment prevents a stale closeout request from completing a
 * job after a dispatcher has reassigned it.
 */
export function buildJobCloseoutClaimWhere(job: {
  id: string;
  status: JobStatus;
  workerCommissionRate: number;
  technicianId: string | null;
}) {
  return {
    id: job.id,
    status: job.status,
    workerCommissionRate: job.workerCommissionRate,
    technicianId: job.technicianId,
  };
}

/**
 * Allowed lifecycle transitions for operational/status mutations.  A
 * same-status transition is intentionally idempotent; callers must avoid
 * repeating side effects (for example, notification sends) for those no-op
 * requests.
 */
export const JOB_STATUS_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  // Cancellation is retained as a legacy terminal enum value, but new
  // requests must use the dedicated abandonment/financial closeout flow.
  NEW: ['NEW', 'DISPATCHED'],
  DISPATCHED: ['DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'],
  EN_ROUTE: ['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'],
  ON_SITE: ['ON_SITE', 'IN_PROGRESS'],
  IN_PROGRESS: ['IN_PROGRESS'],
  ABANDONED_TRAVEL_FEE: [],
  INVOICED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export function isTerminalJobStatus(
  status: JobStatus | string | null | undefined
): boolean {
  return (
    typeof status === 'string' &&
    (TERMINAL_JOB_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * Returns whether an open-job mutation may proceed for the current status.
 * Unknown/missing statuses fail closed so a malformed or partially migrated
 * record cannot bypass the lifecycle guard.
 */
export function canMutateJob(status: JobStatus | string | null | undefined): boolean {
  return (
    typeof status === 'string' &&
    (KNOWN_JOB_STATUSES as readonly string[]).includes(status) &&
    !isTerminalJobStatus(status)
  );
}

export function isOpenJobStatus(
  status: JobStatus | string | null | undefined
): status is (typeof OPEN_JOB_STATUSES)[number] {
  return (
    typeof status === 'string' &&
    (OPEN_JOB_STATUSES as readonly string[]).includes(status)
  );
}

export function canTransitionJobStatus(
  currentStatus: JobStatus | string | null | undefined,
  nextStatus: JobStatus | string | null | undefined
): nextStatus is JobStatus {
  if (
    typeof currentStatus !== 'string' ||
    typeof nextStatus !== 'string' ||
    !Object.prototype.hasOwnProperty.call(JOB_STATUS_TRANSITIONS, currentStatus)
  ) {
    return false;
  }

  return (JOB_STATUS_TRANSITIONS[currentStatus as JobStatus] as readonly string[]).includes(nextStatus);
}
