import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X, ADM } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

const cuerpo = (f) => sql(`supabase/migrations/${f}`).split('-- VERIFICACIÓN')[0].replace(/-- =+\s*$/, '');
for (const f of ['20261101_01_confirmacion_rival.sql', '20261101_02_seguridad_servidor.sql', '20261101_03_rachas.sql', '20261101_04_puntos.sql', '20261101_06_partidas_abandonadas.sql', '20261101_07_cola_diaria.sql']) {
  await db.exec(cuerpo(f));
}

const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
const crear = async (rondas = `'[{"points":100,"scorerId":"team1"}]'`, cols = '', vals = '') => (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds,team1_total,limit_score${cols}) VALUES('active','${A}','${B}','${C}','${D}','${A}',${rondas}::jsonb,0,100${vals}) RETURNING id`)).rows[0].id;
const partida = async (id) => (await db.query(`SELECT * FROM public.matches WHERE id='${id}'`)).rows[0];
const cerrar = (u, id, g = 1) => as('authenticated', u, `UPDATE public.matches SET status='completed', winner_team=${g === null ? 'NULL' : g}, team1_total=100 WHERE id='${id}' RETURNING status, auto_confirm_at`);
const vencer = (id) => db.query(`UPDATE public.matches SET auto_confirm_at=now()-interval '1 second' WHERE id='${id}'`);
const tarea = () => db.query(`SELECT public.auto_confirm_expired_matches()`);

// ANTES: una partida normal paga sin que nadie confirme
await db.query(`UPDATE public.profiles SET betting_points=1000`);
let m = await crear();
let r = await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=1 WHERE id='${m}' RETURNING status`);
ok('ANTES: una partida normal pagaba +20 sin confirmación', r.rows?.[0]?.status === 'completed' && (await puntos(A)) === 1020, JSON.stringify([r, await puntos(A)]));

const mig = cuerpo('20261101_08_confirmacion_todas.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);
await db.exec(`UPDATE public.profiles SET betting_points=1000; DELETE FROM public.match_prizes;`);

// Partida normal
m = await crear();
r = await cerrar(A, m);
ok('una partida normal pide confirmación', r.rows?.[0]?.status === 'pending_confirmation', JSON.stringify(r));
const seg = (new Date(r.rows[0].auto_confirm_at) - Date.now()) / 1000;
ok('con 2 minutos para responder', seg > 100 && seg <= 120, String(seg));
ok('sin pagar el premio todavía', (await puntos(A)) === 1000, String(await puntos(A)));
await tarea();
ok('antes de tiempo la tarea no la toca', (await partida(m)).status === 'pending_confirmation');
r = await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('el rival confirma antes de tiempo', !r.err && (await partida(m)).status === 'completed', JSON.stringify(r));
ok('y se paga el +20', (await puntos(A)) === 1020 && (await puntos(B)) === 1020, String(await puntos(A)));

m = await crear();
await cerrar(A, m);
await vencer(m);
await tarea();
let p = await partida(m);
ok('si nadie responde se confirma sola', p.status === 'completed' && p.confirmed_by === null && p.confirmed_at !== null, JSON.stringify(p));
ok('y paga el premio', (await puntos(A)) === 1040, String(await puntos(A)));
await tarea();
ok('una sola vez', (await puntos(A)) === 1040, String(await puntos(A)));

m = await crear();
await cerrar(A, m);
r = await as('authenticated', D, `SELECT public.dispute_match_result('${m}')`);
await vencer(m);
await tarea();
p = await partida(m);
ok('si el rival discrepa la cuenta se detiene', !r.err && p.status === 'active' && p.rounds.length === 0, JSON.stringify(p));
r = await as('authenticated', A, `UPDATE public.matches SET rounds='[{"points":100,"scorerId":"team1"}]'::jsonb WHERE id='${m}' RETURNING id`);
r = await cerrar(A, m);
const seg2 = (new Date(r.rows[0].auto_confirm_at) - Date.now()) / 1000;
ok('al volver a cerrar la cuenta empieza de nuevo', seg2 > 100, String(seg2));

// Con algo en juego
await db.exec(`UPDATE public.profiles SET betting_points=1000; DELETE FROM public.match_prizes;`);
m = await crear();
await db.query(`INSERT INTO public.bets(user_id,match_id,bet_on_team,amount_wagered,multiplier) VALUES('${X}','${m}',1,100,2)`);
await db.query(`UPDATE public.profiles SET betting_points=900 WHERE id='${X}'`);
r = await cerrar(A, m);
ok('con apuestas no hay cuenta regresiva', r.rows?.[0]?.status === 'pending_confirmation' && r.rows[0].auto_confirm_at === null, JSON.stringify(r));
await db.query(`UPDATE public.matches SET auto_confirm_at=now()-interval '1 hour' WHERE id='${m}'`);
await tarea();
ok('y nunca se confirma sola', (await partida(m)).status === 'pending_confirmation' && (await puntos(X)) === 900, String(await puntos(X)));

m = await crear(`'[{"points":100,"scorerId":"team1"}]'`, ',is_wager_match,wager_amount', ',true,100');
r = await cerrar(A, m);
ok('un Duelo VIP tampoco', r.rows?.[0]?.auto_confirm_at === null, JSON.stringify(r));
const t = (await db.query(`INSERT INTO public.tournaments(name,status) VALUES('t','in_progress') RETURNING id`)).rows[0].id;
m = await crear(`'[{"points":100,"scorerId":"team1"}]'`, ',tournament_id', `,'${t}'`);
r = await cerrar(A, m);
ok('un torneo tampoco', r.rows?.[0]?.status === 'pending_confirmation' && r.rows[0].auto_confirm_at === null, JSON.stringify(r));

// Lo que no paga nada cierra directo
m = await crear();
r = await cerrar(A, m, null);
ok('una partida anulada cierra directo', r.rows?.[0]?.status === 'completed', JSON.stringify(r));
m = await crear(`'[]'`);
r = await cerrar(A, m);
ok('una partida sin manos cierra directo', r.rows?.[0]?.status === 'completed', JSON.stringify(r));

// Permisos y limpieza nocturna
r = await as('authenticated', A, `SELECT public.auto_confirm_expired_matches()`);
ok('la app no ejecuta la confirmación automática', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `UPDATE public.matches SET auto_confirm_at=now()-interval '1 hour' WHERE status='pending_confirmation' RETURNING id`);
const vencidas = (await db.query(`SELECT count(*)::int n FROM public.matches WHERE status='pending_confirmation' AND auto_confirm_at < now()-interval '30 minutes'`)).rows[0].n;
ok('nadie adelanta la cuenta regresiva desde la app', vencidas === 1, String(vencidas));
m = await crear();
await db.query(`UPDATE public.matches SET created_at=now()-interval '7 hours', team1_total=100 WHERE id='${m}'`);
await db.query(`SELECT public.cancel_abandoned_matches()`);
p = await partida(m);
ok('la limpieza nocturna sigue cerrando sin ganador lo que no tiene nada en juego', p.status === 'completed' && p.winner_team === null, JSON.stringify(p));

// Zapatos con confirmación automática
await db.exec(`UPDATE public.profiles SET achievements='[]'; DELETE FROM public.matches;`);
for (let i = 0; i < 3; i++) {
  m = await crear(`'[{"points":100,"scorerId":"team1"}]'`, ',is_zapato', ',true');
  await cerrar(A, m);
  await vencer(m);
  await tarea();
}
const logros = (await db.query(`SELECT achievements a FROM public.profiles WHERE id='${B}'`)).rows[0].a;
ok('Zapatero Maestro también llega con la confirmación automática', logros.includes('zapatero_maestro'), JSON.stringify(logros));

fin();
