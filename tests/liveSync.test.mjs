import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate, isDeadChannel } from '../src/lib/liveSyncCore.ts';

test('two wakes close together load once, a later one loads again', () => {
  let t = 0;
  const gate = createGate(1500, () => t);
  assert.equal(gate(), true);
  t = 400;
  assert.equal(gate(), false);
  t = 1600;
  assert.equal(gate(), true);
});

test('a channel that errored, timed out or closed is made again; a live one is kept', () => {
  assert.deepEqual(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].map(isDeadChannel), [true, true, true]);
  assert.equal(isDeadChannel('SUBSCRIBED'), false);
});
