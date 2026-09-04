import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');

    const where: any = { active: true };
    if (role) {
      where.role = role;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        email: true,
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ success: true, users });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, role, email } = body;

    if (!name || !phone || !role) {
      return NextResponse.json(
        { success: false, error: 'Name, phone, and role are required' },
        { status: 400 }
      );
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');

    const newUser = await prisma.user.upsert({
      where: { phone: cleanPhone },
      update: { name, role, email: email || null },
      create: {
        name,
        phone: cleanPhone,
        role,
        email: email || null,
      },
    });

    return NextResponse.json({ success: true, user: newUser });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

