import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X } = IDS;
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

// Como en producción: el reinicio dejó el historial vacío
await db.exec(`TRUNCATE public.points_ledger; UPDATE public.profiles SET betting_points = 1000;`);
const sinHistorial = async () => (await db.query(`SELECT count(*)::int c FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM public.points_ledger l WHERE l.user_id = p.id)`)).rows[0].c;
ok('ANTES: hay cuentas sin historial', (await sinHistorial()) > 0);

const mig = cuerpo('20261102_18_salud_base.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);
ok('cada cuenta tiene historial', (await sinHistorial()) === 0);
ok('un solo movimiento por cuenta aunque se repita', (await db.query(`SELECT count(*)::int c FROM public.points_ledger WHERE reason = 'Reinicio del club' AND user_id = '${X}'`)).rows[0].c === 1);

const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
let r = await as('authenticated', X, `UPDATE public.profiles SET betting_points = 99999 WHERE id = '${X}'`);
ok('nadie se sube los puntos editando su perfil', (await puntos(X)) === 1000, JSON.stringify([r, await puntos(X)]));
r = await as('anon', null, `SELECT public.protect_profile_sensitive_fields()`);
ok('sin sesión no se llama la función de disparador', !!r.err, JSON.stringify(r));

// Las apuestas y el pago al confirmar siguen funcionando
const m = (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds,team1_total) VALUES('active','${A}','${B}','${C}','${D}','${A}','[{"points":10,"scorerId":"team1"}]'::jsonb,0) RETURNING id`)).rows[0].id;
r = await as('authenticated', X, `SELECT public.place_bet('${m}', 1, 100) r`);
ok('se sigue apostando', !r.err && (await puntos(X)) === 900, JSON.stringify(r));
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=1, team1_total=100 WHERE id='${m}'`);
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('al confirmar se paga la apuesta', (await puntos(X)) === 1100, String(await puntos(X)));
const ultimo = (await db.query(`SELECT balance FROM public.points_ledger WHERE user_id='${X}' ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
ok('el historial cuadra con el saldo', Number(ultimo.balance) === (await puntos(X)), JSON.stringify(ultimo));
const dia = (await db.query(`SELECT public._club_day(now()) d`)).rows[0].d;
ok('las funciones con ruta fija siguen andando', !!dia);

fin();
