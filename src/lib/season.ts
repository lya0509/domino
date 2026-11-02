/** Seasonal touches for the VIP card. Pure, so the unit tests can check the dates. */

export type SeasonId = 'navidad' | 'carnaval' | 'halloween';

export interface Season {
  id: SeasonId;
  label: string;
  glyphs: [string, string, string, string];
  accent: string;
}

export const SEASONS: Record<SeasonId, Season> = {
  navidad: { id: 'navidad', label: '¡Feliz Navidad!', glyphs: ['🎄', '❄️', '🎁', '⭐'], accent: '#ef4444' },
  carnaval: { id: 'carnaval', label: '¡Feliz Carnaval!', glyphs: ['🎭', '🎉', '🎊', '✨'], accent: '#a855f7' },
  halloween: { id: 'halloween', label: '¡Feliz Halloween!', glyphs: ['🎃', '🦇', '👻', '🕸️'], accent: '#f97316' },
};

/** Easter Sunday (Gregorian calendar, anonymous algorithm), as a local date. */
export const easterSunday = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
};

const dayNumber = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);

/**
 * Navidad from 1 December to 6 January (Reyes). Carnaval from the Friday before
 * to Carnaval Tuesday (Easter minus 51 to minus 47 days). Halloween 25-31 October.
 */
export const seasonFor = (date: Date): Season | null => {
  const m = date.getMonth();
  const d = date.getDate();
  if (m === 11 || (m === 0 && d <= 6)) return SEASONS.navidad;
  if (m === 9 && d >= 25) return SEASONS.halloween;
  const today = dayNumber(date);
  const easter = dayNumber(easterSunday(date.getFullYear()));
  if (today >= easter - 51 && today <= easter - 47) return SEASONS.carnaval;
  return null;
};

/** The season to show now. On the web `?temporada=navidad` previews one. */
export const currentSeason = (now = new Date()): Season | null => {
  try {
    const q = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search).get('temporada') : null;
    if (q && q in SEASONS) return SEASONS[q as SeasonId];
    if (q === 'ninguna') return null;
  } catch {
    // no window: fall through to the calendar
  }
  return seasonFor(now);
};
