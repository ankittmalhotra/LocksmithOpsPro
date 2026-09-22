import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

const RECEIPT_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

let client: S3Client | null = null;

function receiptConfig() {
  const bucket = process.env.ACCOUNTING_RECEIPTS_S3_BUCKET;
  if (!bucket) throw new Error('ACCOUNTING_RECEIPTS_S3_BUCKET is not configured');
  return { bucket, region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1' };
}

function s3() {
  if (!client) client = new S3Client({ region: receiptConfig().region });
  return client;
}

export function receiptExtension(mimeType: string) {
  return RECEIPT_TYPES.get(mimeType);
}

export async function uploadAccountingReceipt(entityId: string, file: File) {
  return uploadReceiptWithPrefix(entityId, file, 'accounting');
}

export async function uploadAccountingReceiptDraft(entityId: string, file: File) {
  // Keep drafts under the same `accounting/*` IAM prefix as final receipts.
  return uploadReceiptWithPrefix(entityId, file, 'accounting/drafts');
}

async function uploadReceiptWithPrefix(entityId: string, file: File, prefix: string) {
  const extension = receiptExtension(file.type);
  if (!extension) throw new Error('Receipt must be a PDF, JPG, PNG, or WEBP file');
  if (file.size <= 0 || file.size > RECEIPT_MAX_BYTES) throw new Error('Receipt must be between 1 byte and 10 MB');
  const { bucket } = receiptConfig();
  const key = `${prefix}/${entityId}/${randomUUID()}${extension}`;
  await s3().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type,
    ServerSideEncryption: 'AES256',
  }));
  return { key, fileName: file.name.slice(0, 255), mimeType: file.type, size: file.size };
}

export async function deleteAccountingReceipt(key: string | null | undefined) {
  if (!key) return;
  const { bucket } = receiptConfig();
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    // Receipt cleanup is intentionally best-effort; the accounting row remains authoritative.
  }
}

export async function getAccountingReceipt(key: string) {
  const { bucket } = receiptConfig();
  return s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
}

export async function readAccountingReceiptBytes(key: string) {
  const object = await getAccountingReceipt(key);
  if (!object.Body) throw new Error('Receipt object has no content');
  return new Uint8Array(await object.Body.transformToByteArray());
}
