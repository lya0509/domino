import { supabase } from './supabase';
import { generateUUID, offlineSync } from './offlineSync';
import {
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
}

const bySeat = (game: any): TableGame => ({
  ...game,
  players: [...(game.players || [])].sort((a: any, b: any) => a.seat - b.seat),
});

/** The café's internet comes and goes: a result that can't be sent waits in the outbox. */
const sendOrQueue = async (
  type: 'START_TABLE_GAME' | 'FINISH_TABLE_GAME',
  fn: string,
  args: Record<string, unknown>
): Promise<Result> => {
  if (!offlineSync.getIsOnline()) {
    await offlineSync.enqueueTableGame(type, args);
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

export const startTableGame = async (
  game: TableGameKind,
  roster: RosterEntry[],
  createdBy: string
): Promise<Result & { game?: TableGame }> => {
  const id = generateUUID();
  const players = roster.map((p) => (p.user_id ? { user_id: p.user_id } : { name: p.name }));
  const result = await sendOrQueue('START_TABLE_GAME', 'start_table_game', { p_id: id, p_game: game, p_players: players });
  if (!result.ok) return result;

  return {
    ...result,
    game: {
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
    },
  };
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

export const fetchTableGames = async (status: TableGame['status'], limit = 30): Promise<TableGame[]> => {
  const { data } = await supabase
    .from('table_games')
    .select(TABLE_GAME_COLUMNS)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).map(bySeat);
};

export const fetchTableGameRanking = async (game: TableGameKind, from: string | null): Promise<RankingRow[]> => {
  const { data } = await supabase.rpc('table_game_ranking', { p_game: game, p_from: from });
  return (data || []).map((r: any) => ({ ...r, wins: Number(r.wins), played: Number(r.played) }));
};
