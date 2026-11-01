import test from 'node:test';
import assert from 'node:assert/strict';
import { canAnswerMatch, isInMatch, matchRivalIds } from '../src/lib/matchRivals.ts';

const row = { team1_player1: 'a', team1_player2: 'b', team2_player1: 'c', team2_player2: null, winner_team: 1 };

test('the rival is the team opposite whoever closed', () => {
  assert.deepEqual(matchRivalIds({ ...row, closed_by: 'a' }), ['c']);
  assert.deepEqual(matchRivalIds({ ...row, closed_by: 'c' }), ['a', 'b']);
});

test('when a non-player closes, the losing team answers', () => {
  assert.deepEqual(matchRivalIds({ ...row, closed_by: 'z' }), ['c']);
  assert.deepEqual(matchRivalIds({ ...row, closed_by: 'z', winner_team: 2 }), ['a', 'b']);
});

test('an annulled match closed by a non-player goes to both teams', () => {
  assert.deepEqual(matchRivalIds({ ...row, closed_by: 'z', winner_team: null }), ['a', 'b', 'c']);
});

test('admins can always answer, teammates cannot', () => {
  assert.equal(canAnswerMatch({ ...row, closed_by: 'a' }, 'b', false), false);
  assert.equal(canAnswerMatch({ ...row, closed_by: 'a' }, 'b', true), true);
});

test('the closer counts as part of the match', () => {
  assert.equal(isInMatch({ ...row, closed_by: 'z' }, 'z'), true);
  assert.equal(isInMatch({ ...row, closed_by: 'z' }, 'x'), false);
});
