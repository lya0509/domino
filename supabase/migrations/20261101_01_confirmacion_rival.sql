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
  ADD COLUMN IF NOT EXISTS disputed_round jsonb,
  ADD COLUMN IF NOT EXISTS initial_team1 uuid[],
  ADD COLUMN IF NOT EXISTS initial_team2 uuid[];

-- Las partidas en curso conservan a quienes están sentados ahora
UPDATE public.matches
SET initial_team1 = array_remove(ARRAY[team1_player1, team1_player2], NULL),
    initial_team2 = array_remove(ARRAY[team2_player1, team2_player2], NULL)
WHERE status = 'active' AND initial_team1 IS NULL;

-- Los rivales se fijan al crear la partida: quien entra después como sustituto no confirma
CREATE OR REPLACE FUNCTION public.trg_fn_match_initial_lineup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.initial_team1 := array_remove(ARRAY[NEW.team1_player1, NEW.team1_player2], NULL);
  NEW.initial_team2 := array_remove(ARRAY[NEW.team2_player1, NEW.team2_player2], NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_match_initial_lineup ON public.matches;
CREATE TRIGGER tr_match_initial_lineup
  BEFORE INSERT ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_match_initial_lineup();

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

-- Quiénes son rivales: el equipo contrario a quien cerró, tal como empezó la partida.
-- Si cerró alguien que no está jugando, responde el equipo que pierde con ese resultado.
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
  v_i1 uuid[] := COALESCE(p.initial_team1, v_t1);
  v_i2 uuid[] := COALESCE(p.initial_team2, v_t2);
BEGIN
  IF p.closed_by = ANY(v_t1 || v_i1) THEN RETURN v_i2; END IF;
  IF p.closed_by = ANY(v_t2 || v_i2) THEN RETURN v_i1; END IF;
  IF p.winner_team = 1 THEN RETURN v_i2; END IF;
  IF p.winner_team = 2 THEN RETURN v_i1; END IF;
  RETURN v_i1 || v_i2;
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

  -- El logro no debe impedir el pago
  IF v_match.is_zapato THEN
    BEGIN
      PERFORM public.award_zapatero_maestro(u)
      FROM unnest(CASE WHEN v_match.winner_team = 1
                       THEN ARRAY[v_match.team1_player1, v_match.team1_player2]
                       ELSE ARRAY[v_match.team2_player1, v_match.team2_player2] END) AS u
      WHERE u IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

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

-- Eliminar una cuenta sigue quitando su nombre de las partidas ya terminadas
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sql text;
  v_deleted boolean := false;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;
  v_label := 'Jugador eliminado ' || upper(left(v_uid::text, 4));

  -- 1. Lo que es solo suyo (si una tabla o columna no existe, se salta)
  FOREACH v_sql IN ARRAY ARRAY[
    'DELETE FROM public.waitlist WHERE creator_id = $1 OR player1_id = $1 OR player2_id = $1',
    'DELETE FROM public.global_chat WHERE user_id = $1',
    'DELETE FROM public.live_chat WHERE user_id = $1',
    'DELETE FROM public.duos WHERE player1_id = $1 OR player2_id = $1',
    'DELETE FROM public.bets WHERE user_id = $1',
    'DELETE FROM public.wager_consents WHERE user_id = $1',
    'UPDATE public.tournament_participants SET partner_id = NULL, partner_status = NULL WHERE partner_id = $1',
    'DELETE FROM public.tournament_participants WHERE user_id = $1',
    'UPDATE public.tournaments SET created_by = NULL WHERE created_by = $1'
  ] LOOP
    BEGIN
      EXECUTE v_sql USING v_uid;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  -- 2. Su nombre fuera de las partidas guardadas (las partidas siguen siendo de los demás)
  PERFORM set_config('app.allow_match_close', 'true', true);
  BEGIN
    UPDATE public.matches m
    SET players_json = (
      SELECT jsonb_agg(CASE WHEN e->>'profileId' = v_uid::text
                            THEN e || jsonb_build_object('name', v_label, 'initials', '--')
                            ELSE e END)
      FROM jsonb_array_elements(m.players_json::jsonb) e
    )
    WHERE jsonb_typeof(m.players_json::jsonb) = 'array'
      AND m.players_json::jsonb @> jsonb_build_array(jsonb_build_object('profileId', v_uid::text));
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    NULL;
  END;
  PERFORM set_config('app.allow_match_close', 'false', true);

  -- 3. El perfil: borrarlo, o anonimizarlo si su historial lo necesita
  PERFORM set_config('app.allow_points_change', 'true', true);
  PERFORM set_config('app.allow_admin_toggle', 'true', true);
  BEGIN
    DELETE FROM public.profiles WHERE id = v_uid;
    v_deleted := true;
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE public.profiles p
    SET display_name = v_label,
        initials = '--',
        avatar_url = NULL,
        betting_points = 0,
        is_admin = false,
        inventory = r.inventory,
        achievements = r.achievements,
        equipped_items = r.equipped_items
    FROM jsonb_populate_record(NULL::public.profiles,
           '{"inventory": [], "achievements": [], "equipped_items": {}}'::jsonb) r
    WHERE p.id = v_uid;
  END;

  -- 4. El acceso: borrarlo, o quitarle correo y contraseña y bloquearlo
  IF v_deleted THEN
    DELETE FROM auth.users WHERE id = v_uid;
  ELSE
    DELETE FROM auth.identities WHERE user_id = v_uid;
    DELETE FROM auth.sessions WHERE user_id = v_uid;
    BEGIN
      DELETE FROM auth.refresh_tokens WHERE user_id = v_uid::text;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
    UPDATE auth.users
    SET email = 'eliminado+' || v_uid::text || '@invalid.local',
        phone = NULL,
        encrypted_password = '',
        raw_user_meta_data = '{}'::jsonb,
        banned_until = now() + interval '100 years'
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('deleted', true, 'mode', CASE WHEN v_deleted THEN 'deleted' ELSE 'anonymized' END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._match_needs_confirmation(public.matches) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._match_rivals(public.matches) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._match_can_answer(public.matches, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_match_close_gate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_match_initial_lineup() FROM PUBLIC, anon, authenticated;
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
