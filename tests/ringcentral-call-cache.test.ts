import assert from 'node:assert/strict';
import { normalizeRingCentralPhone, sourceKeyForRecord } from '../src/lib/ringcentral-call-cache-utils.ts';

assert.equal(normalizeRingCentralPhone('+1 (416) 240-0593'), '4162400593');
assert.equal(normalizeRingCentralPhone('416-240-0593'), '4162400593');
assert.equal(sourceKeyForRecord({ id: 'call-123' }), 'default:call-123');
assert.equal(sourceKeyForRecord({ telephonySessionId: 'session-123' }), 'default:session-123');
assert.equal(sourceKeyForRecord({}), null);

console.log('ringcentral-call-cache tests passed');
