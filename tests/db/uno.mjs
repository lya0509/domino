import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X, ADM } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

const cuerpo = (f) => sql(`supabase/migrations/${f}`).split('-- VERIFICACIÓN')[0].replace(/-- =+\s*$/, '');
for (const f of ['20261101_01_confirmacion_rival.sql', '20261101_02_seguridad_servidor.sql', '20261101_03_rachas.sql', '20261101_04_puntos.sql', '20261101_06_partidas_abandonadas.sql', '20261101_07_cola_diaria.sql', '20261101_08_confirmacion_todas.sql', '20261101_09_confirmacion_1_minuto.sql']) {
  await db.exec(cuerpo(f));
}
// pg_net can't load here: this stand-in only has to exist
await db.exec(`CREATE SCHEMA net;
  CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
await db.exec(cuerpo('20261101_10_notificaciones_push.sql').replace('CREATE EXTENSION IF NOT EXISTS pg_net;', ''));
await db.exec(cuerpo('20261101_11_direccion_send_push.sql'));
await db.exec(cuerpo('20261101_12_aviso_turno_antes_del_limite.sql'));
// Supabase hands new tables and functions to these roles unless the migration takes them back
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;`);
const mig = cuerpo('20261101_13_uno.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);

for (const u of [A, B, C, D, X]) await as('authenticated', u, `SELECT public.save_push_subscription('https://push/${u}','k','a')`);
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);

let n = 0;
const nuevoId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const reg = (...ids) => JSON.stringify(ids.map((id) => (id.length > 30 ? { user_id: id } : { name: id })));
const empezar = (u, jugadores, juego = 'uno', id = nuevoId()) =>
  as('authenticated', u, `SELECT public.start_table_game('${id}','${juego}','${jugadores}'::jsonb) AS id`);
const nueva = async (u, ids, juego = 'uno') => (await empezar(u, reg(...ids), juego)).rows[0].id;
const terminar = (u, id, silla) => as('authenticated', u, `SELECT public.finish_table_game('${id}',${silla}) AS estado`);
const responder = (u, id, deAcuerdo) => as('authenticated', u, `SELECT public.answer_table_game('${id}',${deAcuerdo}) AS hecho`);
const mesa = async (id) => (await db.query(`SELECT * FROM public.table_games WHERE id='${id}'`)).rows[0];
const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
const movimientos = async (id, reason) => (await db.query(`SELECT delta FROM public.points_ledger WHERE user_id='${id}' AND reason='${reason}'`)).rows;
const racha = async (id) => (await db.query(`SELECT streak_count s FROM public.profiles WHERE id='${id}'`)).rows[0].s;
const avisos = async () => (await db.query(`SELECT * FROM public.notification_queue ORDER BY created_at`)).rows;
const vaciarAvisos = () => db.exec(`DELETE FROM public.notification_queue;`);
const reiniciar = () => db.exec(`DELETE FROM public.table_games; UPDATE public.profiles SET betting_points=1000, streak_count=0, last_streak_update_at=NULL; DELETE FROM public.notification_queue;`);
let r;

// Quién puede empezar y con qué jugadores
r = await as('anon', null, `SELECT public.start_table_game('${nuevoId()}','uno','${reg(A, B)}'::jsonb)`);
ok('sin sesión no se empieza', !!r.err, JSON.stringify(r));
r = await empezar(A, reg(A));
ok('hacen falta al menos 2 jugadores', /2 a 10/.test(r.err || ''), JSON.stringify(r));
r = await empezar(A, reg(...Array.from({ length: 11 }, (_, i) => `J${i}`)));
ok('no caben más de 10', /2 a 10/.test(r.err || ''), JSON.stringify(r));
r = await empezar(A, reg(A, A));
ok('un jugador no se repite', /repetido/.test(r.err || ''), JSON.stringify(r));
r = await empezar(A, reg(A, B), 'parchis');
ok('solo juegos conocidos', /juego/i.test(r.err || ''), JSON.stringify(r));
r = await empezar(A, JSON.stringify([{ user_id: A }, { name: '   ' }]));
ok('el invitado necesita nombre', /nombre/i.test(r.err || ''), JSON.stringify(r));
r = await empezar(A, JSON.stringify([{ user_id: A }, { user_id: 'aaaaaaaa-0000-4000-8000-000000000000' }]));
ok('un usuario inexistente no entra', !!r.err, JSON.stringify(r));

const forjada = await empezar(A, JSON.stringify([{ user_id: B, name: 'Mentira' }, { user_id: A }]));
const nombre = (await db.query(`SELECT name FROM public.table_game_players WHERE game_id='${forjada.rows[0].id}' AND seat=0`)).rows[0].name;
ok('el nombre de un registrado lo pone el servidor', nombre === 'B', nombre);

const fija = nuevoId();
await empezar(A, reg(A, B, C), 'uno_flip', fija);
r = await empezar(A, reg(A, B, C), 'uno_flip', fija);
const copias = (await db.query(`SELECT count(*)::int c FROM public.table_game_players WHERE game_id='${fija}'`)).rows[0].c;
ok('reenviar el mismo inicio sin internet no duplica', !r.err && r.rows[0].id === fija && copias === 3, JSON.stringify([r, copias]));

// Solo por las funciones
r = await as('authenticated', A, `UPDATE public.table_games SET status='completed' WHERE id='${fija}'`);
ok('nadie edita la partida directo', !!r.err || r.n === 0, JSON.stringify(r));
r = await as('authenticated', A, `INSERT INTO public.table_games(game) VALUES('uno')`);
ok('nadie crea la partida directo', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `DELETE FROM public.table_game_players WHERE game_id='${fija}'`);
ok('nadie borra jugadores directo', !!r.err || r.n === 0, JSON.stringify(r));
r = await as('authenticated', X, `SELECT id FROM public.table_games WHERE id='${fija}'`);
ok('con sesión se ve en vivo', r.rows?.length === 1, JSON.stringify(r));
r = await as('authenticated', X, `SELECT * FROM public.table_game_prizes`);
ok('los premios no se leen desde la app', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public._complete_table_game('${fija}')`);
ok('nadie se paga llamando la función interna', !!r.err, JSON.stringify(r));
r = await as('anon', null, `SELECT public.finish_table_game('${fija}',0)`);
ok('sin sesión no se termina', !!r.err, JSON.stringify(r));

// Terminar y confirmar
await reiniciar();
let g = await nueva(A, [A, B, C]);
r = await terminar(X, g, 0);
ok('un extraño no termina la partida', /mesa/.test(r.err || ''), JSON.stringify(r));
r = await terminar(A, g, 7);
ok('el ganador debe estar en la partida', /ganador/i.test(r.err || ''), JSON.stringify(r));
await vaciarAvisos();
r = await terminar(A, g, 0);
let fila = await mesa(g);
ok('al terminar espera confirmación de otro jugador', r.rows?.[0]?.estado === 'pending_confirmation' && fila.status === 'pending_confirmation', JSON.stringify([r, fila]));
ok('con cuenta regresiva de un minuto', Math.abs(new Date(fila.auto_confirm_at) - Date.now() - 60000) < 5000, String(fila.auto_confirm_at));
ok('todavía no se paga', (await puntos(A)) === 1000, String(await puntos(A)));
const aviso = (await avisos()).at(-1);
ok('se avisa a los otros jugadores, no a quien terminó', aviso?.title === '🏁 Confirma el resultado' && [...aviso.user_ids].sort().join() === [B, C].sort().join(), JSON.stringify(aviso));
r = await terminar(A, g, 0);
ok('reenviar el mismo final no cambia nada', r.rows?.[0]?.estado === 'pending_confirmation', JSON.stringify(r));
r = await terminar(A, g, 1);
ok('no se cambia el ganador ya enviado', !!r.err, JSON.stringify(r));
r = await responder(A, g, true);
ok('quien terminó no se confirma solo', /otro jugador/.test(r.err || ''), JSON.stringify(r));
r = await responder(X, g, true);
ok('un extraño no confirma', /otro jugador/.test(r.err || ''), JSON.stringify(r));
r = await responder(B, g, true);
fila = await mesa(g);
ok('otro jugador confirma', r.rows?.[0]?.hecho === true && fila.status === 'completed', JSON.stringify([r, fila]));
ok('el ganador recibe +20', (await puntos(A)) === 1020, String(await puntos(A)));
ok('y queda en el historial', (await movimientos(A, 'Premio por ganar')).length === 1, 'sin movimiento');
ok('los demás no reciben premio', (await puntos(B)) === 1000 && (await puntos(C)) === 1000, 'B o C cobró');
ok('la racha cuenta para todos los que jugaron', (await racha(A)) === 1 && (await racha(B)) === 1 && (await racha(C)) === 1, 'racha sin contar');
r = await responder(C, g, false);
ok('una partida cerrada ya no se reabre', r.rows?.[0]?.hecho === false && (await mesa(g)).status === 'completed' && (await puntos(A)) === 1020, JSON.stringify(r));

// No estar de acuerdo
await reiniciar();
g = await nueva(A, [A, B, C]);
await terminar(A, g, 0);
await vaciarAvisos();
r = await responder(B, g, false);
fila = await mesa(g);
ok('si no está de acuerdo vuelve a jugarse', r.rows?.[0]?.hecho === true && fila.status === 'active' && fila.winner_seat === null && !!fila.disputed_at, JSON.stringify([r, fila]));
ok('sin pagar', (await puntos(A)) === 1000, String(await puntos(A)));
const reabierta = (await avisos()).at(-1);
ok('se le avisa a quien terminó', reabierta?.title === '🔁 Partida reabierta' && reabierta.user_ids.join() === A, JSON.stringify(reabierta));
await terminar(C, g, 1);
await responder(A, g, true);
ok('se corrige y gana el correcto', (await mesa(g)).winner_seat === 1 && (await puntos(B)) === 1020 && (await puntos(A)) === 1000, 'no se corrigió');

// La cuenta llega a cero
await reiniciar();
g = await nueva(A, [A, B, C]);
await terminar(A, g, 0);
r = await as('authenticated', X, `SELECT public.finish_expired_table_game('${g}') AS hecho`);
ok('antes de tiempo no se cierra', r.rows?.[0]?.hecho === false && (await mesa(g)).status === 'pending_confirmation', JSON.stringify(r));
await db.query(`UPDATE public.table_games SET auto_confirm_at = now() - interval '1 second' WHERE id='${g}'`);
r = await as('authenticated', X, `SELECT public.finish_expired_table_game('${g}') AS hecho`);
ok('a cero se cierra sola y paga', r.rows?.[0]?.hecho === true && (await mesa(g)).status === 'completed' && (await puntos(A)) === 1020, JSON.stringify(r));
const otra = await nueva(A, [A, B, C]);
await terminar(A, otra, 1);
await db.query(`UPDATE public.table_games SET auto_confirm_at = now() - interval '1 second' WHERE id='${otra}'`);
await db.query(`SELECT public.auto_confirm_table_games()`);
ok('si nadie abre la app la cierra el servidor', (await mesa(otra)).status === 'completed' && (await puntos(B)) === 1020, 'sin cerrar');
r = await as('authenticated', A, `SELECT public.auto_confirm_table_games()`);
ok('esa tarea no se llama desde la app', !!r.err, JSON.stringify(r));

// Premio: mínimo 3 registrados
await reiniciar();
g = await nueva(A, [A, B, 'Pedro']);
await terminar(A, g, 0);
await responder(B, g, true);
ok('con 2 registrados no hay premio', (await mesa(g)).status === 'completed' && (await puntos(A)) === 1000, String(await puntos(A)));
g = await nueva(A, [A, B, C, 'Pedro']);
await terminar(A, g, 3);
await responder(B, g, true);
ok('si gana quien no tiene cuenta nadie cobra', (await mesa(g)).status === 'completed' && (await puntos(A)) === 1000 && (await puntos(B)) === 1000, 'alguien cobró');
g = await nueva(A, [A, 'Pedro', 'María']);
r = await terminar(A, g, 0);
ok('sin nadie más con cuenta se cierra de una, sin premio', r.rows?.[0]?.estado === 'completed' && (await puntos(A)) === 1000, JSON.stringify(r));

// Tope de 3 al día entre todos los juegos
await reiniciar();
for (let i = 0; i < 4; i++) {
  const u = await nueva(A, [A, B, C], i % 2 ? 'uno_no_mercy' : 'uno');
  await terminar(A, u, 0);
  await responder(B, u, true);
}
ok('máximo 3 premios al día', (await puntos(A)) === 1060, String(await puntos(A)));
const dominoId = (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds,team1_total) VALUES('active','${A}','${B}','${C}','${D}','${A}','[{"points":100,"scorerId":"team1"}]'::jsonb,100) RETURNING id`)).rows[0].id;
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=1 WHERE id='${dominoId}'`);
await as('authenticated', C, `SELECT public.confirm_match_result('${dominoId}')`);
ok('el tope se comparte con el dominó', (await puntos(A)) === 1060 && (await puntos(B)) === 1020, `${await puntos(A)} ${await puntos(B)}`);
await db.exec(`DELETE FROM public.matches WHERE id='${dominoId}'`);

// Anular
await reiniciar();
g = await nueva(A, [A, B, C]);
r = await as('authenticated', X, `SELECT public.cancel_table_game('${g}')`);
ok('un extraño no anula', /mesa/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', B, `SELECT public.cancel_table_game('${g}')`);
ok('un jugador anula sin premio', !r.err && (await mesa(g)).status === 'cancelled' && (await puntos(A)) === 1000, JSON.stringify(r));
r = await terminar(A, g, 0);
ok('una anulada no se termina', !!r.err, JSON.stringify(r));
g = await nueva(A, [A, B, C]);
await terminar(A, g, 0);
r = await as('authenticated', A, `SELECT public.cancel_table_game('${g}')`);
ok('tampoco se anula para evitar un resultado enviado', !!r.err && (await mesa(g)).status === 'pending_confirmation', JSON.stringify(r));
const vieja = await nueva(A, [A, B, C]);
await db.query(`UPDATE public.table_games SET created_at = now() - interval '7 hours' WHERE id='${vieja}'`);
await db.query(`SELECT public.auto_confirm_table_games()`);
ok('una abandonada se cierra sola a las 6 horas', (await mesa(vieja)).status === 'cancelled', 'sigue abierta');

// Ranking por variante
await reiniciar();
const jugar = async (juego, silla) => {
  const u = await nueva(A, [A, B, C], juego);
  await terminar(A, u, silla);
  await responder(B, u, true);
  return u;
};
await jugar('uno', 0);
await jugar('uno', 0);
await jugar('uno', 1);
await jugar('uno_flip', 2);
const sinTerminar = await nueva(A, [A, B, C]);
const ranking = async (juego, desde = 'NULL') => (await as('authenticated', X, `SELECT * FROM public.table_game_ranking('${juego}',${desde})`)).rows;
let tabla = await ranking('uno');
ok('el ranking ordena por victorias', tabla[0]?.display_name === 'A' && Number(tabla[0].wins) === 2 && Number(tabla[0].played) === 3 && tabla[1]?.display_name === 'B', JSON.stringify(tabla));
ok('quien no ha ganado también aparece', Number(tabla.at(-1).wins) === 0 && tabla.at(-1).display_name === 'C', JSON.stringify(tabla));
tabla = await ranking('uno_flip');
ok('cada variante tiene su ranking', tabla[0]?.display_name === 'C' && Number(tabla[0].played) === 1, JSON.stringify(tabla));
tabla = await ranking('uno', `now() + interval '1 hour'`);
ok('filtra por período', tabla.length === 0, JSON.stringify(tabla));
await as('authenticated', A, `SELECT public.cancel_table_game('${sinTerminar}')`);
await db.exec(`INSERT INTO public.table_game_players(game_id,seat,name) VALUES('${sinTerminar}',3,'Pedro')`);
ok('los invitados no salen en el ranking', !(await ranking('uno')).some((f) => f.display_name === 'Pedro'), 'salió Pedro');

// Avisos al empezar
await reiniciar();
g = await nueva(A, [A, B, C], 'uno_flip');
const empezo = (await avisos()).at(-1);
ok('el resto del club se entera, los de la mesa no', empezo?.title === '🃏 Ya están jugando' && /UNO Flip/.test(empezo.body) && [...empezo.user_ids].sort().join() === [D, X].sort().join(), JSON.stringify(empezo));

// Eliminar cuenta
await reiniciar();
g = await nueva(A, [A, B, D]);
await terminar(A, g, 2);
await responder(B, g, true);
await db.exec(`DELETE FROM public.profiles WHERE id='${D}'`);
const silla = (await db.query(`SELECT user_id, name FROM public.table_game_players WHERE game_id='${g}' AND seat=2`)).rows[0];
ok('al eliminar una cuenta la partida guarda el nombre', silla.user_id === null && silla.name === 'D', JSON.stringify(silla));
await db.exec(`INSERT INTO public.profiles(id,display_name,initials) VALUES('${D}','D','D');`);
g = await nueva(D, [A, B, C]);
await db.exec(`DELETE FROM public.profiles WHERE id='${D}'`);
r = await terminar(X, g, 0);
ok('sin creador, un extraño tampoco termina la partida', /mesa/.test(r.err || '') && (await mesa(g)).status === 'active', JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.cancel_table_game('${g}')`);
ok('ni la anula', /mesa/.test(r.err || '') && (await mesa(g)).status === 'active', JSON.stringify(r));

fin();
