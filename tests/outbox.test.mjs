import test from 'node:test';
import assert from 'node:assert/strict';
import { hasQueuedGame, removeConfirmedItems } from '../src/lib/outbox.ts';

test('removes only the items the server confirmed', () => {
  const a = { id: 'a', payload: { n: 1 } };
  const b = { id: 'b', payload: { n: 2 } };
  assert.deepEqual(removeConfirmedItems([a, b], new Map([['a', a.payload]])), [b]);
});

test('a failed item stays queued', () => {
  const a = { id: 'a', payload: {} };
  assert.deepEqual(removeConfirmedItems([a], new Map()), [a]);
});

test('an item queued during the flush survives it', () => {
  const sent = { id: 'a', payload: {} };
  const queuedDuringFlush = { id: 'final', payload: { status: 'completed' } };
  assert.deepEqual(
    removeConfirmedItems([queuedDuringFlush], new Map([['a', sent.payload]])),
    [queuedDuringFlush]
  );
});

test('an item edited while it was being sent stays for the next flush', () => {
  const original = { n: 1 };
  const edited = { id: 'a', payload: { n: 2 } };
  assert.deepEqual(removeConfirmedItems([edited], new Map([['a', original]])), [edited]);
});

test('a game with something queued is recognized by either id field', () => {
  const queue = [
    { id: '1', payload: { p_game: 'g1', p_hand: {} } },
    { id: '2', payload: { p_id: 'g2' } },
    { id: '3', payload: { id: 'partida-de-domino' } },
  ];
  assert.equal(hasQueuedGame(queue, 'g1'), true);
  assert.equal(hasQueuedGame(queue, 'g2'), true);
  assert.equal(hasQueuedGame(queue, 'partida-de-domino'), false);
  assert.equal(hasQueuedGame(queue, 'g3'), false);
});
