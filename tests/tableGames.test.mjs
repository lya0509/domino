import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAnswerGame,
  canManageGame,
  canStartRoster,
  isConnectionError,
  mustAnswerGame,
  playerNames,
  tableGameLabel,
  winnerName,
} from '../src/lib/tableGames.ts';

const game = {
  id: 'g',
  game: 'uno_flip',
  status: 'pending_confirmation',
  created_by: 'a',
  winner_seat: 1,
  closed_by: 'a',
  closed_at: null,
  auto_confirm_at: null,
  disputed_at: null,
  created_at: '',
  players: [
    { seat: 2, user_id: null, name: 'Pedro' },
    { seat: 0, user_id: 'a', name: 'Ana' },
    { seat: 1, user_id: 'b', name: 'Luis' },
  ],
};

test('a game needs 2 to 10 players', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => ({ name: `J${i}` }));
  assert.equal(canStartRoster(list(1)), false);
  assert.equal(canStartRoster(list(2)), true);
  assert.equal(canStartRoster(list(10)), true);
  assert.equal(canStartRoster(list(11)), false);
});

test('names read in seat order and the winner comes from the seat', () => {
  assert.equal(playerNames(game), 'Ana, Luis, Pedro');
  assert.equal(winnerName(game), 'Luis');
  assert.equal(winnerName({ ...game, winner_seat: null }), null);
});

test('labels name each variant', () => {
  assert.equal(tableGameLabel('uno_no_mercy'), 'UNO No Mercy');
  assert.equal(tableGameLabel('uno'), 'UNO');
});

test('the window goes to the other players, never to who closed or an outsider', () => {
  assert.equal(mustAnswerGame(game, 'b'), true);
  assert.equal(mustAnswerGame(game, 'a'), false);
  assert.equal(mustAnswerGame(game, 'z'), false);
  assert.equal(mustAnswerGame({ ...game, status: 'completed' }, 'b'), false);
});

test('an admin can answer from the screen without being asked', () => {
  assert.equal(canAnswerGame(game, 'z', true), true);
  assert.equal(canAnswerGame(game, 'z', false), false);
  assert.equal(canAnswerGame(game, null, false), false);
});

test('only people at the table manage the game', () => {
  assert.equal(canManageGame(game, 'b', false), true);
  assert.equal(canManageGame(game, 'z', false), false);
  assert.equal(canManageGame(game, 'z', true), true);
  assert.equal(canManageGame(game, null, true), false);
});

test('a server refusal is not mistaken for lost internet', () => {
  assert.equal(isConnectionError('TypeError: Failed to fetch'), true);
  assert.equal(isConnectionError('Hay un jugador repetido'), false);
  assert.equal(isConnectionError(undefined), false);
});

import { activeSeats, playerSeats, missingCheckIn, needsMyCheckIn, guestCount, countsForRanking, playerNames as names22 } from '../src/lib/tableGames.ts';

const mesa22 = {
  status: 'active',
  players: [
    { seat: 0, user_id: 'a', name: 'Ana', role: 'player', checked_in_at: '2026-11-07T01:00:00Z', left_at: null },
    { seat: 1, user_id: 'b', name: 'Beto', role: 'player', checked_in_at: null, left_at: null },
    { seat: 2, user_id: null, name: 'Jorge', role: 'player', checked_in_at: '2026-11-07T01:00:00Z', left_at: null },
    { seat: 3, user_id: 'c', name: 'Caro', role: 'player', checked_in_at: '2026-11-07T01:00:00Z', left_at: '2026-11-07T02:00:00Z' },
    { seat: 4, user_id: null, name: 'Pedro', role: 'dealer', checked_in_at: '2026-11-07T01:00:00Z', left_at: null },
  ],
};

test('whoever only deals has no seat in the hands; whoever left keeps chips but plays no more', () => {
  assert.deepEqual(playerSeats(mesa22), [0, 1, 2, 3]);
  assert.deepEqual(activeSeats(mesa22), [0, 1, 2]);
  assert.equal(names22(mesa22), 'Ana, Beto, Jorge, Caro');
});

test('only players with an account who are still in must check in', () => {
  assert.deepEqual(missingCheckIn(mesa22).map((p) => p.name), ['Beto']);
  assert.equal(needsMyCheckIn(mesa22, 'b'), true);
  assert.equal(needsMyCheckIn(mesa22, 'a'), false);
  assert.equal(needsMyCheckIn({ ...mesa22, status: 'completed' }, 'b'), false);
});

test('before SQL 22 there is no check-in column, so nobody is waited for', () => {
  const old = { status: 'active', players: [{ seat: 0, user_id: 'a', name: 'Ana' }, { seat: 1, user_id: 'b', name: 'Beto' }] };
  assert.deepEqual(missingCheckIn(old), []);
});

test('the dealer is not a guest; two guests and the game counts for nobody', () => {
  assert.equal(guestCount(mesa22), 1);
  assert.equal(countsForRanking(mesa22), true);
  const two = { players: [...mesa22.players, { seat: 5, user_id: null, name: 'Luis', role: 'player' }] };
  assert.equal(countsForRanking(two), false);
});
