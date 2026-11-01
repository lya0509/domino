-- ==============================================================================
-- CONFIRMACIÓN EN TODAS LAS PARTIDAS
-- Toda partida con ganador y al menos una mano pide confirmación del rival.
-- - Partida normal: si nadie responde en 2 minutos, se confirma sola.
-- - Con apuestas, Duelo VIP o torneo: espera sin límite, y nada se paga hasta que
--   responda un rival o un admin.
--
-- Orden: ejecutar después de 20261101_07_cola_diaria.sql.
-- Compatibilidad: la app publicada hoy sigue funcionando: sus partidas normales se
-- confirman solas a los 2 minutos. Ejecuta esto ANTES de publicar la app nueva, que
-- necesita la columna auto_confirm_at. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS auto_confirm_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_matches_auto_confirmar
  ON public.matches(auto_confirm_at) WHERE status = 'pending_confirmation';

-- ¿Hay puntos o un torneo en juego?
CREATE OR REPLACE FUNCTION public._match_has_stakes(p public.matches)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p.is_wager_match, false)
      OR p.tournament_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.bets b WHERE b.match_id = p.id AND b.status = 'pending');
$$;

-- Una partida anulada o sin manos no paga nada, así que no necesita confirmación
CREATE OR REPLACE FUNCTION public._match_needs_confirmation(p public.matches)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._match_has_stakes(p)
      OR (p.winner_team IN (1, 2) AND COALESCE(jsonb_array_length(p.rounds), 0) > 0);
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_match_close_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_app_request()
     OR current_setting('app.allow_match_close', true) = 'true'
     OR current_setting('app.allow_points_change', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Cerrada no se edita. Se devuelve la fila sin cambios y sin error para que una
  -- cola sin conexión que reintenta no se quede atascada.
  IF OLD.status IN ('completed', 'pending_confirmation', 'cancelled') THEN
    RETURN OLD;
  END IF;

  NEW.initial_team1 := OLD.initial_team1;
  NEW.initial_team2 := OLD.initial_team2;

  -- Desde la app una partida solo sigue activa o se cierra
  IF NEW.status NOT IN ('active', 'completed', 'pending_confirmation') THEN
    NEW.status := OLD.status;
  END IF;

  IF NEW.status IN ('completed', 'pending_confirmation') THEN
    NEW.closed_by := auth.uid();
    NEW.closed_at := now();
    NEW.status := CASE WHEN public._match_needs_confirmation(NEW)
                       THEN 'pending_confirmation' ELSE 'completed' END;
    NEW.auto_confirm_at := CASE WHEN NEW.status = 'pending_confirmation' AND NOT public._match_has_stakes(NEW)
                                THEN now() + interval '2 minutes' END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_abandoned_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.matches;
  v_limit integer;
  v_count integer := 0;
BEGIN
  FOR m IN
    SELECT * FROM public.matches
    WHERE status = 'active' AND created_at < now() - interval '6 hours'
    FOR UPDATE
  LOOP
    v_limit := COALESCE(m.limit_score, 100);

    IF NOT public._match_has_stakes(m) THEN
      UPDATE public.matches SET status = 'completed', winner_team = NULL WHERE id = m.id;
    ELSIF GREATEST(COALESCE(m.team1_total, 0), COALESCE(m.team2_total, 0)) >= v_limit
          AND COALESCE(m.team1_total, 0) <> COALESCE(m.team2_total, 0) THEN
      UPDATE public.matches
      SET status = 'pending_confirmation',
          winner_team = CASE WHEN COALESCE(m.team1_total, 0) > COALESCE(m.team2_total, 0) THEN 1 ELSE 2 END,
          closed_at = now()
      WHERE id = m.id;
    ELSE
      PERFORM public.resolve_match_bets(m.id, NULL);
      PERFORM public.resolve_match_wagers(m.id, NULL);
      UPDATE public.matches SET status = 'cancelled' WHERE id = m.id;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.award_zapatero_maestro(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_ach jsonb;
BEGIN
  -- La confirmación automática corre en el servidor, sin usuario
  IF (auth.uid() IS NULL AND public._is_app_request()) OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(to_jsonb(p)->'achievements', '[]'::jsonb) INTO v_ach
  FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(v_ach) <> 'array' THEN v_ach := '[]'::jsonb; END IF;
  IF v_ach ? 'zapatero_maestro' THEN
    RETURN false;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.matches
  WHERE status = 'completed' AND is_zapato = true
    AND ((winner_team = 1 AND p_user_id IN (team1_player1, team1_player2))
      OR (winner_team = 2 AND p_user_id IN (team2_player1, team2_player2)));

  IF v_count < 3 THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.profiles p
  SET achievements = r.achievements
  FROM jsonb_populate_record(
    NULL::public.profiles,
    jsonb_build_object('achievements', v_ach || '"zapatero_maestro"'::jsonb)
  ) AS r
  WHERE p.id = p_user_id;

  RETURN true;
END;
$$;

-- La tarea corre cada minuto. Solo toca partidas sin nada en juego: las demás esperan.
CREATE OR REPLACE FUNCTION public.auto_confirm_expired_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.matches;
  v_count integer := 0;
BEGIN
  FOR m IN
    SELECT * FROM public.matches
    WHERE status = 'pending_confirmation' AND auto_confirm_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    IF public._match_has_stakes(m) THEN
      CONTINUE;
    END IF;

    UPDATE public.matches SET status = 'completed', confirmed_at = now() WHERE id = m.id;

    IF m.is_zapato THEN
      PERFORM public.award_zapatero_maestro(u)
      FROM unnest(CASE WHEN m.winner_team = 1
                       THEN ARRAY[m.team1_player1, m.team1_player2]
                       ELSE ARRAY[m.team2_player1, m.team2_player2] END) AS u
      WHERE u IS NOT NULL;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._match_has_stakes(public.matches) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._match_needs_confirmation(public.matches) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_match_close_gate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_abandoned_matches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_confirm_expired_matches() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('confirmar-partidas-normales', '* * * * *', 'SELECT public.auto_confirm_expired_matches()');
  END IF;
END $$;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las dos columnas deben salir en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'confirmar-partidas-normales') AS confirmacion_automatica,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'auto_confirm_at') AS cuenta_regresiva;
