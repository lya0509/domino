/** Personal numbers per game. Pure, so the unit tests can check them. */

export type StatGame = 'domino' | 'uno' | 'poker';

export const STAT_GAMES: { id: StatGame; label: string }[] = [
  { id: 'domino', label: 'Dominó' },
  { id: 'uno', label: 'UNO' },
  { id: 'poker', label: 'Póker' },
];

export const UNO_GAMES = ['uno', 'uno_flip', 'uno_no_mercy'];

export type StatTone = 'win' | 'loss' | 'accent' | 'plain';

export interface StatCell {
  label: string;
  value: string;
  tone: StatTone;
}

export interface TableRecord {
  wins: number;
  played: number;
}

/** One row per finished game the player sat in: did their seat win? */
export const countTableRecord = (rows: { seat: number; winner_seat: number | null }[]): TableRecord => ({
  wins: rows.filter((r) => r.winner_seat !== null && r.winner_seat === r.seat).length,
  played: rows.length,
});

const winRate = (wins: number, played: number) => (played > 0 ? `${Math.round((wins / played) * 100)}%` : '—');

export const dominoCells = (s: { wins: number; losses: number; total: number; zapatos: number }): StatCell[] => [
  { label: 'Ganadas', value: String(s.wins), tone: 'win' },
  { label: 'Perdidas', value: String(s.losses), tone: 'loss' },
  { label: 'Zapatos 👟', value: String(s.zapatos), tone: 'accent' },
  { label: 'Total', value: String(s.total), tone: 'plain' },
];

export const unoCells = (r: TableRecord): StatCell[] => [
  { label: 'Ganadas', value: String(r.wins), tone: 'win' },
  { label: 'Perdidas', value: String(Math.max(0, r.played - r.wins)), tone: 'loss' },
  { label: 'Victorias', value: winRate(r.wins, r.played), tone: 'accent' },
  { label: 'Jugadas', value: String(r.played), tone: 'plain' },
];

/** `bestHandLabel` is already in words (handLabel in poker.ts). */
export const pokerCells = (r: TableRecord, hands: number, bestHandLabel: string | null): StatCell[] => [
  { label: 'Ganadas', value: String(r.wins), tone: 'win' },
  { label: 'Jugadas', value: String(r.played), tone: 'plain' },
  { label: 'Manos', value: String(hands), tone: 'plain' },
  { label: 'Mejor jugada', value: bestHandLabel ?? '—', tone: 'accent' },
];
