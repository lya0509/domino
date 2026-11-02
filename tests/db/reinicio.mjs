import { crearBase, ayudante, sql, IDS } from './base.mjs';
const { A, B, C, D } = IDS;
const db = await crearBase();
const { ok, fin } = ayudante(db);

const cuerpo = (f) => sql(`supabase/migrations/${f}`).split('-- VERIFICACIÓN')[0].replace(/-- =+\s*$/, '');
for (const f of ['20261101_01_confirmacion_rival.sql', '20261101_02_seguridad_servidor.sql', '20261101_03_rachas.sql', '20261101_04_puntos.sql', '20261101_06_partidas_abandonadas.sql', '20261101_07_cola_diaria.sql', '20261101_08_confirmacion_todas.sql', '20261101_09_confirmacion_1_minuto.sql']) {
  await db.exec(cuerpo(f));
}
await db.exec(`CREATE SCHEMA net;
  CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
await db.exec(cuerpo('20261101_10_notificaciones_push.sql').replace('CREATE EXTENSION IF NOT EXISTS pg_net;', ''));
await db.exec(cuerpo('20261101_11_direccion_send_push.sql'));
await db.exec(cuerpo('20261101_12_aviso_turno_antes_del_limite.sql'));
await db.exec(cuerpo('20261101_13_uno.sql'));
await db.exec(cuerpo('20261101_14_poker.sql'));

const uno = async (q) => (await db.query(q)).rows[0];
const cuenta = async (t) => (await uno(`SELECT count(*)::int c FROM ${t}`)).c;

await db.exec(`
  UPDATE public.profiles SET betting_points = 12415, achievements = '["play_1"]'::jsonb, streak_count = 9,
    last_streak_update_at = now(), last_daily_bonus_at = now(), avatar_url = 'foto.png',
    inventory = '{title_veteran,border_veteran}', equipped_items = '{"title":"🏅 Superviviente"}'::jsonb
  WHERE id = '${A}';
  UPDATE public.profiles SET inventory = '{title_mala_suerte,table_green,border_veteran}',
    equipped_items = '{"title":"⛈️ Mala Suerte","table_color":"#064e3b","border":"#94A3B8"}'::jsonb
  WHERE id = '${B}';
  INSERT INTO public.matches(id, status, team1_player1, team1_player2, team2_player1, team2_player2)
  VALUES ('00000000-0000-4000-8000-000000000001', 'active', '${A}', '${B}', '${C}', '${D}');
  INSERT INTO public.bets(user_id, match_id, bet_on_team, amount_wagered, multiplier, status)
  VALUES ('${A}', '00000000-0000-4000-8000-000000000001', 1, 100, 2, 'pending');
  INSERT INTO public.live_chat(user_id, match_id, message) VALUES ('${A}', '00000000-0000-4000-8000-000000000001', 'hola');
  INSERT INTO public.duos(player1_id, player2_id) VALUES ('${A}', '${B}');
  INSERT INTO public.table_games(id, game, created_by) VALUES ('00000000-0000-4000-8000-000000000002', 'poker', '${A}');
  INSERT INTO public.table_game_players(game_id, seat, user_id, name) VALUES ('00000000-0000-4000-8000-000000000002', 0, '${A}', 'A');
  INSERT INTO public.poker_hands(game_id, number, dealer_seat, dealer_plays, entrants, contributions, status)
  VALUES ('00000000-0000-4000-8000-000000000002', 1, 0, true, '{0}', '{"0":10}'::jsonb, 'open');
  INSERT INTO public.push_subscriptions(user_id, endpoint, p256dh, auth) VALUES ('${A}', 'https://push/a', 'k', 'a');
`);
const antes = await uno(`SELECT count(*)::int c FROM public.profiles`);

const script = sql('supabase/mantenimiento/reinicio_del_club.sql');
await db.exec(script);

for (const t of ['matches', 'bets', 'match_prizes', 'live_chat', 'global_chat', 'duos', 'waitlist', 'points_ledger', 'table_games', 'table_game_players', 'poker_hands', 'table_game_prizes', 'tournaments']) {
  ok(`${t} queda vacía`, (await cuenta(`public.${t}`)) === 0);
}
ok('ninguna cuenta se borra', (await cuenta('public.profiles')) === antes.c);
const a = await uno(`SELECT * FROM public.profiles WHERE id='${A}'`);
ok('todos quedan con 1000 puntos', (await cuenta(`public.profiles WHERE betting_points = 1000`)) === antes.c);
ok('los logros se pueden volver a ganar', JSON.stringify(a.achievements) === '[]', JSON.stringify(a.achievements));
ok('la racha vuelve a cero', a.streak_count === 0 && a.last_streak_update_at === null);
ok('el bono diario queda disponible', a.last_daily_bonus_at === null);
ok('la foto se conserva', a.avatar_url === 'foto.png');
ok('los premios de veterano se conservan', a.inventory.includes('title_veteran') && a.inventory.includes('border_veteran'), JSON.stringify(a.inventory));
ok('lo equipado se conserva', a.equipped_items.title === '🏅 Superviviente', JSON.stringify(a.equipped_items));
const b = await uno(`SELECT * FROM public.profiles WHERE id='${B}'`);
ok('lo comprado en la tienda se va', JSON.stringify(b.inventory) === '["border_veteran"]', JSON.stringify(b.inventory));
ok('lo comprado deja de estar equipado', JSON.stringify(b.equipped_items) === '{"border":"#94A3B8"}', JSON.stringify(b.equipped_items));
ok('los teléfonos siguen con avisos', (await cuenta('public.push_subscriptions')) === 1);

ok('el respaldo guarda el saldo anterior', Number((await uno(`SELECT betting_points p FROM respaldo_reinicio.profiles WHERE id='${A}'`)).p) === 12415);
ok('el respaldo guarda las partidas', (await cuenta('respaldo_reinicio.matches')) === 1);
ok('el respaldo guarda las manos', (await cuenta('respaldo_reinicio.poker_hands')) === 1);

await db.exec(`ROLLBACK`).catch(() => {});
await db.exec(`INSERT INTO public.duos(player1_id, player2_id) VALUES ('${A}', '${B}')`);
const repetir = await db.exec(script).then(() => null, (e) => e.message);
await db.exec(`ROLLBACK`).catch(() => {});
ok('ejecutarlo dos veces se detiene', /respaldo_reinicio/.test(repetir || ''), String(repetir));
ok('la segunda vez no borra nada', (await cuenta('public.duos')) === 1);

await db.exec(`SET request.role='authenticated'; SET request.uid='${A}'; SET ROLE authenticated;`);
const ver = await db.query(`SELECT * FROM respaldo_reinicio.profiles`).then(() => null, (e) => e.message);
await db.exec(`RESET ROLE;`);
ok('la app no puede leer el respaldo', /permission denied/.test(ver || ''), String(ver));

fin();
