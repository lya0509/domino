import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { handLabel } from './poker';
import { countTableRecord, pokerCells, StatCell, StatGame, TableRecord, UNO_GAMES, unoCells } from './gameStatsCore';

export * from './gameStatsCore';

const fetchTableRecord = async (userId: string, games: string[]): Promise<TableRecord> => {
  const { data, error } = await supabase
    .from('table_game_players')
    .select('seat, table_games!inner(game, status, winner_seat)')
    .eq('user_id', userId)
    .eq('table_games.status', 'completed')
    .in('table_games.game', games);
  if (error) throw new Error(error.message);
  return countTableRecord(
    (data || []).map((r: any) => {
      const g = Array.isArray(r.table_games) ? r.table_games[0] : r.table_games;
      return { seat: r.seat, winner_seat: g?.winner_seat ?? null };
    }),
  );
};

/** UNO (all variants) or poker numbers for one player, all time. */
export const fetchTableGameCells = async (userId: string, game: Exclude<StatGame, 'domino'>): Promise<StatCell[]> => {
  if (game === 'uno') return unoCells(await fetchTableRecord(userId, UNO_GAMES));
  const [record, ranking] = await Promise.all([
    fetchTableRecord(userId, ['poker']),
    supabase.rpc('poker_ranking', { p_from: null }),
  ]);
  const mine = (ranking.data || []).find((r: any) => r.user_id === userId);
  return pokerCells(record, Number(mine?.hands ?? 0), handLabel(mine?.best_hand ?? null));
};

const cache = new Map<string, { at: number; cells: StatCell[] }>();
const FRESH_MS = 60_000;

/** Cells for UNO or poker; null while loading or for dominó (the screens already have those). */
export const useTableGameCells = (userId: string | null | undefined, game: StatGame): StatCell[] | null => {
  const key = `${userId}:${game}`;
  const [cells, setCells] = useState<StatCell[] | null>(() => cache.get(key)?.cells ?? null);

  useEffect(() => {
    if (!userId || game === 'domino') {
      setCells(null);
      return;
    }
    const hit = cache.get(key);
    setCells(hit?.cells ?? null);
    if (hit && Date.now() - hit.at < FRESH_MS) return;
    let alive = true;
    fetchTableGameCells(userId, game)
      .then((c) => {
        cache.set(key, { at: Date.now(), cells: c });
        if (alive) setCells(c);
      })
      .catch(() => {
        if (alive) setCells(game === 'uno' ? unoCells({ wins: 0, played: 0 }) : pokerCells({ wins: 0, played: 0 }, 0, null));
      });
    return () => {
      alive = false;
    };
  }, [key, userId, game]);

  return cells;
};
