-- ==============================================================================
-- AVISO "¡CASI ES SU TURNO!" SOLO ANTES DE LLEGAR AL LÍMITE
-- Con una mano grande la partida saltaba el tramo de los últimos 10 puntos y el
-- aviso salía con la partida ya terminada ("va por 120 de 100").
--
-- Orden: ejecutar después de 20261101_11_direccion_send_push.sql.
-- Compatibilidad: la app anterior sigue funcionando. Se puede repetir sin daño.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.notify_near_turn(p_match_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_high integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND
     OR v_match.status IS DISTINCT FROM 'active'
     OR v_uid NOT IN (v_match.created_by, v_match.team1_player1, v_match.team1_player2,
                      v_match.team2_player1, v_match.team2_player2) THEN
    RAISE EXCEPTION 'Solo alguien de la mesa puede enviar este aviso';
  END IF;

  v_high := GREATEST(COALESCE(v_match.team1_total, 0), COALESCE(v_match.team2_total, 0));
  IF COALESCE(v_match.limit_score, 0) <= 0
     OR v_high < v_match.limit_score - 10
     OR v_high >= v_match.limit_score THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.allow_waitlist_call', 'true', true);
  UPDATE public.waitlist
  SET near_turn_at = now(), near_turn_score = v_high, near_turn_limit = v_match.limit_score
  WHERE id = (SELECT id FROM public.waitlist WHERE status = 'waiting' ORDER BY created_at LIMIT 1);
  PERFORM set_config('app.allow_waitlist_call', 'false', true);
  RETURN true;
END;
$$;

-- VERIFICACIÓN: debe salir true
SELECT pg_get_functiondef('public.notify_near_turn(uuid)'::regprocedure) LIKE '%v_high >= v_match.limit_score%' AS aviso_corregido;
