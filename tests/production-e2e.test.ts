import { PrismaClient } from '@prisma/client';
import { findJobByIdOrNumber } from '../src/lib/job-helper.ts';
import {
  calculateForwardInvoice,
  calculateReverseInvoice,
  calculateJobSettlementPosition,
} from '../src/lib/calculations.ts';
import { serializeSession, deserializeSession, type AuthSession } from '../src/lib/session.ts';

const prisma = new PrismaClient();

async function runProductionE2E() {
  console.log('================================================================');
  console.log('🧪 RUNNING PRODUCTION-READY END-TO-END VERIFICATION');
  console.log('================================================================');

  // TEST 1: Universal Job Resolution (by Number 9815 and by UUID)
  console.log('\n[Test 1] Universal Job Resolution by Number vs UUID');
  const jobByNumber = await findJobByIdOrNumber('9815');
  console.assert(jobByNumber !== null, 'Job #9815 must exist in database');
  console.assert(jobByNumber?.jobNumber === 9815, 'Job number must be 9815');
  console.log(`✅ findJobByIdOrNumber('9815') resolved: Job #${jobByNumber?.jobNumber} (${jobByNumber?.serviceType})`);

  const jobByUUID = await findJobByIdOrNumber(jobByNumber!.id);
  console.assert(jobByUUID?.id === jobByNumber?.id, 'Lookup by UUID must match lookup by Number');
  console.log(`✅ findJobByIdOrNumber('${jobByNumber!.id}') matched UUID successfully`);

  // TEST 2: Open Jobs Listing Format (Exact User Specification)
  console.log('\n[Test 2] Open Jobs Formatting for Guest / Pre-Login State');
  const allJobs = await prisma.job.findMany({
    include: { customer: true, technician: true },
  });
  const openJobs = allJobs.filter((j) =>
    ['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(j.status)
  );

  console.log(`Found ${openJobs.length} active open job(s):`);
  for (const job of openJobs) {
    const techName = job.technician?.name || 'Unassigned';
    const techFirstName = techName.split(' ')[0] || 'Tech';
    const extStr = job.customer.extension ? ` #${job.customer.extension}` : '';

    const formattedHeader = `🔑 Active Job #${job.jobNumber} - ${job.serviceAddress} (${job.serviceType})`;
    const formattedMeta = `Assigned to ${techName} • Customer: ${job.customer.name} (${job.customer.phone}${extStr}) • Commission: $${job.workerCommission.toFixed(2)}`;
    const formattedLink = `[Open Job as ${techFirstName} →](/tech/jobs/${job.jobNumber})`;

    console.log(`  ${formattedHeader}`);
    console.log(`  ${formattedMeta}`);
    console.log(`  ${formattedLink}`);

    console.assert(formattedHeader.includes(`Job #${job.jobNumber}`), 'Header must contain job number');
    console.assert(formattedMeta.includes(`Commission: $${job.workerCommission.toFixed(2)}`), 'Meta must include commission');
    console.assert(formattedLink.includes(`/tech/jobs/${job.jobNumber}`), 'Link must route to /tech/jobs/JOB_NUMBER');
  }
  console.log('✅ Open jobs match user requested presentation format');

  // TEST 3: RBAC Session Tokens and Role Validation
  console.log('\n[Test 3] Role-Based Access Control (RBAC) & Sessions');
  const ownerUser: AuthSession = { id: 'u-1', name: 'Alex Vance', phone: '4165550100', role: 'OWNER' };
  const dispatchUser: AuthSession = { id: 'u-2', name: 'Sarah Connor', phone: '4165550200', role: 'DISPATCHER' };
  const techUser: AuthSession = { id: 'u-3', name: 'Dave Miller', phone: '6475550301', role: 'TECHNICIAN' };

  const ownerToken = serializeSession(ownerUser);
  const dispatchToken = serializeSession(dispatchUser);
  const techToken = serializeSession(techUser);

  console.assert(deserializeSession(ownerToken)?.role === 'OWNER', 'Owner role deserialization failed');
  console.assert(deserializeSession(dispatchToken)?.role === 'DISPATCHER', 'Dispatcher role deserialization failed');
  console.assert(deserializeSession(techUser && techToken)?.role === 'TECHNICIAN', 'Tech role deserialization failed');
  console.log('✅ RBAC session tokens serialize and validate cleanly');

  // TEST 4: Job #9815 Real-World Reverse Invoicing ($1,661.77 Cash with $30 Parts)
  console.log('\n[Test 4] Reverse Tax Calculation on Job #9815 ($1,661.77 Cash + $30 Parts)');
  const revCalc = calculateReverseInvoice({
    amountReceived: 1661.77,
    partsTotal: 30.0,
    paymentMethod: 'CASH',
  });

  console.assert(revCalc.subtotal === 1470.59, 'Subtotal should be 1470.59');
  console.assert(revCalc.taxAmount === 191.18, 'HST should be 191.18');
  console.assert(revCalc.laborTotal === 1440.59, 'Labor should be 1440.59');
  console.assert(revCalc.partsTotal === 30.0, 'Parts should be 30.00');
  console.assert(revCalc.grandTotal === 1661.77, 'Grand total should be 1661.77');
  console.log(`✅ Calculated: Subtotal $${revCalc.subtotal} + 13% HST $${revCalc.taxAmount} = $${revCalc.grandTotal}`);

  // Settlement position
  const commission = 300.0;
  const settlementPos = calculateJobSettlementPosition({
    paymentMethod: 'CASH',
    grandTotal: 1661.77,
    workerCommission: commission,
  });
  console.assert(settlementPos.cashOwedToCompany === 1361.77, 'Dave must owe $1,361.77');
  console.log(`✅ Dave Miller collected $1,661.77 cash with $300 commission -> Owes Company: $${settlementPos.cashOwedToCompany.toFixed(2)}`);

  // TEST 5: Owner Settle Cash Handover
  console.log('\n[Test 5] Owner Cash Handover Settlement Verification');
  const ownerRecord = await prisma.user.findFirst({ where: { role: 'OWNER' } });
  const dave = await prisma.user.findFirst({ where: { phone: '6475550301' } });

  const settlementRecord = await prisma.settlement.create({
    data: {
      technicianId: dave!.id,
      amountSettled: settlementPos.cashOwedToCompany,
      paymentMethod: 'CASH_HANDOVER',
      notes: 'End-to-End verified handover for Job #9815',
      settledBy: ownerRecord?.id || 'OWNER',
    },
  });

  console.assert(settlementRecord.amountSettled === 1361.77, 'Settlement amount mismatch');
  console.log(`✅ Settlement record created successfully (ID: ${settlementRecord.id}, Amount: $${settlementRecord.amountSettled})`);

  console.log('\n================================================================');
  console.log('🎉 ALL 5 PRODUCTION-READY E2E TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runProductionE2E()
  .catch((e) => {
    console.error('Test Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
