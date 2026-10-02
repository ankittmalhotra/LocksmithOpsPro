import { prisma } from '@/lib/prisma';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type JobReceiptState = 'local_ready' | 'stripe_ready' | 'stripe_partial_refund' | 'payment_pending' | 'off_books' | 'provider_missing' | 'refunded' | 'ineligible';

export function getJobReceiptState(job: any): JobReceiptState {
  if (!job?.invoice || job.status !== 'COMPLETED') return 'ineligible';
  const invoice = job.invoice;
  if (invoice.paymentStatus === 'REFUNDED') return 'refunded';
  if (invoice.taxCollected !== true) return 'off_books';
  if (invoice.paymentStatus !== 'PAID' && invoice.paymentStatus !== 'PARTIALLY_REFUNDED') return 'payment_pending';
  if (invoice.paymentProvider === 'STRIPE') {
    if (!['STRIPE_CARD', 'CREDIT_CARD', 'DEBIT_CARD'].includes(invoice.paymentMethod)) return 'provider_missing';
    return invoice.paymentStatus === 'PARTIALLY_REFUNDED' ? 'stripe_partial_refund' : 'stripe_ready';
  }
  if (invoice.paymentStatus === 'PARTIALLY_REFUNDED') return 'provider_missing';
  if (invoice.paymentMethod === 'CASH' || invoice.paymentMethod === 'INTERAC') return 'local_ready';
  return 'provider_missing';
}

function requiredIssuer(entity: any) {
  const required = [entity?.legalName, entity?.corporationNumber, entity?.addressLine1, entity?.city,
    entity?.province, entity?.postalCode, entity?.country, entity?.hstRegistrationNumber];
  if (!entity || entity.code !== 'LOCKSMITH' || required.some((value) => typeof value !== 'string' || !value.trim())
    || !entity.hstEnabled || !entity.hstEffectiveDate) {
    throw new Error('Receipt unavailable: Locksmith issuer configuration requires verified HST registration, effective date, business identity, and address.');
  }
  return entity;
}

function money(value: unknown) { return `CAD $${Number(value || 0).toFixed(2)}`; }
function safeText(value: unknown) { return String(value ?? '').replace(/[\u2010-\u2015]/g, '-').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim(); }
function displayHst(value: string) { return value.replace(/^(\d{5})(\d{4})(RT\d{4})$/, '$1 $2 $3'); }
function formatDate(value: unknown) {
  if (!value) return 'Unknown';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' }).format(date);
}

export async function getLocksmithReceiptIssuer() {
  const entity = await prisma.accountingEntity.findUnique({ where: { code: 'LOCKSMITH' } });
  return requiredIssuer(entity);
}

async function buildReceiptPdf(snapshot: any): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.1, 0.17);
  const muted = rgb(0.38, 0.43, 0.51);
  const line = (text: string, y: number, font = regular, size = 11, color = ink) => page.drawText(safeText(text), { x: 52, y, font, size, color });
  line('PAYMENT RECEIPT', 728, bold, 24);
  line(`Receipt ${snapshot.receiptNumber}  |  Revision ${snapshot.revision}`, 704, regular, 10, muted);
  line(`Issued ${formatDate(snapshot.issuedAt)}  |  Paid ${formatDate(snapshot.paidAt)}`, 686, regular, 10, muted);
  page.drawLine({ start: { x: 52, y: 671 }, end: { x: 560, y: 671 }, thickness: 1, color: rgb(0.86, 0.89, 0.93) });
  line('FROM', 646, bold, 9, muted);
  line(snapshot.issuer.legalName, 627, bold, 13);
  line(`Business / corporation ID: ${snapshot.issuer.corporationNumber}`, 609, regular, 10);
  line(`HST registration: ${snapshot.issuer.hstRegistrationNumber}`, 593, regular, 10);
  line(snapshot.issuer.address, 577, regular, 10);
  line('BILL TO', 541, bold, 9, muted);
  line(snapshot.customer.name, 522, bold, 12);
  line(`Job #${snapshot.job.jobNumber}  |  ${snapshot.job.serviceType}`, 503, regular, 10);
  line(snapshot.job.serviceAddress, 487, regular, 10);
  page.drawLine({ start: { x: 52, y: 459 }, end: { x: 560, y: 459 }, thickness: 1, color: rgb(0.86, 0.89, 0.93) });
  line('DESCRIPTION', 438, bold, 9, muted);
  line(snapshot.job.description, 417, regular, 11);
  line(`Payment method: ${snapshot.payment.method}`, 384, regular, 10);
  let totalsY = 360;
  if (snapshot.job.partsBreakdownReconciled) {
    const parts = snapshot.job.parts;
    if (parts.length) {
      line('PARTS', 360, bold, 9, muted);
      totalsY = 342;
      parts.slice(0, 6).forEach((part: any, index: number) => {
        line(`${part.quantity} x ${safeText(part.description).slice(0, 56)}  ${money(part.amount)}`, totalsY - index * 15, regular, 9);
      });
      if (parts.length > 6) {
        const shownParts = parts.slice(0, 6).reduce((sum: number, part: any) => sum + Number(part.amount), 0);
        line(`Other ${parts.length - 6} parts: ${money(snapshot.amounts.partsTotal - shownParts)}`, totalsY - 6 * 15, regular, 9, muted);
        totalsY -= 6 * 15 + 15;
      } else {
        totalsY -= parts.length * 15;
      }
    }
    line(`Labor: ${money(snapshot.amounts.laborTotal)}`, totalsY, regular, 10);
    totalsY -= 22;
  } else {
    line(`Service and parts: ${money(snapshot.amounts.subtotal)}`, totalsY, regular, 10);
    totalsY -= 30;
  }
  line(`Subtotal: ${money(snapshot.amounts.subtotal)}`, totalsY, regular, 11);
  line(`HST (${(snapshot.amounts.taxRate * 100).toFixed(2).replace(/\.00$/, '')}%): ${money(snapshot.amounts.tax)}`, totalsY - 21, regular, 11);
  page.drawLine({ start: { x: 350, y: totalsY - 39 }, end: { x: 560, y: totalsY - 39 }, thickness: 1, color: rgb(0.77, 0.81, 0.86) });
  line(`TOTAL PAID: ${money(snapshot.amounts.total)}`, totalsY - 63, bold, 16);
  line('PAID', totalsY - 88, bold, 10, rgb(0.03, 0.47, 0.34));
  line('Thank you for your business.', 72, regular, 9, muted);
  return pdf.save({ useObjectStreams: false });
}

export async function createOrLoadJobPaymentReceipt(job: any, issuedById: string) {
  if (getJobReceiptState(job) !== 'local_ready' || !job.invoice) throw new Error('Receipt unavailable: this job is not an eligible paid, on-books Cash or Interac transaction.');
  return prisma.$transaction(async (tx) => {
  // Serialize issuance with correction, void, and deletion flows on this invoice.
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${job.invoice.id} FOR UPDATE`;
  const current = await tx.job.findUnique({ where: { id: job.id }, include: { invoice: true, customer: true, items: true } });
  if (!current || getJobReceiptState(current) !== 'local_ready' || !current.invoice) throw new Error('Receipt unavailable: payment or job details changed. Reload and try again.');
  const active = await tx.jobPaymentReceipt.findFirst({ where: { invoiceId: current.invoice.id, voidedAt: null } });
  if (active) return active;
  const issuer = await getLocksmithReceiptIssuer();
  const paidAt = current.invoice.paidAt;
  if (!paidAt || Number.isNaN(new Date(paidAt).getTime())) throw new Error('Receipt unavailable: an authoritative payment date is required.');
  if (new Date(paidAt) < issuer.hstEffectiveDate) throw new Error('Receipt unavailable: the Locksmith HST registration was not effective on the payment date.');
  const total = Number(current.invoice.totalAmountCollected || current.invoice.grandTotal);
  const tax = Number(current.invoice.taxAmount || 0);
  const subtotal = Number(current.invoice.subtotal);
  const taxRate = Number(current.invoice.taxRate || 0);
  const partsTotal = Number(current.invoice.partsTotal || 0);
  const laborTotal = Number(current.invoice.laborTotal || 0);
  const parts = (current.items || []).filter((item: any) => item.isPart).map((item: any) => ({
    description: item.description, quantity: item.quantity, amount: Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) / 100,
  }));
  const itemPartsTotalCents = parts.reduce((sum: number, part: any) => sum + Math.round(part.amount * 100), 0);
  const partsBreakdownReconciled = [partsTotal, laborTotal].every(Number.isFinite)
    && itemPartsTotalCents === Math.round(partsTotal * 100)
    && Math.round((partsTotal + laborTotal) * 100) === Math.round(subtotal * 100);
  const expectedTax = Math.round(subtotal * taxRate * 100) / 100;
  if (![total, tax, subtotal, taxRate].every(Number.isFinite) || total <= 0 || tax <= 0
    || Math.abs(taxRate - 0.13) > 0.0001
    || Math.round(tax * 100) !== Math.round(expectedTax * 100)
    || Math.abs(Math.round((subtotal + tax - total) * 100)) > 1) {
    throw new Error('Receipt unavailable: recorded subtotal, HST, and amount paid do not reconcile.');
  }
  const revision = await tx.jobPaymentReceipt.count({ where: { invoiceId: current.invoice.id } }) + 1;
  const receiptNumber = `LR-${current.jobNumber}-${String(revision).padStart(2, '0')}`;
  const snapshot = {
    receiptNumber, revision, issuedAt: new Date().toISOString(), paidAt: new Date(paidAt).toISOString(),
    issuer: {
      legalName: issuer.legalName, corporationNumber: issuer.corporationNumber,
      hstRegistrationNumber: displayHst(issuer.hstRegistrationNumber),
      address: [issuer.addressLine1, issuer.city, issuer.province, issuer.postalCode, issuer.country].filter(Boolean).join(', '),
    },
    customer: { name: current.customer.name },
    job: {
      jobNumber: current.jobNumber, serviceType: current.serviceType, description: current.problemDescription,
      serviceAddress: current.serviceAddress,
      parts, partsBreakdownReconciled,
    },
    payment: { method: current.invoice.paymentMethod },
    amounts: { subtotal, tax, taxRate, total, partsTotal, laborTotal },
  };
  const pdfBytes = await buildReceiptPdf(snapshot);
  const previous = await tx.jobPaymentReceipt.findFirst({ where: { invoiceId: current.invoice.id, voidedAt: { not: null }, replacementId: null }, orderBy: { revision: 'desc' } });
  const created = await tx.jobPaymentReceipt.create({ data: {
    invoiceId: current.invoice.id, receiptNumber, revision, issuedById,
    snapshot, pdfBytes: Buffer.from(pdfBytes),
  } });
  if (previous) await tx.jobPaymentReceipt.update({ where: { id: previous.id }, data: { replacementId: created.id } });
  return created;
  });
}
