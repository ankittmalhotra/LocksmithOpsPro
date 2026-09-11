import { PrismaClient } from '@prisma/client';

// Support both the current Vercel/Supabase names and the legacy names so a
// deployment or local checkout is not taken offline during the rename.
const databaseUrl =
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.DIRECT_URL;

if (!databaseUrl) {
  throw new Error(
    'Database is not configured. Set POSTGRES_PRISMA_URL (or legacy DATABASE_URL) in the deployment environment.'
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
