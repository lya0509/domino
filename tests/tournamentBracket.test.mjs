import test from 'node:test';
import assert from 'node:assert/strict';
import { roundLabel, teamLabel, bracketState, bracketScore, champions, canDecide } from '../src/lib/tournamentBracket.ts';

const p = (display_name, initials) => ({ display_name, initials });
const llave = (extra = {}) => ({
  id: 'b1', round_number: 1, match_number: 1,
  team1_player1: 'a', team1_player2: 'b', team2_player1: 'c', team2_player2: 'd',
  t1p1: p('Ana María', 'AM'), t1p2: p('Luis', 'LU'), t2p1: p('Carlos', 'CA'), t2p2: p(null, 'DD'),
  winner_team: null, live_match_id: 'm1', ...extra,
});

test('round names follow how many matches the round has', () => {
  assert.equal(roundLabel(3, 1, true), 'Final');
  assert.equal(roundLabel(2, 2, false), 'Semifinal');
  assert.equal(roundLabel(1, 4, false), 'Cuartos');
  assert.equal(roundLabel(1, 3, false), 'Ronda 1');
  assert.equal(roundLabel(1, 1, false), 'Ronda 1');
});

test('teams show first names, or initials when there is no name', () => {
  assert.equal(teamLabel(llave(), 1), 'Ana & Luis');
  assert.equal(teamLabel(llave(), 2), 'Carlos & DD');
  assert.equal(teamLabel(llave({ team2_player1: null, team2_player2: null, t2p1: null, t2p2: null }), 2), null);
});

test('state of each bracket', () => {
  assert.equal(bracketState(llave(), null), 'not_started');
  assert.equal(bracketState(llave(), { id: 'm1', status: 'active', team1_total: 0, team2_total: 0 }), 'not_started');
  assert.equal(bracketState(llave(), { id: 'm1', status: 'active', team1_total: 35, team2_total: 0 }), 'playing');
  assert.equal(bracketState(llave(), { id: 'm1', status: 'pending_confirmation', team1_total: 100, team2_total: 40 }), 'to_confirm');
  assert.equal(bracketState(llave(), { id: 'm1', status: 'cancelled' }), 'stuck');
  assert.equal(bracketState(llave({ winner_team: 2 }), { id: 'm1', status: 'completed' }), 'done');
  assert.equal(bracketState(llave({ team2_player1: null, winner_team: 1 })), 'bye');
});

test('the score only shows once the match has started', () => {
  assert.equal(bracketScore(null), null);
  assert.equal(bracketScore({ id: 'm', status: 'active', team1_total: 0, team2_total: 0 }), null);
  assert.deepEqual(bracketScore({ id: 'm', status: 'completed', team1_total: 100, team2_total: 45 }), [100, 45]);
});

test('champions come from the decided final only', () => {
  const semis = [llave({ id: 's1', winner_team: 1 }), llave({ id: 's2', match_number: 2, winner_team: 2 })];
  assert.equal(champions(semis), null);
  const final = llave({ id: 'f', round_number: 2, winner_team: 2 });
  assert.equal(champions([...semis, { ...final, winner_team: null }]), null);
  assert.equal(champions([...semis, final]), 'Carlos & DD');
});

test('an admin may decide open or stuck brackets, never decided ones or byes', () => {
  assert.equal(canDecide(llave(), { id: 'm', status: 'pending_confirmation' }), true);
  assert.equal(canDecide(llave(), { id: 'm', status: 'cancelled' }), true);
  assert.equal(canDecide(llave({ winner_team: 1 }), { id: 'm', status: 'completed' }), false);
  assert.equal(canDecide(llave({ team2_player1: null, winner_team: 1 })), false);
});
