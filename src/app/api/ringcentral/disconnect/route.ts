import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { clearRingCentralTokenCookie } from '@/lib/ringcentral';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized: Admin access required' }, { status: 403 });
  }
  await clearRingCentralTokenCookie();
  try {
    await prisma.ringCentralConnection.delete({ where: { id: 'default' } });
  } catch (error: any) {
    if (error?.code !== 'P2021') throw error;
  }
  return NextResponse.json({ success: true });
}
