import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const envCheck = {
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    databaseUrlPrefix: process.env.DATABASE_URL ? process.env.DATABASE_URL.slice(0, 20) : 'missing',
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
      errorMessage: err.message,
      errorCode: err.code,
    });
  }
}

