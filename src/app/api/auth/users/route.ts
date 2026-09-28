import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail, buildContractorApprovedEmail } from '@/lib/resend';
import { getCurrentUser } from '@/lib/auth';
import { APP_ROLES, type AppRole } from '@/lib/session';
import { hashPassword } from '@/lib/password';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { ACCOUNTING_ENTITY_DEFAULTS } from '@/lib/accounting-types';

function canViewTechnicians(role?: string) {
  return role === 'ADMIN' || role === 'DISPATCHER';
}

function canManageTechnicians(role?: string) {
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

async function handleGET(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || !canViewTechnicians(currentUser.role)) {
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
    logCaughtRequestError(request, '/api/auth/users', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to load team members') }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    const body = await request.json();
    const { name, phone, role, email, password } = body;

    if (!currentUser || !canManageTechnicians(currentUser.role)) {
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

    if (!role) {
      return NextResponse.json(
        { success: false, error: 'Role is required for team member creation' },
        { status: 400 }
      );
    }

    if (!isAppRole(role)) {
      return NextResponse.json({ success: false, error: 'Invalid team member role' }, { status: 400 });
    }

    if (currentUser.role === 'DISPATCHER' && role !== 'TECHNICIAN') {
      return NextResponse.json(
        { success: false, error: 'Dispatchers may only create technicians' },
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

    const newUser = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
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

      if (role === 'ACCOUNTANT') {
        for (const entityDefaults of Object.values(ACCOUNTING_ENTITY_DEFAULTS)) {
          const entity = await tx.accountingEntity.upsert({
            where: { code: entityDefaults.code },
            update: { partnerBillingAnchor: new Date(`${entityDefaults.partnerBillingAnchor}T00:00:00.000Z`) },
            create: {
              ...entityDefaults,
              partnerBillingAnchor: new Date(`${entityDefaults.partnerBillingAnchor}T00:00:00.000Z`),
            },
          });
          await tx.accountingEntityMembership.create({
            data: {
              userId: createdUser.id,
              entityId: entity.id,
              canView: true,
              canManageExpenses: false,
              canManageReimbursements: false,
              canMapAccounting: true,
              canIssueInvoices: false,
              canMarkPayments: false,
            },
          });
        }
      }

      return createdUser;
    });

    return NextResponse.json({
      success: true,
      user: publicUser(newUser),
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/auth/users', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to create team member') }, { status: 500 });
  }
}

// PATCH to activate/deactivate a team member or update a technician commission rate.
async function handlePATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || !canManageTechnicians(currentUser.role)) {
      return NextResponse.json({ success: false, error: 'Team management access required' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, active, name, phone, email, password } = body;
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
        { success: false, error: 'Dispatchers may only manage technicians' },
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
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
      }
      updateData.name = name.trim();
    }
    if (phone !== undefined) {
      if (typeof phone !== 'string' || !phone.trim()) {
        return NextResponse.json({ success: false, error: 'Phone number is required' }, { status: 400 });
      }
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      if (cleanPhone.length < 7) {
        return NextResponse.json({ success: false, error: 'A valid phone number is required' }, { status: 400 });
      }
      const existingPhone = await prisma.user.findFirst({
        where: { phone: cleanPhone, NOT: { id: userId } },
        select: { id: true },
      });
      if (existingPhone) {
        return NextResponse.json(
          { success: false, error: 'An account already exists for this phone number' },
          { status: 409 }
        );
      }
      updateData.phone = cleanPhone;
    }
    if (email !== undefined) {
      if (email !== null && typeof email !== 'string') {
        return NextResponse.json({ success: false, error: 'Email address is invalid' }, { status: 400 });
      }
      updateData.email = typeof email === 'string' && email.trim() ? email.trim() : null;
    }
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 8) {
        return NextResponse.json({ success: false, error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      updateData.passwordHash = hashPassword(password);
    }

    const updatedUser = Object.keys(updateData).length > 0
      ? await prisma.user.update({
          where: { id: userId },
          data: updateData,
        })
      : targetUser;

    // Notify a Technician when an Admin reactivates the account.
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
        : name !== undefined || phone !== undefined || email !== undefined || password !== undefined
        ? `Technician ${updatedUser.name} updated successfully.`
        : active
        ? `Contractor ${updatedUser.name} approved & activated!`
        : `Contractor ${updatedUser.name} deactivated.`,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/auth/users', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to update team member') }, { status: 500 });
  }
}

// DELETE deactivates a technician so historical jobs and settlements remain intact.
async function handleDELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || !canManageTechnicians(currentUser.role)) {
      return NextResponse.json({ success: false, error: 'Team management access required' }, { status: 403 });
    }

    const body = await request.json();
    const { userId } = body;
    if (typeof userId !== 'string' || !userId) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (targetUser.role !== 'TECHNICIAN') {
      return NextResponse.json({ success: false, error: 'Only technicians can be deleted here' }, { status: 400 });
    }

    const deletedUser = await prisma.user.update({
      where: { id: userId },
      data: { active: false },
    });

    return NextResponse.json({
      success: true,
      user: publicUser(deletedUser),
      message: `Technician ${deletedUser.name} deleted.`,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/auth/users', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Unable to delete technician') }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/auth/users', handleGET);
export const POST = withRequestLogging('/api/auth/users', handlePOST);
export const PATCH = withRequestLogging('/api/auth/users', handlePATCH);
export const DELETE = withRequestLogging('/api/auth/users', handleDELETE);
