// The store catalog and the rules for wearing cosmetics. Pure: no React, no Supabase.
// Prices and ids must match public.store_catalog() on the server.

export type CosmeticType = 'title' | 'color' | 'border' | 'table_color';

export interface StoreItem {
  id: string;
  type: CosmeticType;
  name: string;
  price: number;
  value?: string;
  isExclusive?: boolean;
  isCustom?: boolean;
  /** Monthly VIP gift: 'YYYY-MM'. Never sold, kept forever. */
  giftMonth?: string;
}

export interface Equipped {
  title?: string | null;
  color?: string | null;
  border?: string | null;
  table_color?: string | null;
}

export const STORE_ITEMS: StoreItem[] = [
  { id: 'title_veteran', type: 'title', name: '🏅 Superviviente', price: 0, isExclusive: true },
  { id: 'title_mala_suerte', type: 'title', name: '⛈️ Mala Suerte', price: 10000 },
  { id: 'title_rey', type: 'title', name: '👑 Rey del Zapato', price: 50000 },
  { id: 'title_millonario', type: 'title', name: '💰 Millonario', price: 100000 },
  { id: 'title_custom', type: 'title', name: '✏️ Etiqueta Personalizada', price: 250000, isCustom: true },
  { id: 'color_fire', type: 'color', name: 'Nombre Fuego', price: 60000, value: '#EF4444' },
  { id: 'color_gold', type: 'color', name: 'Nombre Dorado', price: 80000, value: '#F59E0B' },
  { id: 'color_rainbow', type: 'color', name: 'Nombre Arcoíris', price: 500000, value: 'rainbow' },
  { id: 'border_veteran', type: 'border', name: 'Marco Titanio', price: 0, value: '#94A3B8', isExclusive: true },
  { id: 'border_gold', type: 'border', name: 'Marco Oro', price: 100000, value: '#F59E0B' },
  { id: 'border_diamond', type: 'border', name: 'Marco Diamante', price: 150000, value: '#3B82F6' },
  { id: 'table_green', type: 'table_color', name: 'Tapete Verde Casino', price: 50000, value: '#064e3b' },
  { id: 'table_red', type: 'table_color', name: 'Tapete Rojo Imperial', price: 100000, value: '#7f1d1d' },
  { id: 'table_black', type: 'table_color', name: 'Tapete Negro VIP', price: 250000, value: '#0f172a' },
];

export const CATEGORIES: { type: CosmeticType; label: string; where: string }[] = [
  { type: 'title', label: 'Títulos', where: 'Sale junto a tu nombre en el chat y en tu perfil.' },
  { type: 'color', label: 'Color de nombre', where: 'Pinta tu nombre en el chat y en tu perfil.' },
  { type: 'border', label: 'Marco de foto', where: 'Rodea tu foto en tu perfil y en tus mensajes del chat.' },
  { type: 'table_color', label: 'Tapete de la libreta', where: 'Color de la libreta en las partidas que tú creas.' },
];

export const EXCLUSIVE_NOTE = 'Regalo para los socios veteranos del club. No se vende.';
export const CUSTOM_MAX = 20;

// Monthly VIP gifts: same months, emojis and colors as vip_gift_catalog() in SQL 23
export const GIFT_MONTHS: { name: string; emoji: string; color: string }[] = [
  { name: 'Enero', emoji: '🎆', color: '#F472B6' },
  { name: 'Febrero', emoji: '💘', color: '#E11D48' },
  { name: 'Marzo', emoji: '🌺', color: '#F97316' },
  { name: 'Abril', emoji: '🌧️', color: '#38BDF8' },
  { name: 'Mayo', emoji: '🌻', color: '#FACC15' },
  { name: 'Junio', emoji: '⚽', color: '#22C55E' },
  { name: 'Julio', emoji: '☀️', color: '#14B8A6' },
  { name: 'Agosto', emoji: '🌴', color: '#84CC16' },
  { name: 'Septiembre', emoji: '📚', color: '#6366F1' },
  { name: 'Octubre', emoji: '🎃', color: '#EA580C' },
  { name: 'Noviembre', emoji: '🃏', color: '#A855F7' },
  { name: 'Diciembre', emoji: '🎄', color: '#DC2626' },
];
export const FIRST_GIFT = '2026-11';
export const LAST_GIFT = '2030-12';

/** 'gift_2026_11' (title) or 'giftb_2026_11' (frame) as a store item; null for anything else. */
export const giftItem = (id: string): StoreItem | null => {
  const m = /^gift(b?)_(\d{4})_(\d{2})$/.exec(id);
  if (!m) return null;
  const month = `${m[2]}-${m[3]}`;
  const info = GIFT_MONTHS[Number(m[3]) - 1];
  if (!info || month < FIRST_GIFT || month > LAST_GIFT) return null;
  return m[1]
    ? { id, type: 'border', name: `Marco ${info.name} ${m[2]}`, price: 0, value: info.color, isExclusive: true, giftMonth: month }
    : { id, type: 'title', name: `${info.emoji} VIP ${info.name} ${m[2]}`, price: 0, isExclusive: true, giftMonth: month };
};

/** The gift ids of a club month, e.g. '2026-11'. */
export const giftIdsOf = (month: string) => {
  const key = month.replace('-', '_');
  return { title: `gift_${key}`, border: `giftb_${key}` };
};

/** Gifts in an inventory, newest month first. */
export const ownedGifts = (inventory: string[] | null | undefined): StoreItem[] =>
  (Array.isArray(inventory) ? inventory : [])
    .map(giftItem)
    .filter((i): i is StoreItem => !!i)
    .sort((a, b) => (b.giftMonth || '').localeCompare(a.giftMonth || '') || a.type.localeCompare(b.type));

export const giftNote = (item: StoreItem): string => {
  if (!item.giftMonth) return '';
  const [y, mo] = item.giftMonth.split('-');
  return `Regalo VIP de ${GIFT_MONTHS[Number(mo) - 1].name.toLowerCase()} ${y}. Es tuyo para siempre.`;
};

const GIFT_TITLE = new RegExp(`^\\S+ VIP (${GIFT_MONTHS.map((g) => g.name).join('|')}) \\d{4}$`);
const CATALOG_TITLES = new Set(STORE_ITEMS.filter((i) => i.type === 'title' && !i.isCustom).map((i) => i.name));
const isCatalogTitle = (title: string) => CATALOG_TITLES.has(title) || GIFT_TITLE.test(title);

export const owns = (inventory: string[] | null | undefined, item: StoreItem): boolean =>
  Array.isArray(inventory) && inventory.includes(item.id);

/** The custom title the player is wearing, if the title is not one from the catalog. */
export const customTitle = (equipped: Equipped | null | undefined): string | null => {
  const t = (equipped?.title || '').trim();
  return t && !isCatalogTitle(t) ? t : null;
};

export const isEquipped = (item: StoreItem, equipped: Equipped | null | undefined): boolean => {
  const e = equipped || {};
  if (item.isCustom) return !!customTitle(e);
  if (item.type === 'title') return e.title === item.name;
  return !!item.value && e[item.type] === item.value;
};

/** What to save after tapping "Ponérmelo" / "Quitar" on an owned item. */
export const toggleEquip = (item: StoreItem, equipped: Equipped | null | undefined, custom?: string): Equipped => {
  const next: Equipped = { ...(equipped || {}) };
  if (isEquipped(item, equipped) && !(item.isCustom && custom)) {
    next[item.type] = null;
    return next;
  }
  if (item.isCustom) next.title = (custom || '').trim().slice(0, CUSTOM_MAX) || null;
  else if (item.type === 'title') next.title = item.name;
  else next[item.type] = item.value ?? null;
  return next;
};

/** Owned items first (the ones you can wear), then the ones left to buy. */
export const splitByOwnership = (inventory: string[] | null | undefined) => ({
  owned: [...STORE_ITEMS.filter((i) => owns(inventory, i)), ...ownedGifts(inventory)],
  toBuy: STORE_ITEMS.filter((i) => !owns(inventory, i)),
});
