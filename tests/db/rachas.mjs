import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D, X } = IDS;
const db = await crearBase();
const { ok, as, fin } = ayudante(db);

await db.exec(sql('supabase/migrations/20261101_01_confirmacion_rival.sql'));
await db.exec(sql('supabase/migrations/20261101_02_seguridad_servidor.sql'));

// ANTES: reproduce que la app escribe la racha sin jugar
let r = await as('authenticated', X, `UPDATE public.profiles SET streak_count=99 WHERE id='${X}' RETURNING streak_count`);
ok('ANTES: entrar a la app podía cambiar la racha', r.rows?.[0]?.streak_count === 99, JSON.stringify(r));
await db.query(`UPDATE public.profiles SET streak_count=0`);

const mig = sql('supabase/migrations/20261101_03_rachas.sql');
await db.exec(mig);
await db.exec(mig);
ok('la migración se puede repetir', true);

const hoy = (await db.query(`SELECT public._club_day(now())::text d`)).rows[0].d;
const racha = async (id) => (await db.query(`SELECT streak_count s, last_streak_update_at::text l FROM public.profiles WHERE id='${id}'`)).rows[0];
const partida = async (rondas = `'[{"points":100,"scorerId":"team1"}]'`) => (await db.query(`INSERT INTO public.matches(status,team1_player1,team1_player2,team2_player1,team2_player2,created_by,rounds) VALUES('active','${A}','${B}','${C}','${D}','${A}',${rondas}::jsonb) RETURNING id`)).rows[0].id;
const cerrar = (u, id) => as('authenticated', u, `UPDATE public.matches SET status='completed', winner_team=1 WHERE id='${id}' RETURNING status`);
const continua = async (ultimo, hoyF) => (await db.query(`SELECT public._streak_continues('${ultimo}','${hoyF}') c`)).rows[0].c;

r = await as('authenticated', X, `UPDATE public.profiles SET streak_count=99 WHERE id='${X}' RETURNING streak_count`);
ok('nadie cambia su racha desde la app', r.rows?.[0]?.streak_count === 0, JSON.stringify(r));
r = await as('authenticated', A, `SELECT public.update_player_streaks_for_match('${await partida()}')`);
ok('la app no ejecuta la racha directamente', !!r.err, JSON.stringify(r));

await cerrar(A, await partida());
ok('jugar empieza la racha', (await racha(A)).s === 1 && (await racha(A)).l === hoy, JSON.stringify(await racha(A)));
ok('de todos los jugadores', (await racha(D)).s === 1, JSON.stringify(await racha(D)));
ok('quien no jugó no suma', (await racha(X)).s === 0, JSON.stringify(await racha(X)));
await cerrar(A, await partida());
ok('dos partidas el mismo día cuentan una vez', (await racha(A)).s === 1, JSON.stringify(await racha(A)));
await cerrar(A, await partida(`'[]'`));
await db.query(`UPDATE public.profiles SET streak_count=5, last_streak_update_at=public._club_day(now())-1 WHERE id='${A}'`);
await cerrar(A, await partida(`'[]'`));
ok('una partida sin manos no cuenta', (await racha(A)).s === 5, JSON.stringify(await racha(A)));
await cerrar(A, await partida());
ok('jugar al día siguiente suma', (await racha(A)).s === 6, JSON.stringify(await racha(A)));

// Con apuesta la racha llega al confirmar
await db.exec(`UPDATE public.profiles SET streak_count=0, last_streak_update_at=NULL;`);
let m = await partida();
await db.query(`INSERT INTO public.bets(user_id,match_id,bet_on_team,amount_wagered,multiplier) VALUES('${X}','${m}',1,100,2)`);
await cerrar(A, m);
ok('por confirmar todavía no cuenta', (await racha(A)).s === 0, JSON.stringify(await racha(A)));
await as('authenticated', C, `SELECT public.confirm_match_result('${m}')`);
ok('al confirmar sí cuenta', (await racha(A)).s === 1, JSON.stringify(await racha(A)));

// Viernes 30 de octubre, sábado 31, domingo 1, lunes 2 y martes 3 de noviembre de 2026
ok('de jueves a viernes sigue', await continua('2026-10-29', '2026-10-30'));
ok('de viernes a domingo sigue', await continua('2026-10-30', '2026-11-01'));
ok('de viernes a lunes sigue', await continua('2026-10-30', '2026-11-02'));
ok('de sábado a lunes sigue', await continua('2026-10-31', '2026-11-02'));
ok('de lunes a miércoles se rompe', !(await continua('2026-11-02', '2026-11-04')));
ok('de jueves a lunes se rompe', !(await continua('2026-10-29', '2026-11-02')));

await db.exec(`UPDATE public.profiles SET streak_count=7, last_streak_update_at=public._club_day(now())-10 WHERE id='${B}';
               UPDATE public.profiles SET streak_count=7, last_streak_update_at=public._club_day(now()) WHERE id='${C}';`);
r = await as('authenticated', A, `SELECT public.reset_expired_streaks()`);
ok('la app no ejecuta el vencimiento', !!r.err, JSON.stringify(r));
await db.query(`SELECT public.reset_expired_streaks()`);
ok('quien dejó de jugar pierde la racha', (await racha(B)).s === 0, JSON.stringify(await racha(B)));
ok('quien jugó hoy la conserva', (await racha(C)).s === 7, JSON.stringify(await racha(C)));

// El bono diario no depende de la racha
await db.exec(`UPDATE public.profiles SET betting_points=0, streak_count=0, last_daily_bonus_at=NULL WHERE id='${X}';`);
r = await as('authenticated', X, `SELECT public.claim_daily_bonus() b`);
ok('el bono diario sigue pagando +10 sin racha', r.rows?.[0]?.b?.claimed === true && Number(r.rows[0].b.new_balance) === 10, JSON.stringify(r));
r = await as('authenticated', X, `SELECT public.claim_daily_bonus() b`);
ok('una vez al día', r.rows?.[0]?.b?.claimed === false, JSON.stringify(r));

fin();
