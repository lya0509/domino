-- ==============================================================================
-- REINICIO DEL CLUB
-- Deja el club como nuevo: borra partidas, apuestas, premios, duelos, torneos, dúos,
-- chats, cola de mesa y movimientos de puntos. Cada cuenta queda con los 1.000 puntos
-- del saldo inicial, sin logros, sin racha, sin compras de la tienda y con el bono
-- diario disponible.
--
-- Se conserva: las cuentas y sus fotos, los teléfonos con avisos, los anuncios, la
-- configuración, y el título y el marco de veterano, que son premios y no compras.
--
-- Antes de borrar guarda una copia en el esquema respaldo_reinicio, que la app no
-- puede ver. Si ese esquema ya existe, el script se detiene sin tocar nada.
--
-- NO es una migración: se ejecuta a mano, una sola vez, cuando el dueño lo decida.
-- ==============================================================================
BEGIN;

CREATE SCHEMA respaldo_reinicio;
REVOKE ALL ON SCHEMA respaldo_reinicio FROM PUBLIC;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'matches', 'bets', 'match_prizes', 'wager_consents', 'live_chat', 'global_chat',
    'duos', 'waitlist', 'points_ledger', 'notification_queue',
    'table_games', 'table_game_players', 'table_game_prizes', 'poker_hands',
    'tournaments', 'tournament_brackets', 'tournament_participants', 'tournament_payouts'
  ] LOOP
    EXECUTE format('CREATE TABLE respaldo_reinicio.%I AS TABLE public.%I', v_table, v_table);
  END LOOP;
END $$;

SELECT set_config('app.allow_points_change', 'true', true), set_config('app.allow_streak_change', 'true', true);

UPDATE public.profiles
SET betting_points = 1000,
    last_daily_bonus_at = NULL,
    achievements = '[]'::jsonb,
    streak_count = 0,
    last_streak_update_at = NULL,
    inventory = ARRAY(SELECT i FROM unnest(inventory) i WHERE i IN ('title_veteran', 'border_veteran')),
    equipped_items = (
      SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
      FROM jsonb_each(equipped_items) AS e(k, v)
      WHERE (k = 'title' AND v = to_jsonb('🏅 Superviviente'::text))
         OR (k = 'border' AND v = to_jsonb('#94A3B8'::text))
    );

-- Sin CASCADE: si alguna tabla nueva apunta a estas, falla en vez de borrar de más
TRUNCATE
  public.bets, public.match_prizes, public.wager_consents, public.live_chat, public.global_chat,
  public.duos, public.waitlist, public.points_ledger, public.notification_queue,
  public.poker_hands, public.table_game_prizes, public.table_game_players, public.table_games,
  public.tournament_payouts, public.tournament_participants, public.tournament_brackets,
  public.matches, public.tournaments;

-- El historial de puntos arranca con el saldo de cada cuenta
INSERT INTO public.points_ledger(user_id, delta, balance, reason)
SELECT id, COALESCE(betting_points, 0), COALESCE(betting_points, 0), 'Reinicio del club' FROM public.profiles;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: cuentas_con_mil debe ser igual a cuentas, y lo demás debe salir en 0
-- ==============================================================================
SELECT
  (SELECT count(*) FROM public.profiles) AS cuentas,
  (SELECT count(*) FROM public.profiles WHERE betting_points = 1000) AS cuentas_con_mil,
  (SELECT count(*) FROM public.matches) AS partidas,
  (SELECT count(*) FROM public.bets) AS apuestas,
  (SELECT count(*) FROM public.table_games) AS partidas_de_mesa,
  (SELECT count(*) FROM public.points_ledger WHERE reason <> 'Reinicio del club') AS movimientos,
  (SELECT count(*) FROM public.duos) AS duos;
