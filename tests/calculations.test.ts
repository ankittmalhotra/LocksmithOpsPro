import {
  calculateForwardInvoice,
  calculateReverseInvoice,
  calculateTravelFee,
  calculateJobSettlementPosition,
} from '../src/lib/calculations.ts';

function runTests() {
  console.log('--- Running Calculations Tests ---');

  // Test 1: User's real example ($1661.77 cash with $30 parts)
  console.log('\nTest 1: Reverse Calculation for $1,661.77 Cash with $30 Parts');
  const result1 = calculateReverseInvoice({
    amountReceived: 1661.77,
    partsTotal: 30.0,
    paymentMethod: 'CASH',
  });
  console.log('Result 1:', result1);
  console.assert(result1.grandTotal === 1661.77, 'Grand total must be 1661.77');
  console.assert(result1.subtotal === 1470.59, 'Subtotal should be 1470.59');
  console.assert(result1.taxAmount === 191.18, 'Tax amount should be 191.18');
  console.assert(result1.laborTotal === 1440.59, 'Labor total should be 1440.59');
  console.assert(result1.partsTotal === 30.0, 'Parts total should be 30.00');
  console.log('✅ Test 1 Passed: Subtotal $1,470.59 + 13% HST $191.18 = $1,661.77');

  // Test 2: Forward Calculation with Stripe 4% Surcharge
  console.log('\nTest 2: Forward Calculation with 4% Stripe Surcharge');
  const result2 = calculateForwardInvoice({
    laborAmount: 100.0,
    partsTotal: 30.0,
    paymentMethod: 'STRIPE_CARD',
  });
  console.log('Result 2:', result2);
  // Subtotal = $130.00. Tax = 130 * 0.13 = $16.90. Base+Tax = $146.90.
  // Card surcharge = 146.90 * 0.04 = $5.88. Grand total = $152.78.
  console.assert(result2.subtotal === 130.0, 'Subtotal should be 130.00');
  console.assert(result2.taxAmount === 16.9, 'Tax should be 16.90');
  console.assert(result2.cardSurchargeAmount === 5.88, 'Card surcharge should be 5.88');
  console.assert(result2.grandTotal === 152.78, 'Grand total should be 152.78');
  console.log('✅ Test 2 Passed: Forward with 4% Surcharge is accurate');

  // Test 3: Abandoned Job Travel Fee ($20 and $25)
  console.log('\nTest 3: Abandoned Job Travel Fee ($25)');
  const result3 = calculateTravelFee({
    travelFeeAmount: 25.0,
    paymentMethod: 'CASH',
  });
  console.log('Result 3:', result3);
  console.assert(result3.subtotal === 25.0, 'Subtotal should be 25.00');
  console.assert(result3.taxAmount === 3.25, 'HST 13% should be 3.25');
  console.assert(result3.grandTotal === 28.25, 'Grand total should be 28.25');
  console.log('✅ Test 3 Passed: Travel fee calculation accurate');

  // Test 4: Worker Cash-in-hand Settlement
  console.log('\nTest 4: Worker Cash Settlement');
  // Worker collected $1,661.77 in cash. Dispatcher set commission to $300.00.
  const settlement1 = calculateJobSettlementPosition({
    paymentMethod: 'CASH',
    grandTotal: 1661.77,
    workerCommission: 300.0,
  });
  console.log('Settlement 1 (Cash):', settlement1);
  console.assert(settlement1.cashOwedToCompany === 1361.77, 'Worker owes $1,361.77');
  console.assert(settlement1.netWorkerBalanceChange === 1361.77, 'Net change should be 1361.77');

  // Worker did a Stripe job of $500 with $150 commission
  const settlement2 = calculateJobSettlementPosition({
    paymentMethod: 'STRIPE_CARD',
    grandTotal: 500.0,
    workerCommission: 150.0,
  });
  console.log('Settlement 2 (Card):', settlement2);
  console.assert(settlement2.companyOwesWorker === 150.0, 'Company owes worker $150');
  console.assert(settlement2.netWorkerBalanceChange === -150.0, 'Net change should be -150');
  console.log('✅ Test 4 Passed: Cash Ledger calculations accurate');

  console.log('\n🎉 ALL CALCULATION TESTS PASSED!');
}

runTests();
