import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { setSessionCookie } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, phone, role, username, password } = body;

    // 1. Handle Super Admin Login (admin / admin123)
    if (username || password) {
      if (username === 'admin' && password === 'admin123') {
        let adminUser = null;
        try {
          adminUser = await prisma.user.findFirst({
            where: { role: 'SUPER_ADMIN' },
          });
          if (!adminUser) {
            adminUser = await prisma.user.upsert({
              where: { phone: '0000000000' },
              update: { role: 'SUPER_ADMIN', name: 'Super Admin' },
              create: {
                name: 'Super Admin',
                phone: '0000000000',
                email: 'admin@locksmithops.com',
                role: 'SUPER_ADMIN',
              },
            });
          }
        } catch {
          // fallback in-memory session if DB is not yet migrated
          adminUser = {
            id: 'super-admin-root',
            name: 'Super Admin',
            phone: '0000000000',
            role: 'SUPER_ADMIN' as const,
          };
        }

        const sessionData = {
          id: adminUser.id,
          name: adminUser.name,
          phone: adminUser.phone,
          role: 'SUPER_ADMIN' as const,
        };

        await setSessionCookie(sessionData);

        return NextResponse.json({
          success: true,
          user: sessionData,
          message: 'Logged in as Super Admin',
        });
      } else {
        return NextResponse.json(
          { success: false, error: 'Invalid Super Admin credentials' },
          { status: 401 }
        );
      }
    }

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
      role: user.role as 'SUPER_ADMIN' | 'OWNER' | 'DISPATCHER' | 'TECHNICIAN',
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
