// Hall of Fame numbers for dominó, from completed matches. Pure: no React, no Supabase.

export interface HofMatch {
  status?: string;
  winner_team?: number | null;
  is_zapato?: boolean | null;
  team1_player1?: string | null;
  team1_player2?: string | null;
  team2_player1?: string | null;
  team2_player2?: string | null;
  team1_total?: number | null;
  team2_total?: number | null;
  limit_score?: number | null;
}

export interface DominoRow {
  id: string;
  wins: number;
  played: number;
  zapatos: number;
  winRate: number; // 0..100
}

/** A team won 100 to 0 (or the match was marked as zapato). */
export const isZapatoFor = (m: HofMatch, team: 1 | 2): boolean => {
  if (m.winner_team !== team) return false;
  if (m.is_zapato) return true;
  const limit = m.limit_score || 100;
  const mine = team === 1 ? m.team1_total || 0 : m.team2_total || 0;
  const theirs = team === 1 ? m.team2_total || 0 : m.team1_total || 0;
  return mine >= limit && theirs === 0;
};

export const dominoStats = (matches: HofMatch[]): DominoRow[] => {
  const by: Record<string, DominoRow> = {};
  for (const m of matches) {
    if (m.status && m.status !== 'completed') continue;
    if (m.winner_team !== 1 && m.winner_team !== 2) continue;
    // More than one guest (empty seat): the match counts for nobody. Same rule as guests.ts
    if ([m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2].filter((id) => !id).length > 1) continue;
    const seats: [string | null | undefined, 1 | 2][] = [
      [m.team1_player1, 1], [m.team1_player2, 1], [m.team2_player1, 2], [m.team2_player2, 2],
    ];
    const seen = new Set<string>();
    for (const [pid, team] of seats) {
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const row = (by[pid] ||= { id: pid, wins: 0, played: 0, zapatos: 0, winRate: 0 });
      row.played++;
      if (m.winner_team === team) row.wins++;
      if (isZapatoFor(m, team)) row.zapatos++;
    }
  }
  return Object.values(by).map((r) => ({ ...r, winRate: r.played ? Math.round((r.wins / r.played) * 100) : 0 }));
};

/** Most wins first; a tie goes to the better win rate, then to fewer games. Nobody with 0 wins. */
export const rankWinners = (rows: DominoRow[], limit = 100): DominoRow[] =>
  rows
    .filter((r) => r.wins > 0)
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.played - b.played)
    .slice(0, limit);

/** Most zapatos given first. Nobody with 0. */
export const rankZapateros = (rows: DominoRow[], limit = 100): DominoRow[] =>
  rows
    .filter((r) => r.zapatos > 0)
    .sort((a, b) => b.zapatos - a.zapatos || b.wins - a.wins)
    .slice(0, limit);

/** Longest current playing streaks (days in a row). Nobody at 0. */
export const rankStreaks = <T extends { id: string; streak_count?: number | null }>(profiles: T[], limit = 100): T[] =>
  profiles
    .filter((p) => (p.streak_count || 0) > 0)
    .sort((a, b) => (b.streak_count || 0) - (a.streak_count || 0))
    .slice(0, limit);

export const medal = (index: number): string => (index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`);
