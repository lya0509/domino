/** Pure VIP rules, shared by the app and the unit tests. */

export const isVipActive = (info: { vip_until?: string | null } | null | undefined, now = Date.now()): boolean =>
  !!info?.vip_until && new Date(info.vip_until).getTime() > now;

/** Whole days left, rounded up: 1 hour left still reads "1 día". */
export const vipDaysLeft = (vipUntil: string | null | undefined, now = Date.now()): number =>
  vipUntil ? Math.max(0, Math.ceil((new Date(vipUntil).getTime() - now) / 86_400_000)) : 0;

export type RingStyle = 'oro' | 'diamante' | 'fuego' | 'arcoiris';

/** Ring styles a VIP can pick: the arc colors go top, right, bottom, left. */
export const RING_STYLES: Record<RingStyle, { label: string; main: string; soft: string; arc: [string, string, string, string] }> = {
  oro: { label: 'Oro', main: '#fbbf24', soft: 'rgba(251,191,36,0.35)', arc: ['#fbbf24', '#fde68a', 'transparent', 'transparent'] },
  diamante: { label: 'Diamante', main: '#67e8f9', soft: 'rgba(103,232,249,0.35)', arc: ['#67e8f9', '#e0f2fe', 'transparent', 'transparent'] },
  fuego: { label: 'Fuego', main: '#f97316', soft: 'rgba(239,68,68,0.4)', arc: ['#f97316', '#ef4444', '#facc15', 'transparent'] },
  arcoiris: { label: 'Arcoíris', main: '#a855f7', soft: 'rgba(168,85,247,0.35)', arc: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'] },
};

export const ringStyleOf = (style: string | null | undefined): RingStyle =>
  style && style in RING_STYLES ? (style as RingStyle) : 'oro';

/** Months paid in a row, as a badge: 1, 3, 6 and 12 months. */
export const seniorityBadge = (months: number | null | undefined): { icon: string; text: string } | null => {
  const m = Number(months) || 0;
  if (m >= 12) return { icon: '💎', text: `${m} meses VIP` };
  if (m >= 6) return { icon: '🥇', text: `${m} meses VIP` };
  if (m >= 3) return { icon: '🥈', text: `${m} meses VIP` };
  if (m >= 1) return { icon: '🥉', text: m === 1 ? '1 mes VIP' : `${m} meses VIP` };
  return null;
};

export const founderBadge = (n: number | null | undefined): string | null =>
  n && n >= 1 && n <= 10 ? `Fundador #${n}` : null;

export type WinStyle = 'confeti' | 'domino' | 'fuegos' | 'coronas';

/** What everyone sees when a VIP wins. */
export const WIN_STYLES: Record<WinStyle, { label: string; icon: string }> = {
  confeti: { label: 'Confeti dorado', icon: '🎊' },
  domino: { label: 'Lluvia de fichas', icon: '🁫' },
  fuegos: { label: 'Fuegos artificiales', icon: '🎆' },
  coronas: { label: 'Lluvia de coronas', icon: '♛' },
};

export const winStyleOf = (style: string | null | undefined): WinStyle =>
  style && style in WIN_STYLES ? (style as WinStyle) : 'confeti';

/** True for the push tags the VIP flow sends (vip-approved, vip-media-ok...). */
export const isVipPushTag = (tag: unknown): boolean => typeof tag === 'string' && tag.startsWith('vip-');
