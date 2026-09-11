import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { findJobByIdOrNumber } from '@/lib/job-helper';
import { calculateJobSettlementPosition, calculateManualInvoice, roundToTwo, type SupportedPaymentMethod } from '@/lib/calculations';
import { MANUAL_JOB_RECEIVED_TIME_SLOTS, MANUAL_PAYMENT_METHODS, MANUAL_SERVICE_TYPES } from '@/lib/manual-job';
import { normalizeJobNumber } from '@/lib/job-number';
import { sendRevenueChangeEmail } from '@/lib/revenue-email';

class ManualJobInputError extends Error {}

function amount(value: unknown, field: string, allowZero = true): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
    throw new ManualJobInputError(`${field} must be a valid ${allowZero ? 'non-negative' : 'positive'} amount`);
  }
  return roundToTwo(parsed);
}

function isManualRole(role: string) {
  return role === 'ADMIN' || role === 'DISPATCHER';
}

function safeJobInclude() {
  return {
    customer: true,
    technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
    dispatcher: { select: { id: true, name: true, phone: true, email: true, active: true } },
    invoice: true,
  } as const;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required' }, { status: 401 });
    }
    if (!isManualRole(currentUser.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Dispatcher access required' }, { status: 403 });
    }

    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job || !job.isManual) {
      return NextResponse.json({ success: false, error: 'Manual job entry not found' }, { status: 404 });
    }
    if (!job.invoice) {
      return NextResponse.json({ success: false, error: 'Manual job invoice is missing' }, { status: 409 });
    }
    const invoice = job.invoice;

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid manual job update' }, { status: 400 });
    }

    const jobNumber = body.jobNumber === undefined ? job.jobNumber : normalizeJobNumber(body.jobNumber);
    const customerName = body.customerName === undefined ? job.customer.name : String(body.customerName).trim();
    const rawPhone = body.customerPhone === undefined ? job.customer.phone : String(body.customerPhone);
    const customerPhone = rawPhone.replace(/[^0-9]/g, '');
    const customerExtension = body.customerExtension === undefined
      ? (job.customer.extension || '')
      : String(body.customerExtension).trim();
    const serviceAddress = body.serviceAddress === undefined ? job.serviceAddress : String(body.serviceAddress).trim();
    const description = body.description === undefined ? job.problemDescription : String(body.description).trim();
    const existingTypeIsKnown = MANUAL_SERVICE_TYPES.includes(job.serviceType as (typeof MANUAL_SERVICE_TYPES)[number]);
    const selectedServiceType = body.serviceType === undefined
      ? (existingTypeIsKnown ? job.serviceType : 'Other')
      : String(body.serviceType).trim();
    const otherServiceType = body.otherServiceType === undefined
      ? (existingTypeIsKnown ? '' : job.serviceType)
      : String(body.otherServiceType).trim();
    const serviceType = selectedServiceType === 'Other' ? otherServiceType : selectedServiceType;
    const jobReceivedTimeSlot = body.jobReceivedTimeSlot === undefined
      ? (job.jobReceivedTimeSlot || '')
      : String(body.jobReceivedTimeSlot).trim();
    const paymentMethod = body.paymentMethod === undefined
      ? invoice.paymentMethod
      : body.paymentMethod;
    const technicianId = body.technicianId === undefined
      ? (job.technicianId || (job.technicianName ? 'OTHER' : ''))
      : String(body.technicianId).trim();
    const otherTechnicianName = body.otherTechnicianName === undefined
      ? (job.technicianName || '')
      : String(body.otherTechnicianName).trim();
    const isOtherTechnician = technicianId === 'OTHER';
    const taxCollected = body.taxCollected === undefined
      ? invoice.taxCollected !== false
      : body.taxCollected;

    if (!jobNumber) {
      return NextResponse.json({ success: false, error: 'Job number must be a positive whole number' }, { status: 400 });
    }
    if (!customerName || customerPhone.length < 7 || !serviceAddress || !description) {
      return NextResponse.json({ success: false, error: 'Customer name, valid phone, address, and description are required' }, { status: 400 });
    }
    if (!(MANUAL_SERVICE_TYPES as readonly string[]).includes(selectedServiceType) && selectedServiceType !== 'Other') {
      return NextResponse.json({ success: false, error: 'Invalid job type' }, { status: 400 });
    }
    if (!serviceType) {
      return NextResponse.json({ success: false, error: 'A job type is required when Other is selected' }, { status: 400 });
    }
    if (jobReceivedTimeSlot && !(MANUAL_JOB_RECEIVED_TIME_SLOTS as readonly string[]).includes(jobReceivedTimeSlot)) {
      return NextResponse.json({ success: false, error: 'Invalid job received time window' }, { status: 400 });
    }
    if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(paymentMethod as string)) {
      return NextResponse.json({ success: false, error: 'Invalid payment method' }, { status: 400 });
    }
    if (typeof taxCollected !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Tax collected must be Yes or No' }, { status: 400 });
    }

    const totalAmountCollected = amount(
      body.totalAmountCollected === undefined ? invoice.totalAmountCollected || invoice.grandTotal : body.totalAmountCollected,
      'Total amount collected',
      false
    );
    const cogsAmount = amount(
      body.cogsAmount === undefined ? invoice.cogsAmount : body.cogsAmount,
      'COGS (Parts, etc.) amount'
    );
    const technicianCommission = amount(
      body.technicianCommission === undefined ? job.workerCommission : body.technicianCommission,
      'Technician commission'
    );
    const manualCalculation = calculateManualInvoice({
      amountCollected: totalAmountCollected,
      taxCollected,
    });

    const technician = isOtherTechnician || !technicianId
      ? null
      : await prisma.user.findUnique({
          where: { id: technicianId },
          select: { id: true, role: true, active: true },
        });
    if (isOtherTechnician && !otherTechnicianName) {
      return NextResponse.json({ success: false, error: 'A technician name is required when Other is selected' }, { status: 400 });
    }
    if (!isOtherTechnician && (!technician || technician.role !== 'TECHNICIAN' || !technician.active)) {
      return NextResponse.json({ success: false, error: 'Selected technician is not active' }, { status: 400 });
    }

    const payment = paymentMethod as SupportedPaymentMethod;
    const settlement = calculateJobSettlementPosition({
      paymentMethod: payment,
      grandTotal: totalAmountCollected,
      workerCommission: technicianCommission,
    });

    const updatedJob = await prisma.$transaction(async (tx) => {
      let customerId = job.customerId;
      const customerChanged = customerName !== job.customer.name
        || customerPhone !== job.customer.phone
        || customerExtension !== (job.customer.extension || '')
        || serviceAddress !== job.serviceAddress;

      if (customerChanged) {
        const linkedJobCount = await tx.job.count({ where: { customerId: job.customerId } });
        if (linkedJobCount === 1) {
          await tx.customer.update({
            where: { id: job.customerId },
            data: { name: customerName, phone: customerPhone, extension: customerExtension || null, address: serviceAddress },
          });
        } else {
          const matchingCustomer = await tx.customer.findFirst({
            where: { phone: customerPhone, id: { not: job.customerId } },
          });
          if (matchingCustomer) {
            customerId = matchingCustomer.id;
          } else {
            const newCustomer = await tx.customer.create({
              data: { name: customerName, phone: customerPhone, extension: customerExtension || null, address: serviceAddress },
            });
            customerId = newCustomer.id;
          }
        }
      }

      await tx.invoice.update({
        where: { jobId: job.id },
        data: {
          calculationMode: 'MANUAL',
          subtotal: manualCalculation.subtotal,
          partsTotal: 0,
          laborTotal: manualCalculation.laborTotal,
          taxRate: manualCalculation.taxRate,
          taxAmount: manualCalculation.taxAmount,
          cardSurchargeRate: 0,
          cardSurchargeAmount: 0,
          grandTotal: manualCalculation.grandTotal,
          totalAmountCollected,
          taxCollected,
          cogsAmount,
          paymentStatus: 'PAID',
          paymentMethod: payment,
          cashOwedToCompany: settlement.cashOwedToCompany,
          paidAt: invoice.paidAt || new Date(),
        },
      });

      return tx.job.update({
        where: { id: job.id },
        data: {
          jobNumber,
          customerId,
          technicianId: technician?.id || null,
          technicianName: isOtherTechnician ? otherTechnicianName : null,
          serviceType,
          problemDescription: description,
          serviceAddress,
          jobReceivedTimeSlot: jobReceivedTimeSlot || null,
          workerCommissionRate: 0,
          workerCommission: technicianCommission,
          status: 'COMPLETED',
          completedAt: job.completedAt || new Date(),
        },
        include: safeJobInclude(),
      });
    });

    const previousRevenue = {
      totalAmountCollected: Number(invoice.totalAmountCollected || invoice.grandTotal || 0),
      cogsAmount: Number(invoice.cogsAmount || 0),
      taxCollected: invoice.taxCollected !== false,
      paymentMethod: invoice.paymentMethod,
      technicianCommission: Number(job.workerCommission || 0),
    };
    const revenueChanged = previousRevenue.totalAmountCollected !== totalAmountCollected
      || previousRevenue.cogsAmount !== cogsAmount
      || previousRevenue.taxCollected !== taxCollected
      || previousRevenue.paymentMethod !== payment
      || previousRevenue.technicianCommission !== technicianCommission;
    let revenueEmail: { success: boolean; error?: string } | null = null;
    if (revenueChanged) {
      const result = await sendRevenueChangeEmail(updatedJob, 'UPDATED');
      revenueEmail = { success: result.success, error: result.error };
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
      message: `Manual Job #${updatedJob.jobNumber} updated successfully.`,
      revenueEmail,
    });
  } catch (err: any) {
    if (err instanceof ManualJobInputError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ success: false, error: 'That job number already exists' }, { status: 409 });
    }
    console.error('Manual job update error:', err);
    return NextResponse.json({ success: false, error: 'Failed to update manual job' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required' }, { status: 401 });
    }
    if (!isManualRole(currentUser.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Dispatcher access required' }, { status: 403 });
    }

    const { id } = await params;
    const job = await findJobByIdOrNumber(id);
    if (!job || !job.isManual) {
      return NextResponse.json({ success: false, error: 'Manual job entry not found' }, { status: 404 });
    }

    await prisma.job.delete({ where: { id: job.id } });
    return NextResponse.json({
      success: true,
      message: `Manual Job #${job.jobNumber} deleted successfully.`,
    });
  } catch (err: any) {
    console.error('Manual job delete error:', err);
    return NextResponse.json({ success: false, error: 'Failed to delete manual job' }, { status: 500 });
  }
}
