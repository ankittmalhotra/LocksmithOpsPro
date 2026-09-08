export const APP_ROLES = ['ADMIN', 'DISPATCHER', 'TECHNICIAN'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export interface AuthSession {
  id: string;
  name: string;
  phone: string;
  role: AppRole;
}

const DEVELOPMENT_SESSION_SECRET = 'locksmith-ops-development-only';
const HMAC_BLOCK_SIZE = 64;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function getSessionSecret(): string {
  const configuredSecret = process.env.SESSION_SECRET;
  if (typeof configuredSecret === 'string' && configuredSecret.trim().length > 0) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }

  return DEVELOPMENT_SESSION_SECRET;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(message: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  const bitLength = BigInt(message.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[padded.length - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64);

    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = (
        (padded[wordOffset] << 24) |
        (padded[wordOffset + 1] << 16) |
        (padded[wordOffset + 2] << 8) |
        padded[wordOffset + 3]
      ) >>> 0;
    }

    for (let index = 16; index < 64; index += 1) {
      const value = words[index - 15];
      const smallSigma0 = rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3);
      const previous = words[index - 2];
      const smallSigma1 = rotateRight(previous, 17) ^ rotateRight(previous, 19) ^ (previous >>> 10);
      words[index] = (words[index - 16] + smallSigma0 + words[index - 7] + smallSigma1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + bigSigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let index = 0; index < words.length; index += 1) {
    digest[index * 4] = words[index] >>> 24;
    digest[index * 4 + 1] = words[index] >>> 16;
    digest[index * 4 + 2] = words[index] >>> 8;
    digest[index * 4 + 3] = words[index];
  }
  return digest;
}

function hmacSha256(message: string, secret: string): Uint8Array {
  let key: Uint8Array = new TextEncoder().encode(secret);
  if (key.length > HMAC_BLOCK_SIZE) {
    key = new Uint8Array(sha256(key));
  }

  const paddedKey = new Uint8Array(HMAC_BLOCK_SIZE);
  paddedKey.set(key);

  const messageBytes = new TextEncoder().encode(message);
  const inner = new Uint8Array(HMAC_BLOCK_SIZE + messageBytes.length);
  const outer = new Uint8Array(HMAC_BLOCK_SIZE + 32);

  for (let index = 0; index < HMAC_BLOCK_SIZE; index += 1) {
    inner[index] = paddedKey[index] ^ 0x36;
    outer[index] = paddedKey[index] ^ 0x5c;
  }
  inner.set(messageBytes, HMAC_BLOCK_SIZE);
  outer.set(sha256(inner), HMAC_BLOCK_SIZE);

  return sha256(outer);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error('Invalid base64 value');
  }

  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// Compare the complete fixed-size HMAC output without an early exit.
function timingSafeEqual(actual: Uint8Array, expected: Uint8Array): boolean {
  const length = Math.max(actual.length, expected.length);
  let difference = actual.length ^ expected.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }

  return difference === 0;
}

function normalizeRole(role: unknown): AppRole | null {
  // Signed tokens from before the database role migration can still be
  // understood and are normalized to the only current administrative role.
  if (role === 'SUPER_ADMIN' || role === 'OWNER') return 'ADMIN';
  if (typeof role === 'string' && (APP_ROLES as readonly string[]).includes(role)) {
    return role as AppRole;
  }
  return null;
}

function normalizeSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== 'object') return null;

  const parsed = value as Record<string, unknown>;
  const role = normalizeRole(parsed.role);
  if (
    typeof parsed.id !== 'string' ||
    typeof parsed.name !== 'string' ||
    typeof parsed.phone !== 'string' ||
    !role
  ) {
    return null;
  }

  return {
    id: parsed.id,
    name: parsed.name,
    phone: parsed.phone,
    role,
  };
}

export function serializeSession(user: AuthSession): string {
  const normalizedUser = normalizeSession(user);
  if (!normalizedUser) {
    throw new Error('Cannot serialize an invalid session');
  }

  const payload = encodeBase64(new TextEncoder().encode(JSON.stringify(normalizedUser)));
  const signature = encodeBase64Url(hmacSha256(payload, getSessionSecret()));
  return `${payload}.${signature}`;
}

export function deserializeSession(token: string): AuthSession | null {
  try {
    if (typeof token !== 'string' || !token) return null;

    const parts = token.split('.');
    if (parts.length !== 2) {
      // Raw base64 was accepted by the pre-HMAC implementation. It is only
      // retained for local migration/testing and is never accepted in prod.
      if (process.env.NODE_ENV === 'production') return null;
      const legacyJson = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(token));
      return normalizeSession(JSON.parse(legacyJson));
    }

    const [payload, signature] = parts;
    if (!payload || !signature) return null;

    const providedSignature = decodeBase64(signature);
    const expectedSignature = hmacSha256(payload, getSessionSecret());
    if (!timingSafeEqual(providedSignature, expectedSignature)) return null;

    const json = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(payload));
    return normalizeSession(JSON.parse(json));
  } catch {
    return null;
  }
}
