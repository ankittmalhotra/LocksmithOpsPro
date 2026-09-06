import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'OWNER')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Owner or Super Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { technicianId, amountSettled, paymentMethod = 'CASH_HANDOVER', notes = '' } = body;

    if (!technicianId || !amountSettled || parseFloat(amountSettled) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid technician or amount' },
        { status: 400 }
      );
    }

    const settlement = await prisma.settlement.create({
      data: {
        technicianId,
        amountSettled: parseFloat(amountSettled),
        paymentMethod,
        notes,
        settledBy: user.id,
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
