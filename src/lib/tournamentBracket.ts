// Pure helpers for drawing tournament brackets (no React, no Supabase), so they can be unit tested.

export interface BracketPlayer {
  id?: string | null;
  initials?: string | null;
  display_name?: string | null;
}

export interface BracketRow {
  id: string;
  round_number: number;
  match_number: number;
  team1_player1?: string | null;
  team1_player2?: string | null;
  team2_player1?: string | null;
  team2_player2?: string | null;
  winner_team?: number | null;
  live_match_id?: string | null;
  t1p1?: BracketPlayer | null;
  t1p2?: BracketPlayer | null;
  t2p1?: BracketPlayer | null;
  t2p2?: BracketPlayer | null;
}

export interface BracketMatchInfo {
  id: string;
  status: string;
  team1_total?: number | null;
  team2_total?: number | null;
}

export type BracketState = 'bye' | 'waiting' | 'not_started' | 'playing' | 'to_confirm' | 'done' | 'stuck';

/** "Final", "Semifinal", "Cuartos" or "Ronda N", from how many matches the round has. */
export const roundLabel = (round: number, matchesInRound: number, isLastRound: boolean): string => {
  if (isLastRound && matchesInRound === 1) return 'Final';
  if (matchesInRound === 2) return 'Semifinal';
  if (matchesInRound === 4) return 'Cuartos';
  if (matchesInRound === 8) return 'Octavos';
  return `Ronda ${round}`;
};

const shortName = (p?: BracketPlayer | null): string => {
  const name = (p?.display_name || '').trim();
  if (name) return name.split(/\s+/)[0].slice(0, 12);
  return (p?.initials || '?').trim() || '?';
};

/** "Ana & Luis" for a team, or null when the slot is empty (a bye). */
export const teamLabel = (b: BracketRow, team: 1 | 2): string | null => {
  const [a, c] = team === 1 ? [b.t1p1, b.t1p2] : [b.t2p1, b.t2p2];
  const first = team === 1 ? b.team1_player1 : b.team2_player1;
  if (!first) return null;
  return c || (team === 1 ? b.team1_player2 : b.team2_player2) ? `${shortName(a)} & ${shortName(c)}` : shortName(a);
};

/** Where a bracket stands, from the bracket and its live match. */
export const bracketState = (b: BracketRow, m?: BracketMatchInfo | null): BracketState => {
  if (!b.team2_player1) return b.winner_team ? 'bye' : 'waiting';
  if (b.winner_team) return 'done';
  if (!b.team1_player1) return 'waiting';
  if (!m) return 'not_started';
  if (m.status === 'pending_confirmation') return 'to_confirm';
  if (m.status === 'active') return (m.team1_total || 0) + (m.team2_total || 0) > 0 ? 'playing' : 'not_started';
  // Cancelled, or closed without a winner: only an admin can move it on
  return 'stuck';
};

export const STATE_TEXT: Record<BracketState, string> = {
  bye: 'Pase directo',
  waiting: 'Esperando rivales',
  not_started: 'Por empezar',
  playing: 'En juego',
  to_confirm: 'Falta que el rival confirme',
  done: 'Terminada',
  stuck: 'Detenida: decide el admin',
};

/** Score shown next to each team: the live match's totals once it has started. */
export const bracketScore = (m?: BracketMatchInfo | null): [number, number] | null => {
  if (!m) return null;
  const a = m.team1_total || 0;
  const b = m.team2_total || 0;
  if (m.status === 'active' && a + b === 0) return null;
  return [a, b];
};

/** The final's winners, once the last round has a single decided match. */
export const champions = (rows: BracketRow[]): string | null => {
  if (!rows.length) return null;
  const last = Math.max(...rows.map((r) => r.round_number));
  const finals = rows.filter((r) => r.round_number === last);
  if (finals.length !== 1 || !finals[0].winner_team) return null;
  return teamLabel(finals[0], finals[0].winner_team === 1 ? 1 : 2);
};

/** True when an admin may decide this bracket by hand. */
export const canDecide = (b: BracketRow, m?: BracketMatchInfo | null): boolean => {
  const s = bracketState(b, m);
  return s === 'not_started' || s === 'playing' || s === 'to_confirm' || s === 'stuck';
};
