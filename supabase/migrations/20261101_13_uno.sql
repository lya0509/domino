-- ==============================================================================
-- UNO, UNO FLIP Y UNO NO MERCY
-- Se anotan los jugadores y al final quién ganó. Cada variante tiene su ranking.
-- - Otro jugador con cuenta confirma; si nadie responde en 1 minuto, se confirma sola.
-- - Ganar paga +20 con mínimo 3 jugadores registrados. El tope de 3 premios al día
--   se comparte con el dominó.
-- - Jugar cuenta para la racha.
-- - La app solo lee estas tablas: todo cambio pasa por las funciones de abajo.
--
-- Orden: ejecutar después de 20261101_12_aviso_turno_antes_del_limite.sql.
-- Compatibilidad: la app publicada sigue funcionando; solo no muestra UNO.
-- Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.table_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game text NOT NULL CHECK (game IN ('uno', 'uno_flip', 'uno_no_mercy')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_confirmation', 'completed', 'cancelled')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  winner_seat integer,
  closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at timestamptz,
  auto_confirm_at timestamptz,
  confirmed_at timestamptz,
  disputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- El nombre se guarda siempre: quien no tiene cuenta solo tiene nombre, y la
-- partida lo conserva si alguien elimina su cuenta.
CREATE TABLE IF NOT EXISTS public.table_game_players (
  game_id uuid NOT NULL REFERENCES public.table_games(id) ON DELETE CASCADE,
  seat integer NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  PRIMARY KEY (game_id, seat)
);

CREATE TABLE IF NOT EXISTS public.table_game_prizes (
  game_id uuid NOT NULL REFERENCES public.table_games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  club_day date NOT NULL,
  amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_table_games_estado ON public.table_games(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_table_game_players_user ON public.table_game_players(user_id);
CREATE INDEX IF NOT EXISTS idx_table_game_prizes_dia ON public.table_game_prizes(user_id, club_day);

ALTER TABLE public.table_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_game_prizes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_games FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.table_game_players FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.table_game_prizes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.table_games TO authenticated;
GRANT SELECT ON public.table_game_players TO authenticated;

DROP POLICY IF EXISTS "Con sesion se ven las partidas" ON public.table_games;
CREATE POLICY "Con sesion se ven las partidas" ON public.table_games
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Con sesion se ven los jugadores" ON public.table_game_players;
CREATE POLICY "Con sesion se ven los jugadores" ON public.table_game_players
  FOR SELECT TO authenticated USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'table_games') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.table_games;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- Reglas compartidas con el dominó
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._prizes_on_day(p_user uuid, p_day date)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT COUNT(*) FROM public.match_prizes
          WHERE user_id = p_user AND club_day = p_day AND reverted_at IS NULL)
       + (SELECT COUNT(*) FROM public.table_game_prizes
          WHERE user_id = p_user AND club_day = p_day);
$$;

CREATE OR REPLACE FUNCTION public._award_match_prize(p_match public.matches)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := public._club_day(now());
  v_uid uuid;
  v_winners uuid[];
BEGIN
  IF p_match.status IS DISTINCT FROM 'completed'
     OR p_match.winner_team NOT IN (1, 2)
     OR p_match.tournament_id IS NOT NULL
     OR COALESCE(jsonb_array_length(p_match.rounds), 0) = 0 THEN
    RETURN;
  END IF;

  -- En dominó las 4 sillas deben ser usuarios registrados: con invitados
  -- bastaría una cuenta para cobrar el premio sin rival real.
  IF p_match.team1_player1 IS NULL OR p_match.team1_player2 IS NULL
     OR p_match.team2_player1 IS NULL OR p_match.team2_player2 IS NULL THEN
    RETURN;
  END IF;

  v_winners := CASE WHEN p_match.winner_team = 1
                    THEN ARRAY[p_match.team1_player1, p_match.team1_player2]
                    ELSE ARRAY[p_match.team2_player1, p_match.team2_player2] END;

  PERFORM set_config('app.allow_points_change', 'true', true);
  PERFORM set_config('app.points_reason', 'Premio por ganar', true);

  FOREACH v_uid IN ARRAY v_winners LOOP
    -- Bloquear el saldo: dos cierres simultáneos no se saltan el tope
    PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;
    IF public._prizes_on_day(v_uid, v_day) >= 3 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.match_prizes(match_id, user_id, club_day, amount)
    VALUES (p_match.id, v_uid, v_day, 20)
    ON CONFLICT (match_id, user_id) DO UPDATE
      SET reverted_at = NULL, club_day = v_day
      WHERE public.match_prizes.reverted_at IS NOT NULL;
    IF FOUND THEN
      UPDATE public.profiles SET betting_points = COALESCE(betting_points, 0) + 20 WHERE id = v_uid;
    END IF;
  END LOOP;

  PERFORM set_config('app.points_reason', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public._bump_play_streak(p_users uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := public._club_day(now());
BEGIN
  PERFORM set_config('app.allow_streak_change', 'true', true);
  UPDATE public.profiles p
  SET streak_count = CASE
        WHEN p.last_streak_update_at IS NOT NULL
             AND public._streak_continues(p.last_streak_update_at, v_today)
          THEN COALESCE(p.streak_count, 0) + 1
        ELSE 1
      END,
      last_streak_update_at = v_today
  WHERE p.id = ANY(p_users)
    AND p.last_streak_update_at IS DISTINCT FROM v_today;
  PERFORM set_config('app.allow_streak_change', 'false', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_player_streaks_for_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.matches;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND
     OR v_match.status IS DISTINCT FROM 'completed'
     OR COALESCE(jsonb_array_length(v_match.rounds), 0) = 0 THEN
    RETURN;
  END IF;

  PERFORM public._bump_play_streak(ARRAY[v_match.team1_player1, v_match.team1_player2,
                                         v_match.team2_player1, v_match.team2_player2]);
END;
$$;

-- ------------------------------------------------------------------------------
-- Ayudantes internos
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._table_game_label(p_game text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_game WHEN 'uno_flip' THEN 'UNO Flip' WHEN 'uno_no_mercy' THEN 'UNO No Mercy' ELSE 'UNO' END;
$$;

CREATE OR REPLACE FUNCTION public._table_game_users(p_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(user_id), '{}') FROM public.table_game_players
  WHERE game_id = p_id AND user_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public._is_admin(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND is_admin = true);
$$;

CREATE OR REPLACE FUNCTION public._can_manage_table_game(p_game public.table_games, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT DISTINCT FROM p_game.created_by
      OR p_user = ANY(public._table_game_users(p_game.id))
      OR public._is_admin(p_user);
$$;

CREATE OR REPLACE FUNCTION public._complete_table_game(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_players uuid[] := public._table_game_users(p_id);
  v_day date := public._club_day(now());
  v_winner uuid;
BEGIN
  UPDATE public.table_games
  SET status = 'completed', confirmed_at = now(), auto_confirm_at = NULL
  WHERE id = p_id;

  -- La racha nunca debe impedir que una partida se cierre
  BEGIN
    PERFORM public._bump_play_streak(v_players);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo actualizar la racha de %: %', p_id, SQLERRM;
  END;

  SELECT p.user_id INTO v_winner
  FROM public.table_game_players p
  JOIN public.table_games g ON g.id = p.game_id AND g.winner_seat = p.seat
  WHERE g.id = p_id;

  IF v_winner IS NULL OR cardinality(v_players) < 3 THEN
    RETURN;
  END IF;

  -- Bloquear el saldo: dos cierres simultáneos no se saltan el tope
  PERFORM 1 FROM public.profiles WHERE id = v_winner FOR UPDATE;
  IF public._prizes_on_day(v_winner, v_day) >= 3 THEN
    RETURN;
  END IF;

  INSERT INTO public.table_game_prizes(game_id, user_id, club_day, amount)
  VALUES (p_id, v_winner, v_day, 20)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    PERFORM set_config('app.allow_points_change', 'true', true);
    PERFORM set_config('app.points_reason', 'Premio por ganar', true);
    UPDATE public.profiles SET betting_points = COALESCE(betting_points, 0) + 20 WHERE id = v_winner;
    PERFORM set_config('app.points_reason', '', true);
    PERFORM set_config('app.allow_points_change', 'false', true);
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- Lo que pide la app
-- ------------------------------------------------------------------------------
-- p_id viene del teléfono: así la cola sin internet puede reenviar sin duplicar
CREATE OR REPLACE FUNCTION public.start_table_game(p_id uuid, p_game text, p_players jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_seat integer := 0;
  v_entry jsonb;
  v_user uuid;
  v_name text;
  v_names text[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF p_game NOT IN ('uno', 'uno_flip', 'uno_no_mercy') THEN
    RAISE EXCEPTION 'Ese juego no existe';
  END IF;
  v_count := CASE WHEN jsonb_typeof(p_players) = 'array' THEN jsonb_array_length(p_players) ELSE 0 END;
  IF v_count NOT BETWEEN 2 AND 10 THEN
    RAISE EXCEPTION 'Una partida necesita de 2 a 10 jugadores';
  END IF;

  INSERT INTO public.table_games(id, game, created_by)
  VALUES (p_id, p_game, v_uid)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN p_id;
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_user := NULLIF(v_entry->>'user_id', '')::uuid;
    IF v_user IS NOT NULL THEN
      SELECT COALESCE(display_name, 'Jugador') INTO v_name FROM public.profiles WHERE id = v_user;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Uno de los jugadores no existe';
      END IF;
      IF EXISTS (SELECT 1 FROM public.table_game_players WHERE game_id = p_id AND user_id = v_user) THEN
        RAISE EXCEPTION 'Hay un jugador repetido';
      END IF;
    ELSE
      v_name := btrim(COALESCE(v_entry->>'name', ''));
      IF length(v_name) NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'Quien juega sin cuenta necesita un nombre de hasta 30 letras';
      END IF;
    END IF;

    INSERT INTO public.table_game_players(game_id, seat, user_id, name)
    VALUES (p_id, v_seat, v_user, v_name);
    v_names := v_names || v_name;
    v_seat := v_seat + 1;
  END LOOP;

  PERFORM public._notify(
    public._everyone_except(public._table_game_users(p_id) || v_uid),
    '🃏 Ya están jugando',
    public._table_game_label(p_game) || ': ' || array_to_string(v_names, ', ') || '. Entra a verla en vivo.',
    'table-' || p_id
  );
  RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_table_game(p_id uuid, p_winner_seat integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
  v_others uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_game FROM public.table_games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public._can_manage_table_game(v_game, v_uid) THEN
    RAISE EXCEPTION 'Solo alguien de la mesa puede terminar la partida';
  END IF;

  IF v_game.status <> 'active' THEN
    -- La cola sin internet puede reenviar el mismo final
    IF v_game.status <> 'cancelled' AND v_game.winner_seat = p_winner_seat THEN
      RETURN v_game.status;
    END IF;
    RAISE EXCEPTION 'Esta partida ya terminó';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.table_game_players WHERE game_id = p_id AND seat = p_winner_seat) THEN
    RAISE EXCEPTION 'El ganador no está en esta partida';
  END IF;

  v_others := array_remove(public._table_game_users(p_id), v_uid);

  UPDATE public.table_games
  SET winner_seat = p_winner_seat, closed_by = v_uid, closed_at = now(),
      status = 'pending_confirmation', auto_confirm_at = now() + interval '1 minute'
  WHERE id = p_id;

  IF cardinality(v_others) = 0 THEN
    PERFORM public._complete_table_game(p_id);
    RETURN 'completed';
  END IF;

  PERFORM public._notify(v_others, '🏁 Confirma el resultado',
    'Tu partida de ' || public._table_game_label(v_game.game) || ' terminó. Entra a confirmar quién ganó.', 'table-confirm-' || p_id);
  RETURN 'pending_confirmation';
END;
$$;

CREATE OR REPLACE FUNCTION public.answer_table_game(p_id uuid, p_agree boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_game FROM public.table_games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT public._is_admin(v_uid)
     AND (v_uid IS NOT DISTINCT FROM v_game.closed_by OR NOT v_uid = ANY(public._table_game_users(p_id))) THEN
    RAISE EXCEPTION 'Solo otro jugador de la partida puede responder';
  END IF;

  -- Otro jugador pudo responder primero
  IF v_game.status <> 'pending_confirmation' THEN
    RETURN false;
  END IF;

  IF p_agree THEN
    PERFORM public._complete_table_game(p_id);
    RETURN true;
  END IF;

  UPDATE public.table_games
  SET status = 'active', winner_seat = NULL, closed_by = NULL, closed_at = NULL,
      auto_confirm_at = NULL, disputed_at = now()
  WHERE id = p_id;

  IF v_game.closed_by IS NOT NULL THEN
    PERFORM public._notify(ARRAY[v_game.closed_by], '🔁 Partida reabierta',
      'Un jugador no estuvo de acuerdo. Entra a marcar el ganador correcto.', 'table-confirm-' || p_id);
  END IF;
  RETURN true;
END;
$$;

-- Solo actúa si el tiempo ya venció, así que cualquiera con sesión puede pedirlo
CREATE OR REPLACE FUNCTION public.finish_expired_table_game(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game public.table_games;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_game FROM public.table_games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND
     OR v_game.status IS DISTINCT FROM 'pending_confirmation'
     OR v_game.auto_confirm_at IS NULL
     OR v_game.auto_confirm_at > now() THEN
    RETURN false;
  END IF;

  PERFORM public._complete_table_game(p_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_table_game(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_game FROM public.table_games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public._can_manage_table_game(v_game, v_uid) THEN
    RAISE EXCEPTION 'Solo alguien de la mesa puede anular la partida';
  END IF;
  IF v_game.status = 'cancelled' THEN
    RETURN;
  END IF;
  IF v_game.status <> 'active' THEN
    RAISE EXCEPTION 'Esta partida ya terminó';
  END IF;

  UPDATE public.table_games SET status = 'cancelled', closed_at = now() WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.table_game_ranking(p_game text, p_from timestamptz DEFAULT NULL)
RETURNS TABLE(user_id uuid, display_name text, wins bigint, played bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.user_id, pr.display_name,
         COUNT(*) FILTER (WHERE g.winner_seat = p.seat) AS wins,
         COUNT(*) AS played
  FROM public.table_games g
  JOIN public.table_game_players p ON p.game_id = g.id
  JOIN public.profiles pr ON pr.id = p.user_id
  WHERE g.game = p_game
    AND g.status = 'completed'
    AND (p_from IS NULL OR g.closed_at >= p_from)
  GROUP BY p.user_id, pr.display_name
  ORDER BY wins DESC, played ASC, pr.display_name
  LIMIT 100;
$$;

-- Corre cada minuto: resultados sin respuesta y partidas olvidadas
CREATE OR REPLACE FUNCTION public.auto_confirm_table_games()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.table_games
    WHERE status = 'pending_confirmation' AND auto_confirm_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public._complete_table_game(v_id);
  END LOOP;

  UPDATE public.table_games
  SET status = 'cancelled', closed_at = now()
  WHERE status = 'active' AND created_at < now() - interval '6 hours';
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('confirmar-partidas-de-mesa', '* * * * *', 'SELECT public.auto_confirm_table_games()');
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public._prizes_on_day(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._award_match_prize(public.matches) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._bump_play_streak(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._table_game_users(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._is_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._can_manage_table_game(public.table_games, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._complete_table_game(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_confirm_table_games() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.start_table_game(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finish_table_game(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.answer_table_game(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finish_expired_table_game(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_table_game(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.table_game_ranking(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_table_game(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_table_game(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.answer_table_game(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_expired_table_game(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_table_game(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.table_game_ranking(text, timestamptz) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las cuatro columnas deben salir en true
-- ==============================================================================
SELECT
  has_function_privilege('authenticated', 'public.start_table_game(uuid, text, jsonb)', 'EXECUTE') AS se_puede_jugar,
  NOT has_function_privilege('anon', 'public.finish_table_game(uuid, integer)', 'EXECUTE') AS sin_sesion_no,
  NOT has_function_privilege('authenticated', 'public._complete_table_game(uuid)', 'EXECUTE') AS premio_protegido,
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'confirmar-partidas-de-mesa') AS cierre_automatico;
