// Mirrors _match_rivals on the server. The server has the final word; this only
// decides which buttons a phone shows.

export interface RivalMatchRow {
  team1_player1?: string | null;
  team1_player2?: string | null;
  team2_player1?: string | null;
  team2_player2?: string | null;
  winner_team?: number | null;
  closed_by?: string | null;
}

const present = (ids: (string | null | undefined)[]) => ids.filter(Boolean) as string[];

export const matchRivalIds = (m: RivalMatchRow): string[] => {
  const team1 = present([m.team1_player1, m.team1_player2]);
  const team2 = present([m.team2_player1, m.team2_player2]);
  const closedBy = m.closed_by ?? '';

  if (team1.includes(closedBy)) return team2;
  if (team2.includes(closedBy)) return team1;
  if (m.winner_team === 1) return team2;
  if (m.winner_team === 2) return team1;
  return [...team1, ...team2];
};

export const canAnswerMatch = (m: RivalMatchRow, userId: string, isAdmin: boolean): boolean =>
  isAdmin || matchRivalIds(m).includes(userId);

export const isInMatch = (m: RivalMatchRow, userId: string): boolean =>
  present([m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2, m.closed_by]).includes(userId);
