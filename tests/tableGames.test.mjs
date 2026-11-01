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
