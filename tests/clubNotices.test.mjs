import test from 'node:test';
import assert from 'node:assert/strict';
import { betPlacedNotice, matchStartedNotice } from '../src/lib/matchRivals.ts';

const match = {
  team1_player1: 'a', team1_player2: 'b', team2_player1: 'c', team2_player2: 'd',
  players_json: [
    { teamNumber: 1, name: 'Ana' }, { teamNumber: 1, name: 'Beto' },
    { teamNumber: 2, name: 'Caro' }, { teamNumber: 2, name: 'Dani' },
  ],
};

test('the club hears who started playing', () => {
  assert.match(matchStartedNotice(match, 'x').text, /Ana y Beto contra Caro y Dani/);
});

test('people at the table are not told about their own match', () => {
  assert.equal(matchStartedNotice(match, 'a'), null);
});

test('a bet says how much is on which team', () => {
  assert.match(betPlacedNotice(match, 2, 20).text, /20 puntos apostados por Caro y Dani/);
});
