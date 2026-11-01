-- ==============================================================================
-- REGLAS DEL SERVIDOR
-- Apuestas de quien anota, cola, datos de cobro, avisos de mesa, Duelo VIP y logros.
--
-- Orden: ejecutar después de 20261101_01_confirmacion_rival.sql.
-- Compatibilidad: ejecuta esto y publica la app nueva en el mismo rato. Mientras
-- tanto la app de hoy sigue abriendo y anotando; lo que deja de hacer es marcar en
-- la cola a un dúo ajeno y sus avisos "¡A la mesa!" no llegan a la app nueva.
-- Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Quien anota sin jugar no apuesta en esa partida
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_validate_bet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
BEGIN
  IF COALESCE(NEW.amount_wagered, 0) <= 0 OR NEW.multiplier IS NULL OR NEW.multiplier < 1 OR NEW.multiplier > 3.5 THEN
    RAISE EXCEPTION 'Monto o multiplicador inválido';
  END IF;

  IF COALESCE(NEW.status, 'pending') <> 'pending' THEN
    RAISE EXCEPTION 'Una apuesta nueva debe empezar en pending';
  END IF;

  SELECT status, team1_total, team2_total, created_by,
         team1_player1, team1_player2, team2_player1, team2_player2
    INTO v_match
  FROM public.matches
  WHERE id = NEW.match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida no encontrada';
  END IF;

  IF v_match.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'La partida no está activa';
  END IF;

  IF COALESCE(v_match.team1_total, 0) >= 50 OR COALESCE(v_match.team2_total, 0) >= 50 THEN
    RAISE EXCEPTION 'Apuestas cerradas: alguien llegó a 50 puntos';
  END IF;

  IF NEW.user_id IN (v_match.team1_player1, v_match.team1_player2) AND NEW.bet_on_team <> 1 THEN
    RAISE EXCEPTION 'Un jugador solo puede apostar por su propio equipo';
  END IF;

  IF NEW.user_id IN (v_match.team2_player1, v_match.team2_player2) AND NEW.bet_on_team <> 2 THEN
    RAISE EXCEPTION 'Un jugador solo puede apostar por su propio equipo';
  END IF;

  IF NEW.user_id = v_match.created_by
     AND NEW.user_id IS DISTINCT FROM v_match.team1_player1
     AND NEW.user_id IS DISTINCT FROM v_match.team1_player2
     AND NEW.user_id IS DISTINCT FROM v_match.team2_player1
     AND NEW.user_id IS DISTINCT FROM v_match.team2_player2 THEN
    RAISE EXCEPTION 'Quien anota sin jugar no puede apostar en esta partida';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_bet ON public.bets;
CREATE TRIGGER tr_validate_bet
  BEFORE INSERT ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_validate_bet();

REVOKE EXECUTE ON FUNCTION public.trg_fn_validate_bet() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Datos de cobro: solo su dueño y los admins
--    La columna vieja se queda solo con la marca "pagado"; el resto va a una
--    tabla privada. La app de hoy sigue pudiendo enviar sus datos.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_payouts (
  participant_id uuid PRIMARY KEY REFERENCES public.tournament_participants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  details jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tournament_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_payouts TO authenticated;

DROP POLICY IF EXISTS "Dueno y admins ven datos de cobro" ON public.tournament_payouts;
CREATE POLICY "Dueno y admins ven datos de cobro" ON public.tournament_payouts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

CREATE OR REPLACE FUNCTION public.trg_fn_split_payout_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_details jsonb;
  v_paid boolean;
  v_admin boolean;
BEGIN
  IF NEW.payout_details IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.payout_details IS NOT DISTINCT FROM OLD.payout_details THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_details := NEW.payout_details::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_details := jsonb_build_object('raw', NEW.payout_details);
  END;
  IF jsonb_typeof(v_details) <> 'object' THEN
    v_details := jsonb_build_object('raw', NEW.payout_details);
  END IF;

  v_admin := NOT public._is_app_request()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true);
  v_paid := COALESCE((v_details->>'paid')::boolean, false);
  IF NOT v_admin THEN
    v_paid := TG_OP = 'UPDATE' AND COALESCE((OLD.payout_details::jsonb->>'paid')::boolean, false);
  END IF;

  v_details := v_details - 'paid';
  IF v_details <> '{}'::jsonb THEN
    IF TG_OP = 'INSERT' THEN
      -- La fila aún no existe: se guarda justo después (tr_store_payout_after_insert)
      PERFORM set_config('app.pending_payout', v_details::text, true);
    ELSE
      INSERT INTO public.tournament_payouts(participant_id, user_id, details, updated_at)
      VALUES (NEW.id, NEW.user_id, v_details, now())
      ON CONFLICT (participant_id) DO UPDATE
        SET details = EXCLUDED.details, updated_at = now();
    END IF;
  END IF;

  NEW.payout_details := jsonb_build_object('paid', v_paid)::text;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_store_payout_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_details text := current_setting('app.pending_payout', true);
BEGIN
  IF COALESCE(v_details, '') <> '' THEN
    INSERT INTO public.tournament_payouts(participant_id, user_id, details)
    VALUES (NEW.id, NEW.user_id, v_details::jsonb)
    ON CONFLICT (participant_id) DO NOTHING;
    PERFORM set_config('app.pending_payout', '', true);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_split_payout_details ON public.tournament_participants;
CREATE TRIGGER tr_split_payout_details
  BEFORE INSERT OR UPDATE OF payout_details ON public.tournament_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_split_payout_details();

DROP TRIGGER IF EXISTS tr_store_payout_after_insert ON public.tournament_participants;
CREATE TRIGGER tr_store_payout_after_insert
  AFTER INSERT ON public.tournament_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_store_payout_after_insert();

-- Lo que ya exista pasa a la tabla privada (el trigger hace el trabajo)
UPDATE public.tournament_participants
SET payout_details = payout_details || ' '
WHERE payout_details IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.tournament_payouts t WHERE t.participant_id = tournament_participants.id)
  AND payout_details !~ '^\{"paid": (true|false)\} ?$';

REVOKE EXECUTE ON FUNCTION public.trg_fn_split_payout_details() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_store_payout_after_insert() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. Cola: cada quien toca su entrada y los admins todas
-- ------------------------------------------------------------------------------
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS called_at timestamptz,
  ADD COLUMN IF NOT EXISTS called_by_name text,
  ADD COLUMN IF NOT EXISTS near_turn_at timestamptz,
  ADD COLUMN IF NOT EXISTS near_turn_score integer,
  ADD COLUMN IF NOT EXISTS near_turn_limit integer;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'waitlist' LOOP
    EXECUTE format('DROP POLICY %I ON public.waitlist', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._waitlist_can_touch(p_creator uuid, p_player1 uuid, p_player2 uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IN (p_creator, p_player1, p_player2)
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true);
$$;

CREATE POLICY "Cola visible" ON public.waitlist FOR SELECT USING (true);
CREATE POLICY "Cada quien entra a la cola" ON public.waitlist FOR INSERT TO authenticated
  WITH CHECK (public._waitlist_can_touch(creator_id, player1_id, player2_id));
CREATE POLICY "Cada quien edita su entrada" ON public.waitlist FOR UPDATE TO authenticated
  USING (public._waitlist_can_touch(creator_id, player1_id, player2_id))
  WITH CHECK (public._waitlist_can_touch(creator_id, player1_id, player2_id));
CREATE POLICY "Cada quien borra su entrada" ON public.waitlist FOR DELETE TO authenticated
  USING (public._waitlist_can_touch(creator_id, player1_id, player2_id));

-- El turno y los avisos no se tocan desde la app, ni en la entrada propia
CREATE OR REPLACE FUNCTION public.trg_fn_protect_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_app_request() OR current_setting('app.allow_waitlist_call', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.creator_id := COALESCE(NEW.creator_id, auth.uid());
    NEW.created_at := now();
    NEW.called_at := NULL;
    NEW.called_by_name := NULL;
    NEW.near_turn_at := NULL;
    NEW.near_turn_score := NULL;
    NEW.near_turn_limit := NULL;
    RETURN NEW;
  END IF;
  NEW.created_at := OLD.created_at;
  NEW.called_at := OLD.called_at;
  NEW.called_by_name := OLD.called_by_name;
  NEW.near_turn_at := OLD.near_turn_at;
  NEW.near_turn_score := OLD.near_turn_score;
  NEW.near_turn_limit := OLD.near_turn_limit;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_waitlist ON public.waitlist;
CREATE TRIGGER tr_protect_waitlist
  BEFORE INSERT OR UPDATE ON public.waitlist
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_protect_waitlist();

-- ¿Esta persona está en una mesa activa (jugando o anotando)?
CREATE OR REPLACE FUNCTION public._user_at_active_table(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.status = 'active'
      AND p_uid IN (m.created_by, m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2)
  );
$$;

-- Sentar a un dúo: lo hace el dúo, un admin o quien creó la partida donde juega ese dúo
CREATE OR REPLACE FUNCTION public.seat_waitlist_entry(p_entry_id uuid, p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entry public.waitlist;
  v_match public.matches;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_entry FROM public.waitlist WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa entrada ya no está en la cola';
  END IF;
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;

  IF NOT public._waitlist_can_touch(v_entry.creator_id, v_entry.player1_id, v_entry.player2_id)
     AND NOT (FOUND
              AND v_match.status = 'active'
              AND v_match.created_by = v_uid
              AND v_entry.player1_id IN (v_match.team1_player1, v_match.team1_player2, v_match.team2_player1, v_match.team2_player2)
              AND v_entry.player2_id IN (v_match.team1_player1, v_match.team1_player2, v_match.team2_player1, v_match.team2_player2)) THEN
    RAISE EXCEPTION 'No puedes sentar a este dúo';
  END IF;

  UPDATE public.waitlist SET status = 'playing' WHERE id = p_entry_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Avisos de mesa: salen del servidor, y solo si los pide alguien de la mesa
--    La app escucha los cambios de la cola, que nadie más puede escribir.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.call_waitlist_duo(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_entry public.waitlist;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_entry FROM public.waitlist WHERE id = p_entry_id AND status = 'waiting' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese dúo ya no está esperando';
  END IF;

  IF NOT public._user_at_active_table(v_uid)
     AND NOT public._waitlist_can_touch(v_entry.creator_id, v_entry.player1_id, v_entry.player2_id) THEN
    RAISE EXCEPTION 'Solo alguien de la mesa puede llamar a un dúo';
  END IF;

  SELECT COALESCE(display_name, 'La Mesa') INTO v_name FROM public.profiles WHERE id = v_uid;

  PERFORM set_config('app.allow_waitlist_call', 'true', true);
  UPDATE public.waitlist SET called_at = now(), called_by_name = v_name WHERE id = p_entry_id;
  PERFORM set_config('app.allow_waitlist_call', 'false', true);
END;
$$;

-- Avisa al primer dúo de la cola cuando la partida va a menos de 10 puntos del final.
-- El marcador lo lee el servidor; no se acepta el que mande el teléfono.
-- Devuelve false si aún falta para el final, y la app vuelve a intentar en la próxima mano.
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
  IF COALESCE(v_match.limit_score, 0) <= 0 OR v_high < v_match.limit_score - 10 THEN
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

-- ------------------------------------------------------------------------------
-- 5. Duelo VIP: los puntos se apartan al aceptar y vuelven si se cancela
--    Los duelos ya activos antes de esta migración terminan con la regla vieja.
-- ------------------------------------------------------------------------------
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS wager_escrowed boolean NOT NULL DEFAULT false;

-- Si producción limita los valores de status, se admite 'cancelled'
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
      AND pg_get_constraintdef(oid) NOT ILIKE '%cancelled%'
  LOOP
    EXECUTE format('ALTER TABLE public.matches DROP CONSTRAINT %I', c.conname);
    EXECUTE format(
      'ALTER TABLE public.matches ADD CONSTRAINT %I CHECK ((%s) OR status = %L) NOT VALID',
      c.conname,
      regexp_replace(c.def, '^CHECK\s*\((.*)\)(\s+NOT VALID)?$', '\1'),
      'cancelled'
    );
  END LOOP;
END $$;

-- Devuelve lo apartado. No toca la fila de la partida: también corre mientras se borra.
CREATE OR REPLACE FUNCTION public._refund_wager_escrow(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.profiles p
  SET betting_points = COALESCE(p.betting_points, 0) + c.amount
  FROM public.wager_consents c
  WHERE c.match_id = p_match_id AND c.status = 'accepted' AND c.user_id = p.id;
END;
$$;

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

  -- Bloquear los 4 saldos y revisarlos otra vez (pudieron gastar en estos 60 s)
  PERFORM 1 FROM public.profiles p
  WHERE p.id IN (SELECT user_id FROM public.wager_consents WHERE match_id = p_match_id)
  ORDER BY p.id
  FOR UPDATE;

  SELECT string_agg(p.display_name, ', ') INTO v_short
  FROM public.wager_consents c
  JOIN public.profiles p ON p.id = c.user_id
  WHERE c.match_id = p_match_id AND COALESCE(p.betting_points, 0) < c.amount;
  IF v_short IS NOT NULL THEN
    UPDATE public.wager_consents SET status = 'cancelled' WHERE match_id = p_match_id;
    RETURN jsonb_build_object('status', 'insufficient', 'players', v_short);
  END IF;

  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.profiles p
  SET betting_points = COALESCE(p.betting_points, 0) - c.amount
  FROM public.wager_consents c
  WHERE c.match_id = p_match_id AND c.status = 'accepted' AND c.user_id = p.id;

  UPDATE public.matches
  SET is_wager_match = true, wager_amount = v_c.amount, wager_settled = false, wager_escrowed = true
  WHERE id = p_match_id;

  RETURN jsonb_build_object('status', 'active', 'amount', v_c.amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_match_wagers(
  p_match_id uuid,
  p_winner_team integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_wager integer;
  v_winners uuid[];
  v_losers uuid[];
  v_pot bigint;
  v_each integer;
BEGIN
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(v_match.is_wager_match, false) = false
     OR COALESCE(v_match.wager_amount, 0) <= 0
     OR COALESCE(v_match.wager_settled, false) = true THEN
    RETURN;
  END IF;

  PERFORM set_config('app.allow_points_change', 'true', true);
  PERFORM set_config('app.points_reason', 'Duelo VIP', true);

  -- Partida anulada: cada quien recupera lo apartado
  IF p_winner_team IS NULL THEN
    IF v_match.wager_escrowed THEN
      PERFORM public._refund_wager_escrow(p_match_id);
      UPDATE public.matches SET wager_settled = true WHERE id = p_match_id;
    END IF;
    PERFORM set_config('app.points_reason', '', true);
    RETURN;
  END IF;

  v_wager := v_match.wager_amount;

  IF (SELECT COUNT(*) FROM public.wager_consents
      WHERE match_id = p_match_id AND status = 'accepted' AND team IN (1, 2)) = 4 THEN
    -- Los que aceptaron, con su equipo original (aunque los hayan sustituido)
    SELECT array_agg(user_id) FILTER (WHERE team = p_winner_team),
           array_agg(user_id) FILTER (WHERE team <> p_winner_team)
      INTO v_winners, v_losers
    FROM public.wager_consents
    WHERE match_id = p_match_id AND status = 'accepted';
  ELSIF p_winner_team = 1 THEN
    v_winners := array_remove(ARRAY[v_match.team1_player1, v_match.team1_player2], NULL);
    v_losers := array_remove(ARRAY[v_match.team2_player1, v_match.team2_player2], NULL);
  ELSE
    v_winners := array_remove(ARRAY[v_match.team2_player1, v_match.team2_player2], NULL);
    v_losers := array_remove(ARRAY[v_match.team1_player1, v_match.team1_player2], NULL);
  END IF;

  IF v_match.wager_escrowed THEN
    -- Lo apartado por los 4 se reparte entre los ganadores
    SELECT COALESCE(SUM(amount), 0) INTO v_pot
    FROM public.wager_consents WHERE match_id = p_match_id AND status = 'accepted';
  ELSE
    -- Duelo anterior a esta migración: suma cero con lo que los perdedores tengan
    WITH taken AS (
      SELECT id, LEAST(GREATEST(COALESCE(betting_points, 0), 0), v_wager) AS amt
      FROM public.profiles
      WHERE id = ANY(v_losers)
      FOR UPDATE
    ), upd AS (
      UPDATE public.profiles p
      SET betting_points = COALESCE(p.betting_points, 0) - t.amt
      FROM taken t
      WHERE p.id = t.id
      RETURNING t.amt
    )
    SELECT COALESCE(SUM(amt), 0) INTO v_pot FROM upd;
  END IF;

  IF v_pot > 0 AND COALESCE(array_length(v_winners, 1), 0) > 0 THEN
    v_each := FLOOR(v_pot / array_length(v_winners, 1));
    UPDATE public.profiles
    SET betting_points = COALESCE(betting_points, 0) + v_each
    WHERE id = ANY(v_winners);
  END IF;

  UPDATE public.matches SET wager_settled = true WHERE id = p_match_id;
  PERFORM set_config('app.points_reason', '', true);
END;
$$;

-- Al borrar una partida también vuelve lo apartado del Duelo
CREATE OR REPLACE FUNCTION public.trg_fn_refund_bets_on_match_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.resolve_match_bets(OLD.id, NULL);
  IF OLD.wager_escrowed AND NOT COALESCE(OLD.wager_settled, false) THEN
    PERFORM public._refund_wager_escrow(OLD.id);
  END IF;
  RETURN OLD;
END;
$$;

-- Una partida abandonada no retiene puntos para siempre: pasados 2 días se cancela
-- y se devuelven Duelo y apuestas. No la llama la app; la programa pg_cron.
CREATE OR REPLACE FUNCTION public.cancel_abandoned_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT m.id FROM public.matches m
    WHERE m.status = 'active'
      AND m.created_at < now() - interval '2 days'
      AND (m.wager_escrowed OR EXISTS (SELECT 1 FROM public.bets b WHERE b.match_id = m.id AND b.status = 'pending'))
    FOR UPDATE
  LOOP
    PERFORM public.resolve_match_bets(v_id, NULL);
    PERFORM public.resolve_match_wagers(v_id, NULL);
    UPDATE public.matches SET status = 'cancelled' WHERE id = v_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('cancelar-partidas-abandonadas', '0 11 * * *', 'SELECT public.cancel_abandoned_matches()');
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 6. Logros: solo pagan si el servidor comprueba que se cumplieron
--    Misma cuenta que src/screens/AchievementsScreen.tsx. Lo ya cobrado no se toca.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._achievement_stats(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  v_in1 boolean;
  v_won boolean;
  v_mine integer;
  v_theirs integer;
  v_rounds integer;
  v_hour integer;
  v_streak integer := 0;
  v_max_streak integer := 0;
  v_total integer := 0;
  v_wins integer := 0;
  v_losses integer := 0;
  v_zap_given integer := 0;
  v_zap_recv integer := 0;
  v_late integer := 0;
  v_early integer := 0;
  v_close integer := 0;
  v_comeback integer := 0;
  v_fast integer := 0;
  v_long integer := 0;
  v_days date[] := '{}';
  v_opp uuid[] := '{}';
  v_partners uuid[] := '{}';
  v_prof jsonb;
BEGIN
  FOR m IN
    SELECT * FROM public.matches
    WHERE status = 'completed'
      AND p_uid IN (team1_player1, team1_player2, team2_player1, team2_player2)
    ORDER BY created_at
  LOOP
    v_in1 := p_uid IN (m.team1_player1, m.team1_player2);
    v_total := v_total + 1;
    v_hour := EXTRACT(HOUR FROM m.created_at AT TIME ZONE 'America/Caracas');
    v_days := array_append(v_days, (m.created_at AT TIME ZONE 'America/Caracas')::date);
    IF v_hour <= 4 THEN v_late := v_late + 1; END IF;
    IF v_hour BETWEEN 5 AND 8 THEN v_early := v_early + 1; END IF;

    IF v_in1 THEN
      v_partners := v_partners || array_remove(array_remove(ARRAY[m.team1_player1, m.team1_player2], p_uid), NULL);
      v_opp := v_opp || array_remove(ARRAY[m.team2_player1, m.team2_player2], NULL);
      v_mine := COALESCE(m.team1_total, 0); v_theirs := COALESCE(m.team2_total, 0);
    ELSE
      v_partners := v_partners || array_remove(array_remove(ARRAY[m.team2_player1, m.team2_player2], p_uid), NULL);
      v_opp := v_opp || array_remove(ARRAY[m.team1_player1, m.team1_player2], NULL);
      v_mine := COALESCE(m.team2_total, 0); v_theirs := COALESCE(m.team1_total, 0);
    END IF;

    v_won := (v_in1 AND m.winner_team = 1) OR (NOT v_in1 AND m.winner_team = 2);
    IF v_won THEN
      v_wins := v_wins + 1;
      v_streak := v_streak + 1;
      v_max_streak := GREATEST(v_max_streak, v_streak);
      IF m.is_zapato THEN v_zap_given := v_zap_given + 1; END IF;
      IF v_mine - v_theirs <= 5 THEN v_close := v_close + 1; END IF;
      v_rounds := COALESCE(jsonb_array_length(m.rounds), 0);
      IF v_rounds > 0 AND v_rounds <= 5 THEN v_fast := v_fast + 1; END IF;
      IF v_rounds > 20 THEN v_long := v_long + 1; END IF;
      IF v_theirs >= 50 THEN v_comeback := v_comeback + 1; END IF;
    ELSE
      v_losses := v_losses + 1;
      v_streak := 0;
      IF m.is_zapato THEN v_zap_recv := v_zap_recv + 1; END IF;
    END IF;
  END LOOP;

  SELECT to_jsonb(p) INTO v_prof FROM public.profiles p WHERE p.id = p_uid;

  RETURN jsonb_build_object(
    'total_matches', v_total, 'wins', v_wins, 'losses', v_losses,
    'zapatos_given', v_zap_given, 'zapatos_received', v_zap_recv,
    'max_win_streak', v_max_streak, 'played_late', v_late, 'played_early', v_early,
    'close_wins', v_close, 'comebacks', v_comeback, 'fast_wins', v_fast, 'long_wins', v_long,
    'unique_days', (SELECT COUNT(DISTINCT d) FROM unnest(v_days) d),
    'unique_opponents', (SELECT COUNT(DISTINCT o) FROM unnest(v_opp) o),
    'unique_partners', (SELECT COUNT(DISTINCT o) FROM unnest(v_partners) o),
    'bets_won', (SELECT COUNT(*) FROM public.bets WHERE user_id = p_uid AND status = 'won'),
    'bets_lost', (SELECT COUNT(*) FROM public.bets WHERE user_id = p_uid AND status = 'lost'),
    'max_bet', (SELECT COALESCE(MAX(amount_wagered), 0) FROM public.bets WHERE user_id = p_uid),
    'chat_messages', (SELECT COUNT(*) FROM public.live_chat WHERE user_id = p_uid),
    'max_points', COALESCE((v_prof->>'betting_points')::numeric, 0),
    'store_items', CASE WHEN jsonb_typeof(v_prof->'inventory') = 'array'
                        THEN jsonb_array_length(v_prof->'inventory') ELSE 0 END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_achievement(p_achievement_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_points integer;
  v_stat text;
  v_min numeric;
  v_prof jsonb;
  v_ach jsonb;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  -- Mismos premios y condiciones que ACHIEVEMENTS en src/screens/AchievementsScreen.tsx
  SELECT s.points, s.stat, s.min INTO v_points, v_stat, v_min
  FROM (VALUES
    ('play_1', 50, 'total_matches', 1), ('play_10', 100, 'total_matches', 10),
    ('play_50', 300, 'total_matches', 50), ('play_100', 1000, 'total_matches', 100),
    ('win_1', 50, 'wins', 1), ('win_10', 200, 'wins', 10),
    ('win_50', 500, 'wins', 50), ('win_100', 2000, 'wins', 100),
    ('zapato_1', 100, 'zapatos_given', 1), ('zapato_5', 300, 'zapatos_given', 5),
    ('zapato_15', 1000, 'zapatos_given', 15), ('zapato_50', 5000, 'zapatos_given', 50),
    ('lose_1', 10, 'losses', 1), ('lose_10', 50, 'losses', 10), ('lose_50', 200, 'losses', 50),
    ('zapatorecv_1', 20, 'zapatos_received', 1), ('zapatorecv_5', 100, 'zapatos_received', 5),
    ('zapatorecv_15', 500, 'zapatos_received', 15),
    ('bet_win_1', 50, 'bets_won', 1), ('bet_win_10', 200, 'bets_won', 10),
    ('bet_win_50', 1000, 'bets_won', 50),
    ('bet_lose_1', 10, 'bets_lost', 1), ('bet_lose_10', 50, 'bets_lost', 10),
    ('win_streak_3', 200, 'max_win_streak', 3), ('win_streak_5', 500, 'max_win_streak', 5),
    ('win_streak_10', 2000, 'max_win_streak', 10),
    ('rich_1000', 100, 'max_points', 1000), ('rich_5000', 500, 'max_points', 5000),
    ('rich_10000', 2000, 'max_points', 10000),
    ('night_owl', 100, 'played_late', 1), ('early_bird', 100, 'played_early', 1),
    ('loyal_3', 150, 'unique_days', 3), ('loyal_7', 400, 'unique_days', 7),
    ('loyal_30', 2000, 'unique_days', 30),
    ('play_vs_3', 100, 'unique_opponents', 3), ('play_vs_10', 300, 'unique_opponents', 10),
    ('partner_3', 100, 'unique_partners', 3), ('partner_10', 300, 'unique_partners', 10),
    ('close_win_1', 100, 'close_wins', 1), ('close_win_5', 400, 'close_wins', 5),
    ('comeback_1', 300, 'comebacks', 1), ('fast_match_1', 200, 'fast_wins', 1),
    ('long_match_1', 200, 'long_wins', 1),
    ('bet_100', 200, 'max_bet', 100), ('bet_1000', 1000, 'max_bet', 1000),
    ('chat_10', 50, 'chat_messages', 10), ('chat_100', 300, 'chat_messages', 100),
    ('store_1', 50, 'store_items', 1), ('store_5', 300, 'store_items', 5),
    ('billetera_gorda', 100, 'max_points', 500)
  ) AS s(id, points, stat, min)
  WHERE s.id = p_achievement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logro desconocido.';
  END IF;

  SELECT to_jsonb(p) INTO v_prof
  FROM public.profiles p
  WHERE p.id = v_uid
  FOR UPDATE;

  v_ach := COALESCE(v_prof->'achievements', '[]'::jsonb);
  IF jsonb_typeof(v_ach) <> 'array' THEN v_ach := '[]'::jsonb; END IF;

  IF v_ach ? p_achievement_id THEN
    RAISE EXCEPTION 'Ya reclamaste este logro.';
  END IF;

  IF COALESCE((public._achievement_stats(v_uid)->>v_stat)::numeric, 0) < v_min THEN
    RAISE EXCEPTION 'Todavía no cumples este logro.';
  END IF;

  v_ach := v_ach || to_jsonb(p_achievement_id);

  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.profiles p
  SET betting_points = COALESCE(p.betting_points, 0) + v_points,
      achievements = r.achievements
  FROM jsonb_populate_record(
    NULL::public.profiles,
    jsonb_build_object('achievements', v_ach)
  ) AS r
  WHERE p.id = v_uid
  RETURNING to_jsonb(p) INTO v_out;

  RETURN v_out;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Permisos
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._waitlist_can_touch(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._waitlist_can_touch(uuid, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_protect_waitlist() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._user_at_active_table(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._refund_wager_escrow(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_match_wagers(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_abandoned_matches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._achievement_stats(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seat_waitlist_entry(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.call_waitlist_duo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_near_turn(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_wager(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_achievement(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seat_waitlist_entry(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_waitlist_duo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_near_turn(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_wager(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_achievement(text) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las cuatro columnas deben salir en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_split_payout_details') AS cobro_privado,
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'waitlist' AND policyname = 'Cada quien edita su entrada') AS cola_cerrada,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'wager_escrowed') AS duelo_apartado,
  has_function_privilege('authenticated', 'public.call_waitlist_duo(uuid)', 'EXECUTE') AS avisos_listos;
