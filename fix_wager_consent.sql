-- ==============================================================================
-- CONSENTIMIENTO DE LA APUESTA VIP (wager)
-- Antes, quien creaba la partida fijaba la apuesta y los otros 3 jugadores
-- perdían puntos sin haber aceptado nada.
-- Ahora:
--   * la partida se crea SIN apuesta;
--   * propose_wager envía la propuesta a los 4 jugadores (60 segundos);
--   * cada uno responde con respond_wager desde su teléfono;
--   * la apuesta se activa solo si los 4 aceptan antes de la primera mano
--     y todos tienen saldo. Si alguien rechaza o no contesta, no hay apuesta.
--   * Nadie puede activar la apuesta de otra forma (ni al crear la partida).
--
-- Requiere haber ejecutado antes fix_points_security.sql.
-- Ejecuta todo en el SQL Editor de Supabase. Es seguro repetirlo.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Tabla de respuestas (una fila por jugador y partida)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wager_consents (
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  proposed_by uuid,
  status text NOT NULL DEFAULT 'pending', -- pending | accepted | declined | cancelled
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

ALTER TABLE public.wager_consents ENABLE ROW LEVEL SECURITY;

-- Ver: tus propias filas y las de las partidas donde juegas o que creaste.
-- Escribir: solo las funciones de abajo (no hay políticas de INSERT/UPDATE/DELETE).
DROP POLICY IF EXISTS "Jugadores ven el consentimiento de su partida" ON public.wager_consents;
CREATE POLICY "Jugadores ven el consentimiento de su partida" ON public.wager_consents
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = wager_consents.match_id
        AND (auth.uid() IN (m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2)
             OR m.created_by = auth.uid())
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.wager_consents FROM anon, authenticated;

-- Tiempo real (el aviso le llega al teléfono de cada jugador)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wager_consents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wager_consents;
  END IF;
END $$;

-- ¿La partida sigue sin empezar? (sin manos anotadas)
CREATE OR REPLACE FUNCTION public._match_not_started(p_match public.matches)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(p_match.team1_total, 0) = 0
     AND COALESCE(p_match.team2_total, 0) = 0
     AND COALESCE(jsonb_array_length(
           CASE WHEN jsonb_typeof(to_jsonb(p_match.rounds)) = 'array' THEN to_jsonb(p_match.rounds) ELSE '[]'::jsonb END
         ), 0) = 0;
$$;

-- ------------------------------------------------------------------------------
-- 2. Proponer la apuesta (quien creó la partida o uno de los jugadores)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propose_wager(p_match_id uuid, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m public.matches%ROWTYPE;
  v_players uuid[];
  v_short text;
  v_expires timestamptz := now() + interval '60 seconds';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Monto de apuesta inválido.';
  END IF;

  SELECT * INTO v_m FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida no encontrada.';
  END IF;

  v_players := ARRAY[v_m.team1_player1, v_m.team1_player2, v_m.team2_player1, v_m.team2_player2];

  IF v_m.status IS DISTINCT FROM 'active' OR v_m.tournament_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo se puede apostar en una partida normal activa.';
  END IF;
  IF array_position(v_players, NULL) IS NOT NULL
     OR (SELECT COUNT(DISTINCT x) FROM unnest(v_players) x) <> 4 THEN
    RAISE EXCEPTION 'La apuesta VIP necesita 4 jugadores registrados.';
  END IF;
  IF v_uid IS DISTINCT FROM v_m.created_by AND NOT (v_uid = ANY(v_players)) THEN
    RAISE EXCEPTION 'Solo quien creó la partida o un jugador puede proponer la apuesta.';
  END IF;
  IF COALESCE(v_m.is_wager_match, false) THEN
    RAISE EXCEPTION 'Esta partida ya tiene apuesta.';
  END IF;
  IF NOT public._match_not_started(v_m) THEN
    RAISE EXCEPTION 'La partida ya empezó: la apuesta se propone antes de la primera mano.';
  END IF;

  SELECT string_agg(display_name, ', ') INTO v_short
  FROM public.profiles
  WHERE id = ANY(v_players) AND COALESCE(betting_points, 0) < p_amount;
  IF v_short IS NOT NULL THEN
    RAISE EXCEPTION 'Sin puntos suficientes (% pts): %', p_amount, v_short;
  END IF;

  DELETE FROM public.wager_consents WHERE match_id = p_match_id;

  INSERT INTO public.wager_consents (match_id, user_id, amount, proposed_by, status, expires_at, responded_at)
  SELECT p_match_id, x, p_amount, v_uid,
         CASE WHEN x = v_uid THEN 'accepted' ELSE 'pending' END,
         v_expires,
         CASE WHEN x = v_uid THEN now() END
  FROM unnest(v_players) AS x;

  RETURN jsonb_build_object('status', 'pending', 'expires_at', v_expires, 'amount', p_amount);
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Responder (cada jugador desde su teléfono)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_wager(p_match_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c public.wager_consents%ROWTYPE;
  v_m public.matches%ROWTYPE;
  v_accepted integer;
  v_short text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  -- Bloquear la partida primero: las 4 respuestas se procesan en orden
  SELECT * INTO v_m FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida no encontrada.';
  END IF;

  SELECT * INTO v_c FROM public.wager_consents
  WHERE match_id = p_match_id AND user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No tienes ninguna apuesta propuesta en esta partida.';
  END IF;
  IF v_c.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_c.status);
  END IF;

  IF now() > v_c.expires_at
     OR v_m.status IS DISTINCT FROM 'active'
     OR NOT public._match_not_started(v_m) THEN
    UPDATE public.wager_consents SET status = 'cancelled'
    WHERE match_id = p_match_id AND status = 'pending';
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF NOT p_accept THEN
    UPDATE public.wager_consents SET status = 'declined', responded_at = now()
    WHERE match_id = p_match_id AND user_id = v_uid;
    UPDATE public.wager_consents SET status = 'cancelled'
    WHERE match_id = p_match_id AND status = 'pending';
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  UPDATE public.wager_consents SET status = 'accepted', responded_at = now()
  WHERE match_id = p_match_id AND user_id = v_uid;

  SELECT COUNT(*) FILTER (WHERE status = 'accepted') INTO v_accepted
  FROM public.wager_consents WHERE match_id = p_match_id;

  IF v_accepted < 4 THEN
    RETURN jsonb_build_object('status', 'pending', 'accepted', v_accepted);
  END IF;

  -- Los 4 aceptaron: revisar saldos otra vez (pudieron gastar en estos 60 s)
  SELECT string_agg(p.display_name, ', ') INTO v_short
  FROM public.wager_consents c
  JOIN public.profiles p ON p.id = c.user_id
  WHERE c.match_id = p_match_id AND COALESCE(p.betting_points, 0) < c.amount;
  IF v_short IS NOT NULL THEN
    UPDATE public.wager_consents SET status = 'cancelled' WHERE match_id = p_match_id;
    RETURN jsonb_build_object('status', 'insufficient', 'players', v_short);
  END IF;

  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.matches
  SET is_wager_match = true, wager_amount = v_c.amount, wager_settled = false
  WHERE id = p_match_id;

  RETURN jsonb_build_object('status', 'active', 'amount', v_c.amount);
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. La apuesta solo nace por consentimiento: la app ya no puede ponerla
--    ni al crear la partida ni después (tampoco un admin por accidente,
--    p. ej. al guardar la partida con los datos viejos del teléfono)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_protect_match_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_app_request() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.wager_settled := false;
    NEW.is_wager_match := false;
    NEW.wager_amount := 0;
    RETURN NEW;
  END IF;

  IF current_setting('app.allow_points_change', true) = 'true' THEN
    RETURN NEW; -- respond_wager activando / resolve_match_wagers liquidando
  END IF;

  NEW.wager_amount := OLD.wager_amount;
  NEW.is_wager_match := OLD.is_wager_match;
  NEW.wager_settled := OLD.wager_settled;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_fn_protect_match_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.propose_wager(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_wager(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_wager(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_wager(uuid, boolean) TO authenticated;
GRANT SELECT ON public.wager_consents TO authenticated;

COMMIT;


-- ==============================================================================
-- VERIFICACIÓN (mándame captura de las 2)
-- ==============================================================================

-- A. Deben salir propose_wager y respond_wager, solo con authenticated
SELECT routine_name, grantee
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND routine_name IN ('propose_wager', 'respond_wager', 'trg_fn_protect_match_fields')
ORDER BY routine_name, grantee;

-- B. La tabla nueva: RLS activado y en tiempo real (las dos columnas en true)
SELECT
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.wager_consents'::regclass) AS rls_activado,
  EXISTS (SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND tablename = 'wager_consents') AS en_tiempo_real;
