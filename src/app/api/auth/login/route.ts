import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { setSessionCookie } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, phone, role, username, password, identifier } = body;

    // Handle credential / identifier normalization
    const loginIdentifier = (identifier || username || phone || '').trim();
    const loginPassword = (password || '').trim();

    // 1. Handle Super Admin Login (admin / admin123)
    if (loginIdentifier.toLowerCase() === 'admin') {
      if (loginPassword === 'admin123') {
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
          redirectUrl: '/dispatch',
          message: 'Logged in as Super Admin',
        });
      } else {
        return NextResponse.json(
          { success: false, error: 'Invalid password for admin' },
          { status: 401 }
        );
      }
    }

    let user = null;

    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    } else if (loginIdentifier) {
      const cleanPhone = loginIdentifier.replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 7) {
        user = await prisma.user.findFirst({
          where: {
            phone: { contains: cleanPhone.slice(-10) },
          },
        });
      }
      if (!user) {
        user = await prisma.user.findFirst({
          where: {
            OR: [
              { phone: loginIdentifier },
              { name: { equals: loginIdentifier, mode: 'insensitive' } },
              { email: { equals: loginIdentifier, mode: 'insensitive' } },
            ],
          },
        });
      }
    } else if (role) {
      user = await prisma.user.findFirst({ where: { role } });
    }

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found. Please verify your phone number or credentials.' },
        { status: 404 }
      );
    }

    if (user.role === 'TECHNICIAN' && user.active === false) {
      return NextResponse.json(
        {
          success: false,
          error: 'Your contractor account is pending admin approval. You will be able to log in once approved.',
          pendingApproval: true,
        },
        { status: 403 }
      );
    }

    const sessionData = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role as 'SUPER_ADMIN' | 'OWNER' | 'DISPATCHER' | 'TECHNICIAN',
    };

    await setSessionCookie(sessionData);

    const redirectUrl =
      user.role === 'SUPER_ADMIN' || user.role === 'OWNER' || user.role === 'DISPATCHER'
        ? '/dispatch'
        : '/tech';

    return NextResponse.json({
      success: true,
      user: sessionData,
      redirectUrl,
      message: `Logged in as ${user.name} (${user.role})`,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
