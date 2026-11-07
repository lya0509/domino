// Rules for table games. They mirror the server, which has the final word:
// here they only decide what a phone shows.

export type TableGameKind = 'uno' | 'uno_flip' | 'uno_no_mercy';
export type AnyTableGame = TableGameKind | 'poker';

export const TABLE_GAMES: { key: TableGameKind; label: string }[] = [
  { key: 'uno', label: 'UNO' },
  { key: 'uno_flip', label: 'UNO Flip' },
  { key: 'uno_no_mercy', label: 'UNO No Mercy' },
];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export interface TableGamePlayer {
  seat: number;
  user_id: string | null;
  name: string;
  /** 'dealer' only deals: no chips, never in a hand, never the winner. Missing before SQL 22. */
  role?: 'player' | 'dealer' | null;
  /** "Estoy en la mesa". Missing before SQL 22, which counts as present. */
  checked_in_at?: string | null;
  /** Left mid-game: chips stay, no more hands, cannot win. */
  left_at?: string | null;
}

export interface TableGame {
  id: string;
  game: AnyTableGame;
  status: 'active' | 'pending_confirmation' | 'completed' | 'cancelled';
  created_by: string | null;
  winner_seat: number | null;
  closed_by: string | null;
  closed_at: string | null;
  auto_confirm_at: string | null;
  disputed_at: string | null;
  created_at: string;
  start_chips?: number | null;
  entry_amount?: number | null;
  rematch_of?: string | null;
  players: TableGamePlayer[];
}

export interface RosterEntry {
  user_id?: string;
  name: string;
}

export const TABLE_GAME_COLUMNS =
  'id, game, status, created_by, winner_seat, closed_by, closed_at, auto_confirm_at, disputed_at, created_at, start_chips, entry_amount, players:table_game_players(seat, user_id, name)';

/** With SQL 22: check-in, outside dealers, leaving and the single rematch. */
export const TABLE_GAME_COLUMNS_MESA =
  'id, game, status, created_by, winner_seat, closed_by, closed_at, auto_confirm_at, disputed_at, created_at, start_chips, entry_amount, rematch_of, players:table_game_players(seat, user_id, name, role, checked_in_at, left_at)';

/** More than one guest and the game counts for nobody's ranking, stats or prize. Same as guests.ts. */
export const GUEST_LIMIT = 1;

export const isDealerOnly = (p: Pick<TableGamePlayer, 'role'>): boolean => p.role === 'dealer';

/** Seats that play (not only deal), including those who left: their chips still show. */
export const playerSeats = (game: Pick<TableGame, 'players'>): number[] =>
  game.players.filter((p) => !isDealerOnly(p)).map((p) => p.seat);

/** Seats still in the game: they can enter hands and win. */
export const activeSeats = (game: Pick<TableGame, 'players'>): number[] =>
  game.players.filter((p) => !isDealerOnly(p) && !p.left_at).map((p) => p.seat);

/** Players with an account who have not tapped "Estoy en la mesa" yet. */
export const missingCheckIn = (game: Pick<TableGame, 'players'>): TableGamePlayer[] =>
  game.players.filter((p) => !isDealerOnly(p) && !!p.user_id && !p.left_at && p.checked_in_at === null);

export const needsMyCheckIn = (game: Pick<TableGame, 'players' | 'status'>, userId: string | null): boolean =>
  !!userId && game.status === 'active' && missingCheckIn(game).some((p) => p.user_id === userId);

export const guestCount = (game: Pick<TableGame, 'players'>): number =>
  game.players.filter((p) => !isDealerOnly(p) && !p.user_id).length;

export const countsForRanking = (game: Pick<TableGame, 'players'>): boolean => guestCount(game) <= GUEST_LIMIT;

export const tableGameLabel = (game: string): string =>
  game === 'poker' ? 'Póker' : TABLE_GAMES.find((g) => g.key === game)?.label ?? game;

export const canStartRoster = (roster: RosterEntry[]): boolean =>
  roster.length >= MIN_PLAYERS && roster.length <= MAX_PLAYERS;

export const playerNames = (game: Pick<TableGame, 'players'>): string =>
  [...game.players].filter((p) => !isDealerOnly(p)).sort((a, b) => a.seat - b.seat).map((p) => p.name).join(', ');

export const winnerName = (game: Pick<TableGame, 'players' | 'winner_seat'>): string | null =>
  game.players.find((p) => p.seat === game.winner_seat)?.name ?? null;

const isPlayer = (game: TableGame, userId: string) => game.players.some((p) => p.user_id === userId);

export const canManageGame = (game: TableGame, userId: string | null, isAdmin: boolean): boolean =>
  !!userId && (isAdmin || game.created_by === userId || isPlayer(game, userId));

/** Asked in the full-screen window: anyone else with an account who played. */
export const mustAnswerGame = (game: TableGame, userId: string): boolean =>
  game.status === 'pending_confirmation' && game.closed_by !== userId && isPlayer(game, userId);

export const canAnswerGame = (game: TableGame, userId: string | null, isAdmin: boolean): boolean =>
  !!userId && (mustAnswerGame(game, userId) || (isAdmin && game.status === 'pending_confirmation'));

/** The queue only takes what never reached the server: a server refusal must be shown. */
export const isConnectionError = (message: string | undefined): boolean =>
  /failed to fetch|network|timeout|load failed|conexi/i.test(message || '');
