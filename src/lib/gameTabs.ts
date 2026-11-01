// The games in Home's bottom bar, and the rules of swiping between them.

export type GameTab = 'domino' | 'uno' | 'poker';

export const GAME_TABS: { key: GameTab; label: string; color: string; note?: string }[] = [
  { key: 'domino', label: 'Dominó', color: '#3b82f6' },
  { key: 'uno', label: 'UNO', color: '#e5484d' },
  { key: 'poker', label: 'Póker', color: '#d4a843', note: 'En proceso' },
];

const SWIPE_DISTANCE = 60;
const SWIPE_SPEED = 0.5;
const EDGE_RESISTANCE = 0.15;
// The first pixels of the screen belong to the phone's own back gesture
const SCREEN_EDGE = 24;
const MIN_DRAG = 12;

export const tabIndex = (tab: GameTab): number => GAME_TABS.findIndex((t) => t.key === tab);

export const isHorizontalSwipe = (dx: number, dy: number, startX: number, screenWidth: number): boolean =>
  Math.abs(dx) > MIN_DRAG &&
  Math.abs(dx) > Math.abs(dy) * 2 &&
  startX > SCREEN_EDGE &&
  startX < screenWidth - SCREEN_EDGE;

/** Dragging left brings the game on the right, as if the games sat side by side. */
export const tabAfterSwipe = (current: GameTab, dx: number, vx: number): GameTab => {
  const decided = Math.abs(dx) >= SWIPE_DISTANCE || Math.abs(vx) >= SWIPE_SPEED;
  if (!decided || dx === 0) return current;
  const next = tabIndex(current) + (dx < 0 ? 1 : -1);
  return GAME_TABS[next]?.key ?? current;
};

/** Past the first or last game the content barely moves, so the end of the row can be felt. */
export const dragOffset = (current: GameTab, dx: number): number => {
  const atEnd = tabAfterSwipe(current, dx, 1) === current;
  return atEnd ? dx * EDGE_RESISTANCE : dx;
};
