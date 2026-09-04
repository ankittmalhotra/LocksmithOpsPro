import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { setSessionCookie } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, phone, role } = body;

    let user = null;

    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    } else if (phone) {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      user = await prisma.user.findFirst({
        where: {
          phone: { contains: cleanPhone.slice(-10) },
        },
      });
    } else if (role) {
      user = await prisma.user.findFirst({ where: { role } });
    }

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const sessionData = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role as 'OWNER' | 'DISPATCHER' | 'TECHNICIAN',
    };

    await setSessionCookie(sessionData);

    return NextResponse.json({
      success: true,
      user: sessionData,
      message: `Logged in as ${user.name} (${user.role})`,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
