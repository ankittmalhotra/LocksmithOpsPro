import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'admin123');
  if (!adminPassword) throw new Error('ADMIN_PASSWORD must be set when seeding production');

  await prisma.user.upsert({
    where: { phone: '0000000000' },
    update: {
      name: 'Administrator',
      email: 'admin@locksmithops.com',
      role: 'ADMIN',
      active: true,
      passwordHash: hashPassword(adminPassword),
    },
    create: {
      id: 'super-admin-root',
      name: 'Administrator',
      phone: '0000000000',
      email: 'admin@locksmithops.com',
      role: 'ADMIN',
      active: true,
      commissionRate: 0,
      passwordHash: hashPassword(adminPassword),
    },
  });

  const entities = [
    {
      code: 'IT_MARKETING',
      legalName: '1001744934 ONTARIO INC.',
      corporationNumber: '1001744934',
      province: 'Ontario',
      country: 'Canada',
    },
    {
      code: 'LOCKSMITH',
      legalName: '1001348245 ONTARIO INC.',
      corporationNumber: '1001348245',
      email: 'bcltoronto1@gmail.com',
      addressLine1: '27 Knollside Drive',
      city: 'Richmond Hill',
      province: 'Ontario',
      postalCode: 'L4C4W7',
      country: 'Canada',
      authorizedPersonName: 'UMAR QURESHI',
      authorizedPersonTitle: 'Director',
    },
  ];

  for (const entityData of entities) {
    await prisma.accountingEntity.upsert({
      where: { code: entityData.code },
      update: {
        ...entityData,
        partnerBillingAnchor: new Date('2026-09-07T00:00:00.000Z'),
      },
      create: {
        ...entityData,
        partnerBillingAnchor: new Date('2026-09-07T00:00:00.000Z'),
      },
    });
  }

  const accountingEntities = await prisma.accountingEntity.findMany({
    select: { id: true, code: true },
  });
  const admin = await prisma.user.findUnique({
    where: { phone: '0000000000' },
    select: { id: true },
  });
  if (admin) {
    for (const entity of accountingEntities) {
      await prisma.accountingEntityMembership.upsert({
        where: { userId_entityId: { userId: admin.id, entityId: entity.id } },
        update: { canView: true, canManageExpenses: true, canIssueInvoices: true, canMarkPayments: true },
        create: { userId: admin.id, entityId: entity.id, canView: true, canManageExpenses: true, canIssueInvoices: true, canMarkPayments: true },
      });
    }
  }

  const dispatchers = await prisma.user.findMany({ where: { role: 'DISPATCHER', active: true }, select: { id: true } });
  const locksmithEntity = accountingEntities.find((entity) => entity.code === 'LOCKSMITH');
  if (locksmithEntity) {
    for (const dispatcher of dispatchers) {
      await prisma.accountingEntityMembership.upsert({
        where: { userId_entityId: { userId: dispatcher.id, entityId: locksmithEntity.id } },
        update: { canView: true, canManageExpenses: true, canIssueInvoices: false, canMarkPayments: false },
        create: { userId: dispatcher.id, entityId: locksmithEntity.id, canView: true, canManageExpenses: true, canIssueInvoices: false, canMarkPayments: false },
      });
    }
  }

  console.log('Initial admin ready; use ADMIN_PASSWORD to sign in.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
