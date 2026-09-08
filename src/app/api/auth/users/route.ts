import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail, buildContractorApprovedEmail } from '@/lib/resend';
import { getCurrentUser } from '@/lib/auth';

function canManageTeam(role?: string) {
  return role === 'SUPER_ADMIN' || role === 'OWNER' || role === 'DISPATCHER';
}

function parseCommissionRate(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return undefined;
  return rate;
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || !canManageTeam(currentUser.role)) {
      return NextResponse.json({ success: false, error: 'Team access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    const activeOnly = searchParams.get('activeOnly');

    const where: any = {};
    if (activeOnly !== 'false') {
      where.active = true;
    }
    if (role) {
      where.role = role;
    }

    const rawUsers = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        email: true,
        active: true,
        commissionRate: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, users: rawUsers });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    const body = await request.json();
    const { name, phone, role, email, isSelfRegistration } = body;

    if (!isSelfRegistration && (!currentUser || !canManageTeam(currentUser.role))) {
      return NextResponse.json({ success: false, error: 'Team management access required' }, { status: 403 });
    }

    if (!name || !phone) {
      return NextResponse.json(
        { success: false, error: 'Name and phone are required' },
        { status: 400 }
      );
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const requestedRate = parseCommissionRate(body.commissionRate);

    if (role === 'TECHNICIAN' && body.commissionRate !== undefined && requestedRate === undefined) {
      return NextResponse.json({ success: false, error: 'Commission rate must be between 0 and 100 percent.' }, { status: 400 });
    }

    // Public self-registration is strictly for TECHNICIAN / Contractor only
    // and requires Admin/Owner approval before becoming active.
    if (isSelfRegistration) {
      const newUser = await prisma.user.upsert({
        where: { phone: cleanPhone },
        update: {
          name,
          role: 'TECHNICIAN',
          email: email || null,
        },
        create: {
          name,
          phone: cleanPhone,
          role: 'TECHNICIAN',
          email: email || null,
          active: false, // Pending admin approval
          commissionRate: 0,
        },
      });

      return NextResponse.json({
        success: true,
        user: newUser,
        pendingApproval: !newUser.active,
        message: newUser.active
          ? 'Account already active. You can sign in now.'
          : 'Registration submitted! Your account is pending admin approval before you can access jobs.',
      });
    }

    // Direct creation by Admin / Owner
    if (!role) {
      return NextResponse.json(
        { success: false, error: 'Role is required for team member creation' },
        { status: 400 }
      );
    }

    if (!['OWNER', 'DISPATCHER', 'TECHNICIAN'].includes(role)) {
      return NextResponse.json({ success: false, error: 'Invalid team member role' }, { status: 400 });
    }

    const newUser = await prisma.user.upsert({
      where: { phone: cleanPhone },
      update: {
        name,
        role,
        email: email || null,
        active: true,
        ...(role === 'TECHNICIAN' && requestedRate !== undefined ? { commissionRate: requestedRate } : {}),
      },
      create: {
        name,
        phone: cleanPhone,
        role,
        email: email || null,
        active: true,
        commissionRate: role === 'TECHNICIAN' ? (requestedRate ?? 0) : 0,
      },
    });

    return NextResponse.json({
      success: true,
      user: newUser,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PATCH to toggle active / approve technician or update commission rate
export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || !canManageTeam(currentUser.role)) {
      return NextResponse.json({ success: false, error: 'Team management access required' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, active } = body;
    const requestedRate = parseCommissionRate(body.commissionRate);

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (typeof active === 'boolean') {
      updateData.active = active;
    }
    if (body.commissionRate !== undefined) {
      if (requestedRate === undefined) {
        return NextResponse.json({ success: false, error: 'Commission rate must be between 0 and 100 percent.' }, { status: 400 });
      }
      updateData.commissionRate = requestedRate;
    }

    const updatedUser = Object.keys(updateData).length > 0
      ? await prisma.user.update({
          where: { id: userId },
          data: updateData,
        })
      : await prisma.user.findUnique({ where: { id: userId } });

    if (!updatedUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // If contractor is activated/approved and has an email, send email via Resend
    let emailResult = null;
    if (active === true && updatedUser.role === 'TECHNICIAN' && updatedUser.email) {
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const { subject, html } = buildContractorApprovedEmail(updatedUser.name, appUrl);
        emailResult = await sendEmail({
          to: updatedUser.email,
          subject,
          html,
        });
      } catch (e) {
        console.error('Failed to send contractor approval email:', e);
      }
    }

    return NextResponse.json({
      success: true,
      user: updatedUser,
      emailResult,
      message: body.commissionRate !== undefined
        ? `Commission rate for ${updatedUser.name} updated to ${updatedUser.commissionRate.toFixed(2)}%`
        : active
        ? `Contractor ${updatedUser.name} approved & activated!`
        : `Contractor ${updatedUser.name} deactivated.`,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
