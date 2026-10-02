import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Admin access required to retrieve voided receipt versions' }, { status: 403 });
    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job?.invoice) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    const receiptId = new URL(request.url).searchParams.get('versionId');
    if (!receiptId) return NextResponse.json({ success: false, error: 'versionId is required' }, { status: 400 });
    const receipt = await prisma.jobPaymentReceipt.findFirst({ where: { id: receiptId, invoiceId: job.invoice.id, voidedAt: { not: null } } });
    if (!receipt) return NextResponse.json({ success: false, error: 'Voided receipt version not found' }, { status: 404 });
    const pdf = await PDFDocument.load(receipt.pdfBytes);
    const page = pdf.getPages()[0];
    if (!page) return NextResponse.json({ success: false, error: 'Voided receipt PDF is unavailable' }, { status: 404 });
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText('VOID - SUPERSEDED', {
      x: 126, y: 365, size: 31, font, rotate: degrees(-24),
      color: rgb(0.72, 0.08, 0.08), opacity: 0.72,
    });
    const reason = (receipt.voidReason || 'No reason recorded').replace(/[^\x20-\x7E]/g, ' ').slice(0, 150);
    page.drawText(`Voided: ${receipt.voidedAt?.toISOString().slice(0, 10) || 'Unknown'} | Reason: ${reason}`, {
      x: 52, y: 48, size: 8, font, color: rgb(0.65, 0.08, 0.08),
    });
    const bytes = Buffer.from(await pdf.save());
    return new NextResponse(bytes, { headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="${receipt.receiptNumber}-VOIDED.pdf"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    logCaughtRequestError(request, '/api/jobs/[id]/receipt/history', error);
    return NextResponse.json({ success: false, error: 'Unable to retrieve receipt history' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export const GET = withRequestLogging('/api/jobs/[id]/receipt/history', handleGET);
