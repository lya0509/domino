import test from 'node:test';
import assert from 'node:assert/strict';
import { dominoStats, rankWinners, rankZapateros, rankStreaks, isZapatoFor, medal } from '../src/lib/hallOfFame.ts';

const m = (winner, t1, t2, extra = {}) => ({
  status: 'completed', winner_team: winner, team1_player1: 'a', team1_player2: 'b', team2_player1: 'c', team2_player2: 'd',
  team1_total: t1, team2_total: t2, limit_score: 100, ...extra,
});

test('a zapato is winning 100 to 0, or a match marked as zapato', () => {
  assert.equal(isZapatoFor(m(1, 100, 0), 1), true);
  assert.equal(isZapatoFor(m(1, 100, 5), 1), false);
  assert.equal(isZapatoFor(m(2, 0, 100), 1), false);
  assert.equal(isZapatoFor(m(2, 20, 110, { is_zapato: true }), 2), true);
});

test('wins, games, zapatos and win rate per player', () => {
  const rows = dominoStats([m(1, 100, 0), m(1, 100, 40), m(2, 30, 100), { ...m(1, 100, 0), status: 'cancelled' }, m(null, 0, 0)]);
  const a = rows.find((r) => r.id === 'a');
  const c = rows.find((r) => r.id === 'c');
  assert.deepEqual([a.wins, a.played, a.zapatos, a.winRate], [2, 3, 1, 67]);
  assert.deepEqual([c.wins, c.played, c.zapatos, c.winRate], [1, 3, 0, 33]);
});

test('winners: ties go to the better win rate; nobody with 0 wins', () => {
  const rows = [
    { id: 'x', wins: 5, played: 10, zapatos: 0, winRate: 50 },
    { id: 'y', wins: 5, played: 6, zapatos: 0, winRate: 83 },
    { id: 'z', wins: 0, played: 4, zapatos: 0, winRate: 0 },
  ];
  assert.deepEqual(rankWinners(rows).map((r) => r.id), ['y', 'x']);
});

test('zapateros only lists people who gave a zapato', () => {
  const rows = [
    { id: 'x', wins: 5, played: 10, zapatos: 2, winRate: 50 },
    { id: 'y', wins: 9, played: 10, zapatos: 0, winRate: 90 },
    { id: 'w', wins: 6, played: 10, zapatos: 2, winRate: 60 },
  ];
  assert.deepEqual(rankZapateros(rows).map((r) => r.id), ['w', 'x']);
});

test('streaks only list people on a streak, longest first', () => {
  const ps = [{ id: 'a', streak_count: 3 }, { id: 'b', streak_count: 0 }, { id: 'c', streak_count: 9 }, { id: 'd' }];
  assert.deepEqual(rankStreaks(ps).map((p) => p.id), ['c', 'a']);
});

test('medals for the top three', () => {
  assert.deepEqual([0, 1, 2, 3].map(medal), ['🥇', '🥈', '🥉', '#4']);
});
