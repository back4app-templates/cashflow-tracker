import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineTotals, sumTotals, parseMoney, parseQty, fmtMoney, addDays } from '../src/money.js';

test('tax-inclusive worked example: 3 lines at $19.99 incl. 10%', () => {
  const lines = Array.from({ length: 3 }, () => lineTotals({ qtyMilli: 1000, unitCents: 1999, rateBp: 1000, inclusive: true }));
  assert.deepEqual(lines[0], { net: 1817, tax: 182, gross: 1999 });
  assert.deepEqual(sumTotals(lines), { subtotal: 5451, tax: 546, total: 5997 });
});
test('tax-exclusive: 3 × $120 + 10%', () => assert.deepEqual(lineTotals({ qtyMilli: 3000, unitCents: 12000, rateBp: 1000, inclusive: false }), { net: 36000, tax: 3600, gross: 39600 }));
test('per-line rounding differs from per-total rounding by a cent in the documented case', () => {
  // 3 lines at $0.05 with 10% tax: per line tax = round(0.5) = 1 cent each → 3 cents; on the total: round(1.5) = 2 cents.
  const lines = Array.from({ length: 3 }, () => lineTotals({ qtyMilli: 1000, unitCents: 5, rateBp: 1000, inclusive: false }));
  assert.equal(sumTotals(lines).tax, 3); assert.equal(Math.round(15 * 0.1), 2);
});
test('fractional quantities: 2.5 h × $120.00', () => assert.equal(lineTotals({ qtyMilli: 2500, unitCents: 12000, rateBp: 0, inclusive: false }).gross, 30000));
test('parseMoney / parseQty accept what people type', () => {
  assert.equal(parseMoney('1,234.56'), 123456); assert.equal(parseMoney('$12'), 1200); assert.ok(Number.isNaN(parseMoney('12.345'))); assert.ok(Number.isNaN(parseMoney('abc')));
  assert.equal(parseQty('2.5'), 2500); assert.equal(parseQty('1'), 1000); assert.ok(Number.isNaN(parseQty('-1')));
});
test('fmtMoney and dates', () => { assert.equal(fmtMoney(123456), '$1,234.56'); assert.equal(fmtMoney(-5, '€'), '−€0.05'); assert.equal(addDays('2026-12-30', 3), '2027-01-02'); });
