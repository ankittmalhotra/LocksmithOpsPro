import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import {
  calculateJobSettlementPosition,
  calculateManualInvoice,
  calculatePendingManualCardInvoice,
  DEFAULT_MANUAL_CARD_SURCHARGE_RATE,
  isCardPaymentMethod,
  SupportedPaymentMethod,
} from '@/lib/calculations';
import { MANUAL_JOB_RECEIVED_TIME_SLOTS, MANUAL_PAYMENT_METHODS, MANUAL_SERVICE_TYPES } from '@/lib/manual-job';
import { normalizeJobNumber } from '@/lib/job-number';
import { sendRevenueChangeEmail } from '@/lib/revenue-email';
import { formatTorontoDateInput, torontoDateToMidnightIso } from '@/lib/timezone';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import { ManualJobInputError, parseManualAmount, parseManualPercentage } from '@/lib/manual-amount';

const MANUAL_PAYMENT_STATUSES = ['PENDING', 'PAID'] as const;
type ManualPaymentStatus = (typeof MANUAL_PAYMENT_STATUSES)[number];

async function handlePOST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required' }, { status: 401 });
    }
    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'DISPATCHER') {
      return NextResponse.json({ success: false, error: 'Forbidden: Dispatcher access required' }, { status: 403 });
    }

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid manual job payload' }, { status: 400 });
    }
    const jobNumber = normalizeJobNumber(body.jobNumber);
    const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
    const rawPhone = typeof body.customerPhone === 'string' ? body.customerPhone : '';
    const customerPhone = rawPhone.replace(/[^0-9]/g, '');
    const customerExtension = typeof body.customerExtension === 'string' ? body.customerExtension.trim() : '';
    const serviceAddress = typeof body.serviceAddress === 'string' ? body.serviceAddress.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const selectedServiceType = typeof body.serviceType === 'string' ? body.serviceType.trim() : '';
    const otherServiceType = typeof body.otherServiceType === 'string' ? body.otherServiceType.trim() : '';
    const serviceType = selectedServiceType === 'Other' ? otherServiceType : selectedServiceType;
    const jobReceivedTimeSlot = typeof body.jobReceivedTimeSlot === 'string' ? body.jobReceivedTimeSlot.trim() : '';
    const paymentMethod = body.paymentMethod as string;
    const technicianId = typeof body.technicianId === 'string' ? body.technicianId.trim() : '';
    const otherTechnicianName = typeof body.otherTechnicianName === 'string' ? body.otherTechnicianName.trim() : '';
    const isOtherTechnician = technicianId === 'OTHER';
    const jobDateInput = body.jobDate === undefined ? formatTorontoDateInput() : body.jobDate;
    const jobDateIso = torontoDateToMidnightIso(jobDateInput);
    if (!jobDateIso) {
      return NextResponse.json({ success: false, error: 'Job date must be a valid YYYY-MM-DD date' }, { status: 400 });
    }
    const manualTimestamp = new Date(jobDateIso);

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
    if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      return NextResponse.json({ success: false, error: 'Invalid payment method' }, { status: 400 });
    }
    const requestedPaymentStatus = body.paymentStatus === undefined ? 'PAID' : body.paymentStatus;
    if (!(MANUAL_PAYMENT_STATUSES as readonly string[]).includes(requestedPaymentStatus)) {
      return NextResponse.json({ success: false, error: 'Invalid payment status' }, { status: 400 });
    }
    if (typeof body.taxCollected !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Tax collected must be Yes or No' }, { status: 400 });
    }

    const totalAmountCollected = parseManualAmount(body.totalAmountCollected, 'Total amount collected', false);
    const cogsAmount = parseManualAmount(body.cogsAmount, 'COGS (Parts, etc.) amount');
    const technicianCommission = parseManualAmount(body.technicianCommission, 'Technician commission');
    const [existingJob, technician] = await Promise.all([
      prisma.job.findUnique({ where: { jobNumber }, select: { id: true } }),
      isOtherTechnician || !technicianId
        ? Promise.resolve(null)
        : prisma.user.findUnique({
            where: { id: technicianId },
            select: { id: true, name: true, role: true, active: true },
          }),
    ]);
    if (existingJob) {
      return NextResponse.json({ success: false, error: `Job #${jobNumber} already exists` }, { status: 409 });
    }
    if (isOtherTechnician && !otherTechnicianName) {
      return NextResponse.json({ success: false, error: 'A technician name is required when Other is selected' }, { status: 400 });
    }
    if (!isOtherTechnician && (!technician || technician.role !== 'TECHNICIAN' || !technician.active)) {
      return NextResponse.json({ success: false, error: 'Selected technician is not active' }, { status: 400 });
    }

    const payment = paymentMethod as SupportedPaymentMethod;
    const paymentStatus = requestedPaymentStatus as ManualPaymentStatus;
    const pendingCardPayment = paymentStatus === 'PENDING' && isCardPaymentMethod(payment);
    const cardSurchargeRate = pendingCardPayment
      ? parseManualPercentage(
          body.cardSurchargeRate === undefined ? DEFAULT_MANUAL_CARD_SURCHARGE_RATE * 100 : body.cardSurchargeRate,
          'Card processing fee',
        )
      : 0;
    const manualCalculation = pendingCardPayment
      ? calculatePendingManualCardInvoice({ amountToBeCollected: totalAmountCollected, cardSurchargeRate })
      : calculateManualInvoice({ amountCollected: totalAmountCollected, taxCollected: body.taxCollected });
    const settlement = calculateJobSettlementPosition({
      paymentMethod: payment,
      grandTotal: manualCalculation.grandTotal,
      workerCommission: technicianCommission,
    });

    const job = await prisma.$transaction(async (tx) => {
      let customer = await tx.customer.findFirst({ where: { phone: customerPhone } });
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            name: customerName,
            phone: customerPhone,
            extension: customerExtension || null,
            address: serviceAddress,
          },
        });
      }

      const created = await tx.job.create({
        data: {
          jobNumber,
          customerId: customer.id,
          dispatcherId: currentUser.id,
          technicianId: technician?.id || null,
          technicianName: isOtherTechnician ? otherTechnicianName : null,
          status: 'COMPLETED',
          isManual: true,
          serviceType,
          problemDescription: description,
          serviceAddress,
          jobReceivedTimeSlot: jobReceivedTimeSlot || null,
          workerCommissionRate: 0,
          workerCommission: technicianCommission,
          createdAt: manualTimestamp,
          completedAt: manualTimestamp,
          invoice: {
            create: {
              calculationMode: 'MANUAL',
              subtotal: manualCalculation.subtotal,
              partsTotal: 0,
              laborTotal: manualCalculation.laborTotal,
              taxRate: manualCalculation.taxRate,
              taxAmount: manualCalculation.taxAmount,
              cardSurchargeRate: manualCalculation.cardSurchargeRate,
              cardSurchargeAmount: manualCalculation.cardSurchargeAmount,
              grandTotal: manualCalculation.grandTotal,
              totalAmountCollected,
              // Stripe Tax is always on for pending card invoices.
              taxCollected: pendingCardPayment ? true : body.taxCollected,
              cogsAmount,
              paymentStatus,
              paymentMethod: payment,
              cashOwedToCompany: settlement.cashOwedToCompany,
              paidAt: paymentStatus === 'PAID' ? manualTimestamp : null,
            },
          },
        },
        include: {
          customer: true,
          technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
          dispatcher: { select: { id: true, name: true, phone: true, email: true, active: true } },
          invoice: true,
        },
      });
      return created;
    });

    const revenueEmail = await sendRevenueChangeEmail(job, 'CREATED');
    return NextResponse.json({
      success: true,
      job,
      message: `Manual Job #${job.jobNumber} recorded successfully.`,
      revenueEmail: { success: revenueEmail.success, error: revenueEmail.error },
    }, { status: 201 });
  } catch (err: any) {
    if (err instanceof ManualJobInputError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ success: false, error: 'That job number already exists' }, { status: 409 });
    }
    logCaughtRequestError(request, '/api/jobs/manual', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'Failed to create manual job') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/jobs/manual', handlePOST);
