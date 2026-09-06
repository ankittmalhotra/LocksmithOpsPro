export interface AuthSession {
  id: string;
  name: string;
  phone: string;
  role: 'SUPER_ADMIN' | 'OWNER' | 'DISPATCHER' | 'TECHNICIAN';
}

const SECRET = process.env.SESSION_SECRET || 'locksmith-ops-prod-sec-9815-ontario';

function generateChecksum(input: string, key: string): string {
  let h1 = 0xdeadbeef ^ key.length;
  let h2 = 0x41c6ce57 ^ key.length;
  const str = input + key;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function serializeSession(user: AuthSession): string {
  const json = JSON.stringify(user);
  const payload = typeof Buffer !== 'undefined'
    ? Buffer.from(json).toString('base64')
    : btoa(unescape(encodeURIComponent(json)));
  const sig = generateChecksum(payload, SECRET);
  return `${payload}.${sig}`;
}

export function deserializeSession(token: string): AuthSession | null {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length === 2) {
      const [payload, sig] = parts;
      const expected = generateChecksum(payload, SECRET);
      if (sig !== expected) return null;
      const json = typeof Buffer !== 'undefined'
        ? Buffer.from(payload, 'base64').toString('utf-8')
        : decodeURIComponent(escape(atob(payload)));
      return JSON.parse(json);
    }
    // Backward compatibility for legacy raw base64 tokens during migration
    const legacyJson = typeof Buffer !== 'undefined'
      ? Buffer.from(token, 'base64').toString('utf-8')
      : decodeURIComponent(escape(atob(token)));
    const parsed = JSON.parse(legacyJson);
    if (parsed && parsed.role && parsed.id) return parsed;
    return null;
  } catch {
    return null;
  }
}
