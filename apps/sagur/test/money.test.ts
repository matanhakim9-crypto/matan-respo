import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, lineTotal, roundAgorot, shekelsToAgorot } from '../src/money.ts';

test('lineTotal rounds fractional quantities to whole agorot', () => {
  assert.equal(lineTotal({ quantity: 2.5, unit_price: 12345 }), 30863); // 2.5 × 123.45 = 308.625
  assert.equal(lineTotal({ quantity: 3, unit_price: 10000 }), 30000);
  assert.equal(lineTotal({ quantity: 0, unit_price: 9999 }), 0);
});

test('lineTotal treats junk input as zero rather than NaN', () => {
  assert.equal(lineTotal({ quantity: Number.NaN, unit_price: 1000 }), 0);
  assert.equal(lineTotal({ quantity: 2, unit_price: Number.POSITIVE_INFINITY }), 0);
});

test('roundAgorot rounds half away from zero', () => {
  assert.equal(roundAgorot(0.5), 1);
  assert.equal(roundAgorot(1.5), 2);
  assert.equal(roundAgorot(-0.5), -1);
});

test('totals add up: subtotal, VAT and total stay consistent', () => {
  const totals = computeTotals(
    [
      { quantity: 2, unit_price: 50000 }, // 1,000.00
      { quantity: 1, unit_price: 25050 }, //   250.50
    ],
    { vat_rate: 18 }
  );
  assert.equal(totals.subtotal, 125050);
  assert.equal(totals.discount_amount, 0);
  assert.equal(totals.vat_amount, 22509);
  assert.equal(totals.total, 147559);
  assert.equal(totals.total, totals.net + totals.vat_amount);
});

test('percentage discount applies before VAT', () => {
  const totals = computeTotals([{ quantity: 1, unit_price: 100000 }], {
    discount_type: 'percent',
    discount_value: 10,
    vat_rate: 18,
  });
  assert.equal(totals.discount_amount, 10000);
  assert.equal(totals.net, 90000);
  assert.equal(totals.vat_amount, 16200);
  assert.equal(totals.total, 106200);
});

test('a fixed discount can never exceed the subtotal', () => {
  const totals = computeTotals([{ quantity: 1, unit_price: 5000 }], {
    discount_type: 'amount',
    discount_value: 999999,
    vat_rate: 18,
  });
  assert.equal(totals.discount_amount, 5000);
  assert.equal(totals.total, 0);
});

test('an out-of-range percentage is clamped instead of going negative', () => {
  const totals = computeTotals([{ quantity: 1, unit_price: 10000 }], {
    discount_type: 'percent',
    discount_value: 250,
    vat_rate: 18,
  });
  assert.equal(totals.discount_amount, 10000);
  assert.equal(totals.total, 0);

  const negative = computeTotals([{ quantity: 1, unit_price: 10000 }], {
    discount_type: 'percent',
    discount_value: -50,
    vat_rate: 18,
  });
  assert.equal(negative.discount_amount, 0);
  assert.equal(negative.total, 11800);
});

test('an empty quote totals zero', () => {
  const totals = computeTotals([], { vat_rate: 18 });
  assert.deepEqual(totals, { subtotal: 0, discount_amount: 0, net: 0, vat_amount: 0, total: 0 });
});

test('shekelsToAgorot parses what a person actually types', () => {
  assert.equal(shekelsToAgorot('1,250.5'), 125050);
  assert.equal(shekelsToAgorot('₪90'), 9000);
  assert.equal(shekelsToAgorot('90'), 9000);
  assert.equal(shekelsToAgorot(''), 0);
  assert.equal(shekelsToAgorot('abc'), 0);
  assert.equal(shekelsToAgorot(12.34), 1234);
});
