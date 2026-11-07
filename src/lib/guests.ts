// Guests: people who play without an account. Pure: no React, no Supabase.
// A game with more than one guest counts for nobody (ranking, stats, prizes, bets),
// so nobody can climb by beating made-up names.

export const GUEST_LIMIT = 1;

/** "  luis   pérez " -> "luis pérez": the same person typed twice is the same guest. */
export const normalizeGuestName = (name: string): string => name.trim().replace(/\s+/g, ' ');

const fold = (text: string) =>
  normalizeGuestName(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Names to suggest while typing: the ones that start with what was typed first, then the ones
 * that contain it. With nothing typed, the most recent ones. Never someone already chosen.
 */
export const suggestGuests = (all: string[], typed: string, chosen: string[] = [], limit = 5): string[] => {
  const taken = new Set(chosen.map(fold));
  const seen = new Set<string>();
  const pool = all.filter((name) => {
    const key = fold(name);
    if (!key || taken.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const t = fold(typed);
  if (!t) return pool.slice(0, limit);
  const starts = pool.filter((n) => fold(n).startsWith(t) || fold(n).split(' ').some((w) => w.startsWith(t)));
  const contains = pool.filter((n) => !starts.includes(n) && fold(n).includes(t));
  return [...starts, ...contains].filter((n) => fold(n) !== t).slice(0, limit);
};

interface DominoSeats {
  team1_player1?: string | null;
  team1_player2?: string | null;
  team2_player1?: string | null;
  team2_player2?: string | null;
}

/** Empty seats in a 2 vs 2 dominó match are guests. */
export const dominoGuestCount = (m: DominoSeats): number =>
  [m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2].filter((id) => !id).length;

/** Whether a dominó match counts for rankings and stats. */
export const countsForStats = (m: DominoSeats): boolean => dominoGuestCount(m) <= GUEST_LIMIT;
