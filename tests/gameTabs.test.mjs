import test from 'node:test';
import assert from 'node:assert/strict';
import { dragOffset, GAME_TABS, isHorizontalSwipe, tabAfterSwipe } from '../src/lib/gameTabs.ts';

test('the bar shows the three games and poker says it is in progress', () => {
  assert.deepEqual(GAME_TABS.map((t) => t.key), ['domino', 'uno', 'poker']);
  assert.equal(GAME_TABS[2].note, 'En proceso');
});

test('dragging left goes to the next game, right to the previous', () => {
  assert.equal(tabAfterSwipe('domino', -80, 0), 'uno');
  assert.equal(tabAfterSwipe('uno', -80, 0), 'poker');
  assert.equal(tabAfterSwipe('poker', 80, 0), 'uno');
  assert.equal(tabAfterSwipe('uno', 80, 0), 'domino');
});

test('the row has an end on each side', () => {
  assert.equal(tabAfterSwipe('domino', 200, 0), 'domino');
  assert.equal(tabAfterSwipe('poker', -200, 0), 'poker');
});

test('a short slow drag stays, a short fast flick changes', () => {
  assert.equal(tabAfterSwipe('domino', -30, 0.1), 'domino');
  assert.equal(tabAfterSwipe('domino', -30, -0.9), 'uno');
});

test('scrolling down the page is never taken for a swipe', () => {
  assert.equal(isHorizontalSwipe(20, 90, 200, 390), false);
  assert.equal(isHorizontalSwipe(5, 0, 200, 390), false);
  assert.equal(isHorizontalSwipe(40, 5, 200, 390), true);
});

test('the phone keeps its own back gesture at the screen edges', () => {
  assert.equal(isHorizontalSwipe(40, 0, 10, 390), false);
  assert.equal(isHorizontalSwipe(-40, 0, 385, 390), false);
});

test('past the last game the content resists the finger', () => {
  assert.equal(dragOffset('uno', -100), -100);
  assert.equal(dragOffset('domino', 100), 15);
  assert.equal(dragOffset('poker', -100), -15);
});
