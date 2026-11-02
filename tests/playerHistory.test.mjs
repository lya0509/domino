import test from 'node:test';
import assert from 'node:assert/strict';
import {
  betOutcome,
  matchRecord,
  matchesAgainst,
  matchesTogether,
  partnerNames,
  sidesOf,
  teamOf,
  wonMatch,
} from '../src/lib/playerHistory.ts';

const match = (id, team1, team2, winner, totals = [100, 80]) => ({
  id,
  team1_player1: team1[0],
  team1_player2: team1[1] ?? null,
  team2_player1: team2[0],
  team2_player2: team2[1] ?? null,
  winner_team: winner,
  team1_total: totals[0],
  team2_total: totals[1],
  created_at: '2026-10-20T20:00:00Z',
});

const history = [
  match('a', ['yo', 'luis'], ['jorge', 'ana'], 1),
  match('b', ['jorge', 'ana'], ['yo', 'luis'], 1),
  match('c', ['jorge', 'pedro'], ['yo', 'ana'], 1),
  match('d', ['yo', 'jorge'], ['luis', 'ana'], 2),
  match('e', ['yo', 'luis'], ['jorge', 'ana'], null),
];

test('a player is on the team that holds their seat', () => {
  assert.equal(teamOf(history[0], 'luis'), 1);
  assert.equal(teamOf(history[1], 'luis'), 2);
  assert.equal(teamOf(history[0], 'nadie'), null);
});

test('winning needs a decided match on the winning side', () => {
  assert.equal(wonMatch(history[0], 'yo'), true);
  assert.equal(wonMatch(history[1], 'yo'), false);
  assert.equal(wonMatch(history[4], 'yo'), false);
});

test('a rival list holds decided matches on opposite sides only', () => {
  const ids = matchesAgainst(history, 'yo', 'jorge').map((m) => m.id);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('the rival record agrees with the count shown on the card', () => {
  const list = matchesAgainst(history, 'yo', 'jorge');
  assert.deepEqual(matchRecord(list, 'yo'), { won: 1, lost: 2 });
});

test('a duo list holds decided matches on the same side only', () => {
  const list = matchesTogether(history, 'yo', 'luis');
  assert.deepEqual(list.map((m) => m.id), ['a', 'b']);
  assert.deepEqual(matchRecord(list, 'yo'), { won: 1, lost: 1 });
});

test('sides read from the player, whichever team they sat on', () => {
  assert.deepEqual(sidesOf(history[1], 'yo'), { team: 2, rivalTeam: 1, myScore: 80, rivalScore: 100 });
  assert.deepEqual(sidesOf(history[0], 'yo'), { team: 1, rivalTeam: 2, myScore: 100, rivalScore: 80 });
});

test('the partner comes from the match, so a guest keeps their name', () => {
  const m = {
    ...history[0],
    players_json: [
      { teamNumber: 1, profileId: 'yo', name: 'Yo' },
      { teamNumber: 1, profileId: null, name: 'Invitado' },
      { teamNumber: 2, profileId: 'jorge', name: 'Jorge' },
    ],
  };
  assert.equal(partnerNames(m, 'yo'), 'Invitado');
});

test('a match without a partner has none to show', () => {
  const solo = { ...match('f', ['yo'], ['jorge'], 1), players_json: [{ teamNumber: 1, profileId: 'yo', name: 'Yo' }] };
  assert.equal(partnerNames(solo, 'yo'), '');
  assert.equal(partnerNames(match('g', ['yo'], ['jorge'], 1), 'yo'), '');
});

test('a refunded bet is not a lost bet', () => {
  const bet = { status: 'refunded', amount_wagered: 100, multiplier: 1.5 };
  assert.deepEqual(betOutcome(bet), { kind: 'refunded', multiplier: 1.5, payout: 0, text: 'Reembolsado (+100 pts)' });
});

test('a cancelled bet reads the same as a refunded one', () => {
  assert.equal(betOutcome({ status: 'cancelled', amount_wagered: 40, multiplier: 2 }).kind, 'refunded');
});

test('a won bet pays what the server pays, rounded down', () => {
  const outcome = betOutcome({ status: 'won', amount_wagered: 75, multiplier: '1.35' });
  assert.equal(outcome.kind, 'won');
  assert.equal(outcome.payout, 101);
  assert.equal(outcome.text, '+101 pts');
});

test('a lost bet shows what was put in', () => {
  const outcome = betOutcome({ status: 'lost', amount_wagered: 75, multiplier: 1.35 });
  assert.equal(outcome.kind, 'lost');
  assert.equal(outcome.text, '-75 pts');
});

test('a bet still open says so', () => {
  assert.equal(betOutcome({ status: 'pending', amount_wagered: 75, multiplier: 1.35 }).kind, 'pending');
});

test('a bet without a multiplier falls back to the same x2 as the server', () => {
  const outcome = betOutcome({ status: 'won', amount_wagered: 50, multiplier: 0 });
  assert.equal(outcome.multiplier, 2);
  assert.equal(outcome.payout, 100);
});
