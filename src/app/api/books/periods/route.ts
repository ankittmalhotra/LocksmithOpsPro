import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { calculatePartnerBilling, getPartnerBillingPeriod } from '@/lib/accounting';
import { calculateOperationalPeriodSnapshot, centsToDecimal, decimalToCents, isBooksEntityCode, parseCents, periodDates, serializeDecimal } from '@/lib/books-api';
import { formatTorontoDateInput } from '@/lib/timezone';
import { refreshUnissuedPartnerBillingSnapshots } from '@/lib/partner-billing-snapshot-refresh';

class ManualSnapshotConflictError extends Error {}

function mapPeriod(period: any, redactIssuer = false) {
  const { issuerEntity, invoice, sourceSnapshot, ...safePeriod } = period;
  const safeInvoice = invoice ? (() => {
    const { issuerEntity: invoiceIssuerEntity, issuerSnapshot, ...invoiceWithoutIssuer } = invoice;
    return {
      ...invoiceWithoutIssuer,
      ...(redactIssuer ? {} : { issuerEntity: invoiceIssuerEntity, issuerSnapshot }),
      serviceAmount: serializeDecimal(invoice.serviceAmount),
      hstAmount: serializeDecimal(invoice.hstAmount),
      totalAmount: serializeDecimal(invoice.totalAmount),
      hstRate: Number(invoice.hstRate),
    };
  })() : null;
  return {
    ...safePeriod,
    ...(redactIssuer ? {} : { issuerEntity, sourceSnapshot }),
    revenueAmount: serializeDecimal(period.revenueAmount), hstDeductedAmount: serializeDecimal(period.hstDeductedAmount),
    cogsAmount: serializeDecimal(period.cogsAmount), technicianCommissionsAmount: serializeDecimal(period.technicianCommissionsAmount),
    operationalProfitAmount: serializeDecimal(period.operationalProfitAmount), priorNegativeCarryForward: serializeDecimal(period.priorNegativeCarryForward),
    adjustedProfitAmount: serializeDecimal(period.adjustedProfitAmount), negativeCarryForward: serializeDecimal(period.negativeCarryForward),
    shareRate: Number(period.shareRate), partnerFeeAmount: serializeDecimal(period.partnerFeeAmount), hstRate: Number(period.hstRate), hstAmount: serializeDecimal(period.hstAmount),
    invoice: safeInvoice,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002');
}

async function createPartnerBillingSnapshot(userId: string, periodStart: string, issuer: any, recipient: any) {
  const dates = periodDates(periodStart);
  try {
    return await prisma.$transaction(async (tx) => {
      // Match the revenue-change refresh lock so period materialization cannot
      // race and publish a stale snapshot or carry-forward dependency.
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AccountingEntity" WHERE "id" = ${issuer.id} FOR UPDATE`;
      const snapshot = await calculateOperationalPeriodSnapshot(dates.periodStart, dates.periodEnd, tx);
      const prior = await tx.partnerBillingPeriod.findFirst({
        where: { recipientEntityId: recipient.id, periodEnd: { lt: new Date(`${dates.periodStart}T00:00:00.000Z`) } },
        orderBy: { periodEnd: 'desc' },
        select: { negativeCarryForward: true },
      });
      const calculation = calculatePartnerBilling({
        revenueCents: snapshot.revenueCents,
        hstDeductedCents: snapshot.hstCents,
        cogsCents: snapshot.cogsCents,
        technicianCommissionsCents: snapshot.commissionCents,
        priorNegativeCarryForwardCents: decimalToCents(prior?.negativeCarryForward),
      });
      const created = await tx.partnerBillingPeriod.create({
        data: {
          issuerEntityId: issuer.id,
          recipientEntityId: recipient.id,
          periodStart: new Date(`${dates.periodStart}T00:00:00.000Z`),
          periodEnd: new Date(`${dates.periodEnd}T00:00:00.000Z`),
          status: calculation.negativeCarryForwardCents > 0 ? 'CARRIED_FORWARD' : 'OPEN',
          revenueAmount: centsToDecimal(snapshot.revenueCents),
          hstDeductedAmount: centsToDecimal(snapshot.hstCents),
          cogsAmount: centsToDecimal(snapshot.cogsCents),
          technicianCommissionsAmount: centsToDecimal(snapshot.commissionCents),
          operationalProfitAmount: centsToDecimal(calculation.operationalProfitCents),
          priorNegativeCarryForward: centsToDecimal(calculation.priorNegativeCarryForwardCents),
          adjustedProfitAmount: centsToDecimal(calculation.adjustedProfitCents),
          negativeCarryForward: centsToDecimal(calculation.negativeCarryForwardCents),
          shareRate: new Prisma.Decimal(0.5),
          partnerFeeAmount: centsToDecimal(calculation.partnerFeeCents),
          hstRate: new Prisma.Decimal(0),
          hstAmount: centsToDecimal(0),
          sourceSnapshot: { formula: 'Revenue - HST - COGS - technician commissions', periodStart: dates.periodStart, periodEnd: dates.periodEnd, contributions: snapshot.contributions } as Prisma.InputJsonValue,
          calculationNote: calculation.negativeCarryForwardCents > 0 ? 'Negative adjusted profit carried to the next billing cycle.' : null,
          createdById: userId,
        },
        include: { invoice: true, issuerEntity: true, recipientEntity: true },
      });
      await tx.accountingAuditEvent.create({
        data: {
          entityId: issuer.id,
          actorId: userId,
          action: 'CREATED',
          resourceType: 'PartnerBillingPeriod',
          resourceId: created.id,
          metadata: { periodStart: dates.periodStart, periodEnd: dates.periodEnd, automatic: true },
        },
      });
      return created;
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return prisma.partnerBillingPeriod.findFirst({
      where: { recipientEntityId: recipient.id, periodStart: new Date(`${dates.periodStart}T00:00:00.000Z`), periodEnd: new Date(`${dates.periodEnd}T00:00:00.000Z`) },
      include: { invoice: true, issuerEntity: true, recipientEntity: true },
    });
  }
}

/** Materialize every completed anchored period before Books is displayed. */
async function ensureCompletedPartnerBillingPeriods(userId: string) {
  const [issuer, recipient] = await Promise.all([
    prisma.accountingEntity.findUnique({ where: { code: 'IT_MARKETING' } }),
    prisma.accountingEntity.findUnique({ where: { code: 'LOCKSMITH' } }),
  ]);
  if (!issuer || !recipient) return;
  const latest = await prisma.partnerBillingPeriod.findFirst({ where: { recipientEntityId: recipient.id }, orderBy: { periodEnd: 'desc' }, select: { periodEnd: true } });
  let nextStart = latest ? new Date(latest.periodEnd.getTime() + 86_400_000).toISOString().slice(0, 10) : '2026-09-07';
  const today = formatTorontoDateInput(new Date());
  while (periodDates(nextStart).periodEnd < today) {
    const created = await createPartnerBillingSnapshot(userId, nextStart, issuer, recipient);
    if (!created) break;
    const followingStart = new Date(`${periodDates(nextStart).periodEnd}T00:00:00.000Z`);
    followingStart.setUTCDate(followingStart.getUTCDate() + 1);
    nextStart = followingStart.toISOString().slice(0, 10);
  }
}

/**
 * Calculate the live, still-open partner share without creating a Books
 * snapshot. The card on the Books dashboard uses this so it reflects the
 * current operating period rather than only previously issued invoices.
 */
async function calculateCurrentPartnerPeriod() {
  const today = formatTorontoDateInput(new Date());
  let dates;
  try {
    dates = periodDates(getPartnerBillingPeriod(today).periodStart);
  } catch {
    // The portal should remain usable before the configured billing anchor.
    return null;
  }

  const [issuer, recipient] = await Promise.all([
    prisma.accountingEntity.findUnique({ where: { code: 'IT_MARKETING' } }),
    prisma.accountingEntity.findUnique({ where: { code: 'LOCKSMITH' } }),
  ]);
  if (!issuer || !recipient) return null;

  const [snapshot, prior] = await Promise.all([
    calculateOperationalPeriodSnapshot(dates.periodStart, dates.periodEnd),
    prisma.partnerBillingPeriod.findFirst({
      where: { recipientEntityId: recipient.id, periodEnd: { lt: new Date(`${dates.periodStart}T00:00:00.000Z`) } },
      orderBy: { periodEnd: 'desc' },
      select: { negativeCarryForward: true },
    }),
  ]);
  const hstRateBps = issuer.hstEnabled && issuer.hstRegistrationNumber && issuer.hstEffectiveDate && issuer.hstEffectiveDate.toISOString().slice(0, 10) <= today ? 1_300 : 0;
  const calculation = calculatePartnerBilling({
    revenueCents: snapshot.revenueCents,
    hstDeductedCents: snapshot.hstCents,
    cogsCents: snapshot.cogsCents,
    technicianCommissionsCents: snapshot.commissionCents,
    priorNegativeCarryForwardCents: decimalToCents(prior?.negativeCarryForward),
    hstRateBps,
  });

  return {
    periodStart: dates.periodStart,
    periodEnd: dates.periodEnd,
    revenueAmount: snapshot.revenueCents / 100,
    hstDeductedAmount: snapshot.hstCents / 100,
    cogsAmount: snapshot.cogsCents / 100,
    technicianCommissionsAmount: snapshot.commissionCents / 100,
    operationalProfitAmount: calculation.operationalProfitCents / 100,
    priorNegativeCarryForward: calculation.priorNegativeCarryForwardCents / 100,
    adjustedProfitAmount: calculation.adjustedProfitCents / 100,
    negativeCarryForward: calculation.negativeCarryForwardCents / 100,
    shareRate: 0.5,
    hstRate: hstRateBps / 10_000,
    partnerFeeAmount: calculation.partnerFeeCents / 100,
    hstAmount: calculation.hstCents / 100,
    invoiceTotalAmount: calculation.invoiceTotalCents / 100,
    contributionCount: snapshot.contributions.length,
  };
}

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    const requested = new URL(request.url).searchParams.get('entityCode');
    const code = isBooksEntityCode(requested) ? requested : user?.role === 'DISPATCHER' ? 'LOCKSMITH' : 'IT_MARKETING';
    const access = await getAccountingEntityAccess(code, user);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    if (code === 'IT_MARKETING' && user?.role === 'ADMIN') await ensureCompletedPartnerBillingPeriods(user.id);
    const locksmith = code === 'LOCKSMITH';
    const periods = await prisma.partnerBillingPeriod.findMany({
      where: locksmith ? { recipientEntityId: access.entity.id } : { issuerEntityId: access.entity.id },
      include: { invoice: true, issuerEntity: true, recipientEntity: true },
      orderBy: { periodStart: 'desc' },
    });
    const currentPeriod = await calculateCurrentPartnerPeriod();
    return NextResponse.json({ success: true, periods: periods.map((period) => mapPeriod(period, user?.role === 'DISPATCHER' && code === 'LOCKSMITH')), currentPeriod });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/periods', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load billing periods') }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  return NextResponse.json({ success: false, error: 'Billing snapshots are created automatically when a period closes' }, { status: 405 });
}

async function handlePATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    const body = await request.json();
    if (body?.entityCode !== 'IT_MARKETING') return NextResponse.json({ success: false, error: 'Only IT & Marketing snapshots can be edited' }, { status: 400 });
    if (typeof body?.periodId !== 'string' || !body.periodId) return NextResponse.json({ success: false, error: 'periodId is required' }, { status: 400 });
    const [revenueCents, hstCents, cogsCents, commissionCents] = [
      parseCents(body.revenueAmount, 'revenueAmount'),
      parseCents(body.hstDeductedAmount, 'hstDeductedAmount'),
      parseCents(body.cogsAmount, 'cogsAmount'),
      parseCents(body.technicianCommissionsAmount, 'technicianCommissionsAmount'),
    ];
    const period = await prisma.partnerBillingPeriod.findFirst({
      where: { id: body.periodId, issuerEntity: { code: 'IT_MARKETING' }, recipientEntity: { code: 'LOCKSMITH' } },
      include: { invoice: true, issuerEntity: true, recipientEntity: true },
    });
    if (!period) return NextResponse.json({ success: false, error: 'Billing period not found' }, { status: 404 });
    const updated = await prisma.$transaction(async (tx) => {
      // Every writer takes issuer then period. This prevents deadlocks with
      // revenue refresh and invoice issuance, and keeps carry values current.
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AccountingEntity" WHERE "id" = ${period.issuerEntityId} FOR UPDATE`;
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PartnerBillingPeriod" WHERE "id" = ${period.id} FOR UPDATE`;
      const current = await tx.partnerBillingPeriod.findFirst({
        where: { id: period.id, issuerEntity: { code: 'IT_MARKETING' }, recipientEntity: { code: 'LOCKSMITH' } },
        include: { invoice: true, issuerEntity: true, recipientEntity: true },
      });
      if (!current) throw new ManualSnapshotConflictError('Billing period not found. Reload the Billing page.');
      if (current.invoice || current.status === 'INVOICED') throw new ManualSnapshotConflictError('Issued snapshots cannot be edited.');
      const prior = await tx.partnerBillingPeriod.findFirst({ where: { recipientEntityId: current.recipientEntityId, periodEnd: { lt: current.periodStart } }, orderBy: { periodEnd: 'desc' }, select: { negativeCarryForward: true } });
      const calculation = calculatePartnerBilling({ revenueCents, hstDeductedCents: hstCents, cogsCents, technicianCommissionsCents: commissionCents, priorNegativeCarryForwardCents: decimalToCents(prior?.negativeCarryForward) });
      const manualData = {
          status: calculation.negativeCarryForwardCents > 0 ? 'CARRIED_FORWARD' as const : 'OPEN' as const,
          revenueAmount: centsToDecimal(revenueCents),
          hstDeductedAmount: centsToDecimal(hstCents),
          cogsAmount: centsToDecimal(cogsCents),
          technicianCommissionsAmount: centsToDecimal(commissionCents),
          operationalProfitAmount: centsToDecimal(calculation.operationalProfitCents),
          priorNegativeCarryForward: centsToDecimal(calculation.priorNegativeCarryForwardCents),
          adjustedProfitAmount: centsToDecimal(calculation.adjustedProfitCents),
          negativeCarryForward: centsToDecimal(calculation.negativeCarryForwardCents),
          partnerFeeAmount: centsToDecimal(calculation.partnerFeeCents),
          hstRate: new Prisma.Decimal(0),
          hstAmount: centsToDecimal(0),
          sourceSnapshot: { formula: 'Revenue - HST - COGS - technician commissions', periodStart: current.periodStart.toISOString().slice(0, 10), periodEnd: current.periodEnd.toISOString().slice(0, 10), manualOverride: true } as Prisma.InputJsonValue,
          calculationNote: 'Manually adjusted by Admin before invoice issuance.',
      };
      const savedCount = await tx.partnerBillingPeriod.updateMany({
        where: { id: current.id, status: { in: ['OPEN', 'CARRIED_FORWARD'] }, invoice: null },
        data: manualData,
      });
      if (savedCount.count !== 1) throw new ManualSnapshotConflictError('Billing period was issued while it was being edited. Reload the Billing page.');
      const saved = await tx.partnerBillingPeriod.findUnique({
        where: { id: current.id },
        include: { invoice: true, issuerEntity: true, recipientEntity: true },
      });
      if (!saved) throw new ManualSnapshotConflictError('Billing period could not be reloaded after editing.');
      await tx.accountingAuditEvent.create({ data: { entityId: current.issuerEntityId, actorId: user.id, action: 'UPDATED', resourceType: 'PartnerBillingPeriod', resourceId: current.id, metadata: { manualOverride: true, revenueAmount: revenueCents / 100, hstDeductedAmount: hstCents / 100, cogsAmount: cogsCents / 100, technicianCommissionsAmount: commissionCents / 100 } } });
      await refreshUnissuedPartnerBillingSnapshots(tx, user.id, 'MANUAL_SNAPSHOT_EDIT', { preservePeriodId: current.id, startPeriodId: current.id });
      return saved;
    });
    return NextResponse.json({ success: true, period: mapPeriod(updated) });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/periods', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to update billing snapshot') }, { status: error instanceof ManualSnapshotConflictError ? 409 : 400 });
  }
}

export const GET = withRequestLogging('/api/books/periods', handleGET);
export const POST = withRequestLogging('/api/books/periods', handlePOST);
export const PATCH = withRequestLogging('/api/books/periods', handlePATCH);
