-- ==============================================================================
-- CONFIRMACIÓN DEL RIVAL
-- Una partida con apuestas, Duelo VIP o torneo no paga nada al terminar: queda
-- "por confirmar" hasta que un jugador rival o un admin la confirme. Si el rival
-- no está de acuerdo, se quita la última mano y la partida vuelve a estar activa.
-- Las partidas normales cierran como siempre.
--
-- Orden: ejecutar después de 20261031_02_cierre_urgente.sql.
-- Compatibilidad: publica primero la app nueva o ambas cosas a la vez. La app
-- nueva funciona antes y después de esta migración. La app de hoy guarda bien la
-- partida, pero no tiene botones para confirmarla: esas partidas esperarían a la
-- app nueva, sin pagar ni perder nada. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_round jsonb;

-- Si producción limita los valores de status, se amplía conservando lo que ya permite
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%pending_confirmation%'
  LOOP
    EXECUTE format('ALTER TABLE public.matches DROP CONSTRAINT %I', c.conname);
    EXECUTE format(
      'ALTER TABLE public.matches ADD CONSTRAINT %I CHECK ((%s) OR status = %L) NOT VALID',
      c.conname,
      regexp_replace(c.def, '^CHECK\s*\((.*)\)(\s+NOT VALID)?$', '\1'),
      'pending_confirmation'
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_matches_por_confirmar
  ON public.matches(closed_at DESC) WHERE status = 'pending_confirmation';

-- ¿Esta partida necesita que un rival la confirme?
CREATE OR REPLACE FUNCTION public._match_needs_confirmation(p public.matches)
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

-- Quiénes son rivales: el equipo contrario a quien cerró. Si cerró alguien que no
-- está jugando, responde el equipo que pierde con ese resultado.
CREATE OR REPLACE FUNCTION public._match_rivals(p public.matches)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t1 uuid[] := array_remove(ARRAY[p.team1_player1, p.team1_player2], NULL);
  v_t2 uuid[] := array_remove(ARRAY[p.team2_player1, p.team2_player2], NULL);
BEGIN
  IF p.closed_by = ANY(v_t1) THEN RETURN v_t2; END IF;
  IF p.closed_by = ANY(v_t2) THEN RETURN v_t1; END IF;
  IF p.winner_team = 1 THEN RETURN v_t2; END IF;
  IF p.winner_team = 2 THEN RETURN v_t1; END IF;
  RETURN v_t1 || v_t2;
END;
$$;

CREATE OR REPLACE FUNCTION public._match_can_answer(p public.matches, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_uid = ANY(public._match_rivals(p))
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_uid AND is_admin = true);
$$;

-- Corre después de tr_protect_match_fields (orden alfabético), con los campos ya protegidos
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
  IF OLD.status IN ('completed', 'pending_confirmation') THEN
    RETURN OLD;
  END IF;

  IF NEW.status IN ('completed', 'pending_confirmation') THEN
    NEW.closed_by := auth.uid();
    NEW.closed_at := now();
    NEW.status := CASE WHEN public._match_needs_confirmation(NEW)
                       THEN 'pending_confirmation' ELSE 'completed' END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_zz_match_close_gate ON public.matches;
CREATE TRIGGER tr_zz_match_close_gate
  BEFORE UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_match_close_gate();

CREATE OR REPLACE FUNCTION public.confirm_match_result(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida no encontrada';
  END IF;
  IF v_match.status IS DISTINCT FROM 'pending_confirmation' THEN
    RAISE EXCEPTION 'Esta partida ya no está por confirmar';
  END IF;
  IF NOT public._match_can_answer(v_match, v_uid) THEN
    RAISE EXCEPTION 'Solo un jugador rival o un admin puede confirmar';
  END IF;

  PERFORM set_config('app.allow_match_close', 'true', true);
  UPDATE public.matches
  SET status = 'completed', confirmed_by = v_uid, confirmed_at = now()
  WHERE id = p_match_id;
  PERFORM public.settle_completed_match(p_match_id);
  PERFORM set_config('app.allow_match_close', 'false', true);

  -- La racha y el logro no deben impedir el pago
  BEGIN
    PERFORM public.update_player_streaks_for_match(p_match_id);
    IF v_match.is_zapato THEN
      PERFORM public.award_zapatero_maestro(u)
      FROM unnest(CASE WHEN v_match.winner_team = 1
                       THEN ARRAY[v_match.team1_player1, v_match.team1_player2]
                       ELSE ARRAY[v_match.team2_player1, v_match.team2_player2] END) AS u
      WHERE u IS NOT NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('status', 'completed', 'winner_team', v_match.winner_team);
END;
$$;

CREATE OR REPLACE FUNCTION public.dispute_match_result(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_rounds jsonb;
  v_last jsonb;
  v_t1 integer;
  v_t2 integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida no encontrada';
  END IF;
  IF v_match.status IS DISTINCT FROM 'pending_confirmation' THEN
    RAISE EXCEPTION 'Esta partida ya no está por confirmar';
  END IF;
  IF NOT public._match_can_answer(v_match, v_uid) THEN
    RAISE EXCEPTION 'Solo un jugador rival o un admin puede responder';
  END IF;

  v_rounds := COALESCE(v_match.rounds, '[]'::jsonb);
  IF jsonb_array_length(v_rounds) > 0 THEN
    v_last := v_rounds -> -1;
    v_rounds := v_rounds - (jsonb_array_length(v_rounds) - 1);
  END IF;

  SELECT COALESCE(SUM((r->>'points')::integer) FILTER (WHERE r->>'scorerId' = 'team1'), 0),
         COALESCE(SUM((r->>'points')::integer) FILTER (WHERE r->>'scorerId' = 'team2'), 0)
    INTO v_t1, v_t2
  FROM jsonb_array_elements(v_rounds) r;

  PERFORM set_config('app.allow_match_close', 'true', true);
  UPDATE public.matches
  SET status = 'active', winner_team = NULL, is_zapato = false,
      rounds = v_rounds, team1_total = v_t1, team2_total = v_t2,
      closed_by = NULL, closed_at = NULL,
      disputed_by = v_uid, disputed_at = now(), disputed_round = v_last
  WHERE id = p_match_id;
  PERFORM set_config('app.allow_match_close', 'false', true);

  RETURN jsonb_build_object('status', 'active', 'removed_round', v_last);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._match_needs_confirmation(public.matches) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._match_rivals(public.matches) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._match_can_answer(public.matches, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_match_close_gate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_match_result(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dispute_match_result(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_match_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_match_result(uuid) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las tres columnas deben salir en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_zz_match_close_gate') AS porton_activo,
  has_function_privilege('authenticated', 'public.confirm_match_result(uuid)', 'EXECUTE') AS app_confirma,
  NOT has_function_privilege('anon', 'public.confirm_match_result(uuid)', 'EXECUTE') AS anonimo_no_confirma;
