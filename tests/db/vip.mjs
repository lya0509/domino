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
for (const f of ['20261101_11_direccion_send_push.sql', '20261101_12_aviso_turno_antes_del_limite.sql', '20261101_13_uno.sql', '20261101_14_poker.sql', '20261102_15_poker_reglas.sql', '20261102_16_tope_apuestas.sql']) {
  await db.exec(cuerpo(f));
}
await db.exec(`INSERT INTO public.system_config(id) VALUES (1) ON CONFLICT DO NOTHING;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT ALL ON storage.objects TO authenticated;
  INSERT INTO public.push_subscriptions(endpoint, user_id, p256dh, auth) VALUES
    ('https://push/adm', '${ADM}', 'k', 'a'), ('https://push/x', '${X}', 'k', 'a'), ('https://push/a', '${A}', 'k', 'a');`);

const mig = cuerpo('20261102_17_vip.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);

const uno = async (q) => (await db.query(q)).rows[0];
const subir = (u, bucket, name) => as('authenticated', u, `INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('${bucket}', '${name}', '${u}') RETURNING name`);
const avisos = async (titulo) => (await uno(`SELECT count(*)::int c FROM public.notification_queue WHERE title = '${titulo}'`)).c;
const dias = async (u) => Number((await uno(`SELECT EXTRACT(EPOCH FROM vip_until - now()) / 86400 d FROM public.vip_members WHERE user_id='${u}'`)).d);

// Comprobantes: cada quien en su carpeta
let r = await subir(X, 'vip-receipts', `${X}/pago1.jpg`);
ok('el socio sube su comprobante', !r.err, JSON.stringify(r));
r = await subir(X, 'vip-receipts', `${A}/falso.jpg`);
ok('nadie sube en la carpeta de otro', !!r.err, JSON.stringify(r));
ok('los comprobantes son privados', (await uno(`SELECT public FROM storage.buckets WHERE id='vip-receipts'`)).public === false);

// Pedir
r = await as('authenticated', X, `SELECT public.request_vip('12', '${X}/pago1.jpg') r`);
ok('la referencia debe tener al menos 4 caracteres', /referencia/.test(r.err || ''), JSON.stringify(r));
await db.exec(`INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('vip-receipts', '${A}/de-a.jpg', '${A}')`);
r = await as('authenticated', X, `SELECT public.request_vip('123456', '${A}/de-a.jpg') r`);
ok('no se usa el comprobante de otro', /comprobante/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.request_vip('123456', '${X}/no-existe.jpg') r`);
ok('el comprobante tiene que estar subido', /comprobante/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.request_vip('  0102-998877  ', '${X}/pago1.jpg') r`);
ok('se pide el VIP', !r.err && r.rows[0].r, JSON.stringify(r));
const req1 = r.rows[0].r;
ok('queda en revisión con la referencia limpia', (await uno(`SELECT status, reference FROM public.vip_requests WHERE id='${req1}'`)).reference === '0102-998877');
ok('a los administradores les llega el aviso', (await avisos('Nueva solicitud VIP')) === 1);
r = await as('authenticated', X, `SELECT public.request_vip('999999', '${X}/pago1.jpg') r`);
ok('una sola solicitud en revisión a la vez', /en revisión/.test(r.err || ''), JSON.stringify(r));

// Nadie se pone VIP solo
r = await as('authenticated', X, `INSERT INTO public.vip_members(user_id, vip_until) VALUES ('${X}', now() + interval '1 year')`);
ok('nadie se escribe VIP a sí mismo', !!r.err, JSON.stringify(r));
r = await as('authenticated', X, `INSERT INTO public.vip_requests(user_id, reference, receipt_path, status) VALUES ('${X}', 'xxxx', 'x', 'approved')`);
ok('nadie inserta solicitudes aprobadas', !!r.err, JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.review_vip_request('${req1}', true) r`);
ok('el socio no aprueba su propia solicitud', /administrador/.test(r.err || ''), JSON.stringify(r));

// Quién ve qué
r = await as('authenticated', X, `SELECT id FROM public.vip_requests`);
ok('el socio ve su solicitud', r.rows?.length === 1, JSON.stringify(r));
r = await as('authenticated', A, `SELECT id FROM public.vip_requests`);
ok('otro socio no la ve', r.rows?.length === 0, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT id FROM public.vip_requests`);
ok('el administrador la ve', r.rows?.length === 1, JSON.stringify(r));
r = await as('authenticated', A, `SELECT name FROM storage.objects WHERE bucket_id='vip-receipts' AND name='${X}/pago1.jpg'`);
ok('otro socio no ve el comprobante', r.rows?.length === 0, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT name FROM storage.objects WHERE bucket_id='vip-receipts' AND name='${X}/pago1.jpg'`);
ok('el administrador ve el comprobante', r.rows?.length === 1, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT * FROM public.list_vip_requests('pending')`);
ok('el panel lista la solicitud con el nombre', r.rows?.[0]?.display_name === 'X' && r.rows[0].reference === '0102-998877', JSON.stringify(r));
r = await as('authenticated', A, `SELECT * FROM public.list_vip_requests('pending')`);
ok('un socio no abre el panel', /administrador/.test(r.err || ''), JSON.stringify(r));

// Aprobar
r = await as('authenticated', ADM, `SELECT public.review_vip_request('${req1}', true) r`);
ok('el administrador aprueba', !r.err, JSON.stringify(r));
let d = await dias(X);
ok('queda VIP 30 días', d > 29.9 && d <= 30, String(d));
ok('le llega el aviso de que ya es VIP', (await avisos('¡Ya eres VIP! ♛')) === 1);
r = await as('authenticated', ADM, `SELECT public.review_vip_request('${req1}', false) r`);
ok('una solicitud se revisa una sola vez', /ya fue revisada/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.get_my_vip() r`);
ok('el socio ve su VIP activo', r.rows?.[0]?.r?.active === true && r.rows[0].r.request.status === 'approved', JSON.stringify(r));
r = await as('anon', null, `SELECT user_id, vip_until FROM public.vip_members`);
ok('todos ven quién es VIP', r.rows?.length === 1, JSON.stringify(r));

// Renovar suma sobre lo que le queda
await subir(X, 'vip-receipts', `${X}/pago2.jpg`);
r = await as('authenticated', X, `SELECT public.request_vip('777777', '${X}/pago2.jpg') r`);
await as('authenticated', ADM, `SELECT public.review_vip_request('${r.rows[0].r}', true)`);
d = await dias(X);
ok('renovar antes de vencer suma 30 días más', d > 59.9 && d <= 60, String(d));

// Rechazar
await subir(A, 'vip-receipts', `${A}/pago.jpg`);
r = await as('authenticated', A, `SELECT public.request_vip('555555', '${A}/pago.jpg') r`);
const reqA = r.rows[0].r;
r = await as('authenticated', ADM, `SELECT public.review_vip_request('${reqA}', false, 'La referencia no aparece') r`);
const rechazada = await uno(`SELECT status, reason FROM public.vip_requests WHERE id='${reqA}'`);
ok('rechazar guarda el motivo', rechazada.status === 'rejected' && rechazada.reason === 'La referencia no aparece', JSON.stringify(rechazada));
ok('el rechazado no queda VIP', (await uno(`SELECT count(*)::int c FROM public.vip_members WHERE user_id='${A}'`)).c === 0);
ok('al rechazado le llega el aviso', (await avisos('Solicitud VIP rechazada')) === 1);

// Tarjeta: foto o GIF con aprobación
r = await as('authenticated', A, `SELECT public.set_vip_media('${A}/x.gif')`);
ok('sin VIP no se personaliza la tarjeta', /VIP activo/.test(r.err || ''), JSON.stringify(r));
r = await subir(X, 'vip-media', `${X}/tarjeta.gif`);
ok('el VIP sube su GIF', !r.err, JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.set_vip_media('${X}/tarjeta.gif')`);
ok('el GIF queda por aprobar', !r.err, JSON.stringify(r));
ok('a los administradores les llega el aviso de la foto', (await avisos('Foto VIP por aprobar')) === 1);
r = await as('authenticated', A, `SELECT pending_media_path FROM public.vip_members`);
ok('nadie ve la foto por aprobar', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `SELECT media_path FROM public.vip_members WHERE user_id='${X}'`);
ok('la tarjeta aún no muestra el GIF', r.rows?.[0]?.media_path === null, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT * FROM public.list_vip_media_pending()`);
ok('el panel muestra la foto por aprobar', r.rows?.[0]?.pending_media_path === `${X}/tarjeta.gif`, JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.review_vip_media('${X}', true)`);
ok('el VIP no aprueba su propia foto', /administrador/.test(r.err || ''), JSON.stringify(r));
await as('authenticated', ADM, `SELECT public.review_vip_media('${X}', true)`);
r = await as('authenticated', A, `SELECT media_path FROM public.vip_members WHERE user_id='${X}'`);
ok('aprobada, todos ven el GIF', r.rows?.[0]?.media_path === `${X}/tarjeta.gif`, JSON.stringify(r));

r = await as('authenticated', X, `SELECT public.set_vip_tagline('${'a'.repeat(61)}')`);
ok('la frase tiene un máximo de 60', /60/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.set_vip_tagline('  El rey del capicúa  ')`);
ok('el VIP pone su frase', !r.err && (await uno(`SELECT tagline FROM public.vip_members WHERE user_id='${X}'`)).tagline === 'El rey del capicúa', JSON.stringify(r));

// Ajustes
r = await as('authenticated', A, `SELECT public.set_vip_settings('gratis', '')`);
ok('un socio no cambia el precio', /administrador/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT public.set_vip_settings('6 USD al mes, al cambio BCV del día', 'Pago móvil 0102 0414-0000000 V-1')`);
const cfg = await uno(`SELECT vip_price_text, vip_payment_info FROM public.system_config`);
ok('el administrador cambia precio y datos de pago', !r.err && cfg.vip_price_text.startsWith('6 USD') && cfg.vip_payment_info.startsWith('Pago móvil'), JSON.stringify([r, cfg]));

// Vencimiento
await db.query(`UPDATE public.vip_members SET vip_until = now() + interval '2 days' WHERE user_id='${X}'`);
await db.query(`SELECT public.expire_vips()`);
await db.query(`SELECT public.expire_vips()`);
ok('3 días antes llega un solo aviso', (await avisos('Tu VIP vence pronto')) === 1);
await db.query(`UPDATE public.vip_members SET vip_until = now() - interval '1 hour' WHERE user_id='${X}'`);
await db.query(`SELECT public.expire_vips()`);
await db.query(`SELECT public.expire_vips()`);
ok('al vencer llega un solo aviso', (await avisos('Tu VIP venció')) === 1);
r = await as('authenticated', X, `SELECT public.get_my_vip() r`);
ok('vencido ya no está activo', r.rows?.[0]?.r?.active === false, JSON.stringify(r));
ok('durante la gracia conserva su tarjeta', (await uno(`SELECT media_path FROM public.vip_members WHERE user_id='${X}'`)).media_path !== null);
r = await as('authenticated', X, `SELECT public.set_vip_tagline('otra')`);
ok('vencido no puede cambiar la tarjeta', /VIP activo/.test(r.err || ''), JSON.stringify(r));
await db.query(`UPDATE public.vip_members SET vip_until = now() - interval '3 days 1 hour' WHERE user_id='${X}'`);
await db.query(`SELECT public.expire_vips()`);
const borrada = await uno(`SELECT media_path, pending_media_path, tagline FROM public.vip_members WHERE user_id='${X}'`);
ok('pasada la gracia se borra su tarjeta', borrada.media_path === null && borrada.tagline === null, JSON.stringify(borrada));

// Renovar después de vencer cuenta desde hoy
await subir(X, 'vip-receipts', `${X}/pago3.jpg`);
r = await as('authenticated', X, `SELECT public.request_vip('888888', '${X}/pago3.jpg') r`);
await as('authenticated', ADM, `SELECT public.review_vip_request('${r.rows[0].r}', true)`);
d = await dias(X);
ok('renovar ya vencido cuenta 30 días desde hoy', d > 29.9 && d <= 30, String(d));

// Permisos de las funciones internas
r = await as('authenticated', X, `SELECT public.expire_vips()`);
ok('nadie corre el vencimiento desde la app', /permission|permiso/i.test(r.err || ''), JSON.stringify(r));

const v = await uno(`SELECT
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'vip-receipts' AND public = false) AS a,
  has_function_privilege('authenticated', 'public.request_vip(text, text)', 'EXECUTE') AS b,
  NOT has_table_privilege('authenticated', 'public.vip_members', 'INSERT') AS c`);
ok('la verificación sale en true (sin pg_cron en la prueba)', v.a && v.b && v.c, JSON.stringify(v));

fin();
