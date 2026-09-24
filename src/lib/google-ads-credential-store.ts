import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const CREDENTIAL_ID = 'primary';

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encodedKey) throw new Error('Set GOOGLE_ADS_TOKEN_ENCRYPTION_KEY before connecting Google Ads.');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new Error('GOOGLE_ADS_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

function encryptRefreshToken(refreshToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptRefreshToken(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Stored Google Ads credentials have an unsupported format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export async function assertGoogleAdsCredentialStoreReady(): Promise<void> {
  getEncryptionKey();
  const { prisma } = await import('@/lib/prisma');
  await prisma.googleAdsOAuthCredential.findUnique({ where: { id: CREDENTIAL_ID }, select: { id: true } });
}

export async function getStoredGoogleAdsRefreshToken(): Promise<string | null> {
  if (!process.env.POSTGRES_PRISMA_URL && !process.env.POSTGRES_URL_NON_POOLING
    && !process.env.DATABASE_URL && !process.env.DIRECT_URL) return null;
  try {
    const { prisma } = await import('@/lib/prisma');
    const credential = await prisma.googleAdsOAuthCredential.findUnique({ where: { id: CREDENTIAL_ID } });
    return credential ? decryptRefreshToken(credential.encryptedRefreshToken) : null;
  } catch (error) {
    // Preserve the existing environment-token setup until the additive OAuth
    // credential table migration has been applied.
    if ((error as { code?: string })?.code === 'P2021') return null;
    throw error;
  }
}

export async function saveGoogleAdsRefreshToken(refreshToken: string): Promise<void> {
  const encryptedRefreshToken = encryptRefreshToken(refreshToken);
  const { prisma } = await import('@/lib/prisma');
  await prisma.googleAdsOAuthCredential.upsert({
    where: { id: CREDENTIAL_ID },
    create: { id: CREDENTIAL_ID, encryptedRefreshToken },
    update: { encryptedRefreshToken },
  });
}
