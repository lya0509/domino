import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, X, ADM } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

const cuerpo = (f) => sql(`supabase/migrations/${f}`).split('-- VERIFICACIÓN')[0].replace(/-- =+\s*$/, '');
for (const f of ['20261101_01_confirmacion_rival.sql', '20261101_02_seguridad_servidor.sql', '20261101_03_rachas.sql', '20261101_04_puntos.sql', '20261101_06_partidas_abandonadas.sql', '20261101_07_cola_diaria.sql', '20261101_08_confirmacion_todas.sql', '20261101_09_confirmacion_1_minuto.sql']) {
  await db.exec(cuerpo(f));
}
await db.exec(`CREATE SCHEMA net;
  CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
await db.exec(cuerpo('20261101_10_notificaciones_push.sql').replace('CREATE EXTENSION IF NOT EXISTS pg_net;', ''));
for (const f of ['20261101_11_direccion_send_push.sql', '20261101_12_aviso_turno_antes_del_limite.sql', '20261101_13_uno.sql', '20261101_14_poker.sql', '20261102_15_poker_reglas.sql', '20261102_16_tope_apuestas.sql', '20261102_17_vip.sql']) {
  await db.exec(cuerpo(f));
}
await db.exec(`INSERT INTO public.system_config(id) VALUES (1) ON CONFLICT DO NOTHING;
  INSERT INTO public.push_subscriptions(endpoint, user_id, p256dh, auth) VALUES ('https://push/x', '${X}', 'k', 'a');`);

const uno = async (q) => (await db.query(q)).rows[0];
const socio = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
for (let n = 1; n <= 11; n++) {
  await db.exec(`INSERT INTO public.profiles(id, display_name, initials) VALUES ('${socio(n)}', 'S${n}', 'S${n}')`);
}
const pedir = async (u) => {
  const path = `${u}/${Math.random().toString(36).slice(2)}.jpg`;
  await db.exec(`INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('vip-receipts', '${path}', '${u}')`);
  const r = await as('authenticated', u, `SELECT public.request_vip('REF-1234', '${path}') r`);
  if (r.err) throw new Error(r.err);
  return r.rows[0].r;
};
const aprobar = async (u) => as('authenticated', ADM, `SELECT public.review_vip_request('${await pedir(u)}', true) r`);
const miembro = (u) => uno(`SELECT streak_months, ring_style, founder_number, vip_until FROM public.vip_members WHERE user_id='${u}'`);

// Antes de la migración: A ya era VIP (como la cuenta de prueba de producción)
await aprobar(A);

const mig = cuerpo('20261102_19_vip_extras.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);
let m = await miembro(A);
ok('quien ya era VIP queda con racha 1, borde oro y sin sello', m.streak_months === 1 && m.ring_style === 'oro' && m.founder_number === null, JSON.stringify(m));

// Fundadores: los primeros 10 en su primera aprobación
for (let n = 1; n <= 11; n++) await aprobar(socio(n));
const numeros = (await db.query(`SELECT founder_number FROM public.vip_members WHERE founder_number IS NOT NULL ORDER BY founder_number`)).rows.map((r) => r.founder_number);
ok('hay exactamente 10 fundadores, del 1 al 10', JSON.stringify(numeros) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), JSON.stringify(numeros));
ok('el primero en aprobarse es el #1', (await miembro(socio(1))).founder_number === 1);
ok('el socio 11 ya no es fundador', (await miembro(socio(11))).founder_number === null);
await aprobar(A);
ok('renovar no da el sello a quien no lo tuvo en su primera vez', (await miembro(A)).founder_number === null);
await aprobar(socio(3));
ok('el fundador conserva su número al renovar', (await miembro(socio(3))).founder_number === 3);

// Antigüedad
await aprobar(X);
ok('la primera vez la racha es 1', (await miembro(X)).streak_months === 1);
await aprobar(X);
ok('renovar antes de vencer suma un mes', (await miembro(X)).streak_months === 2);
await db.query(`UPDATE public.vip_members SET vip_until = now() - interval '2 days' WHERE user_id='${X}'`);
await aprobar(X);
ok('renovar dentro de los 3 días de gracia sigue la racha', (await miembro(X)).streak_months === 3);
await db.query(`UPDATE public.vip_members SET vip_until = now() - interval '5 days' WHERE user_id='${X}'`);
await aprobar(X);
m = await miembro(X);
ok('renovar pasada la gracia empieza de nuevo', m.streak_months === 1, JSON.stringify(m));
const d = Number((await uno(`SELECT EXTRACT(EPOCH FROM vip_until - now()) / 86400 d FROM public.vip_members WHERE user_id='${X}'`)).d);
ok('y cuenta 30 días desde hoy', d > 29.9 && d <= 30, String(d));
const aviso = await uno(`SELECT title FROM public.notification_queue WHERE '${X}' = ANY(user_ids) ORDER BY created_at DESC LIMIT 1`);
ok('el aviso de X es el normal (X no es fundador)', aviso.title === '¡Ya eres VIP! ♛', JSON.stringify(aviso));

// Bordes
let r = await as('authenticated', ADM, `SELECT public.set_vip_ring_style('fuego')`);
ok('sin VIP no se elige borde', /VIP activo/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.set_vip_ring_style('plata')`);
ok('un borde que no existe se rechaza', /no existe/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.set_vip_ring_style('diamante')`);
ok('el VIP elige su borde', !r.err && (await miembro(X)).ring_style === 'diamante', JSON.stringify(r));
r = await as('authenticated', X, `UPDATE public.vip_members SET founder_number = 1, streak_months = 99 WHERE user_id='${X}' RETURNING user_id`);
ok('nadie se escribe el sello ni la antigüedad', !!r.err || (r.rows || []).length === 0, JSON.stringify(r));
r = await as('anon', null, `SELECT ring_style, founder_number, streak_months FROM public.vip_members WHERE user_id='${socio(1)}'`);
ok('todos ven el borde, el sello y la antigüedad', r.rows?.[0]?.founder_number === 1 && r.rows[0].ring_style === 'oro', JSON.stringify(r));

// Rechazar sigue igual
const req = await pedir(socio(11));
r = await as('authenticated', ADM, `SELECT public.review_vip_request('${req}', false, 'No aparece') r`);
ok('rechazar sigue funcionando', !r.err && (await uno(`SELECT status FROM public.vip_requests WHERE id='${req}'`)).status === 'rejected', JSON.stringify(r));

const v = (await db.query(sql('supabase/migrations/20261102_19_vip_extras.sql').split('-- VERIFICACIÓN')[1].replace(/^[^\n]*\n(-- =+\n)?/, ''))).rows[0];
ok('la verificación sale en true', v.fundadores && v.antiguedad && v.bordes, JSON.stringify(v));

fin();
