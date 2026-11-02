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
