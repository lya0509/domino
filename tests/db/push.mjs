import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X, ADM } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

const cuerpo = (f) => sql(`supabase/migrations/${f}`).split('-- VERIFICACIÓN')[0].replace(/-- =+\s*$/, '');
for (const f of ['20261101_01_confirmacion_rival.sql', '20261101_02_seguridad_servidor.sql', '20261101_03_rachas.sql', '20261101_04_puntos.sql', '20261101_06_partidas_abandonadas.sql', '20261101_07_cola_diaria.sql', '20261101_08_confirmacion_todas.sql', '20261101_09_confirmacion_1_minuto.sql']) {
  await db.exec(cuerpo(f));
}
// pg_net can't load here: this stand-in records each wake-up
await db.exec(`CREATE SCHEMA net; CREATE TABLE public.despertares(n serial, url text);
  CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO public.despertares(url) VALUES (url) RETURNING n::bigint $$;`);
const mig = cuerpo('20261101_10_notificaciones_push.sql').replace('CREATE EXTENSION IF NOT EXISTS pg_net;', '');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);
await db.exec(`GRANT SELECT ON public.despertares TO authenticated; GRANT USAGE ON SCHEMA net TO postgres;`);

const suscribir = (u, n = u) => as('authenticated', u, `SELECT public.save_push_subscription('https://push/${n}','k','a')`);
for (const u of [A, B, C, D, X]) await suscribir(u);
const cola = async () => (await db.query(`SELECT * FROM public.notification_queue ORDER BY created_at`)).rows;
const ultimo = async () => (await cola()).at(-1);
const vaciar = () => db.exec(`DELETE FROM public.notification_queue;`);
const partida = async (t = 'active') => (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds,team1_total,players_json) VALUES('${t}','${A}','${B}','${C}','${D}','${A}','[{"points":100,"scorerId":"team1"}]'::jsonb,0,'[{"teamNumber":1,"name":"Ana"},{"teamNumber":1,"name":"Beto"},{"teamNumber":2,"name":"Caro"},{"teamNumber":2,"name":"Dani"}]'::jsonb) RETURNING id`)).rows[0].id;

// Registro
let r = await as('anon', null, `SELECT public.save_push_subscription('https://push/x','k','a')`);
ok('sin sesión no se registra un teléfono', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `SELECT * FROM public.push_subscriptions`);
ok('nadie lee los teléfonos de otros', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `SELECT * FROM public.notification_queue`);
ok('nadie lee la cola de avisos', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `INSERT INTO public.notification_queue(user_ids,title,body) VALUES('{}','x','y')`);
ok('nadie inventa un aviso', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public._notify(ARRAY['${B}']::uuid[],'x','y','z')`);
ok('nadie envía avisos directamente', !!r.err, JSON.stringify(r));
await suscribir(B, 'compartido');
await suscribir(ADM, 'compartido');
const dueno = (await db.query(`SELECT user_id FROM public.push_subscriptions WHERE endpoint='https://push/compartido'`)).rows[0].user_id;
ok('un teléfono es de quien tiene la sesión abierta', dueno === ADM, dueno);
await as('authenticated', B, `SELECT public.remove_push_subscription('https://push/compartido')`);
ok('nadie quita el teléfono de otro', (await db.query(`SELECT count(*)::int n FROM public.push_subscriptions WHERE endpoint='https://push/compartido'`)).rows[0].n === 1);
await as('authenticated', ADM, `SELECT public.remove_push_subscription('https://push/compartido')`);
await vaciar();

// Empezó una partida
let m = await partida();
let n = await ultimo();
ok('empezar una partida avisa al club', n?.title === '🎲 Ya están jugando' && /Ana y Beto contra Caro y Dani/.test(n.body), JSON.stringify(n));
ok('solo a quienes no están en la mesa', JSON.stringify(n.user_ids) === JSON.stringify([X]), JSON.stringify(n.user_ids));
const desp = (await db.query(`SELECT url FROM public.despertares ORDER BY n DESC LIMIT 1`)).rows[0];
ok('y despierta la función de envío', /functions\/v1\/send-push$/.test(desp?.url || ''), JSON.stringify(desp));
await vaciar();

// Apuestas
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);
r = await as('authenticated', X, `SELECT public.place_bet('${m}',1,20)`);
n = await ultimo();
ok('una apuesta avisa con el total y el equipo', n?.title === '💰 Apuestas en la mesa' && /20 puntos apostados por Ana y Beto/.test(n.body), JSON.stringify([r, n]));
ok('menos a quien apostó', !n.user_ids.includes(X) && n.user_ids.includes(A), JSON.stringify(n.user_ids));
await as('authenticated', ADM, `SELECT public.place_bet('${m}',1,30)`);
ok('la segunda apuesta suma el total', /50 puntos/.test((await ultimo()).body), (await ultimo()).body);
await vaciar();

// Confirmación
await db.query(`UPDATE public.matches SET team1_total=100 WHERE id='${m}'`);
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=1 WHERE id='${m}'`);
n = await ultimo();
ok('al terminar se avisa al rival', n?.title === '🏁 Confirma el resultado' && [...n.user_ids].sort().join() === [C, D].sort().join(), JSON.stringify(n));
await vaciar();
await as('authenticated', C, `SELECT public.dispute_match_result('${m}')`);
n = await ultimo();
ok('si discrepa se avisa a quien cerró', n?.title === '🔁 Partida reabierta' && JSON.stringify(n.user_ids) === JSON.stringify([A]), JSON.stringify(n));
await vaciar();

// Cola
const anotar = async (p1, p2, u = p1) => (await as('authenticated', u, `INSERT INTO public.waitlist(creator_id,player1_id,player2_id) VALUES('${u}','${p1}','${p2}') RETURNING id`)).rows[0].id;
await db.exec(`UPDATE public.matches SET status='completed' WHERE status IN ('active','pending_confirmation'); DELETE FROM public.notification_queue;`);
const primero = await anotar(A, B);
ok('quien se anota con la cola vacía no recibe aviso', (await cola()).length === 0, JSON.stringify(await cola()));
const segundo = await anotar(C, D);
ok('el segundo de la cola tampoco', (await cola()).length === 0, JSON.stringify(await cola()));
await as('authenticated', A, `UPDATE public.waitlist SET status='cancelled' WHERE id='${primero}'`);
n = await ultimo();
ok('al quedar de primero llega el aviso', n?.title === '🥇 Quedaste de primero' && [...n.user_ids].sort().join() === [C, D].sort().join(), JSON.stringify(n));
await vaciar();
await anotar(X, ADM);
ok('una sola vez', (await cola()).length === 0, JSON.stringify(await cola()));
const mesa = await partida();
await vaciar();
await as('authenticated', A, `SELECT public.call_waitlist_duo('${segundo}')`);
n = await ultimo();
ok('llamar a un dúo le avisa con quién lo llamó', n?.title === '🚨 ¡A la mesa!' && /^A llamó/.test(n.body) && [...n.user_ids].sort().join() === [C, D].sort().join(), JSON.stringify(n));
await vaciar();
await db.query(`UPDATE public.matches SET team1_total=92 WHERE id='${mesa}'`);
await as('authenticated', A, `SELECT public.notify_near_turn('${mesa}')`);
n = await ultimo();
ok('faltando 10 puntos avisa al primero', n?.title === '⏳ ¡Casi es su turno!' && /92 de 100/.test(n.body), JSON.stringify(n));
await vaciar();

// Torneo
const t = (await db.query(`INSERT INTO public.tournaments(name) VALUES('Copa') RETURNING id`)).rows[0].id;
await db.query(`INSERT INTO public.tournament_participants(tournament_id,user_id,payment_status) VALUES('${t}','${A}','approved'),('${t}','${B}','pending')`);
await db.query(`UPDATE public.tournaments SET status='in_progress' WHERE id='${t}'`);
n = await ultimo();
ok('empezar un torneo avisa a los inscritos aprobados', n?.title === '🏆 Empezó el torneo' && JSON.stringify(n.user_ids) === JSON.stringify([A]), JSON.stringify(n));
await vaciar();

// Nunca bloquea
await db.exec(`DROP FUNCTION net.http_post(text, jsonb, jsonb);`);
const sinRed = await partida();
ok('si la red falla la partida igual se guarda', !!sinRed);
await db.exec(`DELETE FROM public.push_subscriptions;`);
await vaciar();
await partida();
ok('sin teléfonos registrados no se encola nada', (await cola()).length === 0, JSON.stringify(await cola()));

fin();
