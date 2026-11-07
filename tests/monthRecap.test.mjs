import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthRecap, clubMonth, previousMonth, monthLabel, monthRange } from '../src/lib/monthRecap.ts';

const m = (at, winner, t1, t2, extra = {}) => ({
  created_at: at, status: 'completed', winner_team: winner,
  team1_player1: t1[0], team1_player2: t1[1], team2_player1: t2[0], team2_player2: t2[1],
  team1_total: winner === 1 ? 100 : 40, team2_total: winner === 2 ? 100 : 40, limit_score: 100, ...extra,
});
const names = { me: 'Yo', ana: 'Ana', beto: 'Beto', caro: 'Caro', dani: 'Dani' };

test('the club month follows Venezuelan time', () => {
  assert.equal(clubMonth('2026-12-01T03:30:00Z'), '2026-11');
  assert.equal(clubMonth('2026-12-01T04:30:00Z'), '2026-12');
  assert.equal(previousMonth('2027-01'), '2026-12');
  assert.equal(monthLabel('2026-11'), 'Noviembre 2026');
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01T04:00:00.000Z', to: '2027-01-01T04:00:00.000Z' });
});

test('a month in numbers: wins, zapatos, best partner, toughest rival, streak', () => {
  const matches = [
    m('2026-11-02T20:00:00Z', 1, ['me', 'ana'], ['beto', 'caro'], { team2_total: 0 }),
    m('2026-11-03T20:00:00Z', 1, ['me', 'ana'], ['beto', 'dani']),
    m('2026-11-04T20:00:00Z', 2, ['me', 'caro'], ['beto', 'dani']),
    m('2026-11-05T20:00:00Z', 1, ['dani', 'me'], ['beto', 'ana']),
    m('2026-10-30T20:00:00Z', 1, ['me', 'ana'], ['beto', 'caro']),
    // two guests: counts for nobody
    m('2026-11-06T20:00:00Z', 1, ['me', null], ['beto', null]),
  ];
  const tables = [
    { game: 'uno', closed_at: '2026-11-10T22:00:00Z', winner_seat: 0, seat: 0, guests: 0 },
    { game: 'poker', closed_at: '2026-11-11T22:00:00Z', winner_seat: 2, seat: 0, guests: 1 },
    { game: 'uno_flip', closed_at: '2026-11-12T22:00:00Z', winner_seat: 0, seat: 0, guests: 2 },
  ];
  const r = buildMonthRecap('me', '2026-11', matches, tables, names);
  assert.deepEqual(r.domino, { played: 4, wins: 3, winRate: 75, zapatos: 1 });
  assert.deepEqual(r.uno, { played: 1, wins: 1 });
  assert.deepEqual(r.poker, { played: 1, wins: 0 });
  assert.equal(r.played, 6);
  assert.equal(r.wins, 4);
  assert.deepEqual(r.bestPartner, { id: 'ana', name: 'Ana', count: 2 });
  assert.equal(r.toughestRival.count, 1);
  assert.deepEqual(r.favoriteVictim, { id: 'beto', name: 'Beto', count: 3 });
  assert.equal(r.bestStreak, 2);
  assert.equal(r.label, 'Noviembre 2026');
});

test('an empty month is all zeros, with nobody named', () => {
  const r = buildMonthRecap('me', '2026-12', [], [], names);
  assert.equal(r.played, 0);
  assert.equal(r.bestPartner, null);
  assert.equal(r.toughestRival, null);
});
