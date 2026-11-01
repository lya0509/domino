-- ==============================================================================
-- RACHA POR JUGAR
-- Queda una sola racha: la de jugar. La cuenta el servidor cuando una partida
-- termina de verdad, y la app ya no la escribe al entrar. El bono diario de +10
-- no cambia. Se conserva el perdón de fin de semana que ya tenía producción.
--
-- Orden: ejecutar después de 20261101_02_seguridad_servidor.sql.
-- Compatibilidad: la app de hoy sigue funcionando. Su racha por entrar deja de
-- guardarse sin dar error, aunque puede mostrar un aviso de racha hasta que se
-- publique la app nueva. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

-- El día cambia a las 7 AM hora de Venezuela, igual que el bono diario
CREATE OR REPLACE FUNCTION public._club_day(p_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT ((p_at AT TIME ZONE 'America/Caracas') - interval '7 hours')::date;
$$;

-- ¿Jugar hoy continúa una racha cuya última partida fue en p_last?
-- Lunes a viernes no se puede faltar; sábado y domingo se perdonan.
CREATE OR REPLACE FUNCTION public._streak_continues(p_last date, p_today date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_today - p_last = 1
      OR (p_today - p_last = 2 AND EXTRACT(ISODOW FROM p_today) IN (1, 7))
      OR (p_today - p_last = 3 AND EXTRACT(ISODOW FROM p_today) = 1);
$$;

CREATE OR REPLACE FUNCTION public.update_player_streaks_for_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.matches;
  v_today date := public._club_day(now());
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND
     OR v_match.status IS DISTINCT FROM 'completed'
     OR COALESCE(jsonb_array_length(v_match.rounds), 0) = 0 THEN
    RETURN;
  END IF;

  PERFORM set_config('app.allow_streak_change', 'true', true);
  UPDATE public.profiles p
  SET streak_count = CASE
        WHEN p.last_streak_update_at IS NOT NULL
             AND public._streak_continues(p.last_streak_update_at, v_today)
          THEN COALESCE(p.streak_count, 0) + 1
        ELSE 1
      END,
      last_streak_update_at = v_today
  WHERE p.id IN (v_match.team1_player1, v_match.team1_player2, v_match.team2_player1, v_match.team2_player2)
    AND p.last_streak_update_at IS DISTINCT FROM v_today;
  PERFORM set_config('app.allow_streak_change', 'false', true);
END;
$$;

-- La racha nunca debe impedir que una partida se cierre
CREATE OR REPLACE FUNCTION public.trg_fn_streak_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.update_player_streaks_for_match(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo actualizar la racha de %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_streak_on_complete ON public.matches;
CREATE TRIGGER tr_streak_on_complete
  AFTER UPDATE OF status ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.trg_fn_streak_on_complete();

DROP TRIGGER IF EXISTS tr_streak_on_insert ON public.matches;
CREATE TRIGGER tr_streak_on_insert
  AFTER INSERT ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.trg_fn_streak_on_complete();

-- Desde la app nadie cambia su racha
CREATE OR REPLACE FUNCTION public.trg_fn_protect_streak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public._is_app_request()
     AND COALESCE(current_setting('app.allow_streak_change', true), '') <> 'true' THEN
    NEW.streak_count := OLD.streak_count;
    NEW.last_streak_update_at := OLD.last_streak_update_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_streak ON public.profiles;
CREATE TRIGGER tr_protect_streak
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_protect_streak();

-- Quien dejó de jugar pierde la racha aunque no vuelva a abrir la app
CREATE OR REPLACE FUNCTION public.reset_expired_streaks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := public._club_day(now());
  v_count integer;
BEGIN
  UPDATE public.profiles
  SET streak_count = 0
  WHERE COALESCE(streak_count, 0) > 0
    AND (last_streak_update_at IS NULL
         OR (last_streak_update_at < v_today
             AND NOT public._streak_continues(last_streak_update_at, v_today)));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('vencer-rachas', '5 11 * * *', 'SELECT public.reset_expired_streaks()');
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.update_player_streaks_for_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_expired_streaks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_streak_on_complete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_protect_streak() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las dos columnas deben salir en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_streak_on_complete') AS racha_en_servidor,
  NOT has_function_privilege('authenticated', 'public.update_player_streaks_for_match(uuid)', 'EXECUTE') AS app_no_la_toca;
