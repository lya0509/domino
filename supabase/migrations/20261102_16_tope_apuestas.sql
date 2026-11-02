-- ==============================================================================
-- TOPE DIARIO A LO QUE SE GANA CON APUESTAS
-- - Una apuesta ganada siempre devuelve lo apostado.
-- - La ganancia (lo que paga por encima de lo apostado) suma como máximo
--   system_config.max_bet_profit_per_day al día del club por persona (500 al empezar).
--   Pasado el tope, la apuesta ganada solo devuelve lo apostado.
-- - Cada apuesta guarda lo que pagó de verdad (payout) y el día del club en que se
--   resolvió (settled_day), para que la app muestre el pago real.
-- - get_my_bet_profit_left() dice cuánto le queda hoy a quien pregunta.
--
-- Orden: después de 20261101_04_puntos.sql. Se puede repetir sin daño.
-- Para cambiar el tope: UPDATE public.system_config SET max_bet_profit_per_day = 800;
-- ==============================================================================
BEGIN;

ALTER TABLE public.system_config ADD COLUMN IF NOT EXISTS max_bet_profit_per_day integer NOT NULL DEFAULT 500;
ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS payout integer;
ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS settled_day date;

CREATE INDEX IF NOT EXISTS bets_user_settled_day_idx ON public.bets(user_id, settled_day) WHERE status = 'won';

-- Ganancia ya cobrada hoy por apuestas
CREATE OR REPLACE FUNCTION public._bet_profit_on_day(p_user uuid, p_day date)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(payout, 0) - amount_wagered, 0)), 0)
  FROM public.bets
  WHERE user_id = p_user AND status = 'won' AND settled_day = p_day;
$$;

CREATE OR REPLACE FUNCTION public._bet_profit_cap()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT max_bet_profit_per_day FROM public.system_config ORDER BY id LIMIT 1), 500);
$$;

CREATE OR REPLACE FUNCTION public.resolve_match_bets(
  p_match_id uuid,
  p_winner_team integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_day date := public._club_day(now());
  v_cap integer := public._bet_profit_cap();
  v_mult numeric;
  v_profit bigint;
  v_left bigint;
  v_payout bigint;
BEGIN
  PERFORM set_config('app.allow_points_change', 'true', true);

  FOR r IN
    SELECT id, user_id, bet_on_team, amount_wagered, multiplier
    FROM public.bets
    WHERE match_id = p_match_id
      AND status = 'pending'
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    IF p_winner_team IS NULL THEN
      -- Partida anulada: devolver puntos apostados
      UPDATE public.profiles
      SET betting_points = COALESCE(betting_points, 0) + r.amount_wagered
      WHERE id = r.user_id;

      UPDATE public.bets SET status = 'cancelled', payout = r.amount_wagered, settled_day = v_day WHERE id = r.id;

    ELSIF r.bet_on_team = p_winner_team THEN
      -- Ganada: devuelve lo apostado y la ganancia hasta el tope del día.
      -- Bloquear el saldo primero: dos partidas que terminan a la vez no
      -- pueden usar el mismo tope.
      PERFORM 1 FROM public.profiles WHERE id = r.user_id FOR UPDATE;

      v_mult := COALESCE(NULLIF(r.multiplier, 0), 2.0);
      v_profit := GREATEST(FLOOR(r.amount_wagered * v_mult) - r.amount_wagered, 0);
      v_left := GREATEST(v_cap - public._bet_profit_on_day(r.user_id, v_day), 0);
      v_payout := r.amount_wagered + LEAST(v_profit, v_left);

      UPDATE public.profiles
      SET betting_points = COALESCE(betting_points, 0) + v_payout
      WHERE id = r.user_id;

      UPDATE public.bets SET status = 'won', payout = v_payout, settled_day = v_day WHERE id = r.id;

    ELSE
      -- Perdida (los puntos ya se descontaron al apostar)
      UPDATE public.bets SET status = 'lost', payout = 0, settled_day = v_day WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_bet_profit_left()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cap integer := public._bet_profit_cap();
  v_used bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  v_used := public._bet_profit_on_day(v_uid, public._club_day(now()));
  RETURN jsonb_build_object('cap', v_cap, 'used', v_used, 'left', GREATEST(v_cap - v_used, 0));
END;
$$;

REVOKE EXECUTE ON FUNCTION public._bet_profit_on_day(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._bet_profit_cap() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_match_bets(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_bet_profit_left() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_bet_profit_left() TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las tres columnas deben salir en true
-- ==============================================================================
SELECT
  position('_bet_profit_on_day' IN pg_get_functiondef('public.resolve_match_bets(uuid, integer)'::regprocedure)) > 0 AS tope_activo,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'bets' AND column_name = 'payout') AS pago_guardado,
  has_function_privilege('authenticated', 'public.get_my_bet_profit_left()', 'EXECUTE') AS app_ve_lo_que_queda;
