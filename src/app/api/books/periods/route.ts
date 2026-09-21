import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { calculatePartnerBilling } from '@/lib/accounting';
import { calculateOperationalPeriodSnapshot, centsToDecimal, decimalToCents, isBooksEntityCode, periodDates, serializeDecimal } from '@/lib/books-api';
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

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    const requested = new URL(request.url).searchParams.get('entityCode');
    const code = isBooksEntityCode(requested) ? requested : user?.role === 'DISPATCHER' ? 'LOCKSMITH' : 'IT_MARKETING';
    const access = await getAccountingEntityAccess(code, user);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
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
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    const body = await request.json();
    const dates = periodDates(body.periodStart || '2026-09-07', body.periodEnd);
    if (dates.periodEnd >= formatTorontoDateInput(new Date())) {
      return NextResponse.json({ success: false, error: 'A billing period must be complete before it can be snapshotted' }, { status: 409 });
    }
    const [issuer, recipient] = await Promise.all([
      prisma.accountingEntity.findUnique({ where: { code: 'IT_MARKETING' } }),
      prisma.accountingEntity.findUnique({ where: { code: 'LOCKSMITH' } }),
    ]);
    if (!issuer || !recipient) return NextResponse.json({ success: false, error: 'Books entities are not configured' }, { status: 503 });
    const latestPeriod = await prisma.partnerBillingPeriod.findFirst({
      where: { recipientEntityId: recipient.id },
      orderBy: { periodEnd: 'desc' },
      select: { periodEnd: true },
    });
    const expectedStart = latestPeriod
      ? new Date(latestPeriod.periodEnd.getTime() + 86_400_000).toISOString().slice(0, 10)
      : '2026-09-07';
    if (dates.periodStart !== expectedStart) {
      return NextResponse.json({ success: false, error: `The next billing period must begin on ${expectedStart}` }, { status: 409 });
    }
    const snapshot = await calculateOperationalPeriodSnapshot(dates.periodStart, dates.periodEnd);
    const prior = await prisma.partnerBillingPeriod.findFirst({ where: { recipientEntityId: recipient.id, periodEnd: { lt: new Date(`${dates.periodStart}T00:00:00.000Z`) } }, orderBy: { periodEnd: 'desc' }, select: { negativeCarryForward: true } });
    const calculation = calculatePartnerBilling({ revenueCents: snapshot.revenueCents, hstDeductedCents: snapshot.hstCents, cogsCents: snapshot.cogsCents, technicianCommissionsCents: snapshot.commissionCents, priorNegativeCarryForwardCents: decimalToCents(prior?.negativeCarryForward) });
    const period = await prisma.$transaction(async (tx) => {
      const created = await tx.partnerBillingPeriod.create({
        data: {
        issuerEntityId: issuer.id, recipientEntityId: recipient.id,
        periodStart: new Date(`${dates.periodStart}T00:00:00.000Z`), periodEnd: new Date(`${dates.periodEnd}T00:00:00.000Z`),
        status: calculation.negativeCarryForwardCents > 0 ? 'CARRIED_FORWARD' : 'OPEN',
        revenueAmount: centsToDecimal(snapshot.revenueCents), hstDeductedAmount: centsToDecimal(snapshot.hstCents), cogsAmount: centsToDecimal(snapshot.cogsCents), technicianCommissionsAmount: centsToDecimal(snapshot.commissionCents), operationalProfitAmount: centsToDecimal(calculation.operationalProfitCents),
        priorNegativeCarryForward: centsToDecimal(calculation.priorNegativeCarryForwardCents), adjustedProfitAmount: centsToDecimal(calculation.adjustedProfitCents), negativeCarryForward: centsToDecimal(calculation.negativeCarryForwardCents), shareRate: new Prisma.Decimal(0.5), partnerFeeAmount: centsToDecimal(calculation.partnerFeeCents), hstRate: new Prisma.Decimal(0), hstAmount: centsToDecimal(0),
        sourceSnapshot: { formula: 'Revenue - HST - COGS - technician commissions', periodStart: dates.periodStart, periodEnd: dates.periodEnd, contributions: snapshot.contributions } as Prisma.InputJsonValue,
        calculationNote: calculation.negativeCarryForwardCents > 0 ? 'Negative adjusted profit carried to the next billing cycle.' : null,
        createdById: user.id,
        }, include: { invoice: true, issuerEntity: true, recipientEntity: true },
      });
      await tx.accountingAuditEvent.create({ data: { entityId: issuer.id, actorId: user.id, action: 'CREATED', resourceType: 'PartnerBillingPeriod', resourceId: created.id, metadata: { periodStart: dates.periodStart, periodEnd: dates.periodEnd } } });
      return created;
    });
    return NextResponse.json({ success: true, period: mapPeriod(period) }, { status: 201 });
  } catch (error: any) {
    const status = error?.code === 'P2002' ? 409 : 400;
    logCaughtRequestError(request, '/api/books/periods', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to create billing period') }, { status });
  }
}

export const GET = withRequestLogging('/api/books/periods', handleGET);
export const POST = withRequestLogging('/api/books/periods', handlePOST);
