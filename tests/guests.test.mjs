import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGuestName, suggestGuests, dominoGuestCount, countsForStats } from '../src/lib/guests.ts';

const club = ['Jorge', 'José Gregorio', 'María José', 'Luis Pérez', 'jorge ', 'Ana'];

test('a guest typed with extra spaces is the same guest', () => {
  assert.equal(normalizeGuestName('  Luis   Pérez '), 'Luis Pérez');
});

test('typing "jo" suggests names that start with it first, then the ones that contain it', () => {
  assert.deepEqual(suggestGuests(club, 'jo'), ['Jorge', 'José Gregorio', 'María José']);
});

test('accents and case do not matter, and the same name is not suggested twice', () => {
  assert.deepEqual(suggestGuests(club, 'PEREZ'), ['Luis Pérez']);
  assert.equal(suggestGuests(club, '').filter((n) => n.trim().toLowerCase() === 'jorge').length, 1);
});

test('someone already at the table is not suggested, and neither is the exact name typed', () => {
  assert.deepEqual(suggestGuests(club, 'jo', ['jorge']), ['José Gregorio', 'María José']);
  assert.deepEqual(suggestGuests(club, 'Ana'), []);
});

test('with nothing typed, the most recent names', () => {
  assert.deepEqual(suggestGuests(club, '', [], 2), ['Jorge', 'José Gregorio']);
});

test('a dominó match with more than one guest counts for nobody', () => {
  const four = { team1_player1: 'a', team1_player2: 'b', team2_player1: 'c', team2_player2: 'd' };
  assert.equal(countsForStats(four), true);
  assert.equal(countsForStats({ ...four, team2_player2: null }), true);
  assert.equal(dominoGuestCount({ ...four, team1_player2: null, team2_player2: null }), 2);
  assert.equal(countsForStats({ ...four, team1_player2: null, team2_player2: null }), false);
});

import { GUEST_LIMIT as limitTable } from '../src/lib/tableGames.ts';
import { GUEST_LIMIT as limitGuests } from '../src/lib/guests.ts';
import { dominoStats } from '../src/lib/hallOfFame.ts';

test('dominó, UNO and poker use the same guest limit', () => {
  assert.equal(limitTable, limitGuests);
  const m = (t1p2, t2p2) => ({ status: 'completed', winner_team: 1, team1_player1: 'a', team1_player2: t1p2, team2_player1: 'c', team2_player2: t2p2, team1_total: 100, team2_total: 10 });
  assert.equal(dominoStats([m('b', null)]).find((r) => r.id === 'a').wins, 1);
  assert.equal(dominoStats([m(null, null)]).length, 0);
});
