-- ==============================================================================
-- APUESTA VIP + SUSTITUCIONES
-- Antes, la apuesta se cobraba y pagaba a quien figuraba en la mesa al terminar.
-- Si alguien entraba de sustituto, le cobraban una apuesta que nunca aceptó.
-- Ahora la apuesta es siempre entre los 4 que la aceptaron, cada uno con su
-- equipo original, aunque luego hayan salido de la mesa.
--
-- Requiere haber ejecutado antes fix_wager_consent.sql. Es seguro repetirlo.
-- ==============================================================================

BEGIN;

-- 1. Guardar el equipo de cada jugador al proponer la apuesta
ALTER TABLE public.wager_consents ADD COLUMN IF NOT EXISTS team smallint;

CREATE OR REPLACE FUNCTION public.trg_fn_wager_consent_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT CASE
           WHEN NEW.user_id IN (m.team1_player1, m.team1_player2) THEN 1
           WHEN NEW.user_id IN (m.team2_player1, m.team2_player2) THEN 2
         END
    INTO NEW.team
  FROM public.matches m
  WHERE m.id = NEW.match_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_wager_consent_team ON public.wager_consents;
CREATE TRIGGER tr_wager_consent_team
  BEFORE INSERT ON public.wager_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_wager_consent_team();

REVOKE EXECUTE ON FUNCTION public.trg_fn_wager_consent_team() FROM PUBLIC, anon, authenticated;

-- 2. Liquidar con los 4 que aceptaron (si la partida tiene consentimientos)
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
  IF p_winner_team IS NULL THEN
    RETURN;
  END IF;

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

  -- Suma cero: los ganadores se reparten solo lo que de verdad se descontó a los perdedores
  -- (nadie queda en negativo y no se crean puntos de la nada)
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

  IF v_pot > 0 AND COALESCE(array_length(v_winners, 1), 0) > 0 THEN
    v_each := FLOOR(v_pot / array_length(v_winners, 1));
    UPDATE public.profiles
    SET betting_points = COALESCE(betting_points, 0) + v_each
    WHERE id = ANY(v_winners);
  END IF;

  UPDATE public.matches SET wager_settled = true WHERE id = p_match_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_match_wagers(uuid, integer) FROM PUBLIC, anon, authenticated;

COMMIT;


-- ==============================================================================
-- VERIFICACIÓN (mándame captura): las dos columnas en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'wager_consents' AND column_name = 'team') AS columna_equipo,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_wager_consent_team') AS trigger_equipo;
