import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { normalizeManualJobInvoice } from './manual-job';

export const jobWithDetails = Prisma.validator<Prisma.JobDefaultArgs>()({
  include: {
    customer: true,
    dispatcher: { select: { id: true, name: true, phone: true } },
    technician: { select: { id: true, name: true, phone: true } },
    invoice: true,
    items: true,
  },
});

// Keep one shared include shape for list, analytics, and detail reads.  The
// explicit fallback below is intentionally limited to the additive
// Job.updatedAt migration so an older production database can still boot
// while that one-time migration is being applied.
export const jobDetailsInclude = {
  customer: true,
  dispatcher: { select: { id: true, name: true, phone: true } },
  technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
  invoice: true,
  items: true,
} as const;

const legacyJobSelect = {
  id: true,
  jobNumber: true,
  customerId: true,
  dispatcherId: true,
  technicianId: true,
  technicianName: true,
  status: true,
  isManual: true,
  serviceType: true,
  problemDescription: true,
  serviceAddress: true,
  workerCommissionRate: true,
  workerCommission: true,
  isAbandoned: true,
  travelFeeAmount: true,
  keyBitting: true,
  doorDetails: true,
  proofPhotoUrl: true,
  preWorkSignature: true,
  customerSignature: true,
  vehicleYear: true,
  vehicleMake: true,
  vehicleModel: true,
  vehicleVin: true,
  keyType: true,
  fccId: true,
  isScheduled: true,
  scheduledFor: true,
  createdAt: true,
  dispatchedAt: true,
  completedAt: true,
  customer: true,
  dispatcher: { select: { id: true, name: true, phone: true } },
  technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
  invoice: true,
  items: true,
} as const;

function isMissingUpdatedAtError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === 'P2022' && /updatedAt/i.test(candidate.message || '');
}

type JobReadArgs = {
  where?: Prisma.JobWhereInput;
  orderBy?: Prisma.JobOrderByWithRelationInput | Prisma.JobOrderByWithRelationInput[];
};

/**
 * Reads jobs using the current schema and falls back only when the additive
 * updatedAt column is missing.  The fallback aliases createdAt as updatedAt
 * so older records remain readable; applying the migration restores true
 * optimistic-concurrency timestamps for edits.
 */
export async function findJobsWithDetails(args: JobReadArgs = {}) {
  try {
    return await prisma.job.findMany({ ...args, include: jobDetailsInclude });
  } catch (error) {
    if (!isMissingUpdatedAtError(error)) throw error;

    const legacyJobs = await prisma.job.findMany({ ...args, select: legacyJobSelect });
    return legacyJobs.map((job) => ({ ...job, updatedAt: job.createdAt }));
  }
}

export type JobWithDetails = Prisma.JobGetPayload<typeof jobWithDetails>;

/**
 * Resolves a job by either its unique UUID string or its string jobNumber.
 * Fully typed with customer, dispatcher, technician, invoice, and items.
 */
export async function findJobByIdOrNumber(idOrNumber: string): Promise<JobWithDetails | null> {
  const isNumeric = /^\d+$/.test(idOrNumber);

  if (isNumeric) {
    try {
      const job = await prisma.job.findUnique({ where: { jobNumber: idOrNumber }, include: jobDetailsInclude });
      if (job) return normalizeManualJobInvoice(job as JobWithDetails);
    } catch (error) {
      if (!isMissingUpdatedAtError(error)) throw error;
      const job = await prisma.job.findUnique({ where: { jobNumber: idOrNumber }, select: legacyJobSelect });
      if (job) return normalizeManualJobInvoice({ ...job, updatedAt: job.createdAt } as JobWithDetails);
    }
  }

  try {
    const job = await prisma.job.findUnique({ where: { id: idOrNumber }, include: jobDetailsInclude });
    return job ? normalizeManualJobInvoice(job as JobWithDetails) : null;
  } catch (error) {
    if (!isMissingUpdatedAtError(error)) throw error;
    const job = await prisma.job.findUnique({ where: { id: idOrNumber }, select: legacyJobSelect });
    return job ? normalizeManualJobInvoice({ ...job, updatedAt: job.createdAt } as JobWithDetails) : null;
  }
}
