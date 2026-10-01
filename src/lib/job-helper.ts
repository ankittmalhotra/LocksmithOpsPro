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
// explicit fallback below is intentionally limited to additive Job columns so
// an older production database can still boot while one-time migrations are
// being applied.
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

function isMissingJobCompatibilityColumnError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === 'P2022' && /(updatedAt|jobReceivedTimeSlot|intakeMessage)/i.test(candidate.message || '');
}

function normalizeLegacyJob<T extends { createdAt: Date }>(job: T) {
  return {
    ...job,
    // The fallback is only used while additive production columns are being
    // applied. Missing optional values are null for these legacy rows.
    updatedAt: job.createdAt,
    jobReceivedTimeSlot: null,
    intakeMessage: null,
  };
}

function isMissingSettlementTableError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === 'P2021' && /settlement/i.test(candidate.message || '');
}

type JobReadArgs = {
  where?: Prisma.JobWhereInput;
  orderBy?: Prisma.JobOrderByWithRelationInput | Prisma.JobOrderByWithRelationInput[];
};

/**
 * Reads jobs using the current schema and falls back only when an additive
 * compatibility column is missing. The fallback aliases createdAt as
 * updatedAt so older records remain readable while migrations are applied.
 */
export async function findJobsWithDetails(args: JobReadArgs = {}) {
  try {
    return await prisma.job.findMany({ ...args, include: jobDetailsInclude });
  } catch (error) {
    if (!isMissingJobCompatibilityColumnError(error)) throw error;

    const legacyJobs = await prisma.job.findMany({ ...args, select: legacyJobSelect });
    return legacyJobs.map(normalizeLegacyJob);
  }
}

/**
 * Loads technicians for the admin ledger.  Settlement was part of the
 * original schema, but an older database may not have that table yet; in
 * that case the ledger remains usable with zero prior handovers.
 */
export async function findTechniciansWithSettlements() {
  try {
    return await prisma.user.findMany({
      where: { role: 'TECHNICIAN' },
      include: { settlements: true },
    });
  } catch (error) {
    if (!isMissingSettlementTableError(error)) throw error;
    const technicians = await prisma.user.findMany({ where: { role: 'TECHNICIAN' } });
    return technicians.map((technician) => ({ ...technician, settlements: [] }));
  }
}

export type JobWithDetails = Prisma.JobGetPayload<typeof jobWithDetails>;

/** Omit the dispatcher-only source message from job payloads for technicians. */
export function toTechnicianJobPayload<T extends { intakeMessage?: string | null }>(job: T): Omit<T, 'intakeMessage'> {
  const { intakeMessage: _intakeMessage, ...technicianJob } = job;
  return technicianJob;
}

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
      if (!isMissingJobCompatibilityColumnError(error)) throw error;
      const job = await prisma.job.findUnique({ where: { jobNumber: idOrNumber }, select: legacyJobSelect });
      if (job) return normalizeManualJobInvoice(normalizeLegacyJob(job) as JobWithDetails);
    }
  }

  try {
    const job = await prisma.job.findUnique({ where: { id: idOrNumber }, include: jobDetailsInclude });
    return job ? normalizeManualJobInvoice(job as JobWithDetails) : null;
  } catch (error) {
    if (!isMissingJobCompatibilityColumnError(error)) throw error;
    const job = await prisma.job.findUnique({ where: { id: idOrNumber }, select: legacyJobSelect });
    return job ? normalizeManualJobInvoice(normalizeLegacyJob(job) as JobWithDetails) : null;
  }
}
