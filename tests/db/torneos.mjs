// Tournaments end to end on a local copy of the production database:
// paid (Bs) tournaments, points tournaments, duos, brackets, rounds, prizes and payouts.
import { ayudante, IDS } from './base.mjs';
import { crearCompleta, cuerpo } from './_completa.mjs';
import { sql } from './base.mjs';

const { A, B, C, D, X, ADM } = IDS;
const E = '55555555-5555-5555-5555-555555555555';
const F = '66666666-6666-6666-6666-666666666666';
const G = '77777777-7777-7777-7777-777777777777';
const H = '88888888-8888-8888-8888-888888888888';

const db = await crearCompleta();
const { ok, as, fin } = ayudante(db);
await db.exec(cuerpo('20261102_21_torneos.sql'));
const verif = sql('supabase/migrations/20261102_21_torneos.sql').split('-- VERIFICACIÓN')[1].split('\n').slice(2).join('\n');
const v = (await db.query(verif)).rows[0];
ok('el SQL 21 se puede pegar dos veces y su verificación sale en true', Object.values(v).every((x) => x === true), JSON.stringify(v));
await db.exec(`INSERT INTO public.profiles(id,display_name,initials,is_admin) VALUES
  ('${E}','E','E',false),('${F}','F','F',false),('${G}','G','G',false),('${H}','H','H',false);
  UPDATE public.profiles SET betting_points=1000;
  INSERT INTO public.push_subscriptions(endpoint,user_id,p256dh,auth) VALUES('https://push/h','${H}','k','a');`);

const one = async (q) => (await db.query(q)).rows[0];
const puntos = async (id) => Number((await one(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).p);
const torneo = (id) => one(`SELECT * FROM public.tournaments WHERE id='${id}'`);
const llaves = async (t, ronda) => (await db.query(`SELECT * FROM public.tournament_brackets WHERE tournament_id='${t}'${ronda ? ` AND round_number=${ronda}` : ''} ORDER BY round_number, match_number`)).rows;
const crear = (u, cols) => as('authenticated', u, `INSERT INTO public.tournaments(${Object.keys(cols).join(',')}) VALUES(${Object.values(cols).map((v) => (typeof v === 'string' ? `'${v}'` : v)).join(',')}) RETURNING id`);
const inscribirBs = (u, t, quien = u, estado = 'pending') => as('authenticated', u, `INSERT INTO public.tournament_participants(tournament_id,user_id,payment_reference,payment_receipt_url,payment_status) VALUES('${t}','${quien}','0102-${quien.slice(0, 4)}','https://x/receipts/${quien}.jpg','${estado}') RETURNING id`);
const inscripcion = (t, u) => one(`SELECT * FROM public.tournament_participants WHERE tournament_id='${t}' AND user_id='${u}'`);
// The admin's "Aprobar" / "Rechazar" buttons
const revisar = (adm, pid, si) => as('authenticated', adm, `SELECT public.review_tournament_payment('${pid}', ${si}) r`);
const aprobarBs = (adm, pid) => revisar(adm, pid, true);
const invitar = (u, t, p) => as('authenticated', u, `SELECT public.invite_tournament_partner('${t}','${p}') r`);
const responder = (u, t, si) => as('authenticated', u, `SELECT public.respond_tournament_partner('${t}',${si}) r`);
const iniciar = (u, t) => as('authenticated', u, `SELECT public.start_tournament('${t}') r`);
const unirse = (u, t) => as('authenticated', u, `SELECT public.join_tournament_with_points('${t}') r`);
const ganadores = (b) => (b.winner_team === 1 ? [b.team1_player1, b.team1_player2] : [b.team2_player1, b.team2_player2]);

// Plays a bracket's live match like the app: a winner closes it, a rival confirms
const jugar = async (b, g, opts = {}) => {
  const quien = g === 1 ? b.team1_player1 : b.team2_player1;
  const rival = g === 1 ? b.team2_player1 : b.team1_player1;
  const total = g === 1 ? 'team1_total=100, team2_total=45' : 'team2_total=100, team1_total=45';
  const cierre = await as('authenticated', quien, `UPDATE public.matches SET status='completed', winner_team=${g}, ${total},
    rounds='[{"points":55,"scorerId":"team${g}"},{"points":45,"scorerId":"team${g}"}]'::jsonb WHERE id='${b.live_match_id}' RETURNING status`);
  if (opts.sinConfirmar) return { cierre };
  const conf = await as('authenticated', opts.confirma || rival, `SELECT public.confirm_match_result('${b.live_match_id}')`);
  return { cierre, conf };
};

// =====================================================================
// 1. TORNEO PAGADO (Bs): 8 jugadores, 4 parejas, semifinal y final
// =====================================================================
let r = await crear(A, { name: 'Copa falsa', tournament_type: 'vip_cash', entry_fee: 50, max_participants: 8 });
ok('un socio normal no puede crear un torneo en Bs', !!r.err, JSON.stringify(r));

r = await crear(ADM, { name: 'Copa del Cafetín', tournament_type: 'vip_cash', entry_fee: 50, max_participants: 8, prize_pool: 99999, status: 'in_progress' });
ok('el admin crea el torneo en Bs', !r.err && r.rows?.length === 1, JSON.stringify(r));
const T1 = r.rows[0].id;
let t = await torneo(T1);
ok('nace en inscripción, con pozo 0 y a nombre del admin aunque la app mande otra cosa', t.status === 'registration' && Number(t.prize_pool) === 0 && t.created_by === ADM, JSON.stringify(t));

r = await inscribirBs(A, T1, A, 'approved');
ok('nadie se inscribe ya aprobado', !!r.err, JSON.stringify(r));
r = await inscribirBs(A, T1, B);
ok('nadie inscribe a otra persona', !!r.err, JSON.stringify(r));

const ocho = [A, B, C, D, E, F, G, H];
const pid = {};
for (const u of ocho) {
  r = await inscribirBs(u, T1);
  pid[u] = r.rows?.[0]?.id;
}
ok('los 8 suben referencia y comprobante y quedan "esperando aprobación"', Object.values(pid).every(Boolean) && (await inscripcion(T1, H)).payment_status === 'pending', JSON.stringify(pid));
r = await inscribirBs(A, T1);
ok('inscribirse dos veces da error de duplicado (la app dice "Ya estás registrado")', /duplicate|unique/i.test(r.err || ''), JSON.stringify(r));

r = await as('authenticated', A, `UPDATE public.tournament_participants SET payment_status='approved' WHERE id='${pid[A]}' RETURNING payment_status`);
ok('un jugador no puede aprobarse solo', (await inscripcion(T1, A)).payment_status === 'pending', JSON.stringify(r));
r = await as('authenticated', A, `UPDATE public.tournaments SET prize_pool=5000 WHERE id='${T1}' RETURNING id`);
ok('un jugador no puede tocar el pozo', Number((await torneo(T1)).prize_pool) === 0, JSON.stringify(r));

r = await revisar(A, pid[A], true);
ok('un jugador no puede usar el botón de aprobar', !!r.err && (await inscripcion(T1, A)).payment_status === 'pending', JSON.stringify(r));
for (const u of ocho.slice(0, 7)) await aprobarBs(ADM, pid[u]);
r = await aprobarBs(ADM, pid[A]);
ok('aprobar dos veces no suma dos veces al pozo', !!r.err && Number((await torneo(T1)).prize_pool) === 350, JSON.stringify(r));
t = await torneo(T1);
ok('el admin aprueba 7 pagos y el pozo sube a Bs 350', Number(t.prize_pool) === 350, String(t.prize_pool));
r = await iniciar(ADM, T1);
ok('con 7 no arranca: pide múltiplo de 8', r.rows?.[0]?.r?.reason === 'vip_needs_multiple_of_8', JSON.stringify(r));

// Rejecting and re-sending
r = await revisar(ADM, pid[H], false);
ok('el admin rechaza un pago y la inscripción se borra', !r.err && !(await inscripcion(T1, H)), JSON.stringify(r));
const aviso = await one(`SELECT title FROM public.notification_queue WHERE '${H}' = ANY(user_ids) ORDER BY created_at DESC LIMIT 1`).catch(() => null);
ok('al rechazado le llega el aviso', /rechazado/i.test(aviso?.title || ''), JSON.stringify(aviso));
r = await inscribirBs(H, T1);
ok('y puede volver a inscribirse con otro comprobante', !r.err && (await inscripcion(T1, H)).payment_status === 'pending', JSON.stringify(r));
pid[H] = r.rows?.[0]?.id;
await aprobarBs(ADM, pid[H]);
t = await torneo(T1);
ok('el octavo queda aprobado y el pozo es Bs 400', Number(t.prize_pool) === 400 && (await inscripcion(T1, H)).payment_status === 'approved', String(t.prize_pool));

// Duos
r = await invitar(A, T1, B);
ok('A invita a B', r.rows?.[0]?.r === 'sent', JSON.stringify(r));
ok('B ve la invitación pendiente', (await inscripcion(T1, B)).partner_status === 'pending');
r = await responder(B, T1, true);
ok('B acepta y el dúo queda confirmado', r.rows?.[0]?.r === 'confirmed' && (await inscripcion(T1, A)).partner_status === 'confirmed', JSON.stringify(r));
r = await invitar(C, T1, A);
ok('nadie se lleva a quien ya tiene pareja', !!r.err, JSON.stringify(r));
await invitar(C, T1, D);
r = await responder(D, T1, false);
ok('D puede rechazar', r.rows?.[0]?.r === 'rejected' && (await inscripcion(T1, C)).partner_id === null, JSON.stringify(r));
await invitar(C, T1, D);
r = await invitar(D, T1, C);
ok('si los dos se invitan, queda confirmado solo', r.rows?.[0]?.r === 'confirmed', JSON.stringify(r));

r = await iniciar(A, T1);
ok('un jugador no puede arrancar el torneo en Bs', !!r.err, JSON.stringify(r));
r = await iniciar(ADM, T1);
ok('el admin arranca: 4 equipos', r.rows?.[0]?.r?.started === true && r.rows[0].r.teams === 4, JSON.stringify(r));
t = await torneo(T1);
let semis = await llaves(T1, 1);
ok('queda "en curso" con 2 partidas en la ronda 1', t.status === 'in_progress' && semis.length === 2, JSON.stringify(semis.length));
const equipos = semis.flatMap((b) => [[b.team1_player1, b.team1_player2].sort().join(), [b.team2_player1, b.team2_player2].sort().join()]);
ok('los dúos que se eligieron se respetan', equipos.includes([A, B].sort().join()) && equipos.includes([C, D].sort().join()), JSON.stringify(equipos));
ok('cada llave tiene su partida en vivo', semis.every((b) => b.live_match_id), JSON.stringify(semis));
const vivo = await one(`SELECT * FROM public.matches WHERE id='${semis[0].live_match_id}'`);
ok('la partida en vivo es de equipos a 100, en 0-0, con los nombres de los 4', vivo.status === 'active' && vivo.limit_score === 100 && vivo.team1_total === 0 && vivo.players_json.length === 4 && vivo.players_json.every((p) => p.name), JSON.stringify(vivo.players_json));
r = await inscribirBs(X, T1);
ok('ya no se aceptan inscripciones nuevas', true && (await invitar(E, T1, F)).err, JSON.stringify(r));

// Live scoring: a player adds a round
const s0 = semis[0];
r = await as('authenticated', s0.team1_player1, `UPDATE public.matches SET team1_total=35, rounds='[{"points":35,"scorerId":"team1"}]'::jsonb WHERE id='${s0.live_match_id}' RETURNING team1_total`);
ok('un jugador anota una mano y el marcador queda 35-0', r.rows?.[0]?.team1_total === 35, JSON.stringify(r));
r = await as('authenticated', X, `UPDATE public.matches SET team2_total=99 WHERE id='${s0.live_match_id}' RETURNING id`);
ok('un espectador no puede tocar el marcador', !r.rows?.length, JSON.stringify(r));

// Semifinal 1
let j = await jugar(s0, 1, { sinConfirmar: true });
ok('al terminar la semifinal queda esperando que el rival confirme', j.cierre.rows?.[0]?.status === 'pending_confirmation', JSON.stringify(j));
ok('la llave todavía no tiene ganador', (await llaves(T1, 1))[0].winner_team === null);
r = await as('authenticated', s0.team1_player2, `SELECT public.confirm_match_result('${s0.live_match_id}')`);
ok('el compañero del ganador no puede confirmar', !!r.err, JSON.stringify(r));
r = await as('authenticated', s0.team2_player2, `SELECT public.confirm_match_result('${s0.live_match_id}')`);
ok('el rival confirma', !r.err, JSON.stringify(r));
semis = await llaves(T1, 1);
ok('la llave marca al ganador', semis[0].winner_team === 1, JSON.stringify(semis[0]));
ok('todavía no hay final (falta la otra semifinal)', (await llaves(T1, 2)).length === 0);

j = await jugar(semis[1], 2);
ok('la segunda semifinal se juega y se confirma', !j.conf.err, JSON.stringify(j));
let final = await llaves(T1, 2);
ok('la final se arma sola con los dos ganadores', final.length === 1 && final[0].live_match_id, JSON.stringify(final));
ok('los finalistas son los ganadores de cada semifinal',
  [final[0].team1_player1, final[0].team1_player2].sort().join() === ganadores(semis[0]).sort().join()
  && [final[0].team2_player1, final[0].team2_player2].sort().join() === ganadores(semis[1]).sort().join(), JSON.stringify(final[0]));

// Final: the admin confirms if the rival does not show up
j = await jugar(final[0], 2, { confirma: ADM });
ok('el admin también puede confirmar la final', !j.conf.err, JSON.stringify(j));
t = await torneo(T1);
final = await llaves(T1, 2);
ok('el torneo termina como "completado"', t.status === 'completed' && final[0].winner_team === 2, JSON.stringify(t));
const campeones = ganadores(final[0]);
const pts = await Promise.all(ocho.map(puntos));
ok('un torneo en Bs no toca los puntos de nadie', pts.every((p) => p === 1000), JSON.stringify(pts));

// Payout details (the winners' Pago Móvil)
const datos = JSON.stringify({ bank: 'Banesco', id: 'V-12345678', phone: '0414-1234567' });
r = await as('authenticated', campeones[0], `UPDATE public.tournament_participants SET payout_details='${datos}' WHERE tournament_id='${T1}' AND user_id='${campeones[0]}' RETURNING payout_details`);
ok('el campeón manda sus datos de Pago Móvil', JSON.parse(r.rows?.[0]?.payout_details || '{}').paid === false, JSON.stringify(r));
r = await as('authenticated', X, `SELECT payout_details FROM public.tournament_participants WHERE tournament_id='${T1}' AND user_id='${campeones[0]}'`);
ok('los demás no ven su banco ni su cédula', !String(r.rows?.[0]?.payout_details).includes('V-12345678'), JSON.stringify(r));
r = await as('authenticated', X, `SELECT * FROM public.tournament_payouts`);
ok('ni pueden leer la tabla de cobros', (r.rows || []).length === 0, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT details FROM public.tournament_payouts WHERE user_id='${campeones[0]}'`);
ok('el admin sí ve banco, cédula y teléfono', r.rows?.[0]?.details?.id === 'V-12345678', JSON.stringify(r));
r = await as('authenticated', campeones[0], `UPDATE public.tournament_participants SET payout_details='{"paid":true}' WHERE tournament_id='${T1}' AND user_id='${campeones[0]}' RETURNING payout_details`);
ok('el campeón no puede marcarse como pagado', JSON.parse(r.rows?.[0]?.payout_details || '{}').paid === false, JSON.stringify(r));
const det = (await as('authenticated', ADM, `SELECT details FROM public.tournament_payouts WHERE user_id='${campeones[0]}'`)).rows[0].details;
r = await as('authenticated', ADM, `UPDATE public.tournament_participants SET payout_details='${JSON.stringify({ ...det, paid: true })}' WHERE tournament_id='${T1}' AND user_id='${campeones[0]}' RETURNING payout_details`);
ok('el admin marca "pagado" y el campeón lo ve', JSON.parse(r.rows?.[0]?.payout_details || '{}').paid === true, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT details FROM public.tournament_payouts WHERE user_id='${campeones[0]}'`);
ok('y los datos de cobro se conservan', r.rows?.[0]?.details?.bank === 'Banesco', JSON.stringify(r));

// =====================================================================
// 2. TORNEO DE PUNTOS: 4 jugadores, 100 pts de entrada, lo crea un socio
// =====================================================================
await db.exec(`UPDATE public.profiles SET betting_points=1000; UPDATE public.profiles SET betting_points=50 WHERE id='${X}';`);
r = await crear(A, { name: 'Llaves del viernes', tournament_type: 'brackets', entry_points: 100, max_participants: 4 });
ok('un socio crea un torneo de puntos', !r.err, JSON.stringify(r));
const T2 = r.rows[0].id;
r = await unirse(X, T2);
ok('sin puntos suficientes no entra', !!r.err && (await puntos(X)) === 50, JSON.stringify(r));
for (const u of [A, B, C, D]) await unirse(u, T2);
ok('4 se inscriben y a cada uno le cobran 100', (await Promise.all([A, B, C, D].map(puntos))).every((p) => p === 900));
ok('el pozo queda en 400', Number((await torneo(T2)).prize_pool) === 400, String((await torneo(T2)).prize_pool));
ok('quedan aprobados de una vez', (await inscripcion(T2, D)).payment_status === 'approved');
r = await unirse(A, T2);
ok('no se puede pagar dos veces', !!r.err && (await puntos(A)) === 900, JSON.stringify(r));
await db.query(`UPDATE public.profiles SET betting_points=1000 WHERE id='${E}'`);
r = await unirse(E, T2);
ok('lleno: el quinto no entra ni pierde puntos', !!r.err && (await puntos(E)) === 1000, JSON.stringify(r));
r = await iniciar(B, T2);
ok('solo el creador o un admin lo arranca', !!r.err, JSON.stringify(r));
r = await iniciar(A, T2);
ok('el creador lo arranca con parejas al azar', r.rows?.[0]?.r?.started === true && r.rows[0].r.teams === 2, JSON.stringify(r));
let f2 = await llaves(T2);
ok('4 jugadores = una sola partida, que ya es la final', f2.length === 1 && f2[0].round_number === 1, JSON.stringify(f2.length));
await jugar(f2[0], 1);
t = await torneo(T2);
f2 = await llaves(T2);
const c2 = ganadores(f2[0]);
const perdedores2 = [A, B, C, D].filter((u) => !c2.includes(u));
ok('termina y queda pagado', t.status === 'completed' && t.prize_paid === true, JSON.stringify(t));
ok('cada campeón recibe la mitad del pozo (+200, queda en 1.100)', (await Promise.all(c2.map(puntos))).every((p) => p === 1100), JSON.stringify(await Promise.all(c2.map(puntos))));
ok('los perdedores se quedan en 900 (sin el +20 de partida normal)', (await Promise.all(perdedores2.map(puntos))).every((p) => p === 900));
r = await as('authenticated', A, `SELECT public.award_tournament_prize('${T2}') r`);
ok('pedir el premio otra vez no paga doble', (await Promise.all(c2.map(puntos))).every((p) => p === 1100), JSON.stringify(r));
const mov = await one(`SELECT count(*) n FROM public.points_ledger WHERE reason='Premio de torneo'`).catch(() => ({ n: -1 }));
ok('el historial de puntos registra el premio', Number(mov.n) >= 2, JSON.stringify(mov));

// =====================================================================
// 3. 6 JUGADORES: 3 equipos, uno pasa directo
// =====================================================================
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);
r = await crear(ADM, { name: 'Seis', tournament_type: 'brackets', entry_points: 0, max_participants: 8 });
const T3 = r.rows[0].id;
for (const u of [A, B, C, D, E, F]) await unirse(u, T3);
r = await iniciar(ADM, T3);
ok('6 jugadores arrancan como 3 equipos', r.rows?.[0]?.r?.teams === 3, JSON.stringify(r));
let r1 = await llaves(T3, 1);
const bye = r1.find((b) => !b.team2_player1);
ok('una partida y un pase directo ya ganado', r1.length === 2 && bye && bye.winner_team === 1 && !bye.live_match_id, JSON.stringify(r1));
await jugar(r1.find((b) => b.team2_player1), 1);
let r2 = await llaves(T3, 2);
ok('la final se arma con el ganador y el que pasó directo', r2.length === 1 && [r2[0].team1_player1, r2[0].team2_player1].some((p) => [bye.team1_player1, bye.team1_player2].includes(p)), JSON.stringify(r2));
await jugar(r2[0], 2);
ok('y termina', (await torneo(T3)).status === 'completed');

// =====================================================================
// 4. 5 JUGADORES: el impar queda fuera y le devuelven la entrada
// =====================================================================
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);
r = await crear(A, { name: 'Cinco', tournament_type: 'brackets', entry_points: 100, max_participants: 8 });
const T4 = r.rows[0].id;
for (const u of [A, B, C, D, E]) await unirse(u, T4);
r = await iniciar(A, T4);
const fuera = r.rows?.[0]?.r?.left_out;
ok('arranca con 2 equipos y uno queda fuera', r.rows?.[0]?.r?.teams === 2 && !!fuera, JSON.stringify(r));
ok('al que quedó fuera le devuelven sus 100', (await puntos(fuera)) === 1000, String(await puntos(fuera)));
ok('y el pozo baja a 400', Number((await torneo(T4)).prize_pool) === 400, String((await torneo(T4)).prize_pool));

// =====================================================================
// 5. SE ACABA EL TIEMPO DE INSCRIPCIÓN (5 minutos)
// =====================================================================
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);
r = await crear(A, { name: 'Vacío', tournament_type: 'brackets', entry_points: 100, max_participants: 8 });
const T5 = r.rows[0].id;
await unirse(A, T5);
await unirse(B, T5);
r = await as('authenticated', C, `SELECT public.expire_tournament_registration('${T5}') r`);
ok('antes de 5 minutos no pasa nada', r.rows?.[0]?.r?.action === 'none' && (await torneo(T5)).status === 'registration', JSON.stringify(r));
await db.query(`UPDATE public.tournaments SET created_at=now()-interval '6 minutes' WHERE id='${T5}'`);
r = await as('authenticated', C, `SELECT public.expire_tournament_registration('${T5}') r`);
ok('con menos de 4 se cancela', r.rows?.[0]?.r?.action === 'cancelled' && (await torneo(T5)).status === 'cancelled', JSON.stringify(r));
ok('y se devuelven las entradas', (await puntos(A)) === 1000 && (await puntos(B)) === 1000);

r = await crear(A, { name: 'Lleno a tiempo', tournament_type: 'brackets', entry_points: 0, max_participants: 8 });
const T6 = r.rows[0].id;
for (const u of [A, B, C, D]) await unirse(u, T6);
await db.query(`UPDATE public.tournaments SET created_at=now()-interval '6 minutes' WHERE id='${T6}'`);
r = await as('authenticated', X, `SELECT public.expire_tournament_registration('${T6}') r`);
ok('con 4 o más arranca solo al vencer el tiempo', r.rows?.[0]?.r?.action === 'started', JSON.stringify(r));

// Cancel and refund by the creator
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);
r = await crear(A, { name: 'Cancelado', tournament_type: 'brackets', entry_points: 100, max_participants: 8 });
const T7 = r.rows[0].id;
await unirse(B, T7);
r = await as('authenticated', C, `SELECT public.cancel_tournament_and_refund('${T7}')`);
ok('otro socio no puede cancelarlo', !!r.err && (await torneo(T7)).status === 'registration', JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.cancel_tournament_and_refund('${T7}')`);
ok('el creador lo cancela y se devuelve la entrada', !r.err && (await torneo(T7)).status === 'cancelled' && (await puntos(B)) === 1000, JSON.stringify(r));

// =====================================================================
// 6. LO QUE PUEDE TRABAR UN TORNEO
// =====================================================================
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);
r = await crear(ADM, { name: 'Abandonada', tournament_type: 'brackets', entry_points: 0, max_participants: 4 });
const T8 = r.rows[0].id;
for (const u of [A, B, C, D]) await unirse(u, T8);
await iniciar(ADM, T8);
const b8 = (await llaves(T8))[0];
await db.query(`UPDATE public.matches SET created_at=now()-interval '7 hours' WHERE id='${b8.live_match_id}'`);
await db.query(`SELECT public.cancel_abandoned_matches()`);
const m8 = await one(`SELECT status, winner_team FROM public.matches WHERE id='${b8.live_match_id}'`);
const t8 = await torneo(T8);
ok('una partida de torneo abandonada 6 horas queda cancelada y la llave sin ganador', m8.status === 'cancelled' && t8.status === 'in_progress', JSON.stringify({ m8, t8: t8.status }));
const decidir = (u, b, g) => as('authenticated', u, `SELECT public.admin_decide_tournament_match('${b}', ${g}) r`);
r = await decidir(A, b8.id, 1);
ok('un jugador no puede decidir la llave', !!r.err, JSON.stringify(r));
r = await decidir(ADM, b8.id, 1);
ok('el admin decide la llave y el torneo termina', !r.err && (await torneo(T8)).status === 'completed' && (await llaves(T8))[0].winner_team === 1, JSON.stringify(r));
r = await decidir(ADM, b8.id, 2);
ok('una llave decidida no se cambia', !!r.err, JSON.stringify(r));

r = await crear(ADM, { name: 'Sin confirmar', tournament_type: 'brackets', entry_points: 0, max_participants: 4 });
const T9 = r.rows[0].id;
for (const u of [A, B, C, D]) await unirse(u, T9);
await iniciar(ADM, T9);
const b9 = (await llaves(T9))[0];
await jugar(b9, 1, { sinConfirmar: true });
await db.query(`UPDATE public.matches SET closed_at=now()-interval '1 hour' WHERE id='${b9.live_match_id}'`);
await db.query(`SELECT public.auto_confirm_expired_matches()`);
ok('si el rival nunca confirma, sigue esperando (hay algo en juego)', (await one(`SELECT status FROM public.matches WHERE id='${b9.live_match_id}'`)).status === 'pending_confirmation');
r = await decidir(ADM, b9.id, 2);
const m9 = await one(`SELECT status, winner_team, confirmed_by FROM public.matches WHERE id='${b9.live_match_id}'`);
ok('el admin decide: la partida queda cerrada con su decisión', !r.err && m9.status === 'completed' && m9.winner_team === 2 && m9.confirmed_by === ADM, JSON.stringify({ r, m9 }));
ok('y el torneo termina', (await torneo(T9)).status === 'completed');

// Bets on a tournament match are paid when the admin decides it
await db.exec(`UPDATE public.profiles SET betting_points=1000;`);
r = await crear(ADM, { name: 'Con apuestas', tournament_type: 'brackets', entry_points: 0, max_participants: 4 });
const T10 = r.rows[0].id;
for (const u of [A, B, C, D]) await unirse(u, T10);
await iniciar(ADM, T10);
const b10 = (await llaves(T10))[0];
r = await as('authenticated', X, `SELECT public.place_bet('${b10.live_match_id}', 1, 100) r`);
ok('un espectador apuesta en una partida del torneo', !r.err && (await puntos(X)) === 900, JSON.stringify(r));
await decidir(ADM, b10.id, 1);
const ap = await one(`SELECT status FROM public.bets WHERE match_id='${b10.live_match_id}'`);
ok('al decidir el admin, la apuesta se paga', ap.status === 'won' && (await puntos(X)) > 900, JSON.stringify({ ap, x: await puntos(X) }));

fin();
