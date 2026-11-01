import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X, ADM } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
const partida = async (id) => (await db.query(`SELECT * FROM public.matches WHERE id='${id}'`)).rows[0];
const ronda = (n, equipo, pts) => ({ id: `r${n}`, roundNumber: n, scorerId: equipo, points: pts, endingType: 'normal' });
const crear = async (columnas = '', valores = '', rondas = [ronda(1, 'team1', 60), ronda(2, 'team1', 40)]) => {
  const r = await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds,team1_total,team2_total${columnas})
    VALUES('active','${A}','${B}','${C}','${D}','${A}','${JSON.stringify(rondas)}'::jsonb,100,0${valores}) RETURNING id`);
  return r.rows[0].id;
};
// Bets close at 50 points, so the bet goes in before the score does
const apostar = async (id) => {
  await db.query(`UPDATE public.matches SET team1_total=0 WHERE id='${id}'`);
  await db.query(`INSERT INTO public.bets(user_id,match_id,bet_on_team,amount_wagered,multiplier) VALUES('${X}','${id}',1,100,2)`);
  await db.query(`UPDATE public.matches SET team1_total=100 WHERE id='${id}'`);
};
const cerrar = (uid, id) => as('authenticated', uid, `UPDATE public.matches SET status='completed', winner_team=1 WHERE id='${id}' RETURNING status`);
const confirmar = (uid, id) => as('authenticated', uid, `SELECT public.confirm_match_result('${id}') r`);
const disputar = (uid, id) => as('authenticated', uid, `SELECT public.dispute_match_result('${id}') r`);

// ANTES: reproduce el problema con el servidor de hoy
await db.query(`UPDATE public.profiles SET betting_points=1000`);
let m = await crear();
await apostar(m);
await db.query(`UPDATE public.profiles SET betting_points=900 WHERE id='${X}'`);
let r = await cerrar(A, m);
ok('ANTES (reproduce): al cerrar se paga la apuesta al instante', (await puntos(X)) === 1100, JSON.stringify([r, await puntos(X)]));

const mig = sql('supabase/migrations/20261101_01_confirmacion_rival.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);
await db.query(`UPDATE public.profiles SET betting_points=1000`);

// Partida normal
m = await crear();
r = await cerrar(A, m);
ok('una partida normal cierra como siempre', r.rows?.[0]?.status === 'completed', JSON.stringify(r));
ok('y guarda quién la cerró', (await partida(m)).closed_by === A);

// Apuesta de un espectador
m = await crear();
await apostar(m);
await db.query(`UPDATE public.profiles SET betting_points=900 WHERE id='${X}'`);
r = await cerrar(A, m);
ok('con apuestas queda por confirmar', r.rows?.[0]?.status === 'pending_confirmation', JSON.stringify(r));
ok('y no paga nada', (await puntos(X)) === 900, String(await puntos(X)));
r = await as('authenticated', X, `SELECT public.settle_my_pending_bets() r`);
ok('cobrar mis apuestas tampoco paga', !r.err && (await puntos(X)) === 900, JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.settle_completed_match('${m}')`);
ok('liquidar a mano tampoco paga', !r.err && (await puntos(X)) === 900, JSON.stringify(r));
r = await as('authenticated', A, `UPDATE public.matches SET status='completed' WHERE id='${m}' RETURNING status`);
ok('quien cerró no la pasa a terminada por su cuenta', r.rows?.[0]?.status === 'pending_confirmation', JSON.stringify(r));
r = await as('authenticated', A, `UPDATE public.matches SET winner_team=2, team2_total=500 WHERE id='${m}' RETURNING winner_team`);
ok('por confirmar no se puede editar', r.rows?.[0]?.winner_team === 1, JSON.stringify(r));

r = await confirmar(A, m);
ok('quien cerró no puede confirmar', /rival/.test(r.err || ''), JSON.stringify(r));
r = await confirmar(B, m);
ok('su compañero tampoco', /rival/.test(r.err || ''), JSON.stringify(r));
r = await confirmar(X, m);
ok('un espectador tampoco', /rival/.test(r.err || ''), JSON.stringify(r));
r = await as('anon', null, `SELECT public.confirm_match_result('${m}')`);
ok('sin sesión tampoco', !!r.err, JSON.stringify(r));
r = await confirmar(C, m);
ok('un rival confirma', !r.err, JSON.stringify(r));
let p = await partida(m);
ok('y la partida queda terminada', p.status === 'completed' && p.confirmed_by === C, JSON.stringify(p));
ok('y entonces se paga', (await puntos(X)) === 1100, String(await puntos(X)));
r = await confirmar(D, m);
ok('no se puede confirmar dos veces', /ya no está/.test(r.err || ''), JSON.stringify(r));
ok('y no paga dos veces', (await puntos(X)) === 1100, String(await puntos(X)));

// Nadie responde: un admin confirma
m = await crear();
await apostar(m);
await cerrar(A, m);
r = await confirmar(ADM, m);
ok('un admin confirma aunque no juegue', !r.err && (await partida(m)).status === 'completed', JSON.stringify(r));

// Desacuerdo
await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await crear();
await apostar(m);
await db.query(`UPDATE public.profiles SET betting_points=900 WHERE id='${X}'`);
await cerrar(A, m);
r = await disputar(A, m);
ok('quien cerró no puede disputar su cierre', /rival/.test(r.err || ''), JSON.stringify(r));
r = await disputar(D, m);
ok('el otro rival no está de acuerdo', !r.err, JSON.stringify(r));
p = await partida(m);
ok('se reabre sin la última mano', p.status === 'active' && p.rounds.length === 1 && p.team1_total === 60 && p.winner_team === null, JSON.stringify(p));
ok('queda anotada la mano quitada', p.disputed_round?.points === 40 && p.disputed_by === D, JSON.stringify(p));
ok('y no se pagó nada', (await puntos(X)) === 900, String(await puntos(X)));
r = await as('authenticated', A, `UPDATE public.matches SET team1_total=95, rounds='[]'::jsonb WHERE id='${m}' RETURNING team1_total`);
ok('reabierta se puede volver a anotar', r.rows?.[0]?.team1_total === 95, JSON.stringify(r));
r = await cerrar(A, m);
ok('y al volver a cerrar pide confirmación otra vez', r.rows?.[0]?.status === 'pending_confirmation', JSON.stringify(r));

// Duelo VIP
await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await crear();
await db.query(`UPDATE public.matches SET is_wager_match=true, wager_amount=200 WHERE id='${m}'`);
r = await cerrar(C, m);
ok('un Duelo VIP queda por confirmar', r.rows?.[0]?.status === 'pending_confirmation', JSON.stringify(r));
ok('sin mover puntos', (await puntos(A)) === 1000 && (await puntos(C)) === 1000, JSON.stringify([await puntos(A), await puntos(C)]));
r = await confirmar(C, m);
ok('el que cerró no confirma su propio Duelo', /rival/.test(r.err || ''), JSON.stringify(r));
r = await confirmar(A, m);
ok('el rival confirma el Duelo', !r.err, JSON.stringify(r));
ok('y el Duelo paga una sola vez', (await puntos(A)) === 1200 && (await puntos(C)) === 800, JSON.stringify([await puntos(A), await puntos(C)]));

// Torneo
const t = (await db.query(`INSERT INTO public.tournaments(name,status) VALUES('t','in_progress') RETURNING id`)).rows[0].id;
m = await crear(',tournament_id', `,'${t}'`);
await db.query(`INSERT INTO public.tournament_brackets(tournament_id,round_number,match_number,team1_player1,team1_player2,team2_player1,team2_player2,live_match_id) VALUES('${t}',1,1,'${A}','${B}','${C}','${D}','${m}')`);
r = await cerrar(A, m);
ok('una partida de torneo queda por confirmar', r.rows?.[0]?.status === 'pending_confirmation', JSON.stringify(r));
const llave = async () => (await db.query(`SELECT winner_team w FROM public.tournament_brackets WHERE live_match_id='${m}'`)).rows[0].w;
ok('y la llave no avanza', (await llave()) === null, String(await llave()));
r = await confirmar(C, m);
ok('al confirmar la llave avanza', !r.err && (await llave()) === 1, JSON.stringify([r, await llave()]));

// Quien anota sin jugar
await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await crear();
await apostar(m);
await db.query(`UPDATE public.matches SET created_by='${X}' WHERE id='${m}'`);
await db.query(`INSERT INTO public.profiles(id,display_name,initials) VALUES('${'5'.repeat(8)}-5555-5555-5555-${'5'.repeat(12)}','S','S')`);
const S = `${'5'.repeat(8)}-5555-5555-5555-${'5'.repeat(12)}`;
await db.query(`UPDATE public.matches SET created_by='${S}' WHERE id='${m}'`);
r = await cerrar(S, m);
ok('si cierra quien no juega queda por confirmar', r.rows?.[0]?.status === 'pending_confirmation', JSON.stringify(r));
r = await confirmar(A, m);
ok('el equipo ganador no confirma lo que cerró un tercero', /rival/.test(r.err || ''), JSON.stringify(r));
r = await confirmar(C, m);
ok('responde el equipo que pierde', !r.err, JSON.stringify(r));

// Sustitutos
await db.query(`UPDATE public.profiles SET betting_points=1000`);
m = await crear();
await apostar(m);
r = await as('authenticated', A, `UPDATE public.matches SET team2_player1='${X}', initial_team2='{}' WHERE id='${m}' RETURNING initial_team2`);
ok('la formación inicial no se cambia desde la app', r.rows?.[0]?.initial_team2?.length === 2, JSON.stringify(r));
await cerrar(A, m);
r = await confirmar(X, m);
ok('un sustituto no confirma como rival', /rival/.test(r.err || ''), JSON.stringify(r));
ok('y no se paga nada', (await partida(m)).status === 'pending_confirmation');
r = await confirmar(C, m);
ok('el rival original sí confirma aunque ya no esté sentado', !r.err && (await partida(m)).status === 'completed', JSON.stringify(r));
m = await crear();
await apostar(m);
await db.query(`UPDATE public.matches SET team1_player1='${X}' WHERE id='${m}'`);
await cerrar(X, m);
r = await confirmar(B, m);
ok('si cierra un sustituto, su compañero no confirma', /rival/.test(r.err || ''), JSON.stringify(r));
r = await confirmar(D, m);
ok('responde el equipo contrario', !r.err, JSON.stringify(r));

// Zapatos: el logro se entrega al confirmar
for (let i = 0; i < 3; i++) {
  m = await crear(',is_zapato', ',true');
  await apostar(m);
  await db.query(`UPDATE public.matches SET team2_total=0 WHERE id='${m}'`);
  await cerrar(A, m);
  r = await confirmar(C, m);
}
const logros = (await db.query(`SELECT achievements a FROM public.profiles WHERE id='${B}'`)).rows[0].a;
ok('al tercer zapato confirmado se entrega Zapatero Maestro', !r.err && logros.includes('zapatero_maestro'), JSON.stringify([r, logros]));

// Partida terminada
m = await crear();
await cerrar(A, m);
r = await as('authenticated', A, `UPDATE public.matches SET winner_team=2, status='active' WHERE id='${m}' RETURNING status, winner_team`);
ok('una partida terminada no se edita y no da error', r.rows?.[0]?.status === 'completed' && r.rows?.[0]?.winner_team === 1, JSON.stringify(r));
r = await as('authenticated', ADM, `UPDATE public.matches SET winner_team=2 WHERE id='${m}' RETURNING winner_team`);
ok('tampoco desde la app de un admin', r.rows?.[0]?.winner_team === 1, JSON.stringify(r));
const cancelada = await crear();
r = await as('authenticated', A, `UPDATE public.matches SET status='cancelled' WHERE id='${cancelada}' RETURNING status`);
ok('la app no cancela una partida con un estado inventado', r.rows?.[0]?.status === 'active', JSON.stringify(r));
await db.query(`UPDATE public.matches SET status='cancelled' WHERE id='${cancelada}'`);
r = await as('authenticated', A, `UPDATE public.matches SET status='active' WHERE id='${cancelada}' RETURNING status`);
ok('una partida cancelada no revive', r.rows?.[0]?.status === 'cancelled', JSON.stringify(r));
// Eliminar cuenta en una partida ya terminada
m = await crear();
await db.query(`UPDATE public.matches SET players_json='[{"profileId":"${D}","name":"Daniela","initials":"DA"}]'::jsonb WHERE id='${m}'`);
await cerrar(A, m);
r = await as('authenticated', D, `SELECT public.delete_user_account() r`);
ok('eliminar cuenta sigue funcionando', r.rows?.[0]?.r?.deleted === true, JSON.stringify(r));
const anon = (await partida(m)).players_json[0];
ok('y quita su nombre de partidas ya terminadas', anon.initials === '--' && !/Daniela/.test(anon.name), JSON.stringify(anon));
ok('sin abrir la partida para los demás', (await partida(m)).status === 'completed');
r = await as('authenticated', A, `UPDATE public.matches SET winner_team=2 WHERE id='${m}' RETURNING winner_team`);
ok('la partida sigue cerrada después', r.rows?.[0]?.winner_team === 1, JSON.stringify(r));
await db.query(`UPDATE public.matches SET winner_team=2 WHERE id='${m}'`);
ok('el dueño sí corrige desde el editor SQL', (await partida(m)).winner_team === 2);

fin();
