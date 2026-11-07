// Migration 23 on a full local copy of production: monthly VIP gift, recap notice, price, Néstor.
import { ayudante, IDS } from './base.mjs';
import { crearCompleta, cuerpo } from './_completa.mjs';

const { A, B, X } = IDS;
const db = await crearCompleta();
const { ok, as, fin } = ayudante(db);

const q1 = async (sql) => (await db.query(sql)).rows[0];
const inv = async (id) => (await q1(`SELECT inventory i FROM public.profiles WHERE id='${id}'`)).i || [];
const eq = async (id) => (await q1(`SELECT equipped_items e FROM public.profiles WHERE id='${id}'`)).e || {};
const mes = (await q1(`SELECT to_char(public._club_month(now()), 'YYYY_MM') m`)).m;

// Catalog
const cat = (await db.query(`SELECT * FROM public.vip_gift_catalog()`)).rows;
ok('100 regalos: título y marco de nov 2026 a dic 2030', cat.length === 100, String(cat.length));
const nov = cat.find((c) => c.id === 'gift_2026_11');
ok('el de noviembre 2026', nov?.name === '🃏 VIP Noviembre 2026' && cat.find((c) => c.id === 'giftb_2026_11')?.value === '#A855F7', JSON.stringify(nov));
ok('no se venden', cat.every((c) => c.is_exclusive && c.price === 0));

// Push subscriptions so notices are queued
for (const u of [A, B, X]) await as('authenticated', u, `SELECT public.save_push_subscription('https://push/${u}','k','a')`);

// A VIP approved now gets this month's gift at once
await db.exec(`INSERT INTO public.vip_members(user_id, vip_until) VALUES ('${A}', now() + interval '30 days')`);
let i = await inv(A);
ok('al hacerse VIP recibe el regalo del mes', i.includes(`gift_${mes}`) && i.includes(`giftb_${mes}`), JSON.stringify(i));
const avisos = (await q1(`SELECT COUNT(*)::int c FROM public.notification_queue WHERE tag='vip-gift' AND '${A}' = ANY(user_ids)`)).c;
ok('y un aviso', avisos === 1, String(avisos));
await db.exec(`UPDATE public.vip_members SET vip_until = vip_until + interval '30 days' WHERE user_id='${A}'`);
ok('renovar el mismo mes no lo repite', (await inv(A)).filter((x) => x === `gift_${mes}`).length === 1 && (await q1(`SELECT COUNT(*)::int c FROM public.notification_queue WHERE tag='vip-gift'`)).c === 1);

// Wearing it
const titulo = cat.find((c) => c.id === `gift_${mes}`).name;
const marco = cat.find((c) => c.id === `giftb_${mes}`).value;
let r = await as('authenticated', A, `UPDATE public.profiles SET equipped_items='${JSON.stringify({ title: titulo, border: marco })}'::jsonb WHERE id='${A}'`);
ok('el VIP se pone el título y el marco del mes', (await eq(A)).title === titulo && (await eq(A)).border === marco, JSON.stringify([r, await eq(A)]));
r = await as('authenticated', X, `UPDATE public.profiles SET equipped_items='${JSON.stringify({ title: titulo })}'::jsonb WHERE id='${X}'`);
ok('quien no lo recibió no se lo pone', (await eq(X)).title !== titulo, JSON.stringify(await eq(X)));
r = await as('authenticated', X, `SELECT public.buy_store_item('gift_${mes}')`);
ok('no se puede comprar', /no está a la venta/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `UPDATE public.profiles SET inventory=ARRAY['gift_${mes}'] WHERE id='${X}'`);
ok('ni regalárselo uno mismo', !(await inv(X)).includes(`gift_${mes}`));

// It stays after the VIP ends
await db.exec(`UPDATE public.vip_members SET vip_until = now() - interval '1 day' WHERE user_id='${A}'`);
ok('al vencer el VIP se queda con el regalo', (await inv(A)).includes(`gift_${mes}`));
r = await as('authenticated', A, `UPDATE public.profiles SET equipped_items='${JSON.stringify({ title: null })}'::jsonb WHERE id='${A}'`);
r = await as('authenticated', A, `UPDATE public.profiles SET equipped_items='${JSON.stringify({ title: titulo })}'::jsonb WHERE id='${A}'`);
ok('y se lo puede volver a poner', (await eq(A)).title === titulo, JSON.stringify(await eq(A)));

// Daily job: gift for every active VIP; the recap notice only at the start of the month, once
await db.exec(`INSERT INTO public.vip_members(user_id, vip_until) VALUES ('${B}', now() + interval '10 days')`);
await db.exec(`UPDATE public.profiles SET inventory='{}' WHERE id='${B}'`);
await db.exec(`SELECT public.vip_monthly(); SELECT public.vip_monthly();`);
ok('la tarea diaria entrega el regalo que falte', (await inv(B)).includes(`gift_${mes}`), JSON.stringify(await inv(B)));
const dia = Number((await q1(`SELECT EXTRACT(DAY FROM now() AT TIME ZONE 'America/Caracas') d`)).d);
const resumen = (await q1(`SELECT COUNT(*)::int c FROM public.notification_queue WHERE tag='vip-recap'`)).c;
ok(dia <= 3 ? 'a comienzo de mes, un solo aviso del resumen' : 'a mitad de mes no hay aviso del resumen', dia <= 3 ? resumen === 1 : resumen === 0, `día ${dia}, avisos ${resumen}`);

// Price and Néstor
await db.exec(`INSERT INTO public.profiles(id, display_name, initials) VALUES ('55555555-5555-5555-5555-555555555555', 'Nestea_D_Durazno', 'ND');
  INSERT INTO public.vip_members(user_id, vip_until) VALUES ('55555555-5555-5555-5555-555555555555', TIMESTAMPTZ '2026-12-02 23:39:21+00');
  INSERT INTO public.system_config(id) VALUES (1) ON CONFLICT DO NOTHING;
  UPDATE public.system_config SET vip_price_text = '5 USD al mes, al cambio BCV del día';`);
const mig = cuerpo('20261107_23_vip_regalos.sql');
await db.exec(mig);
const nestor = async () => (await q1(`SELECT vip_until v FROM public.vip_members WHERE user_id='55555555-5555-5555-5555-555555555555'`)).v;
const una = new Date(await nestor()).toISOString();
await db.exec(mig);
const dos = new Date(await nestor()).toISOString();
ok('Néstor recibe 30 días más', una.startsWith('2027-01-01'), una);
ok('pegar el SQL otra vez no le suma más', una === dos, dos);
ok('el precio baja a 3 USD', (await q1(`SELECT vip_price_text t FROM public.system_config ORDER BY id LIMIT 1`)).t.startsWith('3 USD'));
await db.exec(`UPDATE public.system_config SET vip_price_text = '4 USD, precio especial'`);
await db.exec(mig);
ok('un precio que el dueño escribió a mano no se toca', (await q1(`SELECT vip_price_text t FROM public.system_config ORDER BY id LIMIT 1`)).t === '4 USD, precio especial');

fin();
