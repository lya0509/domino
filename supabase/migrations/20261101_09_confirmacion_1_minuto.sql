-- ==============================================================================
-- CONFIRMACIÓN EN 1 MINUTO
-- La cuenta regresiva de las partidas normales baja de 2 minutos a 1. Al llegar a
-- cero, el teléfono del rival pide cerrar la partida y el servidor comprueba la
-- hora, sin esperar a la revisión de cada minuto, que queda de respaldo.
--
-- Orden: ejecutar después de 20261101_08_confirmacion_todas.sql.
-- Compatibilidad: la app publicada hoy sigue funcionando. Ejecuta esto ANTES de
-- publicar la app nueva. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

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
                                THEN now() + interval '1 minute' END;
  END IF;

  RETURN NEW;
END;
$$;

-- Solo actúa si el tiempo ya venció y no hay nada en juego, así que cualquiera puede pedirlo
CREATE OR REPLACE FUNCTION public.finish_expired_match(p_match_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.matches;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND
     OR v_match.status IS DISTINCT FROM 'pending_confirmation'
     OR v_match.auto_confirm_at IS NULL
     OR v_match.auto_confirm_at > now()
     OR public._match_has_stakes(v_match) THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.allow_match_close', 'true', true);
  UPDATE public.matches SET status = 'completed', confirmed_at = now() WHERE id = p_match_id;
  PERFORM set_config('app.allow_match_close', 'false', true);

  IF v_match.is_zapato THEN
    PERFORM public.award_zapatero_maestro(u)
    FROM unnest(CASE WHEN v_match.winner_team = 1
                     THEN ARRAY[v_match.team1_player1, v_match.team1_player2]
                     ELSE ARRAY[v_match.team2_player1, v_match.team2_player2] END) AS u
    WHERE u IS NOT NULL;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_fn_match_close_gate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_expired_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_expired_match(uuid) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las dos columnas deben salir en true
-- ==============================================================================
SELECT
  has_function_privilege('authenticated', 'public.finish_expired_match(uuid)', 'EXECUTE') AS cierre_al_llegar_a_cero,
  NOT has_function_privilege('anon', 'public.finish_expired_match(uuid)', 'EXECUTE') AS anonimo_no_cierra;
