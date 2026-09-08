import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { phone: '0000000000' },
    update: {
      name: 'Administrator',
      email: 'admin@locksmithops.com',
      role: 'SUPER_ADMIN',
      active: true,
    },
    create: {
      id: 'super-admin-root',
      name: 'Administrator',
      phone: '0000000000',
      email: 'admin@locksmithops.com',
      role: 'SUPER_ADMIN',
      active: true,
      commissionRate: 0,
    },
  });

  console.log('Initial admin ready: admin / admin123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
