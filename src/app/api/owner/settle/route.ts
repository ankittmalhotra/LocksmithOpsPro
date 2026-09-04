import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { technicianId, amountSettled, paymentMethod = 'CASH_HANDOVER', notes = '' } = body;

    if (!technicianId || !amountSettled || parseFloat(amountSettled) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid technician or amount' },
        { status: 400 }
      );
    }

    // Default owner user
    const owner = await prisma.user.findFirst({
      where: { role: 'OWNER' },
    });

    const settlement = await prisma.settlement.create({
      data: {
        technicianId,
        amountSettled: parseFloat(amountSettled),
        paymentMethod,
        notes,
        settledBy: owner?.id || 'SYSTEM_OWNER',
      },
      include: {
        technician: true,
      },
    });

    return NextResponse.json({
      success: true,
      settlement,
      message: `Successfully settled $${parseFloat(amountSettled).toFixed(2)} with ${settlement.technician.name}`,
    });
  } catch (err: any) {
    console.error('Settlement error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
