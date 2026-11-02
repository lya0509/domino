import test from 'node:test';
import assert from 'node:assert/strict';
import { isVipActive, vipDaysLeft } from '../src/lib/vip.ts';

const now = Date.parse('2026-11-02T12:00:00Z');
const at = (ms) => new Date(now + ms).toISOString();
const DAY = 86_400_000;

test('a VIP with time left is active', () => {
  assert.equal(isVipActive({ vip_until: at(DAY) }, now), true);
});

test('an expired VIP is not active', () => {
  assert.equal(isVipActive({ vip_until: at(-1000) }, now), false);
});

test('nobody without a date is VIP', () => {
  assert.equal(isVipActive(null, now), false);
  assert.equal(isVipActive({ vip_until: null }, now), false);
});

test('days left round up, so one hour left still reads one day', () => {
  assert.equal(vipDaysLeft(at(3600_000), now), 1);
  assert.equal(vipDaysLeft(at(30 * DAY), now), 30);
  assert.equal(vipDaysLeft(at(29.2 * DAY), now), 30);
});

test('an expired VIP has zero days left', () => {
  assert.equal(vipDaysLeft(at(-5 * DAY), now), 0);
  assert.equal(vipDaysLeft(null, now), 0);
});

import { ringStyleOf, seniorityBadge, founderBadge, RING_STYLES } from '../src/lib/vip.ts';

test('an unknown or missing ring style falls back to gold', () => {
  assert.equal(ringStyleOf(null), 'oro');
  assert.equal(ringStyleOf('plata'), 'oro');
  assert.equal(ringStyleOf('fuego'), 'fuego');
  assert.equal(Object.keys(RING_STYLES).length, 4);
});

test('seniority badges step at 1, 3, 6 and 12 months', () => {
  assert.equal(seniorityBadge(0), null);
  assert.deepEqual(seniorityBadge(1), { icon: '🥉', text: '1 mes VIP' });
  assert.equal(seniorityBadge(2).icon, '🥉');
  assert.equal(seniorityBadge(3).icon, '🥈');
  assert.equal(seniorityBadge(6).icon, '🥇');
  assert.deepEqual(seniorityBadge(14), { icon: '💎', text: '14 meses VIP' });
});

test('only founders 1 to 10 get the seal', () => {
  assert.equal(founderBadge(3), 'Fundador #3');
  assert.equal(founderBadge(null), null);
  assert.equal(founderBadge(11), null);
});
