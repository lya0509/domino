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
for (const f of ['20261101_11_direccion_send_push.sql', '20261101_12_aviso_turno_antes_del_limite.sql', '20261101_13_uno.sql', '20261101_14_poker.sql', '20261102_15_poker_reglas.sql']) {
  await db.exec(cuerpo(f));
}

const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
const partida = async () => (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds,team1_total) VALUES('active','${A}','${B}','${C}','${D}','${A}','[{"points":10,"scorerId":"team1"}]'::jsonb,0) RETURNING id`)).rows[0].id;
const apostar = (u, m, eq, n) => as('authenticated', u, `SELECT public.place_bet('${m}',${eq},${n}) r`);
const resolver = (m, g = 1) => db.query(`SELECT public.resolve_match_bets('${m}', ${g === null ? 'NULL' : g})`);
const apuestas = async (m) => (await db.query(`SELECT status, amount_wagered a, payout p, settled_day d FROM public.bets WHERE match_id='${m}' ORDER BY created_at, id`)).rows;
const queda = async (u) => (await as('authenticated', u, `SELECT public.get_my_bet_profit_left() r`)).rows?.[0]?.r;

// ANTES: sin tope, dos apuestas ganadas pagan toda la ganancia
await db.query(`UPDATE public.profiles SET betting_points=3000 WHERE id='${X}'`);
for (let i = 0; i < 2; i++) {
  const m = await partida();
  await apostar(X, m, 1, 1000);
  await resolver(m);
}
ok('ANTES: dos apuestas de 1.000 a x2 ganan 2.000 en un día', (await puntos(X)) === 5000, String(await puntos(X)));

const mig = sql('supabase/migrations/20261102_16_tope_apuestas.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);
await db.exec(`DELETE FROM public.bets; UPDATE public.profiles SET betting_points=3000;`);

// Primera ganada: cabe entera
let m = await partida();
let r = await apostar(X, m, 1, 400);
ok('se sigue apostando igual', !r.err && Number(r.rows[0].r.multiplier) === 2, JSON.stringify(r));
await resolver(m);
let b = await apuestas(m);
ok('la primera ganada paga entera', b[0].status === 'won' && b[0].p === 800 && (await puntos(X)) === 3400, JSON.stringify([b, await puntos(X)]));
ok('guarda el día del club', b[0].d !== null);
let q = await queda(X);
ok('la app ve cuánto le queda hoy', q.cap === 500 && Number(q.used) === 400 && Number(q.left) === 100, JSON.stringify(q));

// Segunda ganada: solo cabe 100 de ganancia
m = await partida();
await apostar(X, m, 1, 400);
await resolver(m);
b = await apuestas(m);
ok('la segunda solo paga hasta el tope', b[0].p === 500 && (await puntos(X)) === 3500, JSON.stringify([b, await puntos(X)]));

// Tercera ganada: tope lleno, devuelve lo apostado
m = await partida();
await apostar(X, m, 1, 300);
await resolver(m);
b = await apuestas(m);
ok('con el tope lleno devuelve lo apostado', b[0].status === 'won' && b[0].p === 300 && (await puntos(X)) === 3500, JSON.stringify([b, await puntos(X)]));
q = await queda(X);
ok('ya no le queda nada hoy', Number(q.left) === 0 && Number(q.used) === 500, JSON.stringify(q));

// Perder y anular no cambian
m = await partida();
await apostar(X, m, 2, 200);
await resolver(m, 1);
b = await apuestas(m);
ok('una perdida guarda pago 0', b[0].status === 'lost' && b[0].p === 0 && (await puntos(X)) === 3300, JSON.stringify(b));
m = await partida();
await apostar(X, m, 1, 200);
await resolver(m, null);
b = await apuestas(m);
ok('una anulada devuelve todo', b[0].status === 'cancelled' && b[0].p === 200 && (await puntos(X)) === 3300, JSON.stringify(b));

// Otro día: el tope vuelve a empezar
await db.query(`UPDATE public.bets SET settled_day = settled_day - 1`);
ok('al día siguiente vuelve a tener 500', Number((await queda(X)).left) === 500);

// Dos apuestas en la misma partida comparten el tope
m = await partida();
await apostar(X, m, 1, 300);
await apostar(X, m, 1, 300);
await resolver(m);
b = await apuestas(m);
ok('dos apuestas de la misma partida comparten el tope', b[0].p === 600 && b[1].p === 500 && (await puntos(X)) === 3300 - 600 + 600 + 500, JSON.stringify([b, await puntos(X)]));

// El tope es de cada persona
await db.query(`UPDATE public.profiles SET betting_points=1000 WHERE id='${A}'`);
m = await partida();
await apostar(A, m, 1, 400);
await resolver(m);
ok('el tope de uno no afecta a otro', (await apuestas(m))[0].p === 800, JSON.stringify(await apuestas(m)));

// El dueño puede cambiar el tope
await db.exec(`INSERT INTO public.system_config(id) VALUES (1) ON CONFLICT DO NOTHING; UPDATE public.system_config SET max_bet_profit_per_day = 800;`);
q = await queda(X);
ok('cambiar el tope se nota enseguida', q.cap === 800 && Number(q.left) === 300, JSON.stringify(q));

// El historial de puntos cuadra con el saldo
const ultimo = (await db.query(`SELECT balance FROM public.points_ledger WHERE user_id='${X}' ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
ok('el historial cuadra con el saldo', Number(ultimo.balance) === (await puntos(X)), JSON.stringify([ultimo, await puntos(X)]));

// Pagar por el camino normal: confirmar la partida
await db.exec(`UPDATE public.system_config SET max_bet_profit_per_day = 500; UPDATE public.bets SET settled_day = settled_day - 1;`);
m = await partida();
await apostar(X, m, 1, 1000);
const antes = await puntos(X);
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=1, team1_total=100 WHERE id='${m}'`);
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
b = await apuestas(m);
ok('al confirmar una partida el tope también aplica', b[0].status === 'won' && b[0].p === 1500 && (await puntos(X)) === antes + 1500, JSON.stringify([b, antes, await puntos(X)]));

// Permisos
r = await as('authenticated', X, `SELECT public.resolve_match_bets('${m}', 1)`);
ok('nadie puede resolver apuestas desde la app', /permission|permiso/i.test(r.err || ''), JSON.stringify(r));
r = await as('anon', null, `SELECT public.get_my_bet_profit_left()`);
ok('sin sesión no se consulta el tope', !!r.err, JSON.stringify(r));
r = await as('authenticated', X, `UPDATE public.bets SET payout = 99999 WHERE match_id='${m}' RETURNING id`);
ok('la app no puede cambiar el pago guardado', !!r.err || (r.rows || []).length === 0, JSON.stringify(r));

const v = (await db.query(sql('supabase/migrations/20261102_16_tope_apuestas.sql').split('-- VERIFICACIÓN')[1].replace(/^[^\n]*\n(-- =+\n)?/, ''))).rows[0];
ok('la verificación sale en true', v.tope_activo && v.pago_guardado && v.app_ve_lo_que_queda, JSON.stringify(v));

fin();
