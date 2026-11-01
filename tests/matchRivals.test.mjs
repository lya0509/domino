import test from 'node:test';
import assert from 'node:assert/strict';
import { canAnswerMatch, isInMatch, isMatchRival, matchRivalIds, matchTeamLabel, secondsUntil } from '../src/lib/matchRivals.ts';

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

test('a substitute is not a rival, and the player they replaced still is', () => {
  const swapped = { ...row, team2_player1: 'friend', initial_team1: ['a', 'b'], initial_team2: ['c', 'd'], closed_by: 'a' };
  assert.deepEqual(matchRivalIds(swapped), ['c', 'd']);
  assert.equal(canAnswerMatch(swapped, 'friend', false), false);
  assert.equal(isInMatch(swapped, 'c'), true);
});

test('the countdown never goes below zero', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(secondsUntil('2026-11-01T12:02:00Z', now), 120);
  assert.equal(secondsUntil('2026-11-01T11:59:00Z', now), 0);
});

test('team names come from the players, with a fallback', () => {
  const players_json = [{ teamNumber: 1, name: 'Ana' }, { teamNumber: 1, name: 'Luis' }];
  assert.equal(matchTeamLabel({ players_json }, 1), 'Ana y Luis');
  assert.equal(matchTeamLabel({ players_json }, 2), 'Equipo 2');
});

test('only rivals get the window, an admin does not', () => {
  const closed = { ...row, closed_by: 'a' };
  assert.equal(isMatchRival(closed, 'c'), true);
  assert.equal(isMatchRival(closed, 'b'), false);
});
