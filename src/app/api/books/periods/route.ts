import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { calculatePartnerBilling } from '@/lib/accounting';
import { calculateOperationalPeriodSnapshot, centsToDecimal, decimalToCents, isBooksEntityCode, parseCents, periodDates, serializeDecimal } from '@/lib/books-api';
import { formatTorontoDateInput } from '@/lib/timezone';

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
  const snapshot = await calculateOperationalPeriodSnapshot(dates.periodStart, dates.periodEnd);
  const prior = await prisma.partnerBillingPeriod.findFirst({
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
  try {
    return await prisma.$transaction(async (tx) => {
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
    return NextResponse.json({ success: true, periods: periods.map((period) => mapPeriod(period, user?.role === 'DISPATCHER' && code === 'LOCKSMITH')) });
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
    if (period.invoice || period.status === 'INVOICED') return NextResponse.json({ success: false, error: 'Issued snapshots cannot be edited' }, { status: 409 });
    const prior = await prisma.partnerBillingPeriod.findFirst({ where: { recipientEntityId: period.recipientEntityId, periodEnd: { lt: period.periodStart } }, orderBy: { periodEnd: 'desc' }, select: { negativeCarryForward: true } });
    const calculation = calculatePartnerBilling({ revenueCents, hstDeductedCents: hstCents, cogsCents, technicianCommissionsCents: commissionCents, priorNegativeCarryForwardCents: decimalToCents(prior?.negativeCarryForward) });
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.partnerBillingPeriod.update({
        where: { id: period.id },
        data: {
          status: calculation.negativeCarryForwardCents > 0 ? 'CARRIED_FORWARD' : 'OPEN',
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
          sourceSnapshot: { formula: 'Revenue - HST - COGS - technician commissions', periodStart: period.periodStart.toISOString().slice(0, 10), periodEnd: period.periodEnd.toISOString().slice(0, 10), manualOverride: true } as Prisma.InputJsonValue,
          calculationNote: 'Manually adjusted by Admin before invoice issuance.',
        },
        include: { invoice: true, issuerEntity: true, recipientEntity: true },
      });
      await tx.accountingAuditEvent.create({ data: { entityId: period.issuerEntityId, actorId: user.id, action: 'UPDATED', resourceType: 'PartnerBillingPeriod', resourceId: period.id, metadata: { manualOverride: true, revenueAmount: revenueCents / 100, hstDeductedAmount: hstCents / 100, cogsAmount: cogsCents / 100, technicianCommissionsAmount: commissionCents / 100 } } });
      return saved;
    });
    return NextResponse.json({ success: true, period: mapPeriod(updated) });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/periods', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to update billing snapshot') }, { status: 400 });
  }
}

export const GET = withRequestLogging('/api/books/periods', handleGET);
export const POST = withRequestLogging('/api/books/periods', handlePOST);
export const PATCH = withRequestLogging('/api/books/periods', handlePATCH);
