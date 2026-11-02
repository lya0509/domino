-- ==============================================================================
-- PÓKER: REGLAS DEL SERVIDOR
-- - Una mano nueva empieza abierta y solo con las salidas.
-- - Un guardado viejo no reabre una mano cerrada; corregirla se pide a propósito.
-- - Retirarse no toca lo apostado, y el último jugador no puede retirarse.
--
-- Orden: ejecutar después de 20261101_14_poker.sql y de publicar la app que manda
-- "reopen" al corregir una mano. Antes de eso, corregir una mano no haría nada.
-- Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.save_poker_hand(p_game uuid, p_hand jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
  v_number integer := (p_hand->>'number')::integer;
  v_last public.poker_hands;
  v_dealer integer := (p_hand->>'dealerSeat')::integer;
  v_plays boolean := (p_hand->>'dealerPlays')::boolean;
  v_entrants integer[] := public._int_array(p_hand->'entrants');
  v_folded integer[] := public._int_array(p_hand->'folded');
  v_status text := p_hand->>'status';
  v_end text := NULLIF(p_hand->>'endType', '');
  v_best text := NULLIF(p_hand->>'bestHand', '');
  v_contributions jsonb := COALESCE(p_hand->'contributions', '{}'::jsonb);
  v_winners jsonb := COALESCE(p_hand->'winners', '[]'::jsonb);
  v_seats integer[];
  v_alive integer[];
  v_pot bigint;
  v_paid bigint;
  v_new boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_game FROM public.table_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND OR v_game.game <> 'poker' THEN
    RAISE EXCEPTION 'Esa partida de póker no existe';
  END IF;
  IF v_game.status <> 'active' THEN
    RAISE EXCEPTION 'Esta partida ya terminó';
  END IF;

  SELECT * INTO v_last FROM public.poker_hands WHERE game_id = p_game ORDER BY number DESC LIMIT 1;

  IF v_last.number IS NOT NULL AND v_number = v_last.number THEN
    -- Un guardado viejo no reabre una mano cerrada: corregirla se pide a propósito
    IF v_last.status = 'closed' AND v_status = 'open'
       AND COALESCE((p_hand->>'reopen')::boolean, false) IS NOT TRUE THEN
      RETURN;
    END IF;
    -- Quien reparte no cambia al corregir, y lo apostado viene de cada jugador
    v_dealer := v_last.dealer_seat;
    v_plays := v_last.dealer_plays;
    v_entrants := v_last.entrants;
    v_folded := v_last.folded;
    v_contributions := v_last.contributions;
    IF NOT public._can_score_poker_hand(v_game, v_dealer, v_uid) THEN
      RAISE EXCEPTION 'Solo quien reparte puede anotar esta mano';
    END IF;
  ELSE
    IF NOT public._can_manage_table_game(v_game, v_uid) THEN
      RAISE EXCEPTION 'Solo alguien de la mesa puede empezar una mano';
    END IF;
    IF v_number IS DISTINCT FROM COALESCE(v_last.number, 0) + 1 THEN
      RAISE EXCEPTION 'Solo se puede anotar la última mano';
    END IF;
    IF v_last.status = 'open' THEN
      RAISE EXCEPTION 'Primero cierra la mano abierta';
    END IF;
    v_new := true;
  END IF;

  SELECT array_agg(seat) INTO v_seats FROM public.table_game_players WHERE game_id = p_game;
  IF NOT v_dealer = ANY(v_seats) THEN
    RAISE EXCEPTION 'Quien reparte no está en esta partida';
  END IF;
  IF cardinality(v_entrants) < 2
     OR NOT v_entrants <@ v_seats
     OR (SELECT COUNT(DISTINCT e) FROM unnest(v_entrants) e) <> cardinality(v_entrants) THEN
    RAISE EXCEPTION 'Una mano necesita al menos 2 jugadores de esta partida';
  END IF;
  IF (v_dealer = ANY(v_entrants)) IS DISTINCT FROM v_plays THEN
    RAISE EXCEPTION 'Quien solo reparte no entra en la mano';
  END IF;
  IF NOT v_folded <@ v_entrants THEN
    RAISE EXCEPTION 'Quien se retira debe estar en la mano';
  END IF;

  IF jsonb_typeof(v_contributions) <> 'object'
     OR (SELECT COUNT(*) FROM jsonb_object_keys(v_contributions)) <> cardinality(v_entrants)
     OR EXISTS (SELECT 1 FROM jsonb_each_text(v_contributions) c
                WHERE NOT c.key::integer = ANY(v_entrants) OR c.value::bigint < 0) THEN
    RAISE EXCEPTION 'Las apuestas de la mano no cuadran';
  END IF;
  -- Una mano nueva empieza abierta y solo con las salidas: el resto lo pone cada jugador
  IF v_new AND (v_status <> 'open' OR cardinality(v_folded) > 0
                OR EXISTS (SELECT 1 FROM jsonb_each_text(v_contributions) c WHERE c.value::bigint > v_game.entry_amount)) THEN
    RAISE EXCEPTION 'Una mano nueva empieza abierta y solo con las salidas';
  END IF;

  IF EXISTS (SELECT 1 FROM public._poker_chips(p_game, v_number) c
             JOIN jsonb_each_text(v_contributions) a ON a.key::integer = c.seat
             WHERE a.value::bigint > c.chips) THEN
    RAISE EXCEPTION 'Nadie puede apostar más fichas de las que tiene';
  END IF;

  IF v_status = 'closed' THEN
    v_alive := ARRAY(SELECT e FROM unnest(v_entrants) e WHERE NOT e = ANY(v_folded));
    SELECT COALESCE(SUM(value::bigint), 0) INTO v_pot FROM jsonb_each_text(v_contributions);
    SELECT COALESCE(SUM((w->>'amount')::bigint), 0) INTO v_paid FROM jsonb_array_elements(v_winners) w;

    IF jsonb_typeof(v_winners) <> 'array' OR jsonb_array_length(v_winners) = 0 OR v_paid <> v_pot
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_winners) w
                  WHERE (w->>'amount')::bigint < 0 OR NOT (w->>'seat')::integer = ANY(v_alive))
       OR (SELECT COUNT(DISTINCT w->>'seat') FROM jsonb_array_elements(v_winners) w) <> jsonb_array_length(v_winners) THEN
      RAISE EXCEPTION 'Las fichas repartidas deben sumar el pozo';
    END IF;

    IF v_end = 'fold' THEN
      IF cardinality(v_alive) <> 1 OR v_best IS NOT NULL THEN
        RAISE EXCEPTION 'Una mano por retirada deja a un solo jugador y no anota jugada';
      END IF;
    ELSIF v_end = 'showdown' THEN
      IF v_best IS NULL OR NOT v_best = ANY(ARRAY['royal_flush', 'straight_flush', 'four_of_a_kind', 'full_house', 'flush',
                                                  'straight', 'three_of_a_kind', 'two_pair', 'pair', 'high_card']) THEN
        RAISE EXCEPTION 'Esa jugada no existe';
      END IF;
    ELSE
      RAISE EXCEPTION 'Falta cómo terminó la mano';
    END IF;
  ELSIF v_status = 'open' THEN
    v_end := NULL;
    v_best := NULL;
    v_winners := '[]'::jsonb;
  ELSE
    RAISE EXCEPTION 'Estado de mano desconocido';
  END IF;

  INSERT INTO public.poker_hands(game_id, number, dealer_seat, dealer_plays, entrants, contributions, folded,
                                 betting_round, status, end_type, winners, best_hand, scored_by, updated_at, closed_at)
  VALUES (p_game, v_number, v_dealer, v_plays, v_entrants, v_contributions, v_folded,
          COALESCE((p_hand->>'bettingRound')::integer, 1), v_status, v_end, v_winners, v_best, v_uid, now(),
          CASE WHEN v_status = 'closed' THEN now() END)
  ON CONFLICT (game_id, number) DO UPDATE
    SET entrants = EXCLUDED.entrants, contributions = EXCLUDED.contributions, folded = EXCLUDED.folded,
        betting_round = EXCLUDED.betting_round, status = EXCLUDED.status, end_type = EXCLUDED.end_type,
        winners = EXCLUDED.winners, best_hand = EXCLUDED.best_hand, scored_by = EXCLUDED.scored_by,
        updated_at = now(), closed_at = EXCLUDED.closed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_poker_seat(p_game uuid, p_number integer, p_seat integer, p_total integer, p_folded boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
  v_hand public.poker_hands;
  v_own boolean;
  v_scorer boolean;
  v_current bigint;
  v_total bigint := p_total;
  v_was_folded boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_game FROM public.table_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND OR v_game.game <> 'poker' THEN
    RAISE EXCEPTION 'Esa partida de póker no existe';
  END IF;

  SELECT * INTO v_hand FROM public.poker_hands WHERE game_id = p_game AND number = p_number;
  IF v_hand.number IS NULL THEN
    RETURN false;
  END IF;

  v_own := EXISTS (SELECT 1 FROM public.table_game_players
                   WHERE game_id = p_game AND seat = p_seat AND user_id = v_uid);
  v_scorer := public._can_score_poker_hand(v_game, v_hand.dealer_seat, v_uid);
  IF NOT v_own AND NOT v_scorer THEN
    RAISE EXCEPTION 'Solo puedes mover tus propias fichas';
  END IF;

  IF v_game.status <> 'active' OR v_hand.status <> 'open' OR NOT p_seat = ANY(v_hand.entrants)
     OR p_total IS NULL OR p_total < 0 OR p_folded IS NULL THEN
    RETURN false;
  END IF;

  v_current := (v_hand.contributions->>p_seat::text)::bigint;
  v_was_folded := p_seat = ANY(v_hand.folded);

  -- Retirarse no toca lo apostado, que puede venir de una pantalla vieja, y alguien
  -- tiene que quedar para llevarse el pozo
  IF p_folded AND NOT v_was_folded THEN
    v_total := GREATEST(v_total, v_current);
    IF cardinality(v_hand.entrants) - cardinality(v_hand.folded) <= 1 THEN
      RETURN false;
    END IF;
  END IF;

  -- Lo apostado no se devuelve y quien se retira no vuelve; solo quien reparte corrige
  IF NOT v_scorer AND (v_total < v_current OR v_was_folded) THEN
    RETURN false;
  END IF;

  IF v_total > (SELECT c.chips FROM public._poker_chips(p_game, p_number) c WHERE c.seat = p_seat) THEN
    RETURN false;
  END IF;

  UPDATE public.poker_hands
  SET contributions = jsonb_set(contributions, ARRAY[p_seat::text], to_jsonb(v_total)),
      folded = CASE WHEN p_folded THEN array_append(array_remove(folded, p_seat), p_seat)
                    ELSE array_remove(folded, p_seat) END,
      updated_at = now()
  WHERE game_id = p_game AND number = p_number;
  RETURN true;
END;
$$;

ALTER FUNCTION public._int_array(jsonb) SET search_path = public;
ALTER FUNCTION public._table_game_label(text) SET search_path = public;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las tres columnas deben salir en true
-- ==============================================================================
SELECT
  position('Una mano nueva empieza abierta' IN pg_get_functiondef('public.save_poker_hand(uuid, jsonb)'::regprocedure)) > 0 AS mano_nueva_protegida,
  position('v_total' IN pg_get_functiondef('public.set_poker_seat(uuid, integer, integer, integer, boolean)'::regprocedure)) > 0 AS retirada_protegida,
  has_function_privilege('authenticated', 'public.set_poker_seat(uuid, integer, integer, integer, boolean)', 'EXECUTE') AS se_puede_apostar;
