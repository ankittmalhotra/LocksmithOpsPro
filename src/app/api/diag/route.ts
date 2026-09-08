import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }
  const envCheck = {
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    hasDirectUrl: !!process.env.DIRECT_URL,
    nodeEnv: process.env.NODE_ENV,
  };

  try {
    const userCount = await prisma.user.count();
    const jobCount = await prisma.job.count();
    return NextResponse.json({
      success: true,
      envCheck,
      databaseConnected: true,
      counts: { users: userCount, jobs: jobCount },
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      envCheck,
      databaseConnected: false,
      errorName: err.name,
      errorCode: err.code,
    });
  }
}
