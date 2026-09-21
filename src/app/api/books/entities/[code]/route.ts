import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getAccountingEntityAccess } from '@/lib/accounting-auth';
import { getApiErrorMessage } from '@/lib/api-error';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { isBooksEntityCode, parseDateOnly } from '@/lib/books-api';

async function handleGET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await getCurrentUser();
    const { code: rawCode } = await params;
    if (!isBooksEntityCode(rawCode)) return NextResponse.json({ success: false, error: 'Invalid Books entity' }, { status: 400 });
    const access = await getAccountingEntityAccess(rawCode, user);
    if (!access?.canView) return NextResponse.json({ success: false, error: 'Forbidden: Books access required' }, { status: 403 });
    return NextResponse.json({ success: true, entity: access.entity });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/entities/[code]', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to load Books entity') }, { status: 500 });
  }
}

async function handlePATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    const { code: rawCode } = await params;
    if (!isBooksEntityCode(rawCode)) return NextResponse.json({ success: false, error: 'Invalid Books entity' }, { status: 400 });
    const body = await request.json();
    const hstRegistrationNumber = typeof body.hstRegistrationNumber === 'string' ? body.hstRegistrationNumber.trim() : '';
    const hstEffectiveDate = body.hstEffectiveDate ? parseDateOnly(body.hstEffectiveDate, 'hstEffectiveDate') : null;
    const hstEnabled = body.hstEnabled === undefined ? Boolean(hstRegistrationNumber && hstEffectiveDate) : body.hstEnabled === true;
    if (hstEnabled && (!hstRegistrationNumber || !hstEffectiveDate)) {
      return NextResponse.json({ success: false, error: 'HST registration number and effective date are required to enable HST' }, { status: 400 });
    }
    const entity = await prisma.accountingEntity.findUnique({ where: { code: rawCode } });
    if (!entity) return NextResponse.json({ success: false, error: 'Books entity not found' }, { status: 404 });
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.accountingEntity.update({
        where: { id: entity.id },
        data: {
          hstRegistrationNumber: hstRegistrationNumber || null,
          hstEffectiveDate: hstEffectiveDate ? new Date(`${hstEffectiveDate}T00:00:00.000Z`) : null,
          hstEnabled,
        },
      });
      await tx.accountingAuditEvent.create({
        data: {
          entityId: entity.id,
          actorId: user.id,
          action: 'UPDATED',
          resourceType: 'AccountingEntity',
          resourceId: entity.id,
          metadata: { hstRegistrationNumber: hstRegistrationNumber || null, hstEffectiveDate, hstEnabled },
        },
      });
      return saved;
    });
    return NextResponse.json({ success: true, entity: { ...updated, hstEffectiveDate: updated.hstEffectiveDate?.toISOString() || null } });
  } catch (error) {
    logCaughtRequestError(request, '/api/books/entities/[code]', error);
    return NextResponse.json({ success: false, error: getApiErrorMessage(error, 'Unable to update HST settings') }, { status: 400 });
  }
}

export const GET = withRequestLogging('/api/books/entities/[code]', handleGET);
export const PATCH = withRequestLogging('/api/books/entities/[code]', handlePATCH);
