-- ==============================================================================
-- PUNTOS: historial, premio por ganar y límite de apuesta
-- - Cada cambio de saldo queda en el historial, venga de donde venga.
-- - Cada usuario arranca con un movimiento inicial igual a su saldo actual.
-- - Ganar paga +20, con tope de 3 premios al día. El torneo no paga +20.
-- - Se apuesta hasta 1.000 puntos por persona y partida (system_config lo ajusta).
-- Los saldos actuales no se tocan.
--
-- Orden: ejecutar después de 20261101_03_rachas.sql.
-- Compatibilidad: la app de hoy sigue funcionando; solo no muestra el historial.
-- Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta numeric NOT NULL,
  balance numeric NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_points_ledger_user ON public.points_ledger(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_ledger_inicial
  ON public.points_ledger(user_id) WHERE reason = 'Saldo inicial';

ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.points_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.points_ledger TO authenticated;

DROP POLICY IF EXISTS "Dueno y admins ven el historial" ON public.points_ledger;
CREATE POLICY "Dueno y admins ven el historial" ON public.points_ledger
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- El motivo lo pone quien mueve los puntos. Si no lo dice, se deduce de la función
-- que pidió la app, para que ningún movimiento quede fuera del historial.
CREATE OR REPLACE FUNCTION public.trg_fn_points_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := NULLIF(current_setting('app.points_reason', true), '');
  v_query text := current_query();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.points_ledger(user_id, delta, balance, reason)
    VALUES (NEW.id, COALESCE(NEW.betting_points, 0), COALESCE(NEW.betting_points, 0), 'Saldo inicial')
    ON CONFLICT DO NOTHING;
    RETURN NULL;
  END IF;

  v_reason := COALESCE(v_reason, CASE
    WHEN v_query LIKE '%place_bet%' THEN 'Apuesta'
    WHEN v_query LIKE '%confirm_match_result%' OR v_query LIKE '%settle_%' THEN 'Resultado de apuesta'
    WHEN v_query LIKE '%matches%' THEN 'Resultado de apuesta'
    WHEN v_query LIKE '%buy_store_item%' THEN 'Compra en la tienda'
    WHEN v_query LIKE '%claim_achievement%' THEN 'Logro'
    WHEN v_query LIKE '%claim_daily_bonus%' THEN 'Bono diario'
    WHEN v_query LIKE '%respond_wager%' THEN 'Duelo VIP'
    WHEN v_query LIKE '%join_tournament%' THEN 'Inscripción de torneo'
    WHEN v_query LIKE '%cancel_tournament%' THEN 'Reembolso de torneo'
    WHEN v_query LIKE '%award_tournament%' OR v_query LIKE '%tournament%' THEN 'Premio de torneo'
    ELSE 'Ajuste'
  END);

  INSERT INTO public.points_ledger(user_id, delta, balance, reason)
  VALUES (NEW.id, COALESCE(NEW.betting_points, 0) - COALESCE(OLD.betting_points, 0), COALESCE(NEW.betting_points, 0), v_reason);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_points_ledger ON public.profiles;
CREATE TRIGGER tr_points_ledger
  AFTER UPDATE OF betting_points ON public.profiles
  FOR EACH ROW
  WHEN (OLD.betting_points IS DISTINCT FROM NEW.betting_points)
  EXECUTE FUNCTION public.trg_fn_points_ledger();

DROP TRIGGER IF EXISTS tr_points_ledger_new_user ON public.profiles;
CREATE TRIGGER tr_points_ledger_new_user
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_points_ledger();

INSERT INTO public.points_ledger(user_id, delta, balance, reason)
SELECT id, COALESCE(betting_points, 0), COALESCE(betting_points, 0), 'Saldo inicial'
FROM public.profiles
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------
-- Premio por ganar
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_prizes (
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  club_day date NOT NULL,
  amount integer NOT NULL,
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

ALTER TABLE public.match_prizes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_prizes FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_match_prizes_dia ON public.match_prizes(user_id, club_day);

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
    IF (SELECT COUNT(*) FROM public.match_prizes
        WHERE user_id = v_uid AND club_day = v_day AND reverted_at IS NULL) >= 3 THEN
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

CREATE OR REPLACE FUNCTION public._revert_match_prizes(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  PERFORM set_config('app.allow_points_change', 'true', true);
  PERFORM set_config('app.points_reason', 'Premio revertido por corrección', true);
  FOR r IN
    SELECT user_id, amount FROM public.match_prizes
    WHERE match_id = p_match_id AND reverted_at IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.profiles
    SET betting_points = GREATEST(COALESCE(betting_points, 0) - r.amount, 0)
    WHERE id = r.user_id;
    UPDATE public.match_prizes SET reverted_at = now()
    WHERE match_id = p_match_id AND user_id = r.user_id;
  END LOOP;
  PERFORM set_config('app.points_reason', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_match_prize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    PERFORM public._revert_match_prizes(NEW.id);
  END IF;
  PERFORM public._award_match_prize(NEW);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_match_prize ON public.matches;
CREATE TRIGGER tr_match_prize
  AFTER UPDATE OF status ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.trg_fn_match_prize();

DROP TRIGGER IF EXISTS tr_match_prize_insert ON public.matches;
CREATE TRIGGER tr_match_prize_insert
  AFTER INSERT ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.trg_fn_match_prize();

-- Corregir el ganador de una partida ya pagada revierte el premio y paga al correcto
DROP TRIGGER IF EXISTS tr_match_prize_fix ON public.matches;
CREATE TRIGGER tr_match_prize_fix
  AFTER UPDATE OF winner_team ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status = 'completed'
        AND OLD.winner_team IS DISTINCT FROM NEW.winner_team)
  EXECUTE FUNCTION public.trg_fn_match_prize();

-- ------------------------------------------------------------------------------
-- Límite de apuesta por persona y partida
-- ------------------------------------------------------------------------------
ALTER TABLE public.system_config ADD COLUMN IF NOT EXISTS max_bet_per_match integer NOT NULL DEFAULT 1000;

CREATE OR REPLACE FUNCTION public.trg_fn_bet_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_used bigint;
BEGIN
  SELECT max_bet_per_match INTO v_limit FROM public.system_config ORDER BY id LIMIT 1;
  v_limit := COALESCE(v_limit, 1000);

  SELECT COALESCE(SUM(amount_wagered), 0) INTO v_used
  FROM public.bets
  WHERE user_id = NEW.user_id AND match_id = NEW.match_id AND status <> 'cancelled';

  IF v_used + NEW.amount_wagered > v_limit THEN
    RAISE EXCEPTION 'Límite de apuesta: máximo % puntos por partida. Te quedan %.', v_limit, GREATEST(v_limit - v_used, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_bet_limit ON public.bets;
CREATE TRIGGER tr_bet_limit
  BEFORE INSERT ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_bet_limit();

REVOKE EXECUTE ON FUNCTION public.trg_fn_points_ledger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._award_match_prize(public.matches) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._revert_match_prizes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_match_prize() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_bet_limit() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las dos primeras columnas deben coincidir y la tercera salir en true
-- ==============================================================================
SELECT
  (SELECT count(*) FROM public.profiles) AS usuarios,
  (SELECT count(*) FROM public.points_ledger WHERE reason = 'Saldo inicial') AS saldos_iniciales,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_match_prize') AS premio_activo;
