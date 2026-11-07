import { supabase } from './supabase';
import { generateUUID, offlineSync, TableGameOperation } from './offlineSync';
import { hasQueuedGame } from './outbox';
import { PokerHand } from './poker';
import {
  AnyTableGame,
  isConnectionError,
  RosterEntry,
  TABLE_GAME_COLUMNS,
  TABLE_GAME_COLUMNS_MESA,
  TableGame,
  TableGameKind,
} from './tableGames';

interface Result {
  ok: boolean;
  queued?: boolean;
  error?: string;
  data?: unknown;
}

// SQL 22 adds check-in, outside dealers, leaving and the single rematch. Until the owner runs it
// the app asks for the old columns and behaves as before. null: not known yet.
let mesa: boolean | null = null;
const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42703' || /does not exist|could not find/i.test(error.message || ''));
export const mesaReady = (): boolean => mesa === true;

const withColumns = async (build: (columns: string) => PromiseLike<{ data: any; error: any }>): Promise<{ data: any; error: any }> => {
  if (mesa !== false) {
    const res = await build(TABLE_GAME_COLUMNS_MESA);
    if (!res.error) {
      mesa = true;
      return res;
    }
    if (!isMissingColumn(res.error)) return res;
    mesa = false;
  }
  return build(TABLE_GAME_COLUMNS);
};

export interface RankingRow {
  user_id: string;
  display_name: string;
  wins: number;
  played: number;
  hands?: number;
  best_hand?: string | null;
}

const bySeat = (game: any): TableGame => ({
  ...game,
  players: [...(game.players || [])].sort((a: any, b: any) => a.seat - b.seat),
});

/** The cafetín's internet comes and goes: a result that can't be sent waits in the outbox. */
const sendOrQueue = async (
  type: TableGameOperation,
  fn: string,
  args: Record<string, unknown>
): Promise<Result> => {
  const gameId = (args.p_id ?? args.p_game) as string;
  if (!offlineSync.getIsOnline() || hasQueuedGame(offlineSync.getQueue(), gameId)) {
    await offlineSync.enqueueTableGame(type, args);
    offlineSync.flushQueue().catch(() => {});
    return { ok: true, queued: true };
  }
  const { data, error } = await supabase.rpc(fn, args);
  // set_poker_seat answers false when the hand moved on: the player has to know it didn't count
  if (!error && data === false) return { ok: false, error: 'Esa jugada ya no aplica: la mano cambió.' };
  if (!error) return { ok: true, data };
  if (isConnectionError(error.message)) {
    await offlineSync.enqueueTableGame(type, args);
    return { ok: true, queued: true };
  }
  return { ok: false, error: error.message };
};

const rosterPayload = (roster: RosterEntry[]) =>
  roster.map((p) => (p.user_id ? { user_id: p.user_id } : { name: p.name }));

const localGame = (id: string, game: AnyTableGame, roster: RosterEntry[], createdBy: string): TableGame => ({
  id,
  game,
  status: 'active',
  created_by: createdBy,
  winner_seat: null,
  closed_by: null,
  closed_at: null,
  auto_confirm_at: null,
  disputed_at: null,
  created_at: new Date().toISOString(),
  players: roster.map((p, seat) => ({ seat, user_id: p.user_id ?? null, name: p.name })),
});

/** The server may answer with another id: the rematch someone else already started. */
const startedGame = async (requested: string, result: Result, local: TableGame): Promise<Result & { game?: TableGame }> => {
  if (!result.ok) return result;
  const realId = typeof result.data === 'string' ? result.data : requested;
  if (realId === requested) return { ...result, game: local };
  const existing = await fetchTableGame(realId);
  return { ...result, game: existing ?? { ...local, id: realId } };
};

export const startTableGame = async (
  game: TableGameKind,
  roster: RosterEntry[],
  createdBy: string,
  rematchOf?: string
): Promise<Result & { game?: TableGame }> => {
  const id = generateUUID();
  const args: Record<string, unknown> = { p_id: id, p_game: game, p_players: rosterPayload(roster) };
  if (rematchOf && mesaReady()) args.p_rematch_of = rematchOf;
  const result = await sendOrQueue('START_TABLE_GAME', 'start_table_game', args);
  return startedGame(id, result, localGame(id, game, roster, createdBy));
};

export const startPokerGame = async (
  roster: RosterEntry[],
  startChips: number,
  entry: number,
  createdBy: string,
  rematchOf?: string
): Promise<Result & { game?: TableGame }> => {
  const id = generateUUID();
  const args: Record<string, unknown> = {
    p_id: id,
    p_players: rosterPayload(roster),
    p_start_chips: startChips,
    p_entry: entry,
  };
  if (rematchOf && mesaReady()) args.p_rematch_of = rematchOf;
  const result = await sendOrQueue('START_POKER_GAME', 'start_poker_game', args);
  return startedGame(id, result, { ...localGame(id, 'poker', roster, createdBy), start_chips: startChips, entry_amount: entry });
};

const rpc = async (fn: string, args: Record<string, unknown>): Promise<Result> => {
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: error.message } : { ok: true, data };
};

/** "Estoy en la mesa" from this phone. */
export const checkInTableGame = (id: string) => rpc('check_in_table_game', { p_id: id });

/** The creator turns someone who never confirmed into a guest, so the table can go on. */
export const makeTableGameGuest = (id: string, seat: number) => rpc('make_table_game_guest', { p_id: id, p_seat: seat });

/** Someone who only deals this hand: a player, an account or just a name. Answers the seat. */
export const addTableGameDealer = async (id: string, userId: string | null, name: string | null): Promise<Result & { seat?: number }> => {
  const res = await rpc('add_table_game_dealer', { p_id: id, p_user: userId, p_name: name });
  return res.ok ? { ...res, seat: Number(res.data) } : res;
};

export const leaveTableGame = (id: string, seat: number) => rpc('leave_table_game', { p_id: id, p_seat: seat });

/** Guest names the club has used, most recent first, for suggestions. Empty before SQL 22. */
export const fetchClubGuests = async (): Promise<string[]> => {
  const { data, error } = await supabase.from('club_guests').select('name').order('last_used_at', { ascending: false }).limit(300);
  return error ? [] : (data || []).map((g: any) => g.name);
};

/** Dominó remembers its guests when the match starts. Best effort: never blocks a match. */
export const rememberClubGuests = async (names: string[]) => {
  if (names.length === 0) return;
  await supabase.rpc('remember_club_guests', { p_names: names }).then(() => undefined, () => undefined);
};

export const savePokerHand = (gameId: string, hand: PokerHand): Promise<Result> =>
  sendOrQueue('SAVE_POKER_HAND', 'save_poker_hand', { p_game: gameId, p_hand: hand });

export const setPokerSeat = (gameId: string, number: number, seat: number, total: number, folded: boolean): Promise<Result> =>
  sendOrQueue('SET_POKER_SEAT', 'set_poker_seat', {
    p_game: gameId,
    p_number: number,
    p_seat: seat,
    p_total: total,
    p_folded: folded,
  });

export const cancelPokerHand = async (gameId: string, number: number): Promise<Result> => {
  // What is queued would bring the hand back once it reaches the server
  if (hasQueuedGame(offlineSync.getQueue(), gameId)) {
    return { ok: false, error: 'Esa mano todavía se está guardando. Inténtalo en unos segundos.' };
  }
  const { error } = await supabase.rpc('cancel_poker_hand', { p_game: gameId, p_number: number });
  return error ? { ok: false, error: error.message } : { ok: true };
};

export const fetchPokerHands = async (gameId: string): Promise<PokerHand[] | null> => {
  const { data, error } = await supabase.from('poker_hands').select('*').eq('game_id', gameId).order('number');
  if (error) return null;
  return (data || []).map((h: any) => ({
    number: h.number,
    dealerSeat: h.dealer_seat,
    dealerPlays: h.dealer_plays,
    entrants: h.entrants,
    contributions: h.contributions,
    folded: h.folded,
    bettingRound: h.betting_round,
    status: h.status,
    endType: h.end_type,
    winners: h.winners,
    bestHand: h.best_hand,
    scoredBy: h.scored_by,
  }));
};

export const finishTableGame = (id: string, winnerSeat: number): Promise<Result> =>
  sendOrQueue('FINISH_TABLE_GAME', 'finish_table_game', { p_id: id, p_winner_seat: winnerSeat });

export const cancelTableGame = async (id: string): Promise<Result> => {
  const { error } = await supabase.rpc('cancel_table_game', { p_id: id });
  return error ? { ok: false, error: error.message } : { ok: true };
};

export const answerTableGame = async (id: string, agree: boolean): Promise<Result> => {
  const { error } = await supabase.rpc('answer_table_game', { p_id: id, p_agree: agree });
  return error ? { ok: false, error: error.message } : { ok: true };
};

export const finishExpiredTableGame = async (id: string): Promise<boolean> => {
  const { data, error } = await supabase.rpc('finish_expired_table_game', { p_id: id });
  return !error && data === true;
};

export const fetchTableGame = async (id: string): Promise<TableGame | null> => {
  const { data } = await withColumns((columns) => supabase.from('table_games').select(columns).eq('id', id).maybeSingle());
  return data ? bySeat(data) : null;
};

export const fetchTableGames = async (
  status: TableGame['status'],
  limit = 30,
  kind: 'uno' | 'poker' | 'all' = 'all'
): Promise<TableGame[]> => {
  const { data } = await withColumns((columns) => {
    let query = supabase.from('table_games').select(columns).eq('status', status);
    if (kind === 'poker') query = query.eq('game', 'poker');
    if (kind === 'uno') query = query.neq('game', 'poker');
    return query.order('created_at', { ascending: false }).limit(limit);
  });
  return (data || []).map(bySeat);
};

export const fetchTableGameRanking = async (game: AnyTableGame, from: string | null): Promise<RankingRow[]> => {
  const { data } =
    game === 'poker'
      ? await supabase.rpc('poker_ranking', { p_from: from })
      : await supabase.rpc('table_game_ranking', { p_game: game, p_from: from });
  return (data || []).map((r: any) => ({ ...r, wins: Number(r.wins), played: Number(r.played), hands: Number(r.hands ?? 0) }));
};
