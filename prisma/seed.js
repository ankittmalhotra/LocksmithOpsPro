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
