import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X, ADM } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

const cuerpo = (f) => sql(`supabase/migrations/${f}`).split('-- VERIFICACIÓN')[0].replace(/-- =+\s*$/, '');
for (const f of ['20261101_01_confirmacion_rival.sql', '20261101_02_seguridad_servidor.sql', '20261101_03_rachas.sql', '20261101_04_puntos.sql', '20261101_06_partidas_abandonadas.sql', '20261101_07_cola_diaria.sql', '20261101_08_confirmacion_todas.sql', '20261101_09_confirmacion_1_minuto.sql']) {
  await db.exec(cuerpo(f));
}
await db.exec(`CREATE SCHEMA net;
  CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
await db.exec(cuerpo('20261101_10_notificaciones_push.sql').replace('CREATE EXTENSION IF NOT EXISTS pg_net;', ''));
await db.exec(cuerpo('20261101_11_direccion_send_push.sql'));
await db.exec(cuerpo('20261101_12_aviso_turno_antes_del_limite.sql'));
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;`);
await db.exec(cuerpo('20261101_13_uno.sql'));
const mig = cuerpo('20261101_14_poker.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);

for (const u of [A, B, C, D, X]) await as('authenticated', u, `SELECT public.save_push_subscription('https://push/${u}','k','a')`);
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);

let n = 0;
const nuevoId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const reg = (...ids) => JSON.stringify(ids.map((id) => (id.length > 30 ? { user_id: id } : { name: id })));
const empezar = (u, ids, fichas = 200, entrada = 20, id = nuevoId()) =>
  as('authenticated', u, `SELECT public.start_poker_game('${id}','${reg(...ids)}'::jsonb,${fichas},${entrada}) AS id`);
const nueva = async (u, ids, fichas, entrada) => (await empezar(u, ids, fichas, entrada)).rows[0].id;
const guardar = (u, g, mano) => as('authenticated', u, `SELECT public.save_poker_hand('${g}','${JSON.stringify(mano)}'::jsonb)`);
const asiento = (u, g, numero, silla, total, retirado = false) =>
  as('authenticated', u, `SELECT public.set_poker_seat('${g}',${numero},${silla},${total},${retirado}) AS hecho`);
const fichas = async (g) => Object.fromEntries((await db.query(`SELECT * FROM public._poker_chips('${g}')`)).rows.map((f) => [f.seat, Number(f.chips)]));
const manos = async (g) => (await db.query(`SELECT * FROM public.poker_hands WHERE game_id='${g}' ORDER BY number`)).rows;
const mesa = async (g) => (await db.query(`SELECT * FROM public.table_games WHERE id='${g}'`)).rows[0];
const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
const terminar = (u, g, s) => as('authenticated', u, `SELECT public.finish_table_game('${g}',${s}) AS estado`);
const responder = (u, g, si) => as('authenticated', u, `SELECT public.answer_table_game('${g}',${si}) AS hecho`);

const mano = (over = {}) => ({
  number: 1, dealerSeat: 0, dealerPlays: true, entrants: [0, 1, 2],
  contributions: { 0: 20, 1: 20, 2: 20 }, folded: [], bettingRound: 1,
  status: 'open', endType: null, winners: [], bestHand: null, ...over,
});
const cerrada = (over = {}) => mano({ status: 'closed', endType: 'showdown', winners: [{ seat: 1, amount: 60 }], bestHand: 'full_house', ...over });
let r, g;

// Empezar
r = await as('anon', null, `SELECT public.start_poker_game('${nuevoId()}','${reg(A, B)}'::jsonb,200,10)`);
ok('sin sesión no se empieza', !!r.err, JSON.stringify(r));
r = await empezar(A, [A]);
ok('hacen falta 2 jugadores', /2 a 10/.test(r.err || ''), JSON.stringify(r));
r = await empezar(A, [A, B], 0, 10);
ok('las fichas iniciales deben ser positivas', /fichas iniciales/.test(r.err || ''), JSON.stringify(r));
r = await empezar(A, [A, B], 100, 200);
ok('la entrada no pasa de las fichas iniciales', /entrada/.test(r.err || ''), JSON.stringify(r));
r = await empezar(A, [A, A]);
ok('un jugador no se repite', /repetido/.test(r.err || ''), JSON.stringify(r));
const fija = nuevoId();
await empezar(A, [A, B, C], 200, 20, fija);
r = await empezar(A, [A, B, C], 200, 20, fija);
ok('reenviar el inicio no duplica', !r.err && (await db.query(`SELECT count(*)::int c FROM public.table_game_players WHERE game_id='${fija}'`)).rows[0].c === 3, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.start_table_game('${nuevoId()}','poker','${reg(A, B)}'::jsonb)`);
ok('el póker no se empieza como un UNO', /juego/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.start_table_game('${nuevoId()}','uno','${reg(A, B)}'::jsonb)`);
ok('UNO sigue empezando igual', !r.err, JSON.stringify(r));
const fm = (await db.query(`SELECT start_chips, entry_amount FROM public.table_games WHERE id='${fija}'`)).rows[0];
ok('guarda fichas y entrada', fm.start_chips === 200 && fm.entry_amount === 20, JSON.stringify(fm));

// Solo por funciones
r = await as('authenticated', A, `INSERT INTO public.poker_hands(game_id,number,dealer_seat,dealer_plays,entrants,contributions,status) VALUES('${fija}',1,0,true,'{0,1}','{}','open')`);
ok('nadie crea manos directo', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `SELECT * FROM public._poker_chips('${fija}')`);
ok('la función interna de fichas no se llama desde la app', !!r.err, JSON.stringify(r));

// Empezar mano
r = await guardar(X, fija, mano());
ok('un extraño no empieza una mano', /mesa/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, mano({ number: 5 }));
ok('las manos van en orden', /última mano/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, mano({ entrants: [0], contributions: { 0: 20 } }));
ok('una mano necesita 2 jugadores', /al menos 2/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, mano({ entrants: [0, 7], contributions: { 0: 20, 7: 20 } }));
ok('solo jugadores de la partida', /al menos 2/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, mano({ dealerPlays: false }));
ok('quien solo reparte no entra', /solo reparte/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, mano({ contributions: { 0: 20, 1: 500, 2: 20 } }));
ok('nadie apuesta más de lo que tiene', /más fichas/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, mano({ contributions: { 0: 20 } }));
ok('las apuestas deben incluir a todos', /no cuadran/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, mano({ contributions: { 0: 20, 1: -5, 2: 20 } }));
ok('no hay apuestas negativas', /no cuadran/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, mano());
ok('se empieza la mano', !r.err && (await manos(fija)).length === 1, JSON.stringify(r));
r = await guardar(A, fija, mano({ number: 2 }));
ok('no se abre otra con una mano abierta', /mano abierta/.test(r.err || ''), JSON.stringify(r));

// Solo reparte quien reparte
r = await guardar(B, fija, mano({ bettingRound: 2 }));
ok('la ronda la lleva solo quien reparte', /quien reparte/.test(r.err || ''), JSON.stringify(r));
await asiento(A, fija, 1, 0, 60);
await asiento(A, fija, 1, 2, 20, true);
await guardar(A, fija, mano({ bettingRound: 2 }));
ok('la mano se va guardando', Number((await manos(fija))[0].contributions[0]) === 60 && (await manos(fija))[0].betting_round === 2 && (await manos(fija))[0].folded.join() === '2', 'sin guardar');

// Cada jugador mueve sus fichas desde su teléfono
r = await as('anon', null, `SELECT public.set_poker_seat('${fija}',1,0,60,false)`);
ok('sin sesión no se apuesta', !!r.err, JSON.stringify(r));
r = await asiento(X, fija, 1, 1, 60);
ok('un extraño no mueve fichas', /tus propias/.test(r.err || ''), JSON.stringify(r));
r = await asiento(B, fija, 1, 0, 80);
ok('un jugador no mueve las fichas de otro', /tus propias/.test(r.err || ''), JSON.stringify(r));
r = await asiento(B, fija, 1, 1, 90);
ok('un jugador apuesta desde su teléfono', r.rows?.[0]?.hecho === true && Number((await manos(fija))[0].contributions[1]) === 90, JSON.stringify(r));
r = await asiento(B, fija, 1, 1, 70);
ok('lo apostado no se devuelve', r.rows?.[0]?.hecho === false && Number((await manos(fija))[0].contributions[1]) === 90, JSON.stringify(r));
r = await asiento(B, fija, 1, 1, 500);
ok('nadie apuesta más de lo que tiene', r.rows?.[0]?.hecho === false, JSON.stringify(r));
r = await asiento(B, fija, 1, 7, 10);
ok('solo sillas de la mano', !!r.err || r.rows?.[0]?.hecho === false, JSON.stringify(r));
r = await asiento(C, fija, 1, 2, 90, false);
ok('quien se retiró no vuelve solo', r.rows?.[0]?.hecho === false && (await manos(fija))[0].folded.join() === '2', JSON.stringify(r));
r = await asiento(A, fija, 1, 2, 20, false);
ok('quien reparte puede corregir un retiro', r.rows?.[0]?.hecho === true && (await manos(fija))[0].folded.length === 0, JSON.stringify(r));
r = await asiento(A, fija, 1, 1, 60);
ok('quien reparte corrige una apuesta', Number((await manos(fija))[0].contributions[1]) === 60, JSON.stringify(r));
await asiento(B, fija, 1, 1, 80);
await asiento(C, fija, 1, 2, 40);
await guardar(A, fija, mano({ bettingRound: 3 }));
const juntas = (await manos(fija))[0];
ok('dos teléfonos no se pisan, ni con quien reparte', Number(juntas.contributions[1]) === 80 && Number(juntas.contributions[2]) === 40 && Number(juntas.contributions[0]) === 60 && juntas.betting_round === 3, JSON.stringify(juntas));
r = await asiento(B, fija, 9, 1, 40);
ok('una mano que no existe no da error', !r.err && r.rows?.[0]?.hecho === false, JSON.stringify(r));
let f = await fichas(fija);
ok('una mano abierta no mueve las fichas', f[0] === 200 && f[1] === 200, JSON.stringify(f));

// Cerrar
await db.exec(`DELETE FROM public.poker_hands WHERE game_id='${fija}'`);
await guardar(A, fija, mano());
r = await guardar(A, fija, cerrada({ winners: [{ seat: 1, amount: 50 }] }));
ok('las fichas repartidas deben sumar el pozo', /sumar el pozo/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, cerrada({ winners: [{ seat: 1, amount: 30 }, { seat: 1, amount: 30 }] }));
ok('un ganador no se repite', /sumar el pozo/.test(r.err || ''), JSON.stringify(r));
await asiento(A, fija, 1, 1, 20, true);
r = await guardar(A, fija, cerrada());
ok('quien se retiró no gana', /sumar el pozo/.test(r.err || ''), JSON.stringify(r));
await asiento(A, fija, 1, 1, 20, false);
r = await guardar(A, fija, cerrada({ bestHand: 'inventada' }));
ok('solo las 10 jugadas', /jugada/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, cerrada({ endType: null }));
ok('debe decir cómo terminó', /terminó/.test(r.err || ''), JSON.stringify(r));
await asiento(A, fija, 1, 2, 20, true);
r = await guardar(A, fija, mano({ status: 'closed', endType: 'fold', winners: [{ seat: 1, amount: 60 }] }));
ok('por retirada queda uno solo', /retirada/.test(r.err || ''), JSON.stringify(r));
await asiento(A, fija, 1, 0, 20, true);
r = await guardar(A, fija, cerrada({ endType: 'fold' }));
ok('por retirada no se anota jugada', /retirada/.test(r.err || ''), JSON.stringify(r));
await asiento(A, fija, 1, 0, 20, false);
await asiento(A, fija, 1, 2, 20, false);
r = await guardar(A, fija, cerrada({ contributions: { 0: 5, 1: 5, 2: 5 } }));
await db.exec(`UPDATE public.poker_hands SET status='open', closed_at=NULL, end_type=NULL, best_hand=NULL, winners='[]' WHERE game_id='${fija}'`);
ok('al cerrar cuentan las apuestas guardadas, no las que mande el teléfono', !r.err && (await manos(fija))[0].contributions[0] === 20, JSON.stringify(r));
r = await guardar(A, fija, cerrada());
f = await fichas(fija);
ok('el ganador se lleva el pozo', !r.err && f[0] === 180 && f[1] === 240 && f[2] === 180, JSON.stringify([r, f]));
r = await asiento(B, fija, 1, 1, 90);
ok('una apuesta que llega con la mano cerrada se ignora sin error', !r.err && r.rows?.[0]?.hecho === false && Number((await manos(fija))[0].contributions[1]) === 20, JSON.stringify(r));
ok('queda quién anotó', (await manos(fija))[0].scored_by === A && !!(await manos(fija))[0].closed_at, 'sin dato');

// Corregir la última mano
r = await guardar(B, fija, cerrada({ winners: [{ seat: 2, amount: 60 }] }));
ok('solo quien reparte corrige', /quien reparte/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, fija, cerrada({ winners: [{ seat: 2, amount: 60 }], dealerSeat: 2 }));
f = await fichas(fija);
ok('corregir cambia las fichas sin descuadrar', !r.err && f[1] === 180 && f[2] === 240 && f[0] + f[1] + f[2] === 600, JSON.stringify([r, f]));
ok('al corregir no cambia quien repartió', (await manos(fija))[0].dealer_seat === 0, 'cambió');
await guardar(B, fija, mano({ number: 2, dealerSeat: 1 }));
r = await guardar(A, fija, mano({ number: 1, status: 'open' }));
ok('solo se corrige la última', /última mano/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.cancel_poker_hand('${fija}',2)`);
ok('un extraño no quita manos', /quien reparte/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', B, `SELECT public.cancel_poker_hand('${fija}',2)`);
ok('quien reparte quita una mano abierta por error', !r.err && (await manos(fija)).length === 1, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.cancel_poker_hand('${fija}',1)`);
ok('una mano cerrada no se quita', /abierta/.test(r.err || ''), JSON.stringify(r));

// Quien reparte sin cuenta: anota quien creó la partida
g = await nueva(A, ['Pedro', A, B]);
await guardar(A, g, mano({ dealerSeat: 0, dealerPlays: false, entrants: [1, 2], contributions: { 1: 20, 2: 20 } }));
r = await guardar(B, g, mano({ dealerSeat: 0, dealerPlays: false, entrants: [1, 2], contributions: { 1: 40, 2: 20 } }));
ok('sin cuenta anota quien creó, no otro', /quien reparte/.test(r.err || ''), JSON.stringify(r));
r = await guardar(A, g, { ...cerrada({ dealerSeat: 0, dealerPlays: false, entrants: [1, 2], contributions: { 1: 20, 2: 20 }, winners: [{ seat: 2, amount: 40 }], bestHand: 'pair' }) });
ok('quien solo reparte no pone fichas', !r.err && (await fichas(g))[0] === 200, JSON.stringify(r));

// Todo adentro: se anota cuánto se lleva cada uno
g = await nueva(A, [A, B, C], 100, 10);
await guardar(A, g, mano({ contributions: { 0: 100, 1: 40, 2: 100 } }));
r = await guardar(A, g, cerrada({ contributions: { 0: 100, 1: 40, 2: 100 }, winners: [{ seat: 1, amount: 120 }, { seat: 2, amount: 120 }], bestHand: 'flush' }));
f = await fichas(g);
ok('el reparto del todo adentro lo anota quien reparte', !r.err && f[0] === 0 && f[1] === 180 && f[2] === 120, JSON.stringify([r, f]));
r = await guardar(A, g, mano({ number: 2, entrants: [0, 1], contributions: { 0: 10, 1: 10 } }));
ok('sin fichas no se apuesta', /más fichas/.test(r.err || ''), JSON.stringify(r));

// Terminar la partida
g = await nueva(A, [A, B, C], 200, 20);
r = await terminar(A, g, 0);
ok('hay que jugar al menos una mano', /al menos una mano/.test(r.err || ''), JSON.stringify(r));
await guardar(A, g, mano());
r = await terminar(A, g, 0);
ok('no se termina con una mano abierta', /mano abierta/.test(r.err || ''), JSON.stringify(r));
await guardar(A, g, cerrada());
r = await terminar(B, g, 1);
ok('la cierra quien reparte', /quien reparte/.test(r.err || ''), JSON.stringify(r));
r = await terminar(X, g, 1);
ok('un extraño no la cierra', /mesa/.test(r.err || ''), JSON.stringify(r));
r = await terminar(A, g, 0);
ok('gana quien tiene más fichas', /más fichas/.test(r.err || ''), JSON.stringify(r));
await db.exec(`DELETE FROM public.notification_queue;`);
r = await terminar(A, g, 1);
ok('después espera confirmación de otro jugador', r.rows?.[0]?.estado === 'pending_confirmation', JSON.stringify(r));
ok('todavía sin premio', (await puntos(B)) === 1000, String(await puntos(B)));
r = await guardar(A, g, mano({ number: 2 }));
ok('terminada ya no se anota', /ya terminó/.test(r.err || ''), JSON.stringify(r));
const aviso = (await db.query(`SELECT * FROM public.notification_queue ORDER BY created_at`)).rows.at(-1);
ok('el aviso dice que es póker', /Póker/.test(aviso?.body || ''), JSON.stringify(aviso));
await responder(C, g, true);
ok('confirmada paga +20 al ganador', (await mesa(g)).status === 'completed' && (await puntos(B)) === 1020, String(await puntos(B)));
ok('las fichas nunca tocan el saldo', (await puntos(A)) === 1000 && (await puntos(C)) === 1000, 'cambió el saldo');
const mov = (await db.query(`SELECT count(*)::int c FROM public.points_ledger WHERE user_id='${B}' AND reason='Premio por ganar'`)).rows[0].c;
ok('queda un solo movimiento de premio', mov === 1, String(mov));

// Empate: elige quien reparte entre los que más fichas tienen
g = await nueva(A, [A, B, C], 200, 20);
await guardar(A, g, mano({ contributions: { 0: 20, 1: 20, 2: 20 } }));
await guardar(A, g, cerrada({ winners: [{ seat: 0, amount: 30 }, { seat: 1, amount: 30 }] }));
r = await terminar(A, g, 2);
ok('con empate no gana un tercero', /más fichas/.test(r.err || ''), JSON.stringify(r));
r = await terminar(A, g, 1);
ok('con empate elige quien reparte', !r.err, JSON.stringify(r));

// Partida abandonada
g = await nueva(A, [A, B, C], 200, 20);
await guardar(A, g, mano());
await db.query(`UPDATE public.table_games SET created_at = now() - interval '7 hours' WHERE id='${g}'`);
await db.query(`SELECT public.auto_confirm_table_games()`);
ok('una noche larga con manos recientes sigue abierta', (await mesa(g)).status === 'active', 'se cerró');
await db.query(`UPDATE public.poker_hands SET updated_at = now() - interval '7 hours' WHERE game_id='${g}'`);
await db.query(`SELECT public.auto_confirm_table_games()`);
ok('sin manos en 6 horas se anula', (await mesa(g)).status === 'cancelled', 'sigue abierta');

// Ranking y estadísticas
await db.exec(`DELETE FROM public.table_games; DELETE FROM public.notification_queue;`);
g = await nueva(A, [A, B, C], 200, 20);
await guardar(A, g, mano());
await guardar(A, g, cerrada({ winners: [{ seat: 1, amount: 60 }], bestHand: 'pair' }));
await guardar(A, g, mano({ number: 2 }));
await guardar(A, g, cerrada({ number: 2, winners: [{ seat: 1, amount: 60 }], bestHand: 'flush' }));
await guardar(A, g, mano({ number: 3, entrants: [0, 1], contributions: { 0: 20, 1: 20 } }));
await asiento(A, g, 3, 0, 20, true);
await guardar(A, g, mano({ number: 3, entrants: [0, 1], contributions: { 0: 20, 1: 20 }, folded: [0], status: 'closed', endType: 'fold', winners: [{ seat: 1, amount: 40 }] }));
await terminar(A, g, 1);
await responder(C, g, true);
const tabla = (await as('authenticated', X, `SELECT * FROM public.poker_ranking()`)).rows;
const de = (nombre) => tabla.find((t) => t.display_name === nombre);
ok('el ranking cuenta victorias', Number(de('B')?.wins) === 1 && tabla[0].display_name === 'B', JSON.stringify(tabla));
ok('cuenta las manos jugadas', Number(de('B').hands) === 3 && Number(de('C').hands) === 2, JSON.stringify(tabla));
ok('la mejor jugada es la más alta', de('B').best_hand === 'flush', JSON.stringify(de('B')));
ok('quien no ganó con cartas no tiene mejor jugada', de('C').best_hand === null, JSON.stringify(de('C')));
r = await as('authenticated', X, `SELECT * FROM public.poker_ranking(now() + interval '1 hour')`);
ok('filtra por período', r.rows?.length === 0, JSON.stringify(r));
r = await as('authenticated', X, `SELECT * FROM public.table_game_ranking('uno')`);
ok('el póker no entra en el ranking de UNO', r.rows?.length === 0, JSON.stringify(r));

fin();
