// Mirrors _match_rivals on the server. The server has the final word; this only
// decides which buttons a phone shows.

export interface RivalMatchRow {
  team1_player1?: string | null;
  team1_player2?: string | null;
  team2_player1?: string | null;
  team2_player2?: string | null;
  winner_team?: number | null;
  closed_by?: string | null;
  initial_team1?: string[] | null;
  initial_team2?: string[] | null;
}

const present = (ids: (string | null | undefined)[]) => ids.filter(Boolean) as string[];

export const matchRivalIds = (m: RivalMatchRow): string[] => {
  const team1 = present([m.team1_player1, m.team1_player2]);
  const team2 = present([m.team2_player1, m.team2_player2]);
  // Rivals are fixed when the match starts: a substitute can't confirm
  const initial1 = m.initial_team1 ?? team1;
  const initial2 = m.initial_team2 ?? team2;
  const closedBy = m.closed_by ?? '';

  if ([...team1, ...initial1].includes(closedBy)) return initial2;
  if ([...team2, ...initial2].includes(closedBy)) return initial1;
  if (m.winner_team === 1) return initial2;
  if (m.winner_team === 2) return initial1;
  return [...initial1, ...initial2];
};

export const canAnswerMatch = (m: RivalMatchRow, userId: string, isAdmin: boolean): boolean =>
  isAdmin || matchRivalIds(m).includes(userId);

export const isInMatch = (m: RivalMatchRow, userId: string): boolean =>
  present([
    m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2, m.closed_by,
    ...(m.initial_team1 ?? []), ...(m.initial_team2 ?? []),
  ]).includes(userId);
