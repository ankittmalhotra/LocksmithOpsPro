import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const BORDER = rgb(0.88, 0.91, 0.95);
const PALE = rgb(0.97, 0.98, 0.99);
const BLUE = rgb(0.12, 0.28, 0.72);
const AMBER = rgb(0.57, 0.33, 0.04);
const GREEN = rgb(0.03, 0.47, 0.34);

type Party = Record<string, any>;

function text(value: unknown): string {
  return String(value ?? '').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
}

function money(value: unknown, currency = 'CAD') {
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function decimalNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function date(value: unknown): string {
  if (!value) return 'Due on receipt';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return text(value);
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function address(party: Party) {
  return [party.addressLine1, party.city, party.province, party.postalCode, party.country].filter(Boolean).map(text).join(', ');
}

function wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text(value).split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawText(page: PDFPage, value: unknown, x: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(text(value), { x, y, size, font, color });
}

function drawRight(page: PDFPage, value: unknown, rightX: number, y: number, font: PDFFont, size: number, color = INK) {
  const content = text(value);
  page.drawText(content, { x: rightX - font.widthOfTextAtSize(content, size), y, size, font, color });
}

function drawWrapped(page: PDFPage, value: unknown, x: number, y: number, width: number, font: PDFFont, size: number, color = INK, lineHeight = size + 4) {
  const lines = wrap(text(value), font, size, width);
  lines.forEach((line, index) => drawText(page, line, x, y - index * lineHeight, font, size, color));
  return y - lines.length * lineHeight;
}

export async function buildAccountingInvoicePdf(invoice: any): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const issuer: Party = invoice.issuerEntity || invoice.issuerSnapshot || {};
  const recipient: Party = invoice.recipientEntity || invoice.recipientSnapshot || {};
  const currency = text(invoice.currency || 'CAD');
  const quantity = decimalNumber(invoice.quantity || 1);
  const subtotal = decimalNumber(invoice.serviceAmount);
  const hst = decimalNumber(invoice.hstAmount);
  const total = decimalNumber(invoice.totalAmount);
  const hstRate = Number(invoice.hstRate || 0);
  const paid = invoice.paymentStatus === 'RECEIVED';
  const receivedEvent = Array.isArray(invoice.paymentEvents) ? [...invoice.paymentEvents].reverse().find((event: any) => event.toStatus === 'RECEIVED') : undefined;
  const status = paid ? 'PAID' : 'PAYMENT PENDING';

  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(1, 1, 1) });
  drawText(page, 'INVOICE', MARGIN, 724, bold, 28, INK);
  drawText(page, invoice.invoiceKind === 'CUSTOMER_SERVICE' ? 'Professional services' : 'IT services for Locksmith', MARGIN, 704, bold, 9, BLUE);
  page.drawRectangle({ x: 431, y: 704, width: 133, height: 24, color: paid ? rgb(0.91, 0.98, 0.95) : rgb(1, 0.97, 0.88), borderColor: paid ? rgb(0.68, 0.9, 0.8) : rgb(0.95, 0.83, 0.55), borderWidth: 1 });
  drawRight(page, status, 552, 712, bold, 9, paid ? GREEN : AMBER);
  drawRight(page, invoice.invoiceNumber, 564, 675, bold, 12, INK);
  drawRight(page, `Issued: ${date(invoice.issuedAt)}`, 564, 658, regular, 9, MUTED);
  drawRight(page, `Due: ${date(invoice.dueAt)}`, 564, 644, regular, 9, MUTED);
  page.drawLine({ start: { x: MARGIN, y: 626 }, end: { x: PAGE_WIDTH - MARGIN, y: 626 }, thickness: 1, color: BORDER });

  drawText(page, 'FROM', MARGIN, 598, bold, 8, MUTED);
  drawText(page, 'BILL TO', 330, 598, bold, 8, MUTED);
  let issuerY = 580;
  drawText(page, issuer.legalName || '1001744934 ONTARIO INC.', MARGIN, issuerY, bold, 11, INK);
  issuerY -= 16;
  if (issuer.corporationNumber) { drawText(page, `OCN: ${issuer.corporationNumber}`, MARGIN, issuerY, regular, 9, MUTED); issuerY -= 13; }
  if (invoice.hstRegistrationSnapshot || issuer.hstRegistrationNumber) { drawText(page, `HST: ${invoice.hstRegistrationSnapshot || issuer.hstRegistrationNumber}`, MARGIN, issuerY, regular, 9, MUTED); issuerY -= 13; }
  if (address(issuer)) issuerY = drawWrapped(page, address(issuer), MARGIN, issuerY, 220, regular, 9, MUTED);
  if (issuer.email) drawText(page, issuer.email, MARGIN, issuerY - 2, regular, 9, MUTED);

  let recipientY = 580;
  drawText(page, recipient.legalName || 'Customer', 330, recipientY, bold, 11, INK);
  recipientY -= 16;
  if (recipient.corporationNumber) { drawText(page, `OCN: ${recipient.corporationNumber}`, 330, recipientY, regular, 9, MUTED); recipientY -= 13; }
  if (address(recipient)) recipientY = drawWrapped(page, address(recipient), 330, recipientY, 220, regular, 9, MUTED);
  if (recipient.email) drawText(page, recipient.email, 330, recipientY - 2, regular, 9, MUTED);

  const tableTop = 470;
  page.drawRectangle({ x: MARGIN, y: tableTop - 22, width: PAGE_WIDTH - MARGIN * 2, height: 28, color: PALE });
  drawText(page, 'DESCRIPTION', MARGIN + 12, tableTop - 12, bold, 8, MUTED);
  drawRight(page, 'QTY', 462, tableTop - 12, bold, 8, MUTED);
  drawRight(page, 'AMOUNT', 552, tableTop - 12, bold, 8, MUTED);
  const descriptionBottom = drawWrapped(page, invoice.lineDescription || 'Professional services', MARGIN + 12, tableTop - 50, 320, regular, 10, INK);
  drawRight(page, quantity.toFixed(2).replace(/\.00$/, ''), 462, tableTop - 50, regular, 10, INK);
  drawRight(page, money(subtotal, currency), 552, tableTop - 50, regular, 10, INK);
  const rowBottom = Math.min(descriptionBottom - 10, tableTop - 72);
  page.drawLine({ start: { x: MARGIN, y: rowBottom }, end: { x: PAGE_WIDTH - MARGIN, y: rowBottom }, thickness: 1, color: BORDER });

  const totalsTop = rowBottom - 30;
  const totalsX = 378;
  drawText(page, 'Subtotal', totalsX, totalsTop, regular, 10, MUTED);
  drawRight(page, money(subtotal, currency), 552, totalsTop, regular, 10, INK);
  drawText(page, hstRate ? `HST (${(hstRate * 100).toFixed(0)}%)` : 'HST', totalsX, totalsTop - 22, regular, 10, MUTED);
  drawRight(page, money(hst, currency), 552, totalsTop - 22, regular, 10, INK);
  page.drawLine({ start: { x: totalsX, y: totalsTop - 36 }, end: { x: 552, y: totalsTop - 36 }, thickness: 1.5, color: BORDER });
  drawText(page, `Total ${currency}`, totalsX, totalsTop - 58, bold, 13, INK);
  drawRight(page, money(total, currency), 552, totalsTop - 58, bold, 13, INK);
  page.drawRectangle({ x: totalsX - 8, y: totalsTop - 98, width: 182, height: 24, color: paid ? rgb(0.91, 0.98, 0.95) : rgb(1, 0.97, 0.88) });
  drawText(page, paid ? `Paid${receivedEvent?.paidAt ? ` on ${date(receivedEvent.paidAt)}` : ''}` : 'Payment pending', totalsX, totalsTop - 90, bold, 9, paid ? GREEN : AMBER);

  let footerY = totalsTop - 144;
  if (invoice.paymentTerms || invoice.notes) {
    page.drawLine({ start: { x: MARGIN, y: footerY + 18 }, end: { x: PAGE_WIDTH - MARGIN, y: footerY + 18 }, thickness: 1, color: BORDER });
    drawText(page, 'NOTES', MARGIN, footerY, bold, 8, MUTED);
    if (invoice.paymentTerms) footerY = drawWrapped(page, `Payment terms: ${invoice.paymentTerms}`, MARGIN, footerY - 17, PAGE_WIDTH - MARGIN * 2, regular, 9, MUTED) - 2;
    if (invoice.notes) footerY = drawWrapped(page, invoice.notes, MARGIN, footerY, PAGE_WIDTH - MARGIN * 2, regular, 9, MUTED);
  }
  drawText(page, 'Thank you for your business.', MARGIN, 62, regular, 9, MUTED);
  drawRight(page, `${currency} invoice · ${text(invoice.invoiceNumber)}`, PAGE_WIDTH - MARGIN, 62, regular, 8, MUTED);
  return pdf.save({ useObjectStreams: false });
}
