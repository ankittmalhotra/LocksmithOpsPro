import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail, buildContractorApprovedEmail } from '@/lib/resend';
import { getTechnicianCommission, setTechnicianCommission } from '@/lib/commissions';

export async function GET(request: Request) {
  try {
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
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const users = rawUsers.map((u) => ({
      ...u,
      fixedCommission: getTechnicianCommission(u.phone) || getTechnicianCommission(u.id) || 150.0,
    }));

    return NextResponse.json({ success: true, users });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, role, email, isSelfRegistration } = body;

    if (!name || !phone) {
      return NextResponse.json(
        { success: false, error: 'Name and phone are required' },
        { status: 400 }
      );
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');

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

    const newUser = await prisma.user.upsert({
      where: { phone: cleanPhone },
      update: { name, role, email: email || null, active: true },
      create: {
        name,
        phone: cleanPhone,
        role,
        email: email || null,
        active: true,
      },
    });

    if (body.fixedCommission !== undefined && !isNaN(Number(body.fixedCommission))) {
      const comm = parseFloat(body.fixedCommission);
      setTechnicianCommission(newUser.id, comm);
      setTechnicianCommission(newUser.phone, comm);
    }

    return NextResponse.json({
      success: true,
      user: {
        ...newUser,
        fixedCommission: getTechnicianCommission(newUser.phone) || 150.0,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PATCH to toggle active / approve technician or update fixed commission
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { userId, active, fixedCommission } = body;

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

    const updatedUser = Object.keys(updateData).length > 0
      ? await prisma.user.update({
          where: { id: userId },
          data: updateData,
        })
      : await prisma.user.findUnique({ where: { id: userId } });

    if (!updatedUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (fixedCommission !== undefined && !isNaN(Number(fixedCommission))) {
      const commAmount = parseFloat(fixedCommission);
      setTechnicianCommission(updatedUser.id, commAmount);
      setTechnicianCommission(updatedUser.phone, commAmount);
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

    const currentCommission = getTechnicianCommission(updatedUser.phone) || getTechnicianCommission(updatedUser.id) || 150.0;

    return NextResponse.json({
      success: true,
      user: {
        ...updatedUser,
        fixedCommission: currentCommission,
      },
      emailResult,
      message: fixedCommission !== undefined
        ? `Fixed commission for ${updatedUser.name} updated to $${currentCommission.toFixed(2)}`
        : active
        ? `Contractor ${updatedUser.name} approved & activated!`
        : `Contractor ${updatedUser.name} deactivated.`,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

