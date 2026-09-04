export interface AuthSession {
  id: string;
  name: string;
  phone: string;
  role: 'SUPER_ADMIN' | 'OWNER' | 'DISPATCHER' | 'TECHNICIAN';
}

export function serializeSession(user: AuthSession): string {
  return Buffer.from(JSON.stringify(user)).toString('base64');
}

export function deserializeSession(token: string): AuthSession | null {
  try {
    const json = Buffer.from(token, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}
