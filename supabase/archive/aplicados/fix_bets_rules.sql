-- ============================================
-- REGLAS DE APUESTAS EN EL SERVIDOR
-- - Solo se apuesta en partidas activas y antes de que alguien llegue a 50 puntos.
-- - Un jugador de la mesa solo puede apostar por SU propio equipo.
-- - Monto > 0, multiplicador entre 1 y 3.5, estado inicial 'pending'.
-- - Varias apuestas del mismo usuario en la misma partida están permitidas (subir apuesta).
-- Ejecuta esto en el SQL Editor de Supabase. Es seguro repetirlo.
-- ============================================
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

  SELECT status, team1_total, team2_total,
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_bet ON public.bets;
CREATE TRIGGER tr_validate_bet
  BEFORE INSERT ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_validate_bet();
