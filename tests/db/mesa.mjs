// Table rules of migration 22 on a full local copy of production:
// "Estoy en la mesa", one rematch, no duplicate tables, outside dealer, leaving, guests.
import { ayudante, IDS } from './base.mjs';
import { crearCompleta, cuerpo } from './_completa.mjs';

const { A, B, C, D, X, ADM } = IDS;
const db = await crearCompleta();
const { ok, as, fin } = ayudante(db);

await db.exec(cuerpo('20261107_22_mesa.sql'));
ok('el SQL 22 se puede repetir', true);
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);

let n = 0;
const nuevoId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const reg = (...ids) => JSON.stringify(ids.map((id) => (id.length > 30 ? { user_id: id } : { name: id })));
const poker = (u, ids, id = nuevoId(), rematch = null) =>
  as('authenticated', u, `SELECT public.start_poker_game('${id}','${reg(...ids)}'::jsonb,200,10${rematch ? `,'${rematch}'` : ''}) AS id`);
const uno = (u, ids, id = nuevoId()) => as('authenticated', u, `SELECT public.start_table_game('${id}','uno','${reg(...ids)}'::jsonb) AS id`);
const mano = (u, g, h) => as('authenticated', u, `SELECT public.save_poker_hand('${g}','${JSON.stringify(h)}'::jsonb)`);
const sillas = async (g) => (await db.query(`SELECT * FROM public.table_game_players WHERE game_id='${g}' ORDER BY seat`)).rows;
const mesa = async (g) => (await db.query(`SELECT * FROM public.table_games WHERE id='${g}'`)).rows[0];
const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
const fichas = async (g) => Object.fromEntries((await db.query(`SELECT * FROM public._poker_chips('${g}')`)).rows.map((f) => [f.seat, Number(f.chips)]));
const terminar = (u, g, s) => as('authenticated', u, `SELECT public.finish_table_game('${g}',${s}) AS estado`);
const abrir = (number, dealerSeat, entrants, contributions) => ({
  number, dealerSeat, dealerPlays: entrants.includes(dealerSeat), entrants, contributions, folded: [], bettingRound: 1,
  status: 'open', endType: null, winners: [], bestHand: null,
});

// 1) Estoy en la mesa
let r = await poker(A, [A, B, C, 'Jorge']);
const g = r.rows?.[0]?.id;
let s = await sillas(g);
ok('quien crea y el invitado ya están; los otros con cuenta no', !!s[0].checked_in_at && !s[1].checked_in_at && !s[2].checked_in_at && !!s[3].checked_in_at, JSON.stringify([r.err, s.map((x) => !!x.checked_in_at)]));
r = await mano(A, g, abrir(1, 0, [0, 1, 2, 3], { 0: 0, 1: 5, 2: 10, 3: 0 }));
ok('sin confirmar no arranca la primera mano', /Falta que confirmen.*B.*C/.test(r.err || ''), JSON.stringify(r));
await as('authenticated', B, `SELECT public.check_in_table_game('${g}')`);
r = await as('authenticated', B, `SELECT public.make_table_game_guest('${g}', 2)`);
ok('solo quien creó la partida pasa a alguien a invitado', /Solo quien creó/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.make_table_game_guest('${g}', 1)`);
ok('quien ya confirmó no se pasa a invitado', /ya confirmó/.test(r.err || ''), JSON.stringify(r));
await as('authenticated', C, `SELECT public.check_in_table_game('${g}')`);
ok('C confirma', !!(await sillas(g))[2].checked_in_at);

// 2) No hay dos mesas abiertas del mismo juego con la misma persona
r = await poker(D, [D, B]);
ok('B no puede estar en dos partidas de póker abiertas', /B ya está en otra partida de póker/.test(r.err || ''), JSON.stringify(r));
r = await uno(D, [D, B]);
ok('pero sí en una de UNO a la vez', !r.err, JSON.stringify(r));
const gUno = r.rows?.[0]?.id;

// 3) Repartidor de afuera
r = await as('authenticated', A, `SELECT public.add_table_game_dealer('${g}', NULL, 'Pedro') AS seat`);
const pedro = r.rows?.[0]?.seat;
ok('alguien que no juega reparte: entra como repartidor', pedro === 4 && (await sillas(g))[4].role === 'dealer', JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.add_table_game_dealer('${g}', NULL, ' pedro ') AS seat`);
ok('el mismo nombre no se repite', r.rows?.[0]?.seat === 4, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.add_table_game_dealer('${g}', '${B}', NULL) AS seat`);
ok('un jugador que reparte sigue en su silla', r.rows?.[0]?.seat === 1, JSON.stringify(r));
ok('el repartidor no tiene fichas', !(4 in (await fichas(g))) && Object.keys(await fichas(g)).length === 4, JSON.stringify(await fichas(g)));
r = await mano(A, g, abrir(1, 4, [0, 1, 2, 3, 4], { 0: 5, 1: 10, 2: 0, 3: 0, 4: 0 }));
ok('el repartidor no entra en la mano', !!r.err, JSON.stringify(r));
r = await mano(A, g, abrir(1, 4, [0, 1, 2, 3], { 0: 5, 1: 10, 2: 0, 3: 0 }));
ok('una mano con repartidor de afuera arranca', !r.err, JSON.stringify(r));

// 4) Retirarse
r = await as('authenticated', A, `SELECT public.leave_table_game('${g}', 3)`);
ok('no se retira quien sigue en la mano abierta', /Primero retírate/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', B, `SELECT public.leave_table_game('${g}', 3)`);
ok('otro jugador no retira a nadie', /Solo el jugador o quien creó/.test(r.err || ''), JSON.stringify(r));
// Jorge se retira de la mano (lo anota quien creó, porque Jorge no tiene teléfono) y luego de la partida
await as('authenticated', A, `SELECT public.set_poker_seat('${g}', 1, 3, 0, true)`);
r = await as('authenticated', A, `SELECT public.leave_table_game('${g}', 3)`);
ok('ya retirado de la mano, se va de la partida', !r.err && !!(await sillas(g))[3].left_at, JSON.stringify(r));
// Cierra la mano 1: A se lleva todo
r = await mano(A, g, { ...abrir(1, 4, [0, 1, 2, 3], { 0: 10, 1: 10, 2: 10, 3: 0 }), status: 'closed', folded: [3], endType: 'showdown', bestHand: 'pair', winners: [{ seat: 0, amount: 30 }] });
await as('authenticated', A, `SELECT public.set_poker_seat('${g}', 1, 0, 10, false)`);
await as('authenticated', B, `SELECT public.set_poker_seat('${g}', 1, 1, 10, false)`);
await as('authenticated', C, `SELECT public.set_poker_seat('${g}', 1, 2, 10, false)`);
r = await mano(A, g, { ...abrir(1, 4, [0, 1, 2, 3], { 0: 10, 1: 10, 2: 10, 3: 0 }), status: 'closed', folded: [3], endType: 'showdown', bestHand: 'pair', winners: [{ seat: 0, amount: 30 }] });
ok('quien creó anota por el repartidor sin cuenta', !r.err && (await fichas(g))[0] === 220, JSON.stringify([r, await fichas(g)]));
r = await mano(A, g, abrir(2, 4, [0, 1, 3], { 0: 5, 1: 10, 3: 0 }));
ok('quien se retiró no entra en manos nuevas', !!r.err, JSON.stringify(r));
r = await terminar(A, g, 3);
ok('quien se retiró no puede ganar', /tiene que estar jugando/.test(r.err || ''), JSON.stringify(r));
r = await terminar(A, g, 0);
await as('authenticated', B, `SELECT public.answer_table_game('${g}', true)`);
ok('termina y se confirma', (await mesa(g)).status === 'completed', JSON.stringify([r, (await mesa(g)).status]));
ok('3 con cuenta y 1 invitado: hay premio', (await puntos(A)) === 1020, String(await puntos(A)));

// 5) Una sola revancha aunque dos teléfonos la pidan
const r1 = await poker(B, [A, B, C], nuevoId(), g);
const r2 = await poker(C, [A, B, C], nuevoId(), g);
const revanchas = (await db.query(`SELECT id FROM public.table_games WHERE rematch_of='${g}'`)).rows;
ok('la segunda revancha entra a la primera', r1.rows?.[0]?.id === r2.rows?.[0]?.id && revanchas.length === 1, JSON.stringify([r1, r2, revanchas]));
r = await poker(X, [X, 'Ana'], nuevoId(), g);
ok('alguien de afuera no pide revancha... recibe la que ya existe', r.rows?.[0]?.id === r1.rows?.[0]?.id, JSON.stringify(r));

// 6) Póker sin manos se anula a los 15 minutos
const vieja = r1.rows[0].id;
await db.exec(`UPDATE public.table_games SET created_at = now() - interval '20 minutes' WHERE id='${vieja}'`);
await db.exec(`SELECT public.auto_confirm_table_games()`);
ok('la mesa sin manos se anuló sola', (await mesa(vieja)).status === 'cancelled', (await mesa(vieja)).status);

// 7) UNO: también hay que confirmar antes de terminar
r = await terminar(D, gUno, 0);
ok('UNO no termina sin que todos confirmen', /Falta que confirmen.*B/.test(r.err || ''), JSON.stringify(r));
await as('authenticated', B, `SELECT public.check_in_table_game('${gUno}')`);
r = await terminar(D, gUno, 0);
ok('después de confirmar, termina', r.rows?.[0]?.estado === 'pending_confirmation', JSON.stringify(r));

// 8) Invitados: más de uno no cuenta para el ranking
r = await uno(X, [X, 'G1', 'G2']);
await terminar(X, r.rows[0].id, 0);
let rank = (await as('authenticated', X, `SELECT * FROM public.table_game_ranking('uno')`)).rows;
ok('ganarles a dos invitados no sube en el ranking', !rank.some((x) => x.user_id === X), JSON.stringify(rank));
r = await uno(X, [X, 'G1']);
await terminar(X, r.rows[0].id, 0);
rank = (await as('authenticated', X, `SELECT * FROM public.table_game_ranking('uno')`)).rows;
ok('con un solo invitado sí cuenta', rank.some((x) => x.user_id === X && Number(x.wins) === 1), JSON.stringify(rank));

// 9) Lista de invitados del club
const lr = await as('authenticated', X, `SELECT name_key, uses FROM public.club_guests ORDER BY name_key`);
const lista = lr.rows || [];
ok('la lista recuerda a los invitados', ['g1', 'g2', 'jorge', 'pedro'].every((k) => lista.some((x) => x.name_key === k)) && lista.find((x) => x.name_key === 'g1')?.uses === 2, JSON.stringify(lr));
r = await as('authenticated', A, `SELECT public.remember_club_guests(ARRAY['Luis  Pérez', 'Jorge'])`);
ok('el dominó también guarda invitados', !r.err && (await db.query(`SELECT 1 FROM public.club_guests WHERE name_key='luis pérez'`)).rows.length === 1, JSON.stringify(r));
r = await as('anon', null, `SELECT public.remember_club_guests(ARRAY['Nadie'])`);
ok('sin sesión no se guarda nada', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `INSERT INTO public.club_guests(name_key, name) VALUES ('x','x')`);
ok('nadie escribe la lista directo', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.forget_club_guest('Jorge')`);
ok('solo un administrador borra un invitado', /administrador/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT public.forget_club_guest('jorge')`);
ok('el administrador lo borra', !r.err && (await db.query(`SELECT 1 FROM public.club_guests WHERE name_key='jorge'`)).rows.length === 0, JSON.stringify(r));

// 10) Dominó con más de un invitado: sin apuestas
await db.exec(`INSERT INTO public.matches(id, status, team1_player1, team1_player2, team2_player1, team2_player2, created_by, rounds, limit_score, team1_total, team2_total)
  VALUES ('00000000-0000-4000-9000-000000000001', 'active', '${A}', NULL, NULL, '${B}', '${A}', '[]', 100, 0, 0),
         ('00000000-0000-4000-9000-000000000002', 'active', '${A}', '${C}', '${D}', '${B}', '${A}', '[]', 100, 0, 0)`);
r = await as('authenticated', X, `SELECT public.place_bet('00000000-0000-4000-9000-000000000001', 1, 10)`);
ok('con dos invitados no se apuesta', /más de un invitado/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.place_bet('00000000-0000-4000-9000-000000000002', 1, 10)`);
ok('con los cuatro registrados sí', !(r.err || '').includes('invitado'), JSON.stringify(r));

// 11) Volver a pegar el SQL no confirma a nadie por su cuenta
r = await poker(D, [D, X]);
await db.exec(cuerpo('20261107_22_mesa.sql'));
ok('repetir el SQL no marca presente a quien no confirmó', !(await sillas(r.rows[0].id))[1].checked_in_at, JSON.stringify(r));

fin();
