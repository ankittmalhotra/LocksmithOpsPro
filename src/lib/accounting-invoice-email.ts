import { buildAccountingInvoiceEmail } from '@/lib/resend';
import { serializeDecimal } from '@/lib/books-api';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInvoiceEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

function dateValue(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function invoiceRecipientEmail(invoice: any): string | null {
  return normalizeInvoiceEmail(invoice.recipientEntity?.email || invoice.recipientSnapshot?.email);
}

export function buildBooksInvoiceEmail(invoice: any, recipientEmail: string) {
  const issuer = invoice.issuerEntity || invoice.issuerSnapshot || {};
  const recipient = invoice.recipientEntity || invoice.recipientSnapshot || {};
  const receivedEvent = Array.isArray(invoice.paymentEvents)
    ? [...invoice.paymentEvents].reverse().find((event: any) => event.toStatus === 'RECEIVED')
    : undefined;
  const issuerAddress = [issuer.addressLine1, issuer.city, issuer.province, issuer.postalCode, issuer.country].filter(Boolean).join(', ');
  return buildAccountingInvoiceEmail({
    invoiceNumber: invoice.invoiceNumber,
    recipientName: recipient.legalName || 'Customer',
    recipientEmail,
    issuerName: issuer.legalName || '1001744934 ONTARIO INC.',
    issuerAddress: issuerAddress || undefined,
    issuerEmail: issuer.email || undefined,
    issuerHstNumber: invoice.hstRegistrationSnapshot || issuer.hstRegistrationNumber || undefined,
    description: invoice.lineDescription,
    quantity: serializeDecimal(invoice.quantity || 1),
    serviceAmount: serializeDecimal(invoice.serviceAmount),
    hstRate: Number(invoice.hstRate || 0),
    hstAmount: serializeDecimal(invoice.hstAmount),
    totalAmount: serializeDecimal(invoice.totalAmount),
    paymentStatus: invoice.paymentStatus === 'RECEIVED' ? 'RECEIVED' : 'PENDING',
    paidAt: dateValue(receivedEvent?.paidAt),
    issuedAt: dateValue(invoice.issuedAt),
    dueAt: dateValue(invoice.dueAt),
    paymentTerms: invoice.paymentTerms || undefined,
    notes: invoice.notes || undefined,
    currency: invoice.currency || 'CAD',
  });
}
