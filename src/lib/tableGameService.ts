import { supabase } from './supabase';
import { generateUUID, offlineSync, TableGameOperation } from './offlineSync';
import { hasQueuedGame } from './outbox';
import { PokerHand } from './poker';
import {
  AnyTableGame,
  isConnectionError,
  RosterEntry,
  TABLE_GAME_COLUMNS,
  TableGame,
  TableGameKind,
} from './tableGames';

interface Result {
  ok: boolean;
  queued?: boolean;
  error?: string;
}

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

/** The café's internet comes and goes: a result that can't be sent waits in the outbox. */
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
  const { error } = await supabase.rpc(fn, args);
  if (!error) return { ok: true };
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

export const startTableGame = async (
  game: TableGameKind,
  roster: RosterEntry[],
  createdBy: string
): Promise<Result & { game?: TableGame }> => {
  const id = generateUUID();
  const result = await sendOrQueue('START_TABLE_GAME', 'start_table_game', { p_id: id, p_game: game, p_players: rosterPayload(roster) });
  return result.ok ? { ...result, game: localGame(id, game, roster, createdBy) } : result;
};

export const startPokerGame = async (
  roster: RosterEntry[],
  startChips: number,
  entry: number,
  createdBy: string
): Promise<Result & { game?: TableGame }> => {
  const id = generateUUID();
  const result = await sendOrQueue('START_POKER_GAME', 'start_poker_game', {
    p_id: id,
    p_players: rosterPayload(roster),
    p_start_chips: startChips,
    p_entry: entry,
  });
  if (!result.ok) return result;
  return { ...result, game: { ...localGame(id, 'poker', roster, createdBy), start_chips: startChips, entry_amount: entry } };
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
  const { data } = await supabase.from('table_games').select(TABLE_GAME_COLUMNS).eq('id', id).maybeSingle();
  return data ? bySeat(data) : null;
};

export const fetchTableGames = async (
  status: TableGame['status'],
  limit = 30,
  kind: 'uno' | 'poker' | 'all' = 'all'
): Promise<TableGame[]> => {
  let query = supabase.from('table_games').select(TABLE_GAME_COLUMNS).eq('status', status);
  if (kind === 'poker') query = query.eq('game', 'poker');
  if (kind === 'uno') query = query.neq('game', 'poker');
  const { data } = await query.order('created_at', { ascending: false }).limit(limit);
  return (data || []).map(bySeat);
};

export const fetchTableGameRanking = async (game: AnyTableGame, from: string | null): Promise<RankingRow[]> => {
  const { data } =
    game === 'poker'
      ? await supabase.rpc('poker_ranking', { p_from: from })
      : await supabase.rpc('table_game_ranking', { p_game: game, p_from: from });
  return (data || []).map((r: any) => ({ ...r, wins: Number(r.wins), played: Number(r.played), hands: Number(r.hands ?? 0) }));
};
