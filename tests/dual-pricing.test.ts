import assert from 'node:assert/strict';
import { calculateDualPriceManualCardQuote, MAX_CARD_PRICE_DIFFERENCE_RATE } from '../src/lib/calculations.ts';

assert.equal(MAX_CARD_PRICE_DIFFERENCE_RATE, 0.04, 'Manual card price difference is capped at 4%');

const quote = calculateDualPriceManualCardQuote({ nonCardPrice: 100, cardPriceDifferenceRate: 0.04 });

assert.equal(quote.nonCardPrice, 100);
assert.equal(quote.cardPrice, 104);
assert.equal(quote.nonCardTaxEstimate, 13);
assert.equal(quote.cardTaxEstimate, 13.52);
assert.equal(quote.nonCardTotalEstimate, 113);
assert.equal(quote.cardTotalEstimate, 117.52);
assert.equal(quote.calculation.subtotal, 104);
assert.equal(quote.calculation.grandTotal, 104, 'Checkout base amount is the accepted card service price before Stripe Tax');
assert.equal(quote.calculation.cardSurchargeRate, 0, 'Dual pricing must not store a card surcharge rate');
assert.equal(quote.calculation.cardSurchargeAmount, 0, 'Dual pricing must not create a card surcharge line');
assert.equal(calculateDualPriceManualCardQuote({ nonCardPrice: 100, cardPriceDifferenceRate: 0.0399 }).cardPrice, 103.99, 'Percentage precision is preserved to 0.01%');

console.log('Dual-pricing quote checks passed.');
