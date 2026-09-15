import type { RingCentralCallRecord } from './ringcentral';

export function normalizeRingCentralPhone(value?: string | null) {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function sourceKeyForRecord(record: RingCentralCallRecord) {
  const providerId = record.id || record.uri || record.telephonySessionId || record.sessionId;
  if (!providerId) return null;
  return `default:${providerId}`;
}
