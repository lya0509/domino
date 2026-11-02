import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callBet,
  betChips,
  canScoreHand,
  chipValues,
  chipLeaders,
  chipsAfterHands,
  closeByFold,
  closeShowdown,
  copySeat,
  currentBet,
  foldPlayer,
  handPot,
  isShortAllIn,
  loneSurvivor,
  nextDealerSeat,
  openHand,
  owedBy,
  POKER_HANDS,
  rackOf,
  raiseBet,
  seatStatus,
  splitPot,
  stackLeft,
  trayAction,
  unfoldPlayer,
} from '../src/lib/poker.ts';

const chips = { 0: 200, 1: 200, 2: 200 };
const hand = (over = {}) => ({
  ...openHand({ number: 1, dealerSeat: 0, dealerPlays: true, entrants: [0, 1, 2], entry: 20, chips }),
  ...over,
});

test('there are the 10 agreed hands, best first', () => {
  assert.equal(POKER_HANDS.length, 10);
  assert.equal(POKER_HANDS[0].label, 'Escalera real');
  assert.equal(POKER_HANDS[9].label, 'Carta alta');
});

test('everyone enters with the entry', () => {
  const h = hand();
  assert.deepEqual(h.contributions, { 0: 20, 1: 20, 2: 20 });
  assert.equal(handPot(h), 60);
  assert.equal(h.status, 'open');
});

test('the agreed example: entry 20, Javier adds 40, whoever calls carries 60', () => {
  let h = raiseBet(hand(), 1, 40, chips);
  assert.equal(h.contributions[1], 60);
  assert.equal(currentBet(h), 60);
  assert.equal(owedBy(h, 0, chips), 40);
  h = callBet(h, 0, chips);
  assert.equal(h.contributions[0], 60);
  assert.equal(owedBy(h, 0, chips), 0);
});

test('a raise adds on top of the highest bet, even from someone behind', () => {
  let h = raiseBet(hand(), 1, 40, chips);
  h = raiseBet(h, 2, 10, chips);
  assert.equal(h.contributions[2], 70);
});

test('who does not call loses what they already put in', () => {
  let h = raiseBet(hand(), 1, 40, chips);
  h = foldPlayer(h, 2);
  assert.equal(h.contributions[2], 20);
  assert.equal(handPot(h), 100);
  assert.equal(loneSurvivor(h), null);
});

test('when everyone else folds the last one wins without showing', () => {
  let h = foldPlayer(foldPlayer(hand(), 0), 1);
  assert.equal(loneSurvivor(h), 2);
  h = closeByFold(h);
  assert.deepEqual(h.winners, [{ seat: 2, amount: 60 }]);
  assert.equal(h.endType, 'fold');
  assert.equal(h.bestHand, null);
  assert.equal(h.status, 'closed');
});

test('a player never bets more chips than they have', () => {
  const short = { 0: 200, 1: 35, 2: 200 };
  let h = openHand({ number: 1, dealerSeat: 0, dealerPlays: true, entrants: [0, 1, 2], entry: 20, chips: short });
  h = raiseBet(h, 0, 100, short);
  h = callBet(h, 1, short);
  assert.equal(h.contributions[1], 35);
  assert.equal(stackLeft(h, 1, short), 0);
  assert.equal(owedBy(h, 1, short), 0);
  assert.equal(isShortAllIn(h, short), true);
});

test('an entry bigger than a stack takes what is left', () => {
  const short = { 0: 200, 1: 5 };
  const h = openHand({ number: 1, dealerSeat: 0, dealerPlays: true, entrants: [0, 1], entry: 20, chips: short });
  assert.equal(h.contributions[1], 5);
});

test('with bets matched no one is short all-in', () => {
  assert.equal(isShortAllIn(hand(), chips), false);
});

test('a tie splits the pot and the dealer gives the odd chip', () => {
  assert.deepEqual(splitPot(61, [0, 1], 1), [{ seat: 0, amount: 30 }, { seat: 1, amount: 31 }]);
  assert.deepEqual(splitPot(60, [0, 1], null), [{ seat: 0, amount: 30 }, { seat: 1, amount: 30 }]);
});

test('a hand with cards keeps its winners and the best hand', () => {
  const h = closeShowdown(hand(), [{ seat: 1, amount: 60 }], 'full_house');
  assert.equal(h.endType, 'showdown');
  assert.equal(h.bestHand, 'full_house');
});

test('a showdown must hand out exactly the pot', () => {
  assert.throws(() => closeShowdown(hand(), [{ seat: 1, amount: 50 }], 'full_house'), /fichas/);
  assert.throws(() => closeShowdown(hand(), [{ seat: 1, amount: 60 }], 'inventada'), /jugada/);
});

test('chips come from the hands already closed', () => {
  const closed = closeShowdown(raiseBet(hand(), 1, 40, chips), [{ seat: 1, amount: 100 }], 'flush');
  assert.deepEqual(chipsAfterHands([0, 1, 2], 200, [closed]), { 0: 180, 1: 240, 2: 180 });
});

test('an open hand does not change the stacks yet', () => {
  assert.deepEqual(chipsAfterHands([0, 1, 2], 200, [hand()]), { 0: 200, 1: 200, 2: 200 });
});

test('the dealer moves to the next seat and wraps around', () => {
  assert.equal(nextDealerSeat([0, 1, 2], null), 0);
  assert.equal(nextDealerSeat([0, 1, 2], 0), 1);
  assert.equal(nextDealerSeat([0, 1, 2], 2), 0);
});

test('the game goes to who has the most chips, and a tie is reported', () => {
  assert.deepEqual(chipLeaders({ 0: 300, 1: 100, 2: 200 }), [0]);
  assert.deepEqual(chipLeaders({ 0: 300, 1: 300, 2: 0 }), [0, 1]);
});

test('only the dealer scores; the creator covers a dealer with no phone', () => {
  const game = { created_by: 'c', players: [{ seat: 0, user_id: 'a', name: 'A' }, { seat: 1, user_id: null, name: 'B' }] };
  assert.equal(canScoreHand(game, 0, 'a', false), true);
  assert.equal(canScoreHand(game, 0, 'z', false), false);
  assert.equal(canScoreHand(game, 0, 'c', false), true);
  assert.equal(canScoreHand(game, 1, 'c', false), true);
  assert.equal(canScoreHand(game, 1, 'z', true), true);
  assert.equal(canScoreHand(game, 0, null, false), false);
});

test('someone folded by mistake comes back with what they had put in', () => {
  const h = unfoldPlayer(foldPlayer(hand(), 2), 2);
  assert.deepEqual(h.folded, []);
  assert.equal(h.contributions[2], 20);
});

test('the guide shows five different example cards for each hand', () => {
  POKER_HANDS.forEach((hand) => {
    assert.equal(hand.cards.length, 5, hand.label);
    assert.equal(new Set(hand.cards).size, 5, hand.label);
    hand.cards.forEach((card) => assert.match(card, /^(10|[2-9JQKA])[♠♥♦♣]$/, hand.label));
  });
});

test('chip values follow the entry', () => {
  assert.deepEqual(chipValues(20), [10, 20, 50, 100, 200]);
  assert.deepEqual(chipValues(10), [5, 10, 25, 50, 100]);
  assert.deepEqual(chipValues(1), [1, 3, 5, 10]);
});

test('the rack adds up to the stack and keeps small chips in view', () => {
  const values = chipValues(20);
  const rack = rackOf(480, values);
  assert.equal(values.reduce((sum, v) => sum + v * rack[v], 0), 480);
  assert.ok(rack[10] > 0 && rack[20] > 0);
  assert.equal(values.reduce((sum, v) => sum + v * rackOf(30, values)[v], 0), 30);
  assert.deepEqual(rackOf(0, values), { 10: 0, 20: 0, 50: 0, 100: 0, 200: 0 });
});

test('the tray button says what will happen', () => {
  const h = raiseBet(hand(), 1, 40, chips);
  assert.deepEqual(trayAction(h, 0, chips, 0), { label: 'Igualar 40', amount: 40, enabled: true });
  assert.deepEqual(trayAction(h, 0, chips, 20), { label: 'Faltan 20', amount: 20, enabled: false });
  assert.deepEqual(trayAction(h, 0, chips, 40), { label: 'Igualar 40', amount: 40, enabled: true });
  assert.deepEqual(trayAction(h, 0, chips, 50), { label: 'Subir 10, total 70', amount: 50, enabled: true });
  assert.equal(trayAction(h, 1, chips, 0).enabled, false);
  assert.equal(trayAction(h, 1, chips, 0).label, 'Nada que igualar');
});

test('betting everything is allowed even when it does not reach', () => {
  const short = { 0: 200, 1: 35, 2: 200 };
  let h = openHand({ number: 1, dealerSeat: 0, dealerPlays: true, entrants: [0, 1, 2], entry: 20, chips: short });
  h = raiseBet(h, 0, 100, short);
  assert.deepEqual(trayAction(h, 1, short, 15), { label: 'Todo adentro 15', amount: 15, enabled: true });
  assert.equal(betChips(h, 1, 15, short).contributions[1], 35);
});

test('a tray bet adds to what the player already put in, up to their chips', () => {
  assert.equal(betChips(hand(), 1, 40, chips).contributions[1], 60);
  assert.equal(betChips(hand(), 1, 900, chips).contributions[1], 200);
});

test('each seat shows how it stands', () => {
  const short = { 0: 200, 1: 60, 2: 200 };
  let h = openHand({ number: 1, dealerSeat: 0, dealerPlays: true, entrants: [0, 1, 2], entry: 20, chips: short });
  h = foldPlayer(raiseBet(h, 0, 100, short), 2);
  h = callBet(h, 1, short);
  assert.deepEqual(seatStatus(h, 0, short), { state: 'matched', owed: 0 });
  assert.deepEqual(seatStatus(h, 1, short), { state: 'allIn', owed: 0 });
  assert.deepEqual(seatStatus(h, 2, short), { state: 'folded', owed: 0 });
  assert.deepEqual(seatStatus(raiseBet(hand(), 1, 40, chips), 0, chips), { state: 'owes', owed: 40 });
});

test('copying one seat leaves what the others did', () => {
  const before = hand();
  const server = raiseBet(before, 2, 30, chips);
  const mine = foldPlayer(before, 1);
  const merged = copySeat(server, mine, 1);
  assert.equal(merged.contributions[2], 50);
  assert.deepEqual(merged.folded, [1]);
  assert.deepEqual(copySeat(merged, before, 1).folded, []);
});
