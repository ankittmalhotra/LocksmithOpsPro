import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail, buildContractorApprovedEmail } from '@/lib/resend';
import { getCurrentUser } from '@/lib/auth';
import { APP_ROLES, type AppRole } from '@/lib/session';
import { hashPassword } from '@/lib/password';

function canManageTeam(role?: string) {
  return role === 'ADMIN' || role === 'DISPATCHER';
}

function isAppRole(role: unknown): role is AppRole {
  return typeof role === 'string' && (APP_ROLES as readonly string[]).includes(role);
}

function parseCommissionRate(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return undefined;
  return rate;
}

function publicUser(user: Record<string, unknown>) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
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
    if (currentUser.role === 'DISPATCHER') {
      // Dispatchers only need active technicians for job assignment.
      if (role && role !== 'TECHNICIAN') {
        return NextResponse.json(
          { success: false, error: 'Dispatchers may only view technicians' },
          { status: 403 }
        );
      }
      where.role = 'TECHNICIAN';
      where.active = true;
    } else {
      if (activeOnly !== 'false') {
        where.active = true;
      }
      if (role) {
        if (!isAppRole(role)) {
          return NextResponse.json({ success: false, error: 'Invalid user role filter' }, { status: 400 });
        }
        where.role = role;
      }
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
    return NextResponse.json({ success: false, error: 'Unable to load team members' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    const body = await request.json();
    const { name, phone, role, email, isSelfRegistration, password } = body;
    const wantsSelfRegistration = isSelfRegistration === true;

    if (wantsSelfRegistration && currentUser) {
      return NextResponse.json(
        { success: false, error: 'Self-registration is only available when signed out' },
        { status: 403 }
      );
    }

    if (!wantsSelfRegistration && (!currentUser || !canManageTeam(currentUser.role))) {
      return NextResponse.json({ success: false, error: 'Team management access required' }, { status: 403 });
    }

    if (typeof name !== 'string' || !name.trim() || typeof phone !== 'string' || !phone.trim()) {
      return NextResponse.json(
        { success: false, error: 'Name and phone are required' },
        { status: 400 }
      );
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 7) {
      return NextResponse.json({ success: false, error: 'A valid phone number is required' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    const requestedRate = parseCommissionRate(body.commissionRate);

    if (role === 'TECHNICIAN' && body.commissionRate !== undefined && requestedRate === undefined) {
      return NextResponse.json({ success: false, error: 'Commission rate must be between 0 and 100 percent.' }, { status: 400 });
    }

    // Public self-registration is strictly for TECHNICIAN / Contractor only
    // and requires Admin approval before becoming active. It must never
    // update an existing account by phone.
    if (wantsSelfRegistration) {
      if (role !== undefined && role !== null && role !== '' && role !== 'TECHNICIAN') {
        return NextResponse.json(
          { success: false, error: 'Self-registration is only available for technicians' },
          { status: 400 }
        );
      }

      const existingUser = await prisma.user.findUnique({
        where: { phone: cleanPhone },
        select: { id: true },
      });
      if (existingUser) {
        return NextResponse.json(
          { success: false, error: 'An account already exists for this phone number' },
          { status: 409 }
        );
      }

      const newUser = await prisma.user.create({
        data: {
          name: name.trim(),
          phone: cleanPhone,
          role: 'TECHNICIAN',
          email: email || null,
          active: false, // Pending admin approval
          commissionRate: 0,
          passwordHash: hashPassword(password),
        },
      });

      return NextResponse.json({
        success: true,
        user: publicUser(newUser),
        pendingApproval: !newUser.active,
        message: newUser.active
          ? 'Account already active. You can sign in now.'
          : 'Registration submitted! Your account is pending admin approval before you can access jobs.',
      });
    }

    // Direct creation by Admin
    if (!role) {
      return NextResponse.json(
        { success: false, error: 'Role is required for team member creation' },
        { status: 400 }
      );
    }

    if (!isAppRole(role)) {
      return NextResponse.json({ success: false, error: 'Invalid team member role' }, { status: 400 });
    }

    if (role === 'ADMIN' && currentUser?.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Only Admin may create Admin users' },
        { status: 403 }
      );
    }

    if (currentUser?.role === 'DISPATCHER' && role !== 'TECHNICIAN') {
      return NextResponse.json(
        { success: false, error: 'Dispatchers may only create Technician users' },
        { status: 403 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { phone: cleanPhone },
      select: { id: true },
    });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'An account already exists for this phone number' },
        { status: 409 }
      );
    }

    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        phone: cleanPhone,
        role,
        email: email || null,
        active: true,
        commissionRate: role === 'TECHNICIAN' ? (requestedRate ?? 0) : 0,
        passwordHash: hashPassword(password),
      },
    });

    return NextResponse.json({
      success: true,
      user: publicUser(newUser),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: 'Unable to create team member' }, { status: 500 });
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

    if (typeof userId !== 'string' || !userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (currentUser.role === 'DISPATCHER' && targetUser.role !== 'TECHNICIAN') {
      return NextResponse.json(
        { success: false, error: 'Dispatchers may only manage Technician users' },
        { status: 403 }
      );
    }

    const updateData: any = {};
    if (typeof active === 'boolean') {
      updateData.active = active;
    }
    if (body.commissionRate !== undefined) {
      if (targetUser.role !== 'TECHNICIAN') {
        return NextResponse.json(
          { success: false, error: 'Commission rates only apply to Technician users' },
          { status: 400 }
        );
      }
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
      : targetUser;

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
      user: publicUser(updatedUser),
      emailResult,
      message: body.commissionRate !== undefined
        ? `Commission rate for ${updatedUser.name} updated to ${updatedUser.commissionRate.toFixed(2)}%`
        : active
        ? `Contractor ${updatedUser.name} approved & activated!`
        : `Contractor ${updatedUser.name} deactivated.`,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: 'Unable to update team member' }, { status: 500 });
  }
}
