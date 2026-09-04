import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

export const jobWithDetails = Prisma.validator<Prisma.JobDefaultArgs>()({
  include: {
    customer: true,
    dispatcher: { select: { id: true, name: true, phone: true } },
    technician: { select: { id: true, name: true, phone: true } },
    invoice: true,
    items: true,
  },
});

export type JobWithDetails = Prisma.JobGetPayload<typeof jobWithDetails>;

/**
 * Resolves a job by either its unique UUID string or its integer jobNumber.
 * Fully typed with customer, dispatcher, technician, invoice, and items.
 */
export async function findJobByIdOrNumber(idOrNumber: string): Promise<JobWithDetails | null> {
  const isNumeric = /^\d+$/.test(idOrNumber);

  if (isNumeric) {
    const jobNumber = parseInt(idOrNumber, 10);
    const job = await prisma.job.findUnique({
      where: { jobNumber },
      include: {
        customer: true,
        dispatcher: { select: { id: true, name: true, phone: true } },
        technician: { select: { id: true, name: true, phone: true } },
        invoice: true,
        items: true,
      },
    });
    if (job) return job;
  }

  return prisma.job.findUnique({
    where: { id: idOrNumber },
    include: {
      customer: true,
      dispatcher: { select: { id: true, name: true, phone: true } },
      technician: { select: { id: true, name: true, phone: true } },
      invoice: true,
      items: true,
    },
  });
}
