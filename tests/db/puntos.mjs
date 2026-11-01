import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X, ADM } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

await db.exec(sql('supabase/migrations/20261101_01_confirmacion_rival.sql'));
await db.exec(sql('supabase/migrations/20261101_02_seguridad_servidor.sql'));
await db.exec(sql('supabase/migrations/20261101_03_rachas.sql'));

const puntos = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
const partida = async (extraC = '', extraV = '') => (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds,team1_total${extraC}) VALUES('active','${A}','${B}','${C}','${D}','${A}','[{"points":100,"scorerId":"team1"}]'::jsonb,0${extraV}) RETURNING id`)).rows[0].id;
const cerrar = (u, id, ganador = 1) => as('authenticated', u, `UPDATE public.matches SET status='completed', winner_team=${ganador} WHERE id='${id}' RETURNING status`);

// ANTES: reproduce que hoy no hay límite ni premio
await db.query(`UPDATE public.profiles SET betting_points=2000`);
let m = await partida();
let r = await as('authenticated', X, `SELECT public.place_bet('${m}',1,600)`);
ok('ANTES: se apuestan más de 500 en una partida', !r.err, JSON.stringify(r));
m = await partida();
await cerrar(A, m);
ok('ANTES: ganar no paga premio', (await puntos(A)) === 2000, String(await puntos(A)));

await db.exec(`DELETE FROM public.bets; DELETE FROM public.matches; UPDATE public.profiles SET betting_points=1000;`);
await db.query(`UPDATE public.profiles SET betting_points=777 WHERE id='${D}'`);
const mig = sql('supabase/migrations/20261101_04_puntos.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);

const historial = async (id) => (await db.query(`SELECT delta, balance, reason FROM public.points_ledger WHERE user_id='${id}' ORDER BY created_at`)).rows.map((x) => ({ d: Number(x.delta), b: Number(x.balance), r: x.reason }));
const motivos = async (id) => (await historial(id)).map((x) => x.r);
const inicial = await db.query(`SELECT count(*)::int n FROM public.points_ledger WHERE reason='Saldo inicial'`);
ok('todos arrancan con un movimiento inicial', inicial.rows[0].n === 6, JSON.stringify(inicial.rows));
ok('igual a su saldo actual', (await historial(D))[0].d === 777 && (await puntos(D)) === 777, JSON.stringify(await historial(D)));
ok('los saldos no cambiaron', (await puntos(A)) === 1000);

// Apuestas
m = await partida();
r = await as('authenticated', X, `SELECT public.place_bet('${m}',1,300) r`);
ok('apostar descuenta el saldo', !r.err && (await puntos(X)) === 700, JSON.stringify(r));
ok('y queda en el historial', (await historial(X)).at(-1).d === -300 && (await historial(X)).at(-1).r === 'Apuesta', JSON.stringify(await historial(X)));
r = await as('authenticated', X, `SELECT public.place_bet('${m}',2,10) r`);
ok('no se apuesta a los dos lados', /otro equipo/.test(r.err || ''), JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.place_bet('${m}',1,201) r`);
ok('la suma por persona y partida no pasa de 500', /Límite/.test(r.err || '') && (await puntos(X)) === 700, JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.place_bet('${m}',1,200) r`);
ok('justo 500 sí se puede', !r.err, JSON.stringify(r));
await db.query(`UPDATE public.profiles SET betting_points=5000 WHERE id='${ADM}'`);
r = await as('authenticated', ADM, `SELECT public.place_bet('${m}',1,501) r`);
ok('tampoco de una sola vez', /Límite/.test(r.err || ''), JSON.stringify(r));
await db.query(`UPDATE public.system_config SET max_bet_per_match=500`);
await db.exec(`INSERT INTO public.system_config(id,max_bet_per_match) VALUES(1,1000) ON CONFLICT (id) DO UPDATE SET max_bet_per_match=1000;`);
r = await as('authenticated', ADM, `SELECT public.place_bet('${m}',1,501) r`);
ok('el límite se puede ajustar', !r.err, JSON.stringify(r));
await db.exec(`DELETE FROM public.system_config;`);
await db.query(`UPDATE public.profiles SET betting_points=100 WHERE id='${C}'`);
r = await as('authenticated', C, `SELECT public.place_bet('${m}',2,101) r`);
ok('no se apuesta más que el saldo', /Saldo insuficiente/.test(r.err || ''), JSON.stringify(r));
await db.query(`UPDATE public.matches SET team1_total=50 WHERE id='${m}'`);
r = await as('authenticated', D, `SELECT public.place_bet('${m}',2,10) r`);
ok('desde 50 puntos no se apuesta', /cerradas/.test(r.err || ''), JSON.stringify(r));

await cerrar(A, m);
const antes = await puntos(X);
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
const multiplicado = (await historial(X)).at(-1);
ok('la apuesta ganada paga y queda en el historial', (await puntos(X)) > antes && multiplicado.r === 'Resultado de apuesta', JSON.stringify(multiplicado));
ok('el historial cuadra con el saldo', multiplicado.b === (await puntos(X)), JSON.stringify(multiplicado));
const estados = (await db.query(`SELECT DISTINCT status FROM public.bets WHERE match_id='${m}'`)).rows.map((x) => x.status);
ok('todas las apuestas quedan resueltas', JSON.stringify(estados) === '["won"]', JSON.stringify(estados));

// Premio por ganar
await db.exec(`UPDATE public.profiles SET betting_points=1000; DELETE FROM public.match_prizes;`);
m = await partida();
await cerrar(A, m);
ok('ganar paga +20 a cada miembro del dúo', (await puntos(A)) === 1020 && (await puntos(B)) === 1020, JSON.stringify([await puntos(A), await puntos(B)]));
ok('perder no paga', (await puntos(C)) === 1000);
ok('el premio se ve en el historial', (await motivos(A)).at(-1) === 'Premio por ganar', JSON.stringify(await motivos(A)));
await as('authenticated', A, `UPDATE public.matches SET status='completed' WHERE id='${m}'`);
ok('no se cobra dos veces', (await puntos(A)) === 1020, String(await puntos(A)));
await cerrar(A, await partida());
await cerrar(A, await partida());
ok('tres premios en un día', (await puntos(A)) === 1060, String(await puntos(A)));
await cerrar(A, await partida());
ok('el cuarto no paga', (await puntos(A)) === 1060, String(await puntos(A)));
const dia = (await db.query(`SELECT public._club_day(now())::text d`)).rows[0].d;
await db.query(`UPDATE public.match_prizes SET club_day = '${dia}'::date - 1`);
await cerrar(A, await partida());
ok('al día siguiente vuelve a pagar', (await puntos(A)) === 1080, String(await puntos(A)));

// Quién no cobra
await db.exec(`UPDATE public.profiles SET betting_points=1000; DELETE FROM public.match_prizes;`);
const t = (await db.query(`INSERT INTO public.tournaments(name,status) VALUES('t','in_progress') RETURNING id`)).rows[0].id;
m = await partida(',tournament_id', `,'${t}'`);
await cerrar(A, m);
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('el torneo no paga +20', (await puntos(A)) === 1000, String(await puntos(A)));
m = await partida();
await as('authenticated', A, `UPDATE public.matches SET team2_player2=NULL WHERE id='${m}'`);
await cerrar(A, m);
ok('con un invitado en la mesa no hay premio', (await puntos(A)) === 1000, String(await puntos(A)));
m = (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds) VALUES('active','${A}','${B}','${C}','${D}','${A}','[]'::jsonb) RETURNING id`)).rows[0].id;
await cerrar(A, m);
ok('una partida sin manos no paga', (await puntos(A)) === 1000, String(await puntos(A)));
m = await partida();
await as('authenticated', A, `UPDATE public.matches SET status='completed', winner_team=NULL WHERE id='${m}'`);
ok('una partida anulada no paga', (await puntos(A)) === 1000, String(await puntos(A)));

// Con confirmación, el premio llega al confirmar
m = await partida(',is_wager_match,wager_amount', ',true,100');
await cerrar(A, m);
ok('por confirmar no hay premio', (await puntos(A)) === 1000, String(await puntos(A)));
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('al confirmar sí, junto con el Duelo', (await puntos(A)) === 1120, String(await puntos(A)));
ok('cada cosa con su motivo', JSON.stringify((await motivos(A)).slice(-2).sort()) === '["Duelo VIP","Premio por ganar"]', JSON.stringify(await motivos(A)));

// Corrección
await db.exec(`UPDATE public.profiles SET betting_points=1000; DELETE FROM public.match_prizes;`);
m = await partida();
await cerrar(A, m);
ok('premio pagado', (await puntos(A)) === 1020);
await db.query(`UPDATE public.matches SET winner_team=2 WHERE id='${m}'`);
ok('al corregir el ganador se revierte', (await puntos(A)) === 1000, String(await puntos(A)));
ok('con un movimiento visible', (await motivos(A)).at(-1) === 'Premio revertido por corrección', JSON.stringify(await motivos(A)));
ok('y cobra el ganador correcto', (await puntos(C)) === 1020, String(await puntos(C)));

// Permisos
r = await as('authenticated', A, `SELECT reason FROM public.points_ledger WHERE user_id='${B}'`);
ok('nadie lee el historial de otro', r.rows?.length === 0, JSON.stringify(r));
r = await as('authenticated', A, `SELECT reason FROM public.points_ledger`);
ok('cada quien lee el suyo', r.rows?.length > 0, JSON.stringify(r));
r = await as('authenticated', ADM, `SELECT reason FROM public.points_ledger WHERE user_id='${B}'`);
ok('un admin puede revisarlo', r.rows?.length > 0, JSON.stringify(r));
r = await as('anon', null, `SELECT reason FROM public.points_ledger`);
ok('sin sesión no', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `INSERT INTO public.points_ledger(user_id,delta,balance,reason) VALUES('${A}',1,1,'x')`);
ok('nadie escribe en el historial', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `DELETE FROM public.points_ledger WHERE user_id='${A}' RETURNING id`);
ok('nadie lo borra', !!r.err, JSON.stringify(r));
r = await as('authenticated', A, `SELECT * FROM public.match_prizes`);
ok('la tabla de premios no se toca desde la app', !!r.err, JSON.stringify(r));

// Tienda, y un usuario nuevo
await db.exec(`UPDATE public.profiles SET betting_points=100000 WHERE id='${X}';`);
r = await as('authenticated', X, `SELECT public.buy_store_item('title_rey') r`);
ok('comprar en la tienda queda en el historial', (await motivos(X)).at(-1) === 'Compra en la tienda', JSON.stringify([r, await motivos(X)]));
await db.query(`INSERT INTO public.profiles(id,display_name,initials,betting_points) VALUES('77777777-7777-7777-7777-777777777777','N','N',500)`);
const nuevo = await historial('77777777-7777-7777-7777-777777777777');
ok('un usuario nuevo también arranca con su saldo', nuevo.length === 1 && nuevo[0].d === 500 && nuevo[0].r === 'Saldo inicial', JSON.stringify(nuevo));

fin();
