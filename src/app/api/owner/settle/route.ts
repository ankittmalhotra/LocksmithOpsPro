import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { technicianId, amountSettled, paymentMethod = 'CASH_HANDOVER', notes = '' } = body;
    const normalizedAmount = Number(amountSettled);

    if (
      typeof technicianId !== 'string' ||
      !technicianId ||
      !Number.isFinite(normalizedAmount) ||
      normalizedAmount <= 0
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid technician or amount' },
        { status: 400 }
      );
    }

    const technician = await prisma.user.findUnique({
      where: { id: technicianId },
      select: { id: true, name: true, role: true, active: true },
    });
    if (!technician || technician.role !== 'TECHNICIAN' || !technician.active) {
      return NextResponse.json(
        { success: false, error: 'Settlement target must be an active Technician' },
        { status: 400 }
      );
    }

    const settlement = await prisma.settlement.create({
      data: {
        technicianId,
        amountSettled: normalizedAmount,
        paymentMethod,
        notes,
        settledBy: user.id,
      },
      include: {
        technician: { select: { id: true, name: true, phone: true, active: true } },
      },
    });

    return NextResponse.json({
      success: true,
      settlement,
      message: `Successfully settled $${normalizedAmount.toFixed(2)} with ${settlement.technician.name}`,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/owner/settle', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to record settlement') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/owner/settle', handlePOST);
