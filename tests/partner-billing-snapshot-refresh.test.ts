import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const fixture: any = { sources: {}, periods: [], audits: [], locks: 0 };
Object.assign(globalThis, { __partnerBillingRefreshFixture: fixture });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/accounting') return { url: pathToFileURL(`${process.cwd()}/src/lib/accounting.ts`).href, shortCircuit: true };
    if (specifier === '@/lib/books-api') return { url: 'partner-refresh-test:books-api', shortCircuit: true };
    if (specifier === '@/lib/job-helper') return { url: 'partner-refresh-test:job-helper', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'partner-refresh-test:books-api') return {
      format: 'module', shortCircuit: true, source: `
        const f = globalThis.__partnerBillingRefreshFixture;
        export function calculateOperationalPeriodSnapshotFromJobs(start) { return f.sources[start]; }
        export function centsToDecimal(cents) { return cents / 100; }
        export function decimalToCents(value) { return Math.round(Number(value || 0) * 100); }
      `,
    };
    if (url === 'partner-refresh-test:job-helper') return { format: 'module', shortCircuit: true, source: 'export const jobDetailsInclude = {};' };
    return nextLoad(url, context);
  },
});

const { refreshUnissuedPartnerBillingSnapshots } = await import('../src/lib/partner-billing-snapshot-refresh.ts');

function period(id: string, start: string, status: string, negativeCarryForward = 0) {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(startDate.getTime() + 13 * 86_400_000);
  return {
    id,
    issuerEntityId: 'it',
    recipientEntityId: 'locksmith',
    periodStart: startDate,
    periodEnd: endDate,
    status,
    invoice: status === 'INVOICED' ? { id: `invoice-${id}` } : null,
    revenueAmount: 0,
    hstDeductedAmount: 0,
    cogsAmount: 0,
    technicianCommissionsAmount: 0,
    operationalProfitAmount: 0,
    priorNegativeCarryForward: 0,
    adjustedProfitAmount: 0,
    negativeCarryForward,
    partnerFeeAmount: 0,
    sourceSnapshot: null,
    calculationNote: null,
  };
}

function source(revenueCents: number, cogsCents: number) {
  return { revenueCents, hstCents: 0, cogsCents, commissionCents: 0, contributions: [] };
}

function fakeTransaction() {
  const tx: any = {
    accountingEntity: { async findUnique({ where }: any) { return { id: where.code === 'IT_MARKETING' ? 'it' : 'locksmith' }; } },
    async $queryRaw() { fixture.locks += 1; return []; },
    job: { async findMany() { return []; } },
    partnerBillingPeriod: {
      async findMany() { return fixture.periods; },
      async updateMany({ where, data }: any) {
        const row = fixture.periods.find((item: any) => item.id === where.id);
        if (!row || row.invoice || !['OPEN', 'CARRIED_FORWARD'].includes(row.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async findUnique({ where }: any) {
        const row = fixture.periods.find((item: any) => item.id === where.id);
        return row ? { negativeCarryForward: row.negativeCarryForward } : null;
      },
    },
    accountingAuditEvent: { async create({ data }: any) { fixture.audits.push(data); } },
  };
  return tx;
}

test('refresh recalculates unissued periods in order, carries losses forward, audits changes, and freezes issued snapshots', async () => {
  fixture.locks = 0;
  fixture.audits = [];
  fixture.periods = [
    period('p1', '2026-09-07', 'OPEN'),
    period('p2', '2026-09-21', 'OPEN'),
    period('p3', '2026-10-05', 'OPEN'),
    period('issued', '2026-10-19', 'INVOICED', 4),
    period('p5', '2026-11-02', 'OPEN'),
  ];
  fixture.sources = {
    '2026-09-07': source(5_000, 7_000),
    '2026-09-21': source(1_000, 0),
    '2026-10-05': source(5_000, 0),
    '2026-11-02': source(2_000, 0),
  };

  const result = await refreshUnissuedPartnerBillingSnapshots(fakeTransaction(), 'admin-id', 'MANUAL_JOB_UPDATED');

  assert.equal(result.updatedCount, 4);
  assert.equal(fixture.locks, 2, 'refresh locks the shared issuer row and ordered unissued periods');
  assert.equal(fixture.periods[0].negativeCarryForward, 2_000 / 100);
  assert.equal(fixture.periods[1].priorNegativeCarryForward, 20);
  assert.equal(fixture.periods[1].negativeCarryForward, 10);
  assert.equal(fixture.periods[2].priorNegativeCarryForward, 10);
  assert.equal(fixture.periods[2].partnerFeeAmount, 20);
  assert.equal(fixture.periods[3].negativeCarryForward, 4);
  assert.equal(fixture.periods[3].partnerFeeAmount, 0);
  assert.equal(fixture.periods[4].priorNegativeCarryForward, 4);
  assert.equal(fixture.periods[4].partnerFeeAmount, 8);
  assert.deepEqual(fixture.audits.map((event: any) => event.resourceId), ['p1', 'p2', 'p3', 'p5']);
  assert.ok(fixture.audits.every((event: any) => event.metadata.automatic && event.metadata.cause === 'MANUAL_JOB_UPDATED'));
});

test('manual snapshot save preserves the target override and recalculates only its unissued suffix', async () => {
  fixture.locks = 0;
  fixture.audits = [];
  fixture.periods = [
    period('earlier', '2026-09-07', 'OPEN', 12),
    period('manual', '2026-09-21', 'CARRIED_FORWARD', 5),
    period('later', '2026-10-05', 'OPEN'),
  ];
  fixture.periods[1].sourceSnapshot = { manualOverride: true };
  fixture.periods[1].revenueAmount = 80;
  fixture.periods[1].partnerFeeAmount = 0;
  fixture.sources = {
    '2026-09-07': source(100_000, 0),
    '2026-09-21': source(50_000, 0),
    '2026-10-05': source(10_000, 0),
  };

  await refreshUnissuedPartnerBillingSnapshots(fakeTransaction(), 'admin-id', 'MANUAL_SNAPSHOT_EDIT', {
    preservePeriodId: 'manual',
    startPeriodId: 'manual',
  });

  assert.equal(fixture.periods[0].revenueAmount, 0, 'earlier unissued periods stay untouched');
  assert.equal(fixture.periods[1].revenueAmount, 80, 'Admin override stays as saved');
  assert.deepEqual(fixture.periods[1].sourceSnapshot, { manualOverride: true });
  assert.equal(fixture.periods[2].priorNegativeCarryForward, 5);
  assert.equal(fixture.periods[2].partnerFeeAmount, 47.5);
  assert.deepEqual(fixture.audits.map((event: any) => event.resourceId), ['later']);

  fixture.audits = [];
  fixture.sources['2026-09-21'] = source(20_000, 0);
  await refreshUnissuedPartnerBillingSnapshots(fakeTransaction(), 'admin-id', 'JOB_CLOSEOUT');
  assert.equal(fixture.periods[1].revenueAmount, 200, 'a later revenue change replaces the saved override with source revenue');
  assert.deepEqual(fixture.periods[1].sourceSnapshot, {
    formula: 'Revenue - HST - COGS - technician commissions',
    periodStart: '2026-09-21',
    periodEnd: '2026-10-04',
    contributions: [],
  });
  assert.equal(fixture.periods[2].priorNegativeCarryForward, 0);
  assert.ok(fixture.audits.some((event: any) => event.resourceId === 'manual' && event.metadata.cause === 'JOB_CLOSEOUT'));
});
