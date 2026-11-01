import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X, ADM } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
const nuevaPartida = async (creador = A, extra = '', valores = '') => (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by${extra}) VALUES('active','${A}','${B}','${C}','${D}','${creador}'${valores}) RETURNING id`)).rows[0].id;

// ANTES: reproduce cada hueco con el servidor de hoy
let m = await nuevaPartida(X);
let r = await as('authenticated', X, `SELECT public.place_bet('${m}',1,100)`);
ok('ANTES: quien anota sin jugar sí apuesta', !r.err, JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.claim_achievement('win_100')`);
ok('ANTES: un logro sin cumplir sí paga', !r.err, JSON.stringify(r));
const entradaVieja = (await db.query(`INSERT INTO public.waitlist(creator_id,player1_id,player2_id) VALUES('${A}','${A}','${B}') RETURNING id`)).rows[0].id;
r = await as('authenticated', X, `UPDATE public.waitlist SET status='cancelled' WHERE id='${entradaVieja}' RETURNING id`);
ok('ANTES: cualquiera saca a otro de la cola', r.rows?.length === 1, JSON.stringify(r));
await db.query(`DELETE FROM public.waitlist`);
await db.exec(`UPDATE public.profiles SET betting_points=1000, achievements='[]'; DELETE FROM public.bets;`);

const m1 = sql('supabase/migrations/20261101_01_confirmacion_rival.sql');
const m2 = sql('supabase/migrations/20261101_02_seguridad_servidor.sql');
await db.exec(m1);
await db.exec(m2);
await db.exec(m2);
ok('la migración se puede repetir', true);
await db.query(`UPDATE public.profiles SET betting_points=1000`);

// 1. Quien anota no apuesta
m = await nuevaPartida(X);
r = await as('authenticated', X, `SELECT public.place_bet('${m}',1,100)`);
ok('quien anota sin jugar no apuesta', /anota/.test(r.err || ''), JSON.stringify(r));
ok('y conserva sus puntos', (await puntos(X)) === 1000);
r = await as('authenticated', A, `SELECT public.place_bet('${m}',1,100)`);
ok('un jugador sí apuesta por su equipo', !r.err, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT public.place_bet('${m}',2,100)`);
ok('un espectador sí apuesta', !r.err, JSON.stringify(r));
await db.query(`UPDATE public.profiles SET betting_points=1000`);

// 2. Datos de cobro
const t = (await db.query(`INSERT INTO public.tournaments(name) VALUES('t') RETURNING id`)).rows[0].id;
const part = (await db.query(`INSERT INTO public.tournament_participants(tournament_id,user_id) VALUES('${t}','${B}') RETURNING id`)).rows[0].id;
const datos = JSON.stringify({ bank: 'Banco', id: 'V-1', phone: '0414' });
r = await as('authenticated', B, `UPDATE public.tournament_participants SET payout_details='${datos}' WHERE id='${part}' RETURNING payout_details`);
ok('el dueño envía sus datos de cobro', JSON.parse(r.rows?.[0]?.payout_details || '{}').paid === false, JSON.stringify(r));
r = await as('authenticated', X, `SELECT payout_details FROM public.tournament_participants WHERE id='${part}'`);
ok('otro usuario no ve banco, cédula ni teléfono', r.rows?.[0]?.payout_details && !/V-1|0414|Banco/.test(r.rows[0].payout_details), JSON.stringify(r));
r = await as('authenticated', X, `SELECT * FROM public.tournament_payouts`);
ok('otro usuario no lee la tabla privada', r.rows?.length === 0, JSON.stringify(r));
r = await as('anon', null, `SELECT * FROM public.tournament_payouts`);
ok('sin sesión tampoco', !!r.err, JSON.stringify(r));
r = await as('authenticated', B, `SELECT details FROM public.tournament_payouts`);
ok('el dueño ve lo suyo', r.rows?.[0]?.details?.bank === 'Banco', JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT details FROM public.tournament_payouts`);
ok('un admin ve los datos', r.rows?.[0]?.details?.phone === '0414', JSON.stringify(r));
r = await as('authenticated', X, `INSERT INTO public.tournament_payouts(participant_id,user_id,details) VALUES('${part}','${X}','{}')`);
ok('nadie escribe directo en la tabla privada', !!r.err, JSON.stringify(r));
r = await as('authenticated', B, `UPDATE public.tournament_participants SET payout_details='${JSON.stringify({ paid: true })}' WHERE id='${part}' RETURNING payout_details`);
ok('el dueño no se marca como pagado', JSON.parse(r.rows?.[0]?.payout_details || '{}').paid === false, JSON.stringify(r));
const pagado = JSON.stringify({ bank: 'Banco', id: 'V-1', phone: '0414', paid: true });
r = await as('authenticated', ADM, `UPDATE public.tournament_participants SET payout_details='${pagado}' WHERE id='${part}' RETURNING payout_details`);
ok('un admin marca pagado', JSON.parse(r.rows?.[0]?.payout_details || '{}').paid === true, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT details FROM public.tournament_payouts`);
ok('y los datos siguen ahí', r.rows?.[0]?.details?.bank === 'Banco', JSON.stringify(r));
r = await as('authenticated', C, `INSERT INTO public.tournament_participants(tournament_id,user_id,payout_details) VALUES('${t}','${C}','${datos}') RETURNING payout_details`);
const filaNueva = r.rows?.[0]?.payout_details;
ok('al inscribirse con datos tampoco quedan públicos', !!filaNueva && !/V-1/.test(filaNueva), JSON.stringify(r));

// 3. Cola
r = await as('authenticated', A, `INSERT INTO public.waitlist(creator_id,player1_id,player2_id) VALUES('${A}','${A}','${B}') RETURNING id, created_at`);
const e = r.rows?.[0]?.id;
ok('cada quien se anota', !!e, JSON.stringify(r));
r = await as('authenticated', X, `INSERT INTO public.waitlist(creator_id,player1_id,player2_id) VALUES('${A}','${C}','${D}') RETURNING id`);
ok('nadie anota a otros', !!r.err, JSON.stringify(r));
r = await as('authenticated', X, `UPDATE public.waitlist SET status='cancelled' WHERE id='${e}' RETURNING id`);
ok('nadie saca a otro de la cola', r.rows?.length === 0, JSON.stringify(r));
r = await as('authenticated', X, `DELETE FROM public.waitlist WHERE id='${e}' RETURNING id`);
ok('nadie borra entradas ajenas', r.rows?.length === 0, JSON.stringify(r));
r = await as('authenticated', B, `UPDATE public.waitlist SET created_at='2020-01-01' WHERE id='${e}' RETURNING created_at`);
ok('nadie se adelanta en la cola', r.rows?.length === 1 && new Date(r.rows[0].created_at).getFullYear() > 2020, JSON.stringify(r));
r = await as('authenticated', B, `UPDATE public.waitlist SET called_at=now() WHERE id='${e}' RETURNING called_at`);
ok('nadie falsifica un llamado', r.rows?.[0]?.called_at === null, JSON.stringify(r));
r = await as('authenticated', B, `UPDATE public.waitlist SET status='cancelled' WHERE id='${e}' RETURNING id`);
ok('el compañero sí puede salir', r.rows?.length === 1, JSON.stringify(r));
await db.query(`UPDATE public.waitlist SET status='waiting' WHERE id='${e}'`);
r = await as('authenticated', ADM, `UPDATE public.waitlist SET status='cancelled' WHERE id='${e}' RETURNING id`);
ok('un admin toca cualquier entrada', r.rows?.length === 1, JSON.stringify(r));
await db.query(`UPDATE public.waitlist SET status='waiting' WHERE id='${e}'`);

// Sentar a un dúo que no es tuyo
const mesa = (await db.query(`INSERT INTO public.matches(status,team1_player1,team2_player1,team2_player2,created_by) VALUES('active','${X}','${A}','${B}','${X}') RETURNING id`)).rows[0].id;
r = await as('authenticated', C, `SELECT public.seat_waitlist_entry('${e}','${mesa}')`);
ok('un extraño no sienta a un dúo', /No puedes/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.seat_waitlist_entry('${e}','${mesa}')`);
ok('quien creó la mesa donde juega ese dúo sí lo sienta', !r.err, JSON.stringify(r));
await db.exec(`UPDATE public.matches SET status='completed' WHERE id='${mesa}'; UPDATE public.waitlist SET status='waiting' WHERE id='${e}';`);

// 4. Avisos de mesa
await db.exec(`UPDATE public.matches SET status='completed' WHERE status='active';`);
r = await as('authenticated', X, `SELECT public.call_waitlist_duo('${e}')`);
ok('quien no está en una mesa no llama a nadie', /mesa/.test(r.err || ''), JSON.stringify(r));
r = await as('anon', null, `SELECT public.call_waitlist_duo('${e}')`);
ok('sin sesión tampoco', !!r.err, JSON.stringify(r));
m = await nuevaPartida(C, ',limit_score,team1_total', ',100,92');
r = await as('authenticated', D, `SELECT public.call_waitlist_duo('${e}')`);
const fila = async () => (await db.query(`SELECT * FROM public.waitlist WHERE id='${e}'`)).rows[0];
ok('alguien de la mesa llama al dúo', !r.err && !!(await fila()).called_at, JSON.stringify(r));
ok('con el nombre que dice el servidor', (await fila()).called_by_name === 'D', (await fila()).called_by_name);
r = await as('authenticated', X, `SELECT public.notify_near_turn('${m}')`);
ok('un extraño no envía el aviso de la mesa', /mesa/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', D, `SELECT public.notify_near_turn('${m}')`);
const aviso = await fila();
ok('la mesa avisa al primero de la cola con el marcador real', !r.err && aviso.near_turn_score === 92 && aviso.near_turn_limit === 100, JSON.stringify([r, aviso]));
const lejos = await nuevaPartida(C, ',limit_score,team1_total', ',100,10');
await db.query(`UPDATE public.waitlist SET near_turn_at=NULL`);
r = await as('authenticated', D, `SELECT public.notify_near_turn('${lejos}')`);
ok('lejos del final no se avisa y la app sabe que debe reintentar', !r.err && r.rows?.[0]?.notify_near_turn === false && (await fila()).near_turn_at === null, JSON.stringify(r));

// 5. Duelo VIP
const duelo = async (monto = 200) => {
  const id = await nuevaPartida(A, ',rounds', `,'[]'::jsonb`);
  const propuesta = await as('authenticated', A, `SELECT public.propose_wager('${id}',${monto})`);
  if (propuesta.err) throw new Error(propuesta.err);
  return id;
};
const responder = (u, id, si = true) => as('authenticated', u, `SELECT public.respond_wager('${id}',${si}) r`);
const saldos = async () => [await puntos(A), await puntos(B), await puntos(C), await puntos(D)];
await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await duelo();
await responder(A, m); await responder(B, m); await responder(C, m);
ok('con 3 respuestas no se aparta nada', JSON.stringify(await saldos()) === '[1000,1000,1000,1000]', JSON.stringify(await saldos()));
r = await responder(D, m);
ok('al aceptar los 4 se activa', r.rows?.[0]?.r?.status === 'active', JSON.stringify(r));
ok('y se apartan los puntos de los 4', JSON.stringify(await saldos()) === '[800,800,800,800]', JSON.stringify(await saldos()));
await db.query(`UPDATE public.matches SET team1_total=100 WHERE id='${m}'`);
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=1 WHERE id='${m}'`);
ok('por confirmar siguen apartados', JSON.stringify(await saldos()) === '[800,800,800,800]', JSON.stringify(await saldos()));
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('al confirmar el pozo va a los ganadores', JSON.stringify(await saldos()) === '[1200,1200,800,800]', JSON.stringify(await saldos()));
const total = (await saldos()).reduce((a, b) => a + b, 0);
ok('el Duelo es suma cero', total === 4000, String(total));

await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await duelo();
for (const u of [A, B, C, D]) await responder(u, m);
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=NULL WHERE id='${m}'`);
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('si se anula vuelve lo apartado', JSON.stringify(await saldos()) === '[1000,1000,1000,1000]', JSON.stringify(await saldos()));

await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await duelo();
for (const u of [A, B, C, D]) await responder(u, m);
await db.query(`DELETE FROM public.matches WHERE id='${m}'`);
ok('si se borra la partida vuelve lo apartado', JSON.stringify(await saldos()) === '[1000,1000,1000,1000]', JSON.stringify(await saldos()));

await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await duelo();
for (const u of [A, B, C, D]) await responder(u, m);
await db.query(`UPDATE public.matches SET created_at=now()-interval '3 days' WHERE id='${m}'`);
await db.query(`SELECT public.cancel_abandoned_matches()`);
ok('una partida abandonada devuelve lo apartado', JSON.stringify(await saldos()) === '[1000,1000,1000,1000]', JSON.stringify(await saldos()));
ok('y queda cancelada', (await db.query(`SELECT status FROM public.matches WHERE id='${m}'`)).rows[0].status === 'cancelled');
await db.query(`SELECT public.cancel_abandoned_matches()`);
ok('no devuelve dos veces', JSON.stringify(await saldos()) === '[1000,1000,1000,1000]', JSON.stringify(await saldos()));
r = await as('authenticated', A, `SELECT public.cancel_abandoned_matches()`);
ok('la app no ejecuta la limpieza', !!r.err, JSON.stringify(r));

await db.query(`UPDATE public.profiles SET betting_points=150 WHERE id='${D}'`);
await db.query(`UPDATE public.profiles SET betting_points=1000 WHERE id<>'${D}'`);
await db.exec(`UPDATE public.wager_consents SET status='cancelled'`);
m = await nuevaPartida(A, ',rounds', `,'[]'::jsonb`);
r = await as('authenticated', A, `SELECT public.propose_wager('${m}',100)`);
await responder(A, m); await responder(B, m); await responder(C, m);
await db.query(`UPDATE public.profiles SET betting_points=50 WHERE id='${D}'`);
r = await responder(D, m);
ok('sin saldo al final no se aparta nada', r.rows?.[0]?.r?.status === 'insufficient' && (await puntos(A)) === 1000, JSON.stringify(r));

// Limpieza nocturna: la tarea que había en producción pagaba por el marcador
await db.exec(`DELETE FROM public.bets; UPDATE public.profiles SET betting_points=1000;`);
const zombieViejo = async (id) => db.query(`UPDATE public.matches SET status='completed', winner_team=NULL WHERE id='${id}'`);
const conApuesta = async (total) => {
  const id = await nuevaPartida(A);
  await db.query(`INSERT INTO public.bets(user_id,match_id,bet_on_team,amount_wagered,multiplier) VALUES('${X}','${id}',1,100,2)`);
  await db.query(`UPDATE public.matches SET team1_total=${total}, limit_score=100, created_at=now()-interval '7 hours', rounds='[{"points":100,"scorerId":"team1"}]'::jsonb WHERE id='${id}'`);
  return id;
};
await db.query(`UPDATE public.profiles SET betting_points=900 WHERE id='${X}'`);
m = await conApuesta(100);
await zombieViejo(m);
ok('ANTES: la limpieza vieja pagaba sin confirmación del rival', (await puntos(X)) === 1100, String(await puntos(X)));

await db.exec(`DELETE FROM public.bets; UPDATE public.matches SET status='completed' WHERE status='active'; UPDATE public.profiles SET betting_points=1000;`);
const m6 = sql('supabase/migrations/20261101_06_partidas_abandonadas.sql').split('-- VERIFICACIÓN')[0].replace(/-- =+\s*$/, '').replace(/DO \$\$[\s\S]*?END \$\$;/, '');
await db.exec(m6);
await db.exec(m6);
const estado = async (id) => (await db.query(`SELECT status, winner_team FROM public.matches WHERE id='${id}'`)).rows[0];

await db.query(`UPDATE public.profiles SET betting_points=900 WHERE id='${X}'`);
m = await conApuesta(100);
await db.query(`SELECT public.cancel_abandoned_matches()`);
ok('llegó al límite y tiene apuestas: queda por confirmar', (await estado(m)).status === 'pending_confirmation' && (await estado(m)).winner_team === 1, JSON.stringify(await estado(m)));
ok('y no paga nada', (await puntos(X)) === 900, String(await puntos(X)));
r = await as('authenticated', A, `SELECT public.confirm_match_result('${m}')`);
ok('el ganador no se confirma solo', /rival/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('el equipo perdedor sí confirma y se paga', !r.err && (await puntos(X)) === 1100, JSON.stringify([r, await puntos(X)]));

await db.exec(`DELETE FROM public.bets; UPDATE public.profiles SET betting_points=1000;`);
await db.query(`UPDATE public.profiles SET betting_points=900 WHERE id='${X}'`);
m = await conApuesta(20);
await db.query(`SELECT public.cancel_abandoned_matches()`);
ok('sin terminar y con apuestas: se cancela', (await estado(m)).status === 'cancelled', JSON.stringify(await estado(m)));
ok('y se devuelve la apuesta', (await puntos(X)) === 1000, String(await puntos(X)));

m = await nuevaPartida(A);
await db.query(`UPDATE public.matches SET created_at=now()-interval '7 hours' WHERE id='${m}'`);
await db.query(`SELECT public.cancel_abandoned_matches()`);
ok('sin nada en juego: se cierra sin ganador', JSON.stringify(await estado(m)) === '{"status":"completed","winner_team":null}', JSON.stringify(await estado(m)));

m = await nuevaPartida(A);
await db.query(`UPDATE public.matches SET created_at=now()-interval '1 hour' WHERE id='${m}'`);
await db.query(`SELECT public.cancel_abandoned_matches()`);
ok('una partida reciente no se toca', (await estado(m)).status === 'active', JSON.stringify(await estado(m)));
await db.exec(`UPDATE public.matches SET status='completed' WHERE status='active';`);

// Un duelo anterior a la migración termina con la regla vieja
await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await nuevaPartida(A, ',is_wager_match,wager_amount', ',true,200');
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=1 WHERE id='${m}'`);
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('un Duelo ya activo sin apartado sigue pagando bien', JSON.stringify(await saldos()) === '[1200,1200,800,800]', JSON.stringify(await saldos()));

// 6. Logros
await db.exec(`UPDATE public.profiles SET betting_points=0, achievements='[]'; DELETE FROM public.matches; DELETE FROM public.bets;`);
r = await as('authenticated', A, `SELECT public.claim_achievement('win_100')`);
ok('un logro sin cumplir no paga', /no cumples/.test(r.err || '') && (await puntos(A)) === 0, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.claim_achievement('inventado')`);
ok('un logro inventado no existe', /desconocido/.test(r.err || ''), JSON.stringify(r));
m = await nuevaPartida(C);
await db.query(`UPDATE public.matches SET team1_total=100, rounds='[{"points":100,"scorerId":"team1"}]'::jsonb WHERE id='${m}'`);
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=1 WHERE id='${m}'`);
r = await as('authenticated', A, `SELECT public.claim_achievement('win_1')`);
ok('un logro cumplido paga', !r.err && (await puntos(A)) === 50, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.claim_achievement('win_1')`);
ok('y una sola vez', /Ya reclamaste/.test(r.err || '') && (await puntos(A)) === 50, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.claim_achievement('fast_match_1')`);
ok('el servidor cuenta las manos', !r.err, JSON.stringify(r));
r = await as('authenticated', C, `SELECT public.claim_achievement('lose_1')`);
ok('y las derrotas', !r.err, JSON.stringify(r));
r = await as('authenticated', C, `SELECT public.claim_achievement('win_1')`);
ok('quien perdió no cobra la victoria', /no cumples/.test(r.err || ''), JSON.stringify(r));
for (let i = 0; i < 10; i++) await db.query(`INSERT INTO public.live_chat(user_id,message) VALUES('${A}','hola')`);
r = await as('authenticated', A, `SELECT public.claim_achievement('chat_10')`);
ok('los mensajes del chat cuentan', !r.err, JSON.stringify(r));

const cat = sql('src/screens/AchievementsScreen.tsx');
const app = [...cat.matchAll(/\{ id: '([a-z0-9_]+)'.*?points: (\d+).*?s\.([a-z_]+) >= (\d+)/g)].map((x) => `${x[1]}|${x[2]}|${x[3]}|${x[4]}`).sort();
const servidor = [...m2.split('Mismos premios y condiciones')[1].split('AS s(id, points, stat, min)')[0].matchAll(/\('([a-z0-9_]+)', (\d+), '([a-z_]+)', (\d+)\)/g)].map((x) => `${x[1]}|${x[2]}|${x[3]}|${x[4]}`).sort();
ok('los 50 logros coinciden con los de la pantalla', app.length === 50 && JSON.stringify(app) === JSON.stringify(servidor), JSON.stringify(app.filter((x) => !servidor.includes(x))));

fin();
