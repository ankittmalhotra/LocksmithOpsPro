import { Prisma } from '@prisma/client';
import { calculatePartnerBilling } from '@/lib/accounting';
import { calculateOperationalPeriodSnapshotFromJobs, centsToDecimal, decimalToCents } from '@/lib/books-api';
import { jobDetailsInclude } from '@/lib/job-helper';

export type PartnerBillingSnapshotRefreshCause =
  | 'JOB_CLOSEOUT'
  | 'MANUAL_JOB_CREATED'
  | 'MANUAL_JOB_UPDATED'
  | 'MANUAL_JOB_DELETED'
  | 'MANUAL_SNAPSHOT_EDIT'
  | 'JOB_DELETED'
  | 'STRIPE_PAYMENT_STATUS_CHANGED';

/**
 * Rebuild every still-unissued partner period from the same paid-job source,
 * formula, and Toronto activity-date rules used when snapshots are created.
 * Call inside the transaction that changed the revenue input, so the source
 * write, recalculated snapshots, and audit events commit or roll back together.
 */
export async function refreshUnissuedPartnerBillingSnapshots(
  tx: Prisma.TransactionClient,
  actorId: string,
  cause: PartnerBillingSnapshotRefreshCause,
  options: { preservePeriodId?: string; startPeriodId?: string } = {},
) {
  const recipient = await tx.accountingEntity.findUnique({ where: { code: 'LOCKSMITH' }, select: { id: true } });
  const issuer = await tx.accountingEntity.findUnique({ where: { code: 'IT_MARKETING' }, select: { id: true } });
  if (!recipient || !issuer) return { updatedCount: 0 };

  // The issuer row is a shared serialization point for refreshes and period
  // creation, including the window before a new period row exists.
  await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AccountingEntity" WHERE "id" = ${issuer.id} FOR UPDATE`;

  // A shared ordered row lock serializes concurrent revenue changes before
  // reading source jobs. At READ COMMITTED, the second transaction then sees
  // the first one's committed job update and cannot publish a stale sum.
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "PartnerBillingPeriod"
    WHERE "recipientEntityId" = ${recipient.id}
      AND "issuerEntityId" = ${issuer.id}
      AND "status" IN ('OPEN', 'CARRIED_FORWARD')
    ORDER BY "periodStart" ASC, "id" ASC
    FOR UPDATE
  `;

  const periods = await tx.partnerBillingPeriod.findMany({
    where: { recipientEntityId: recipient.id, issuerEntityId: issuer.id },
    include: { invoice: { select: { id: true } } },
    orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
  });
  if (periods.length === 0) return { updatedCount: 0 };

  const jobs = await tx.job.findMany({ orderBy: { createdAt: 'asc' }, include: jobDetailsInclude });
  let priorNegativeCarryForwardCents = 0;
  let updatedCount = 0;
  let inSuffix = !options.startPeriodId;

  for (const period of periods) {
    if (!inSuffix && period.id === options.startPeriodId) inSuffix = true;
    if (!inSuffix) {
      priorNegativeCarryForwardCents = decimalToCents(period.negativeCarryForward);
      continue;
    }
    // Issued snapshots are a frozen accounting record. Their carry value is
    // still an input to each later period, so keep it exactly as issued.
    if (period.invoice || period.status === 'INVOICED') {
      priorNegativeCarryForwardCents = decimalToCents(period.negativeCarryForward);
      continue;
    }
    if (period.id === options.preservePeriodId) {
      // Admin's explicit values are retained for this save. The remaining
      // unissued suffix still recalculates from that manually saved carry.
      priorNegativeCarryForwardCents = decimalToCents(period.negativeCarryForward);
      continue;
    }

    const periodStart = period.periodStart.toISOString().slice(0, 10);
    const periodEnd = period.periodEnd.toISOString().slice(0, 10);
    const source = calculateOperationalPeriodSnapshotFromJobs(periodStart, periodEnd, jobs);
    const calculation = calculatePartnerBilling({
      revenueCents: source.revenueCents,
      hstDeductedCents: source.hstCents,
      cogsCents: source.cogsCents,
      technicianCommissionsCents: source.commissionCents,
      priorNegativeCarryForwardCents,
    });
    const status: 'OPEN' | 'CARRIED_FORWARD' = calculation.negativeCarryForwardCents > 0 ? 'CARRIED_FORWARD' : 'OPEN';
    const sourceSnapshot = {
      formula: 'Revenue - HST - COGS - technician commissions',
      periodStart,
      periodEnd,
      contributions: source.contributions,
    } as Prisma.InputJsonValue;
    const nextValues = {
      status,
      revenueAmount: centsToDecimal(source.revenueCents),
      hstDeductedAmount: centsToDecimal(source.hstCents),
      cogsAmount: centsToDecimal(source.cogsCents),
      technicianCommissionsAmount: centsToDecimal(source.commissionCents),
      operationalProfitAmount: centsToDecimal(calculation.operationalProfitCents),
      priorNegativeCarryForward: centsToDecimal(calculation.priorNegativeCarryForwardCents),
      adjustedProfitAmount: centsToDecimal(calculation.adjustedProfitCents),
      negativeCarryForward: centsToDecimal(calculation.negativeCarryForwardCents),
      partnerFeeAmount: centsToDecimal(calculation.partnerFeeCents),
      sourceSnapshot,
      calculationNote: calculation.negativeCarryForwardCents > 0
        ? 'Negative adjusted profit carried to the next billing cycle.'
        : null,
    };

    const changed = period.status !== status
      || decimalToCents(period.revenueAmount) !== source.revenueCents
      || decimalToCents(period.hstDeductedAmount) !== source.hstCents
      || decimalToCents(period.cogsAmount) !== source.cogsCents
      || decimalToCents(period.technicianCommissionsAmount) !== source.commissionCents
      || decimalToCents(period.operationalProfitAmount) !== calculation.operationalProfitCents
      || decimalToCents(period.priorNegativeCarryForward) !== calculation.priorNegativeCarryForwardCents
      || decimalToCents(period.adjustedProfitAmount) !== calculation.adjustedProfitCents
      || decimalToCents(period.negativeCarryForward) !== calculation.negativeCarryForwardCents
      || decimalToCents(period.partnerFeeAmount) !== calculation.partnerFeeCents
      || JSON.stringify(period.sourceSnapshot) !== JSON.stringify(sourceSnapshot)
      || period.calculationNote !== nextValues.calculationNote;

    if (changed) {
      // Conditional write is a second guard for invoice issuance that races a
      // refresh. If issuance wins, leave its period untouched and use its
      // persisted carry-forward value for the next unissued period.
      const update = await tx.partnerBillingPeriod.updateMany({
        where: { id: period.id, status: { in: ['OPEN', 'CARRIED_FORWARD'] }, invoice: null },
        data: nextValues,
      });
      if (update.count === 1) {
        updatedCount += 1;
        await tx.accountingAuditEvent.create({
          data: {
            entityId: period.issuerEntityId,
            actorId,
            action: 'UPDATED',
            resourceType: 'PartnerBillingPeriod',
            resourceId: period.id,
            metadata: {
              automatic: true,
              cause,
              periodStart,
              periodEnd,
              revenueAmount: source.revenueCents / 100,
              hstDeductedAmount: source.hstCents / 100,
              cogsAmount: source.cogsCents / 100,
              technicianCommissionsAmount: source.commissionCents / 100,
              priorNegativeCarryForward: calculation.priorNegativeCarryForwardCents / 100,
              partnerFeeAmount: calculation.partnerFeeCents / 100,
            },
          },
        });
        priorNegativeCarryForwardCents = calculation.negativeCarryForwardCents;
        continue;
      }

      const current = await tx.partnerBillingPeriod.findUnique({ where: { id: period.id }, select: { negativeCarryForward: true } });
      priorNegativeCarryForwardCents = decimalToCents(current?.negativeCarryForward);
      continue;
    }

    priorNegativeCarryForwardCents = calculation.negativeCarryForwardCents;
  }

  return { updatedCount };
}
