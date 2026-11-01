import test from 'node:test';
import assert from 'node:assert/strict';
import { removeConfirmedItems } from '../src/lib/outbox.ts';

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
