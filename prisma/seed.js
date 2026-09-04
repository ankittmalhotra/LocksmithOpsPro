import { PrismaClient } from '@prisma/client';
import { calculateReverseInvoice, calculateForwardInvoice, calculateTravelFee, calculateJobSettlementPosition } from '../src/lib/calculations.ts';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Locksmith Operations database...');

  // 1. Create Users
  const superAdmin = await prisma.user.upsert({
    where: { phone: '0000000000' },
    update: { role: 'SUPER_ADMIN' },
    create: {
      name: 'Super Admin',
      phone: '0000000000',
      email: 'admin@locksmithops.com',
      role: 'SUPER_ADMIN',
    },
  });

  const owner = await prisma.user.upsert({
    where: { phone: '4165550100' },
    update: {},
    create: {
      name: 'Alex Vance (Owner)',
      phone: '4165550100',
      email: 'owner@torontolocksmith.com',
      role: 'OWNER',
    },
  });

  const dispatcher = await prisma.user.upsert({
    where: { phone: '4165550200' },
    update: {},
    create: {
      name: 'Sarah Connor (Dispatch)',
      phone: '4165550200',
      email: 'dispatch@torontolocksmith.com',
      role: 'DISPATCHER',
    },
  });

  const techDave = await prisma.user.upsert({
    where: { phone: '6475550301' },
    update: {},
    create: {
      name: 'Dave Miller',
      phone: '6475550301',
      email: 'dave@torontolocksmith.com',
      role: 'TECHNICIAN',
    },
  });

  const techSam = await prisma.user.upsert({
    where: { phone: '6475550302' },
    update: {},
    create: {
      name: 'Sam Chen',
      phone: '6475550302',
      email: 'sam@torontolocksmith.com',
      role: 'TECHNICIAN',
    },
  });

  console.log('Users created:', { owner: owner.name, dispatcher: dispatcher.name, tech1: techDave.name, tech2: techSam.name });

  // 2. Customers
  const custAtivan = await prisma.customer.create({
    data: {
      name: 'Ativan',
      phone: '6479510901',
      extension: '762',
      address: '663 Bloor Street West',
      postalCode: 'M6G 1L1',
      notes: 'Commercial storefront on Bloor W',
    },
  });

  const custYorkville = await prisma.customer.create({
    data: {
      name: 'Yorkville Boutique',
      phone: '4169221100',
      address: '138 Cumberland St',
      postalCode: 'M5R 1A6',
    },
  });

  const custQueenSt = await prisma.customer.create({
    data: {
      name: 'Queen St Bakery',
      phone: '4165042211',
      address: '740 Queen St W',
      postalCode: 'M6J 1E9',
    },
  });

  const custRoncy = await prisma.customer.create({
    data: {
      name: 'Roncesvalles Office',
      phone: '4165319988',
      address: '321 Roncesvalles Ave',
      postalCode: 'M6R 2M6',
    },
  });

  // 3. Create Sample Jobs
  // Job 9815: In progress (The exact user prompt example)
  const job9815 = await prisma.job.create({
    data: {
      jobNumber: 9815,
      customerId: custAtivan.id,
      dispatcherId: dispatcher.id,
      technicianId: techDave.id,
      status: 'ON_SITE',
      serviceType: 'Commercial Lock Change',
      problemDescription: 'Need replaced lock cylinder on the glass door at the bottom',
      serviceAddress: '663 Bloor Street West, Toronto, Ontario M6G 1L1',
      workerCommission: 300.0,
      dispatchedAt: new Date(),
    },
  });

  // Job 9814: Completed (Cash job reverse calculation)
  const calc9814 = calculateReverseInvoice({ amountReceived: 850.0, partsTotal: 45.0, paymentMethod: 'CASH' });
  const settlement9814 = calculateJobSettlementPosition({ paymentMethod: 'CASH', grandTotal: 850.0, workerCommission: 200.0 });
  const job9814 = await prisma.job.create({
    data: {
      jobNumber: 9814,
      customerId: custYorkville.id,
      dispatcherId: dispatcher.id,
      technicianId: techDave.id,
      status: 'COMPLETED',
      serviceType: 'Rekey Commercial Master System',
      problemDescription: 'Rekey 6 interior locks and 2 exterior mortise cylinders',
      serviceAddress: '138 Cumberland St, Toronto, ON M5R 1A6',
      workerCommission: 200.0,
      completedAt: new Date(Date.now() - 3600000 * 3),
      items: {
        create: [
          { description: 'Commercial Rekeying Labor', quantity: 1, unitPrice: calc9814.laborTotal, isPart: false },
          { description: 'Replacement Mortise Cylinder', quantity: 1, unitPrice: 45.0, unitCost: 18.0, isPart: true },
        ],
      },
      invoice: {
        create: {
          calculationMode: 'REVERSE',
          subtotal: calc9814.subtotal,
          partsTotal: calc9814.partsTotal,
          laborTotal: calc9814.laborTotal,
          taxRate: calc9814.taxRate,
          taxAmount: calc9814.taxAmount,
          cardSurchargeRate: 0,
          cardSurchargeAmount: 0,
          grandTotal: calc9814.grandTotal,
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          cashOwedToCompany: settlement9814.cashOwedToCompany,
          paidAt: new Date(Date.now() - 3600000 * 3),
        },
      },
    },
  });

  // Job 9813: Completed (Stripe Card with 4% surcharge)
  const calc9813 = calculateForwardInvoice({ laborAmount: 180.0, partsTotal: 25.0, paymentMethod: 'STRIPE_CARD' });
  const settlement9813 = calculateJobSettlementPosition({ paymentMethod: 'STRIPE_CARD', grandTotal: calc9813.grandTotal, workerCommission: 75.0 });
  const job9813 = await prisma.job.create({
    data: {
      jobNumber: 9813,
      customerId: custQueenSt.id,
      dispatcherId: dispatcher.id,
      technicianId: techSam.id,
      status: 'COMPLETED',
      serviceType: 'Emergency Lockout',
      problemDescription: 'Storefront deadbolt jammed, customer locked out',
      serviceAddress: '740 Queen St W, Toronto, ON M6J 1E9',
      workerCommission: 75.0,
      completedAt: new Date(Date.now() - 3600000 * 5),
      items: {
        create: [
          { description: 'Emergency Entry Labor', quantity: 1, unitPrice: 180.0, isPart: false },
          { description: 'Standard Deadbolt Latch', quantity: 1, unitPrice: 25.0, unitCost: 10.0, isPart: true },
        ],
      },
      invoice: {
        create: {
          calculationMode: 'FORWARD',
          subtotal: calc9813.subtotal,
          partsTotal: calc9813.partsTotal,
          laborTotal: calc9813.laborTotal,
          taxRate: calc9813.taxRate,
          taxAmount: calc9813.taxAmount,
          cardSurchargeRate: calc9813.cardSurchargeRate,
          cardSurchargeAmount: calc9813.cardSurchargeAmount,
          grandTotal: calc9813.grandTotal,
          paymentStatus: 'PAID',
          paymentMethod: 'STRIPE_CARD',
          cashOwedToCompany: 0,
          smsSent: true,
          stripeSessionId: 'cs_test_mock123',
          paidAt: new Date(Date.now() - 3600000 * 5),
        },
      },
    },
  });

  // Job 9812: Abandoned Travel Fee ($25)
  const calc9812 = calculateTravelFee({ travelFeeAmount: 25.0, paymentMethod: 'CASH' });
  const settlement9812 = calculateJobSettlementPosition({ paymentMethod: 'CASH', grandTotal: calc9812.grandTotal, workerCommission: 10.0 });
  const job9812 = await prisma.job.create({
    data: {
      jobNumber: 9812,
      customerId: custRoncy.id,
      dispatcherId: dispatcher.id,
      technicianId: techDave.id,
      status: 'ABANDONED_TRAVEL_FEE',
      isAbandoned: true,
      travelFeeAmount: 25.0,
      serviceType: 'Deadbolt Service Call',
      problemDescription: 'Customer canceled after technician arrived at location',
      serviceAddress: '321 Roncesvalles Ave, Toronto, ON M6R 2M6',
      workerCommission: 10.0,
      completedAt: new Date(Date.now() - 3600000 * 8),
      invoice: {
        create: {
          calculationMode: 'FORWARD',
          subtotal: calc9812.subtotal,
          partsTotal: 0,
          laborTotal: calc9812.laborTotal,
          taxRate: calc9812.taxRate,
          taxAmount: calc9812.taxAmount,
          cardSurchargeRate: 0,
          cardSurchargeAmount: 0,
          grandTotal: calc9812.grandTotal,
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          cashOwedToCompany: settlement9812.cashOwedToCompany,
          paidAt: new Date(Date.now() - 3600000 * 8),
        },
      },
    },
  });

  console.log('Sample jobs created: #9815, #9814, #9813, #9812');
  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
