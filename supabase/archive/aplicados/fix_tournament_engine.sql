-- ==============================================================================
-- MOTOR DE TORNEOS EN EL SERVIDOR
-- Las llaves (tournament_brackets) y el estado del torneo solo los puede cambiar
-- un admin. Por eso:
--   * un usuario normal que crea un torneo no podía arrancarlo, y
--   * al terminar una partida de torneo, el jugador (no admin) no podía marcar
--     el ganador ni crear la siguiente ronda: el torneo se quedaba atascado.
-- Ahora:
--   * start_tournament: el creador o un admin arranca el torneo.
--   * expire_tournament_registration: al vencer la inscripción (5 min), si hay
--     4 o más inscritos arranca con parejas al azar; si no, cancela y reembolsa.
--   * Un trigger en matches avanza las llaves solo, cuando una partida de torneo
--     termina (también si se terminó sin internet y se sincronizó después),
--     y al terminar la final paga el premio.
--
-- Requiere haber ejecutado antes fix_points_security.sql (award_tournament_prize).
-- Ejecuta todo en el SQL Editor de Supabase. Es seguro repetirlo.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Helper: crea la partida en vivo y la llave de un cruce entre dos equipos.
-- p_t2 vacío = pase directo (bye): la llave nace ganada por el equipo 1.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_create_bracket(
  p_tournament_id uuid,
  p_round integer,
  p_match_number integer,
  p_t1 uuid[],
  p_t2 uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_id uuid;
  v_players jsonb;
BEGIN
  IF p_t2 IS NULL OR array_length(p_t2, 1) IS NULL THEN
    INSERT INTO public.tournament_brackets
      (tournament_id, round_number, match_number, team1_player1, team1_player2, winner_team)
    VALUES (p_tournament_id, p_round, p_match_number, p_t1[1], p_t1[2], 1);
    RETURN;
  END IF;

  -- Mismo formato de players_json que crea la app
  SELECT jsonb_agg(jsonb_build_object(
           'id', x.slot::text, 'profileId', x.pid, 'name', p.display_name,
           'initials', p.initials, 'teamNumber', x.team, 'position', x.pos)
         ORDER BY x.slot)
    INTO v_players
  FROM (VALUES
    (1, p_t1[1], 1, 'bottom'),
    (2, p_t2[1], 2, 'right'),
    (3, p_t1[2], 1, 'top'),
    (4, p_t2[2], 2, 'left')
  ) AS x(slot, pid, team, pos)
  LEFT JOIN public.profiles p ON p.id = x.pid;

  INSERT INTO public.matches
    (tournament_id, status, game_mode, limit_score, team1_total, team2_total,
     team1_player1, team1_player2, team2_player1, team2_player2, rounds, players_json)
  VALUES
    (p_tournament_id, 'active', 'teams', 100, 0, 0,
     p_t1[1], p_t1[2], p_t2[1], p_t2[2], '[]'::jsonb, v_players)
  RETURNING id INTO v_match_id;

  INSERT INTO public.tournament_brackets
    (tournament_id, round_number, match_number,
     team1_player1, team1_player2, team2_player1, team2_player2, live_match_id)
  VALUES (p_tournament_id, p_round, p_match_number,
          p_t1[1], p_t1[2], p_t2[1], p_t2[2], v_match_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- Arranque interno (sin revisar quién llama): arma equipos y la ronda 1
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_start_internal(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t RECORD;
  v_teams uuid[][] := '{}';
  v_singles uuid[] := '{}';
  v_used uuid[] := '{}';
  v_left uuid;
  r RECORD;
  i integer;
  v_n integer;
  v_match integer := 1;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_t.status IS DISTINCT FROM 'registration' THEN
    RETURN jsonb_build_object('started', false, 'reason', 'not_registration');
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND payment_status = 'approved';
  IF v_n < 4 THEN
    RETURN jsonb_build_object('started', false, 'reason', 'not_enough_players');
  END IF;
  IF v_t.tournament_type = 'vip_cash' AND v_n % 8 <> 0 THEN
    RETURN jsonb_build_object('started', false, 'reason', 'vip_needs_multiple_of_8');
  END IF;

  -- 1. Dúos confirmados (los dos aprobados)
  FOR r IN
    SELECT a.user_id AS p1, a.partner_id AS p2
    FROM public.tournament_participants a
    JOIN public.tournament_participants b
      ON b.tournament_id = a.tournament_id AND b.user_id = a.partner_id
    WHERE a.tournament_id = p_tournament_id
      AND a.payment_status = 'approved' AND b.payment_status = 'approved'
      AND a.partner_status = 'confirmed' AND b.partner_status = 'confirmed'
      AND b.partner_id = a.user_id
      AND a.user_id < a.partner_id
  LOOP
    v_teams := v_teams || ARRAY[ARRAY[r.p1, r.p2]];
    v_used := v_used || r.p1 || r.p2;
  END LOOP;

  -- 2. Los demás, en parejas al azar
  SELECT COALESCE(array_agg(user_id ORDER BY random()), '{}') INTO v_singles
  FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND payment_status = 'approved'
    AND NOT (user_id = ANY(v_used));

  i := 1;
  WHILE i + 1 <= COALESCE(array_length(v_singles, 1), 0) LOOP
    v_teams := v_teams || ARRAY[ARRAY[v_singles[i], v_singles[i + 1]]];
    UPDATE public.tournament_participants
    SET partner_id = CASE WHEN user_id = v_singles[i] THEN v_singles[i + 1] ELSE v_singles[i] END,
        partner_status = 'confirmed'
    WHERE tournament_id = p_tournament_id AND user_id IN (v_singles[i], v_singles[i + 1]);
    i := i + 2;
  END LOOP;

  -- 3. Si sobra un jugador sin pareja: queda fuera y se le devuelven sus puntos
  IF COALESCE(array_length(v_singles, 1), 0) % 2 = 1 THEN
    v_left := v_singles[array_length(v_singles, 1)];
    DELETE FROM public.tournament_participants
    WHERE tournament_id = p_tournament_id AND user_id = v_left;
    IF COALESCE(v_t.entry_points, 0) > 0 AND v_t.tournament_type IS DISTINCT FROM 'vip_cash' THEN
      PERFORM set_config('app.allow_points_change', 'true', true);
      UPDATE public.profiles SET betting_points = COALESCE(betting_points, 0) + v_t.entry_points
      WHERE id = v_left;
      UPDATE public.tournaments SET prize_pool = GREATEST(COALESCE(prize_pool, 0) - v_t.entry_points, 0)
      WHERE id = p_tournament_id;
    END IF;
  END IF;

  -- 4. Ronda 1 en orden aleatorio; si hay número impar de equipos, el último pasa directo
  v_teams := ARRAY(
    SELECT ARRAY[v_teams[k][1], v_teams[k][2]]
    FROM generate_subscripts(v_teams, 1) AS k
    ORDER BY random()
  );

  i := 1;
  WHILE i <= COALESCE(array_length(v_teams, 1), 0) LOOP
    IF i + 1 <= array_length(v_teams, 1) THEN
      PERFORM public._tournament_create_bracket(p_tournament_id, 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], ARRAY[v_teams[i + 1][1], v_teams[i + 1][2]]);
    ELSE
      PERFORM public._tournament_create_bracket(p_tournament_id, 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], NULL);
    END IF;
    v_match := v_match + 1;
    i := i + 2;
  END LOOP;

  UPDATE public.tournaments SET status = 'in_progress' WHERE id = p_tournament_id;

  RETURN jsonb_build_object('started', true, 'teams', array_length(v_teams, 1), 'left_out', v_left);
END;
$$;

-- ------------------------------------------------------------------------------
-- Arrancar: solo el creador o un admin
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_tournament(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;
  SELECT created_by INTO v_creator FROM public.tournaments WHERE id = p_tournament_id;
  IF v_creator IS DISTINCT FROM auth.uid()
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Solo el creador o un administrador puede iniciar este torneo.';
  END IF;
  RETURN public._tournament_start_internal(p_tournament_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- Fin de la inscripción (5 min, igual que el contador de la app).
-- Cualquiera puede llamarla, pero solo actúa si el plazo ya venció.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_tournament_registration(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t RECORD;
  v_res jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id;
  IF NOT FOUND OR v_t.status IS DISTINCT FROM 'registration' OR v_t.tournament_type = 'vip_cash' THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;
  IF now() < v_t.created_at + interval '5 minutes' THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'not_expired');
  END IF;

  v_res := public._tournament_start_internal(p_tournament_id);
  IF (v_res->>'started')::boolean THEN
    RETURN jsonb_build_object('action', 'started') || v_res;
  END IF;
  IF v_res->>'reason' IS DISTINCT FROM 'not_enough_players' THEN
    RETURN jsonb_build_object('action', 'none'); -- otro usuario ya lo arrancó o canceló
  END IF;

  -- Menos de 4 jugadores: cancelar y reembolsar
  UPDATE public.tournaments SET status = 'cancelled'
  WHERE id = p_tournament_id AND status = 'registration';
  IF FOUND AND COALESCE(v_t.entry_points, 0) > 0 THEN
    PERFORM set_config('app.allow_points_change', 'true', true);
    UPDATE public.profiles p
    SET betting_points = COALESCE(p.betting_points, 0) + v_t.entry_points
    FROM public.tournament_participants tp
    WHERE tp.tournament_id = p_tournament_id AND tp.user_id = p.id AND tp.payment_status = 'approved';
  END IF;
  RETURN jsonb_build_object('action', 'cancelled');
END;
$$;

-- ------------------------------------------------------------------------------
-- Trigger: una partida de torneo terminó → marcar la llave y avanzar
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_advance_tournament()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bracket RECORD;
  v_winner integer;
  v_pending integer;
  v_teams uuid[][];
  v_count integer;
  i integer;
  v_match integer := 1;
BEGIN
  v_winner := NEW.winner_team;
  IF v_winner IS NULL THEN
    IF COALESCE(NEW.team1_total, 0) >= COALESCE(NEW.limit_score, 100) THEN v_winner := 1;
    ELSIF COALESCE(NEW.team2_total, 0) >= COALESCE(NEW.limit_score, 100) THEN v_winner := 2;
    END IF;
  END IF;
  IF v_winner IS NULL OR v_winner NOT IN (1, 2) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_bracket FROM public.tournament_brackets
  WHERE live_match_id = NEW.id
  FOR UPDATE;
  IF NOT FOUND OR v_bracket.winner_team IS NOT NULL THEN
    RETURN NEW; -- ya procesada
  END IF;

  UPDATE public.tournament_brackets SET winner_team = v_winner WHERE id = v_bracket.id;

  -- Bloquear el torneo: dos finales de ronda simultáneas se procesan en orden
  PERFORM 1 FROM public.tournaments WHERE id = v_bracket.tournament_id FOR UPDATE;

  SELECT COUNT(*) FILTER (WHERE winner_team IS NULL), COUNT(*)
    INTO v_pending, v_count
  FROM public.tournament_brackets
  WHERE tournament_id = v_bracket.tournament_id AND round_number = v_bracket.round_number;

  IF v_pending > 0 THEN
    RETURN NEW; -- faltan partidas de esta ronda
  END IF;

  -- ¿Ya existe la siguiente ronda? (no duplicar)
  IF EXISTS (SELECT 1 FROM public.tournament_brackets
             WHERE tournament_id = v_bracket.tournament_id
               AND round_number = v_bracket.round_number + 1) THEN
    RETURN NEW;
  END IF;

  IF v_count = 1 THEN
    -- Era la final: terminar y pagar el premio (si es de puntos)
    UPDATE public.tournaments SET status = 'completed' WHERE id = v_bracket.tournament_id;
    PERFORM public.award_tournament_prize(v_bracket.tournament_id);
    RETURN NEW;
  END IF;

  -- Ganadores de la ronda, en orden de llave
  v_teams := ARRAY(
    SELECT CASE WHEN winner_team = 1 THEN ARRAY[team1_player1, team1_player2]
                ELSE ARRAY[team2_player1, team2_player2] END
    FROM public.tournament_brackets
    WHERE tournament_id = v_bracket.tournament_id AND round_number = v_bracket.round_number
    ORDER BY match_number
  );

  i := 1;
  WHILE i <= array_length(v_teams, 1) LOOP
    IF i + 1 <= array_length(v_teams, 1) THEN
      PERFORM public._tournament_create_bracket(v_bracket.tournament_id, v_bracket.round_number + 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], ARRAY[v_teams[i + 1][1], v_teams[i + 1][2]]);
    ELSE
      PERFORM public._tournament_create_bracket(v_bracket.tournament_id, v_bracket.round_number + 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], NULL);
    END IF;
    v_match := v_match + 1;
    i := i + 2;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_advance_tournament ON public.matches;
CREATE TRIGGER tr_advance_tournament
  AFTER UPDATE OF status ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.tournament_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_fn_advance_tournament();

-- Permisos: los internos no se llaman desde la app
REVOKE EXECUTE ON FUNCTION public._tournament_create_bracket(uuid, integer, integer, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._tournament_start_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_advance_tournament() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_tournament(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.expire_tournament_registration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_tournament(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_tournament_registration(uuid) TO authenticated;

-- Tiempo real para la pantalla de torneos (invitaciones, inscripciones, llaves, arranque)
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['tournaments', 'tournament_participants', 'tournament_brackets'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END $$;

COMMIT;


-- ==============================================================================
-- VERIFICACIÓN (mándame captura de las 2)
-- ==============================================================================

-- A. Tablas con tiempo real: deben aparecer las 3 de torneos
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY tablename;

-- B. Deben salir solo start_tournament y expire_tournament_registration, con authenticated
SELECT routine_name, grantee
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND routine_name IN ('start_tournament', 'expire_tournament_registration',
                       '_tournament_start_internal', '_tournament_create_bracket',
                       'trg_fn_advance_tournament')
ORDER BY routine_name, grantee;
