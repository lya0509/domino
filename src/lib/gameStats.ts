import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { handLabel } from './poker';
import { countsForRanking } from './tableGames';
import { countTableRecord, pokerCells, StatCell, StatGame, TableRecord, UNO_GAMES, unoCells } from './gameStatsCore';

export * from './gameStatsCore';

const tableRecordQuery = (userId: string, games: string[], seatColumns: string) =>
  supabase
    .from('table_game_players')
    .select(`seat, ${seatColumns}, table_games!inner(game, status, winner_seat, players:table_game_players(user_id${seatColumns.includes('role') ? ', role' : ''}))`)
    .eq('user_id', userId)
    .eq('table_games.status', 'completed')
    .in('table_games.game', games);

const fetchTableRecord = async (userId: string, games: string[]): Promise<TableRecord> => {
  // With SQL 22 whoever only dealt did not play; before it, there is no role column
  let res: any = await tableRecordQuery(userId, games, 'role');
  if (res.error) res = await tableRecordQuery(userId, games, 'name');
  if (res.error) throw new Error(res.error.message);
  return countTableRecord(
    (res.data || [])
      .filter((r: any) => r.role !== 'dealer')
      .map((r: any) => {
        const g = Array.isArray(r.table_games) ? r.table_games[0] : r.table_games;
        return { game: g, seat: r.seat };
      })
      // More than one guest at the table: the game counts for nobody
      .filter(({ game }: any) => countsForRanking({ players: (game?.players || []).map((p: any) => ({ seat: 0, name: '', ...p })) }))
      .map(({ game, seat }: any) => ({ seat, winner_seat: game?.winner_seat ?? null })),
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
