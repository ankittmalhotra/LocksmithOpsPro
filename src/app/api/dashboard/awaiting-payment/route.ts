import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { CARD_TOTAL_PRICING_MODEL } from '@/lib/card-pay-link';

/**
 * Completed jobs whose invoice is still unpaid, for the Dashboard's
 * "Awaiting payment" card. Cumulative (an open to-do list, not a period
 * total), so it never depends on the selected reporting period.
 */
async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER') {
      return NextResponse.json({ success: false, error: 'Admin or Dispatcher access required' }, { status: 403 });
    }

    const pending = await prisma.invoice.findMany({
      where: { paymentStatus: 'PENDING', job: { status: 'COMPLETED' } },
      select: {
        grandTotal: true,
        pricingModel: true,
        paymentMethod: true,
        job: { select: { completedAt: true, createdAt: true } },
      },
      take: 1000,
    });

    let totalCents = 0;
    let cardLinkCount = 0;
    let oldest: Date | null = null;
    for (const invoice of pending) {
      totalCents += Math.round(Number(invoice.grandTotal || 0) * 100);
      if (invoice.pricingModel === CARD_TOTAL_PRICING_MODEL) cardLinkCount += 1;
      const completed = invoice.job.completedAt || invoice.job.createdAt;
      if (!oldest || completed < oldest) oldest = completed;
    }
    const oldestDays = oldest ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 86_400_000)) : null;

    return NextResponse.json({
      success: true,
      count: pending.length,
      cardLinkCount,
      totalCents,
      oldestDays,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logCaughtRequestError(request, '/api/dashboard/awaiting-payment', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load awaiting payments') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/dashboard/awaiting-payment', handleGET);
