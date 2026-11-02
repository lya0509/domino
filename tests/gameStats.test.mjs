import test from 'node:test';
import assert from 'node:assert/strict';
import { countTableRecord, dominoCells, pokerCells, unoCells, STAT_GAMES } from '../src/lib/gameStatsCore.ts';

const values = (cells) => Object.fromEntries(cells.map((c) => [c.label, c.value]));

test('a game counts as won only when the winner seat is the player seat', () => {
  const r = countTableRecord([
    { seat: 0, winner_seat: 0 },
    { seat: 2, winner_seat: 1 },
    { seat: 1, winner_seat: null },
  ]);
  assert.deepEqual(r, { wins: 1, played: 3 });
});

test('UNO shows wins, losses, win rate and games played', () => {
  assert.deepEqual(values(unoCells({ wins: 2, played: 3 })), { Ganadas: '2', Perdidas: '1', Victorias: '67%', Jugadas: '3' });
});

test('UNO with no games shows a dash, not 0% or NaN', () => {
  assert.equal(values(unoCells({ wins: 0, played: 0 })).Victorias, '—');
});

test('poker shows wins, games, hands and the best hand in words', () => {
  assert.deepEqual(values(pokerCells({ wins: 1, played: 4 }, 37, 'Full')), { Ganadas: '1', Jugadas: '4', Manos: '37', 'Mejor jugada': 'Full' });
  assert.equal(values(pokerCells({ wins: 0, played: 0 }, 0, null))['Mejor jugada'], '—');
});

test('dominó keeps its four numbers, zapatos included', () => {
  assert.deepEqual(values(dominoCells({ wins: 5, losses: 3, total: 8, zapatos: 1 })), { Ganadas: '5', Perdidas: '3', 'Zapatos 👟': '1', Total: '8' });
});

test('the three games are listed in dock order', () => {
  assert.deepEqual(STAT_GAMES.map((g) => g.id), ['domino', 'uno', 'poker']);
});
