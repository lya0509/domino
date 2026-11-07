// "Mi mes en el cafetín": a VIP's month in numbers. Pure: no React, no Supabase.
// Same rule as everywhere: a match with more than one guest counts for nobody.

export const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export interface RecapMatch {
  created_at: string;
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

export interface RecapTableGame {
  game: string;
  closed_at: string | null;
  winner_seat: number | null;
  /** The player's own seat. */
  seat: number;
  /** Guests (players without an account) at that table. */
  guests: number;
}

export interface Person {
  id: string;
  name: string;
  count: number;
}

export interface MonthRecap {
  month: string;
  label: string;
  domino: { played: number; wins: number; winRate: number; zapatos: number };
  uno: { played: number; wins: number };
  poker: { played: number; wins: number };
  played: number;
  wins: number;
  bestPartner: Person | null;
  toughestRival: Person | null;
  favoriteVictim: Person | null;
  bestStreak: number;
}

/** The club's month (Venezuela, UTC-4) of a moment, as 'YYYY-MM'. */
export const clubMonth = (at: string | number | Date): string => new Date(new Date(at).getTime() - 4 * 3600_000).toISOString().slice(0, 7);

export const previousMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

/** First and last instant of a club month, for the database query. */
export const monthRange = (month: string): { from: string; to: string } => {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 4));
  const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 4));
  return { from: from.toISOString(), to: to.toISOString() };
};

const isZapato = (m: RecapMatch, team: 1 | 2) => {
  if (m.winner_team !== team) return false;
  if (m.is_zapato) return true;
  const limit = m.limit_score || 100;
  const mine = team === 1 ? m.team1_total || 0 : m.team2_total || 0;
  const theirs = team === 1 ? m.team2_total || 0 : m.team1_total || 0;
  return mine >= limit && theirs === 0;
};

const top = (counts: Record<string, number>, names: Record<string, string>): Person | null => {
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || (names[a[0]] || '').localeCompare(names[b[0]] || ''))[0];
  return best ? { id: best[0], name: names[best[0]] || 'Alguien', count: best[1] } : null;
};

export const buildMonthRecap = (
  userId: string,
  month: string,
  matches: RecapMatch[],
  tables: RecapTableGame[],
  names: Record<string, string>
): MonthRecap => {
  const inMonth = matches
    .filter((m) => (!m.status || m.status === 'completed') && (m.winner_team === 1 || m.winner_team === 2))
    .filter((m) => clubMonth(m.created_at) === month)
    .filter((m) => [m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2].filter((id) => !id).length <= 1)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const partners: Record<string, number> = {};
  const beatMe: Record<string, number> = {};
  const iBeat: Record<string, number> = {};
  let wins = 0;
  let zapatos = 0;
  let streak = 0;
  let bestStreak = 0;
  let played = 0;

  for (const m of inMonth) {
    const team: 1 | 2 | null = [m.team1_player1, m.team1_player2].includes(userId) ? 1 : [m.team2_player1, m.team2_player2].includes(userId) ? 2 : null;
    if (!team) continue;
    played++;
    const won = m.winner_team === team;
    const mate = (team === 1 ? [m.team1_player1, m.team1_player2] : [m.team2_player1, m.team2_player2]).find((id) => id && id !== userId);
    const rivals = (team === 1 ? [m.team2_player1, m.team2_player2] : [m.team1_player1, m.team1_player2]).filter(Boolean) as string[];
    if (won) {
      wins++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      if (isZapato(m, team)) zapatos++;
      if (mate) partners[mate] = (partners[mate] || 0) + 1;
      rivals.forEach((r) => (iBeat[r] = (iBeat[r] || 0) + 1));
    } else {
      streak = 0;
      rivals.forEach((r) => (beatMe[r] = (beatMe[r] || 0) + 1));
    }
  }

  const tablesInMonth = tables.filter((t) => t.closed_at && clubMonth(t.closed_at) === month && t.guests <= 1);
  const count = (pred: (t: RecapTableGame) => boolean) => {
    const list = tablesInMonth.filter(pred);
    return { played: list.length, wins: list.filter((t) => t.winner_seat === t.seat).length };
  };
  const uno = count((t) => t.game !== 'poker');
  const poker = count((t) => t.game === 'poker');

  return {
    month,
    label: monthLabel(month),
    domino: { played, wins, winRate: played ? Math.round((wins / played) * 100) : 0, zapatos },
    uno,
    poker,
    played: played + uno.played + poker.played,
    wins: wins + uno.wins + poker.wins,
    bestPartner: top(partners, names),
    toughestRival: top(beatMe, names),
    favoriteVictim: top(iBeat, names),
    bestStreak,
  };
};
