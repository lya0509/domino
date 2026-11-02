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
