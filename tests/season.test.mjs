import test from 'node:test';
import assert from 'node:assert/strict';
import { easterSunday, seasonFor } from '../src/lib/season.ts';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (y, m, d) => new Date(y, m - 1, d, 12);

test('Easter falls on the known dates', () => {
  assert.equal(ymd(easterSunday(2026)), '2026-04-05');
  assert.equal(ymd(easterSunday(2027)), '2027-03-28');
  assert.equal(ymd(easterSunday(2028)), '2028-04-16');
});

test('Navidad runs from 1 December to 6 January', () => {
  assert.equal(seasonFor(at(2026, 11, 30)), null);
  assert.equal(seasonFor(at(2026, 12, 1))?.id, 'navidad');
  assert.equal(seasonFor(at(2027, 1, 6))?.id, 'navidad');
  assert.equal(seasonFor(at(2027, 1, 7)), null);
});

test('Carnaval 2027 covers Friday 5 to Tuesday 9 February', () => {
  assert.equal(seasonFor(at(2027, 2, 4)), null);
  assert.equal(seasonFor(at(2027, 2, 5))?.id, 'carnaval');
  assert.equal(seasonFor(at(2027, 2, 8))?.id, 'carnaval');
  assert.equal(seasonFor(at(2027, 2, 9))?.id, 'carnaval');
  assert.equal(seasonFor(at(2027, 2, 10)), null);
});

test('Halloween runs 25 to 31 October', () => {
  assert.equal(seasonFor(at(2026, 10, 24)), null);
  assert.equal(seasonFor(at(2026, 10, 31))?.id, 'halloween');
  assert.equal(seasonFor(at(2026, 11, 2)), null);
});
