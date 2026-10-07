import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess, requirePartnerInvoiceIssuanceAccess } from '@/lib/accounting-auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { ONTARIO_HST_RATE_BPS, buildPartnerInvoiceDescription } from '@/lib/accounting';
import { centsToDecimal, decimalToCents, isBooksEntityCode, parseCents, parseDateOnly, serializeDecimal, toJsonSafe } from '@/lib/books-api';
import { formatTorontoDateInput } from '@/lib/timezone';
import { sendEmail } from '@/lib/resend';
import { buildBooksInvoiceEmail, invoiceRecipientEmail } from '@/lib/accounting-invoice-email';
import { buildAccountingInvoicePdf } from '@/lib/accounting-invoice-pdf';

class BillingSnapshotChangedError extends Error {}

function mapInvoice(invoice: any, redactIssuer = false) {
  const { issuerEntity, issuerSnapshot, ...safeInvoice } = invoice;
  const billingPeriod = invoice.billingPeriod ? (() => {
    const { issuerEntity: periodIssuerEntity, sourceSnapshot, ...safePeriod } = invoice.billingPeriod;
    return {
      ...safePeriod,
      ...(redactIssuer ? {} : { issuerEntity: periodIssuerEntity, sourceSnapshot }),
      revenueAmount: serializeDecimal(invoice.billingPeriod.revenueAmount),
      operationalProfitAmount: serializeDecimal(invoice.billingPeriod.operationalProfitAmount),
      adjustedProfitAmount: serializeDecimal(invoice.billingPeriod.adjustedProfitAmount),
      negativeCarryForward: serializeDecimal(invoice.billingPeriod.negativeCarryForward),
    };
  })() : undefined;
  return {
    ...safeInvoice,
    ...(redactIssuer ? {} : { issuerEntity, issuerSnapshot }),
    serviceAmount: serializeDecimal(invoice.serviceAmount), quantity: serializeDecimal(invoice.quantity || 1), hstAmount: serializeDecimal(invoice.hstAmount), totalAmount: serializeDecimal(invoice.totalAmount), hstRate: Number(invoice.hstRate),
    billingPeriod,
  };
}

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    const requested = new URL(request.url).searchParams.get('entityCode');
    const code = isBooksEntityCode(requested) ? requested : user?.role === 'DISPATCHER' ? 'LOCKSMITH' : 'IT_MARKETING';
    const access = await getAccountingEntityAccess(code, user);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    const invoices = await prisma.partnerInvoice.findMany({
      where: code === 'LOCKSMITH' ? { recipientEntityId: access.entity.id, status: 'ISSUED' } : { issuerEntityId: access.entity.id },
      include: { billingPeriod: true, issuerEntity: true, recipientEntity: true, paymentEvents: { orderBy: { createdAt: 'asc' } }, auditEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const redactIssuer = user?.role === 'DISPATCHER' && code === 'LOCKSMITH';
    return NextResponse.json({ success: true, invoices: invoices.map((invoice) => mapInvoice(invoice, redactIssuer)) });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/invoices', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load invoices') }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    const body = await request.json();
    if (body?.entityCode !== 'IT_MARKETING') return NextResponse.json({ success: false, error: 'Only IT & Marketing can issue invoices' }, { status: 400 });
    const issuer = await requirePartnerInvoiceIssuanceAccess('IT_MARKETING', ONTARIO_HST_RATE_BPS, user);
    // PostgreSQL DATE values are materialized as UTC midnight by Prisma. Keep
    // that value as a calendar date; converting it through Toronto can shift
    // it to the previous day during daylight-saving time.
    if (issuer.entity.hstEffectiveDate
      && issuer.entity.hstEffectiveDate.toISOString().slice(0, 10) > formatTorontoDateInput(new Date())) {
      return NextResponse.json({ success: false, error: 'HST effective date has not started' }, { status: 409 });
    }
    const invoiceKind = body?.invoiceKind === 'CUSTOMER_SERVICE' ? 'CUSTOMER_SERVICE' : 'PARTNER_SERVICE';
    let period: any = null;
    let recipientSnapshot: Prisma.InputJsonValue;
    let serviceCents: number;
    let lineDescription: string;
    let quantity = 1;
    let paymentTerms: string | null = null;
    let notes: string | null = null;

    if (invoiceKind === 'PARTNER_SERVICE') {
      if (typeof body?.billingPeriodId !== 'string' || !body.billingPeriodId) return NextResponse.json({ success: false, error: 'billingPeriodId is required' }, { status: 400 });
      period = await prisma.partnerBillingPeriod.findFirst({ where: { id: body.billingPeriodId, issuerEntityId: issuer.entity.id, recipientEntity: { code: 'LOCKSMITH' } }, include: { invoice: true, recipientEntity: true } });
      if (!period) return NextResponse.json({ success: false, error: 'Billing period not found' }, { status: 404 });
      if (period.invoice) return NextResponse.json({ success: false, error: 'This billing period already has an invoice' }, { status: 409 });
      serviceCents = decimalToCents(period.partnerFeeAmount);
      if (serviceCents <= 0) return NextResponse.json({ success: false, error: 'No invoice is due for a zero or negative adjusted-profit period' }, { status: 409 });
      recipientSnapshot = toJsonSafe(period.recipientEntity);
      lineDescription = buildPartnerInvoiceDescription(serviceCents);
    } else {
      const customer = body?.customer;
      if (!customer || typeof customer.legalName !== 'string' || !customer.legalName.trim()) return NextResponse.json({ success: false, error: 'Customer business name is required' }, { status: 400 });
      if (typeof body?.lineDescription !== 'string' || !body.lineDescription.trim()) return NextResponse.json({ success: false, error: 'Service description is required' }, { status: 400 });
      serviceCents = parseCents(body?.serviceAmount, 'serviceAmount', false);
      const rawQuantity = body?.quantity === undefined || body.quantity === '' ? 1 : Number(body.quantity);
      if (!Number.isFinite(rawQuantity) || rawQuantity <= 0 || rawQuantity > 100000) return NextResponse.json({ success: false, error: 'quantity must be greater than zero' }, { status: 400 });
      quantity = Math.round(rawQuantity * 100) / 100;
      lineDescription = body.lineDescription.trim();
      paymentTerms = typeof body?.paymentTerms === 'string' ? body.paymentTerms.trim().slice(0, 500) || null : null;
      notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null;
      recipientSnapshot = {
        legalName: customer.legalName.trim(), corporationNumber: typeof customer.corporationNumber === 'string' ? customer.corporationNumber.trim() || null : null,
        email: typeof customer.email === 'string' ? customer.email.trim() || null : null,
        addressLine1: typeof customer.addressLine1 === 'string' ? customer.addressLine1.trim() || null : null,
        city: typeof customer.city === 'string' ? customer.city.trim() || null : null,
        province: typeof customer.province === 'string' ? customer.province.trim() || null : null,
        postalCode: typeof customer.postalCode === 'string' ? customer.postalCode.trim() || null : null,
        country: typeof customer.country === 'string' ? customer.country.trim() || 'Canada' : 'Canada',
      } as Prisma.InputJsonValue;
    }
    const hstCents = Math.round(serviceCents * ONTARIO_HST_RATE_BPS / 10_000);
    const totalCents = serviceCents + hstCents;
    const dueAt = body.dueDate ? new Date(`${parseDateOnly(body.dueDate, 'dueDate')}T00:00:00.000Z`) : undefined;
    const result = await prisma.$transaction(async (tx) => {
      if (period) {
        // Keep the shared serialization order used by auto-refresh and period
        // creation: issuer first, then the target period.
        await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AccountingEntity" WHERE "id" = ${issuer.entity.id} FOR UPDATE`;
        await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PartnerBillingPeriod" WHERE "id" = ${period.id} FOR UPDATE`;
        const currentPeriod = await tx.partnerBillingPeriod.findUnique({
          where: { id: period.id },
          include: { invoice: { select: { id: true } } },
        });
        if (!currentPeriod || currentPeriod.invoice || currentPeriod.status === 'INVOICED') {
          throw new BillingSnapshotChangedError('This billing snapshot was already issued. Reload the Billing page.');
        }
        if (decimalToCents(currentPeriod.partnerFeeAmount) !== serviceCents) {
          throw new BillingSnapshotChangedError('This billing snapshot was refreshed from updated revenue. Reload the Billing page before issuing the invoice.');
        }
      }
      const counter = await tx.accountingEntity.update({ where: { id: issuer.entity.id }, data: { nextPartnerInvoiceNumber: { increment: 1 } }, select: { nextPartnerInvoiceNumber: true } });
      const sequence = counter.nextPartnerInvoiceNumber - 1;
      const invoice = await tx.partnerInvoice.create({
        data: {
          billingPeriodId: period?.id || null, issuerEntityId: issuer.entity.id, recipientEntityId: period?.recipientEntityId || null,
          invoiceNumber: `INV-${String(sequence).padStart(6, '0')}`, status: 'ISSUED', paymentStatus: 'PENDING',
          invoiceKind, lineDescription, quantity: new Prisma.Decimal(quantity), serviceAmount: centsToDecimal(serviceCents), hstRate: new Prisma.Decimal(0.13), hstAmount: centsToDecimal(hstCents), totalAmount: centsToDecimal(totalCents), currency: 'CAD',
          periodStart: period?.periodStart || null, periodEnd: period?.periodEnd || null, issuedAt: new Date(), dueAt,
          hstRegistrationSnapshot: issuer.entity.hstRegistrationNumber,
          issuerSnapshot: toJsonSafe(issuer.entity), recipientSnapshot, paymentTerms, notes, issuedById: user.id,
        }, include: { billingPeriod: true, issuerEntity: true, recipientEntity: true, paymentEvents: true },
      });
      if (period) await tx.partnerBillingPeriod.update({ where: { id: period.id }, data: { status: 'INVOICED', hstRate: new Prisma.Decimal(0.13), hstAmount: centsToDecimal(hstCents) } });
      await tx.accountingAuditEvent.create({ data: { entityId: issuer.entity.id, invoiceId: invoice.id, actorId: user.id, action: 'ISSUED', resourceType: 'PartnerInvoice', resourceId: invoice.id, metadata: { invoiceNumber: invoice.invoiceNumber, totalAmount: totalCents / 100 } } });
      return invoice;
    });
    let responseInvoice = result;
    let emailNotification: { sent: boolean; to?: string; error?: string } | undefined;
    const recipientEmail = invoiceRecipientEmail(result);
    if (recipientEmail) {
      const email = buildBooksInvoiceEmail(result, recipientEmail);
      const pdf = await buildAccountingInvoicePdf(result);
      const emailResult = await sendEmail({ to: recipientEmail, subject: email.subject, html: email.html, text: email.text, replyTo: issuer.entity.email || undefined, attachments: [{ filename: `${result.invoiceNumber}.pdf`, content: pdf }] });
      if (emailResult.success) {
        responseInvoice = await prisma.$transaction(async (tx) => {
          const saved = await tx.partnerInvoice.update({ where: { id: result.id }, data: { emailSentAt: new Date(), emailSentTo: recipientEmail, emailMessageId: emailResult.id || null }, include: { billingPeriod: true, issuerEntity: true, recipientEntity: true, paymentEvents: true } });
          await tx.accountingAuditEvent.create({ data: { entityId: issuer.entity.id, invoiceId: result.id, actorId: user.id, action: 'EMAIL_SENT', resourceType: 'PartnerInvoice', resourceId: result.id, metadata: { invoiceNumber: result.invoiceNumber, recipientEmail, paymentStatus: result.paymentStatus, messageId: emailResult.id || null } } });
          return saved;
        });
        emailNotification = { sent: true, to: recipientEmail };
      } else {
        emailNotification = { sent: false, to: recipientEmail, error: emailResult.error || 'Unable to send invoice email' };
      }
    }
    return NextResponse.json({ success: true, invoice: mapInvoice(responseInvoice), emailNotification }, { status: 201 });
  } catch (error: any) {
    logCaughtRequestError(request, '/api/books/invoices', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to issue invoice') }, { status: error instanceof BillingSnapshotChangedError || error?.code === 'P2002' ? 409 : 400 });
  }
}

export const GET = withRequestLogging('/api/books/invoices', handleGET);
export const POST = withRequestLogging('/api/books/invoices', handlePOST);
