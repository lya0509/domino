// What a profile tells about a player's matches and bets. The lists and the totals
// above them read the same rules, so they can't disagree.

export interface HistoryMatch {
  id: string;
  status?: string | null;
  winner_team?: number | null;
  is_zapato?: boolean | null;
  team1_player1?: string | null;
  team1_player2?: string | null;
  team2_player1?: string | null;
  team2_player2?: string | null;
  team1_total?: number | null;
  team2_total?: number | null;
  limit_score?: number | null;
  rounds?: any[] | null;
  players_json?: any[] | null;
  created_at: string;
}

export interface HistoryBet {
  status: string;
  amount_wagered: number | string;
  multiplier?: number | string | null;
  /** What the server really paid (migration 16); missing on older bets */
  payout?: number | string | null;
}

export type BetOutcomeKind = 'pending' | 'won' | 'lost' | 'refunded';

export interface BetOutcome {
  kind: BetOutcomeKind;
  multiplier: number;
  payout: number;
  /** The daily cap on bet winnings paid less than amount x multiplier */
  capped: boolean;
  text: string;
}

export const MATCH_HISTORY_COLUMNS =
  'id, status, winner_team, is_zapato, team1_player1, team1_player2, team2_player1, team2_player2, team1_total, team2_total, limit_score, rounds, players_json, created_at';

export const teamOf = (m: HistoryMatch, playerId: string): 1 | 2 | null => {
  if (m.team1_player1 === playerId || m.team1_player2 === playerId) return 1;
  if (m.team2_player1 === playerId || m.team2_player2 === playerId) return 2;
  return null;
};

export const wonMatch = (m: HistoryMatch, playerId: string): boolean =>
  !!m.winner_team && m.winner_team === teamOf(m, playerId);

const decidedWith = (matches: HistoryMatch[], playerId: string, otherId: string, sameTeam: boolean) =>
  matches.filter((m) => {
    const mine = teamOf(m, playerId);
    const theirs = teamOf(m, otherId);
    return !!m.winner_team && !!mine && !!theirs && (mine === theirs) === sameTeam;
  });

export const matchesAgainst = (matches: HistoryMatch[], playerId: string, rivalId: string) =>
  decidedWith(matches, playerId, rivalId, false);

export const matchesTogether = (matches: HistoryMatch[], playerId: string, partnerId: string) =>
  decidedWith(matches, playerId, partnerId, true);

export const matchRecord = (matches: HistoryMatch[], playerId: string) => {
  const won = matches.filter((m) => wonMatch(m, playerId)).length;
  return { won, lost: matches.length - won };
};

export const sidesOf = (m: HistoryMatch, playerId: string) => {
  const team = teamOf(m, playerId) === 2 ? 2 : 1;
  return {
    team,
    rivalTeam: team === 1 ? 2 : 1,
    myScore: team === 1 ? m.team1_total : m.team2_total,
    rivalScore: team === 1 ? m.team2_total : m.team1_total,
  };
};

// players_json has every name, also those of guests without an account
export const partnerNames = (m: HistoryMatch, playerId: string): string =>
  (m.players_json || [])
    .filter((p: any) => p.teamNumber === teamOf(m, playerId) && p.profileId !== playerId)
    .map((p: any) => p.name || p.initials)
    .join(' y ');

// The server writes 'cancelled'; bets from before it say 'refunded'
export const betOutcome = (bet: HistoryBet): BetOutcome => {
  const amount = Number(bet.amount_wagered || 0);
  const multiplier = Number(bet.multiplier) > 0 ? Number(bet.multiplier) : 2;
  if (bet.status === 'won') {
    const full = Math.floor(amount * multiplier);
    const paid = bet.payout === null || bet.payout === undefined || bet.payout === '' ? full : Number(bet.payout);
    return { kind: 'won', multiplier, payout: paid, capped: paid < full, text: `+${paid} pts` };
  }
  if (bet.status === 'lost') return { kind: 'lost', multiplier, payout: 0, capped: false, text: `-${amount} pts` };
  if (bet.status === 'refunded' || bet.status === 'cancelled') {
    return { kind: 'refunded', multiplier, payout: 0, capped: false, text: `Reembolsado (+${amount} pts)` };
  }
  return { kind: 'pending', multiplier, payout: 0, capped: false, text: 'En curso' };
};
