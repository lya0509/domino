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

export const isMatchRival = (m: RivalMatchRow, userId: string): boolean => matchRivalIds(m).includes(userId);

export const CONFIRMATION_COLUMNS =
  'id, status, game_mode, limit_score, rounds, players_json, substitutions, team1_player1, team1_player2, team2_player1, team2_player2, team1_total, team2_total, winner_team, closed_by, initial_team1, initial_team2, auto_confirm_at, disputed_at, disputed_round, created_by, wager_amount, is_wager_match, tournament_id';

export const matchTeamLabel = (m: { players_json?: any[] | null }, team: number): string =>
  (m.players_json || [])
    .filter((p: any) => p.teamNumber === team)
    .map((p: any) => p.name || p.initials)
    .join(' y ') || `Equipo ${team}`;

export const secondsUntil = (iso: string, now: number = Date.now()): number =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));

// Club notices: who hears what, and in what words
export interface Notice {
  title: string;
  text: string;
}

type NoticeMatch = RivalMatchRow & { players_json?: any[] | null };

/** People at the table already know: only the rest of the club gets told. */
export const matchStartedNotice = (m: NoticeMatch, userId: string): Notice | null => {
  if (isInMatch(m, userId)) return null;
  return {
    title: '🎲 Ya están jugando',
    text: `${matchTeamLabel(m, 1)} contra ${matchTeamLabel(m, 2)}. Entra a verla en vivo.`,
  };
};

export const betPlacedNotice = (m: NoticeMatch, team: number, totalOnTeam: number): Notice => ({
  title: '💰 Apuestas en la mesa',
  text: `Hay ${totalOnTeam} puntos apostados por ${matchTeamLabel(m, team)}. ¡Entra rápido y apuesta tú también!`,
});

export const firstInLineNotice: Notice = {
  title: '🥇 Quedaste de primero',
  text: 'Tu dúo es el siguiente en la lista de espera. ¡Vayan preparándose!',
};
