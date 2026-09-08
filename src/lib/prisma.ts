import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;

if (!databaseUrl) {
  throw new Error(
    'Database is not configured. Set POSTGRES_PRISMA_URL in the deployment environment (POSTGRES_URL_NON_POOLING may be used as a fallback).'
  );
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
