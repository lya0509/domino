import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STORE_ITEMS, isEquipped, toggleEquip, splitByOwnership, customTitle } from '../src/lib/storeCatalog.ts';

const item = (id) => STORE_ITEMS.find((i) => i.id === id);

test('the app catalog matches the server catalog (ids, prices, values)', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261001_00_esquema_base.sql', import.meta.url), 'utf8');
  const block = sql.slice(sql.indexOf('FUNCTION public.store_catalog()'), sql.indexOf('AS s(id, type, name, price'));
  const rows = [...block.matchAll(/\('(\w+)',\s*'(\w+)',\s*'([^']+)',\s*(\d+),\s*(NULL|'[^']*')/g)].map((m) => ({
    id: m[1], type: m[2], price: Number(m[4]), value: m[5] === 'NULL' ? undefined : m[5].slice(1, -1),
  }));
  assert.equal(rows.length, STORE_ITEMS.length);
  for (const r of rows) {
    const i = item(r.id);
    assert.ok(i, r.id);
    assert.equal(i.type, r.type, r.id);
    assert.equal(i.price, r.price, r.id);
    assert.equal(i.value, r.value, r.id);
  }
});

test('owned items are split from the ones left to buy', () => {
  const { owned, toBuy } = splitByOwnership(['title_veteran', 'border_veteran']);
  assert.deepEqual(owned.map((i) => i.id), ['title_veteran', 'border_veteran']);
  assert.equal(toBuy.length, STORE_ITEMS.length - 2);
  assert.equal(splitByOwnership(null).owned.length, 0);
});

test('wearing and taking off a title', () => {
  const sup = item('title_veteran');
  let e = toggleEquip(sup, {});
  assert.equal(e.title, '🏅 Superviviente');
  assert.equal(isEquipped(sup, e), true);
  e = toggleEquip(sup, e);
  assert.equal(e.title, null);
});

test('table colors can be worn, swapped and taken off', () => {
  let e = toggleEquip(item('table_green'), { title: 'x' });
  assert.equal(e.table_color, '#064e3b');
  assert.equal(e.title, 'x');
  e = toggleEquip(item('table_red'), e);
  assert.equal(e.table_color, '#7f1d1d');
  assert.equal(isEquipped(item('table_green'), e), false);
  e = toggleEquip(item('table_red'), e);
  assert.equal(e.table_color, null);
});

test('the custom title uses the text, not the item name', () => {
  const c = item('title_custom');
  let e = toggleEquip(c, {}, '  El Rey del Capicúa de la Esquina  ');
  assert.equal(e.title, 'El Rey del Capicúa d');
  assert.equal(customTitle(e), 'El Rey del Capicúa d');
  assert.equal(isEquipped(c, e), true);
  assert.equal(isEquipped(item('title_veteran'), e), false);
  e = toggleEquip(c, e, 'Otro');
  assert.equal(e.title, 'Otro');
  e = toggleEquip(c, e);
  assert.equal(e.title, null);
  assert.equal(customTitle({ title: '🏅 Superviviente' }), null);
});

import { GIFT_MONTHS, giftItem, ownedGifts, giftIdsOf, giftNote } from '../src/lib/storeCatalog.ts';

test('monthly gifts match the server list (months, emojis, colors)', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261107_23_vip_regalos.sql', import.meta.url), 'utf8');
  const arr = (start) => [...sql.slice(sql.indexOf(start)).split(']')[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(arr("(ARRAY['Enero'"), GIFT_MONTHS.map((g) => g.name));
  assert.deepEqual(arr("(ARRAY['🎆'"), GIFT_MONTHS.map((g) => g.emoji));
  assert.deepEqual(arr("(ARRAY['#F472B6'"), GIFT_MONTHS.map((g) => g.color));
});

test('a gift id becomes a title or a frame of its month; outside the range it is nothing', () => {
  assert.equal(giftItem('gift_2026_11').name, '🃏 VIP Noviembre 2026');
  assert.equal(giftItem('giftb_2026_12').value, '#DC2626');
  assert.equal(giftItem('gift_2026_10'), null);
  assert.equal(giftItem('title_rey'), null);
  assert.deepEqual(giftIdsOf('2027-01'), { title: 'gift_2027_01', border: 'giftb_2027_01' });
  assert.equal(giftNote(giftItem('gift_2026_11')), 'Regalo VIP de noviembre 2026. Es tuyo para siempre.');
});

test('owned gifts show in "Lo que tienes", newest first, and can be worn', () => {
  const inv = ['title_rey', 'gift_2026_11', 'giftb_2026_11', 'gift_2026_12'];
  assert.deepEqual(ownedGifts(inv).map((i) => i.id), ['gift_2026_12', 'giftb_2026_11', 'gift_2026_11']);
  assert.equal(splitByOwnership(inv).owned.length, 4);
  const g = giftItem('gift_2026_11');
  const e = toggleEquip(g, {});
  assert.equal(e.title, '🃏 VIP Noviembre 2026');
  assert.equal(isEquipped(g, e), true);
  // A gift title is not mistaken for a custom one
  assert.equal(customTitle(e), null);
  assert.equal(isEquipped(item('title_custom'), e), false);
});
