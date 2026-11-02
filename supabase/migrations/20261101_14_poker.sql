-- ==============================================================================
-- PÓKER
-- Fichas de mesa: valen solo dentro de la partida y nunca pasan al saldo de puntos.
-- - Las fichas no se guardan: salen siempre de las manos cerradas, así que corregir
--   una mano no puede descuadrar nada.
-- - Cada jugador mueve sus propias fichas desde su teléfono. Quien reparte abre y cierra
--   la mano, y anota por quien no tenga cuenta o teléfono. Quien creó la partida cubre a
--   quien reparte sin cuenta o sin teléfono a mano.
-- - El servidor revisa cada mano cerrada: las fichas repartidas deben sumar el pozo.
-- - Al cerrar gana quien tenga más fichas, y siguen las reglas de UNO: otro jugador
--   confirma, +20 con mínimo 3 registrados y el tope de 3 premios al día compartido.
--
-- Orden: ejecutar después de 20261101_13_uno.sql.
-- Compatibilidad: la app publicada sigue funcionando; solo no muestra póker.
-- Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

ALTER TABLE public.table_games DROP CONSTRAINT IF EXISTS table_games_game_check;
ALTER TABLE public.table_games ADD CONSTRAINT table_games_game_check
  CHECK (game IN ('uno', 'uno_flip', 'uno_no_mercy', 'poker'));
ALTER TABLE public.table_games ADD COLUMN IF NOT EXISTS start_chips integer;
ALTER TABLE public.table_games ADD COLUMN IF NOT EXISTS entry_amount integer;

CREATE TABLE IF NOT EXISTS public.poker_hands (
  game_id uuid NOT NULL REFERENCES public.table_games(id) ON DELETE CASCADE,
  number integer NOT NULL,
  dealer_seat integer NOT NULL,
  dealer_plays boolean NOT NULL,
  entrants integer[] NOT NULL,
  contributions jsonb NOT NULL,
  folded integer[] NOT NULL DEFAULT '{}',
  betting_round integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  end_type text CHECK (end_type IN ('fold', 'showdown')),
  winners jsonb NOT NULL DEFAULT '[]'::jsonb,
  best_hand text,
  scored_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  PRIMARY KEY (game_id, number)
);

ALTER TABLE public.poker_hands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.poker_hands FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.poker_hands TO authenticated;
DROP POLICY IF EXISTS "Con sesion se ven las manos" ON public.poker_hands;
CREATE POLICY "Con sesion se ven las manos" ON public.poker_hands
  FOR SELECT TO authenticated USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'poker_hands') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.poker_hands;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._table_game_label(p_game text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_game
           WHEN 'uno_flip' THEN 'UNO Flip'
           WHEN 'uno_no_mercy' THEN 'UNO No Mercy'
           WHEN 'poker' THEN 'Póker'
           ELSE 'UNO'
         END;
$$;

-- ------------------------------------------------------------------------------
-- Sentar jugadores: la misma regla para UNO y póker
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seat_table_game_players(p_id uuid, p_players jsonb)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat integer := 0;
  v_entry jsonb;
  v_user uuid;
  v_name text;
  v_names text[] := '{}';
BEGIN
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_user := NULLIF(v_entry->>'user_id', '')::uuid;
    IF v_user IS NOT NULL THEN
      SELECT COALESCE(display_name, 'Jugador') INTO v_name FROM public.profiles WHERE id = v_user;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Uno de los jugadores no existe';
      END IF;
      IF EXISTS (SELECT 1 FROM public.table_game_players WHERE game_id = p_id AND user_id = v_user) THEN
        RAISE EXCEPTION 'Hay un jugador repetido';
      END IF;
    ELSE
      v_name := btrim(COALESCE(v_entry->>'name', ''));
      IF length(v_name) NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'Quien juega sin cuenta necesita un nombre de hasta 30 letras';
      END IF;
    END IF;

    INSERT INTO public.table_game_players(game_id, seat, user_id, name)
    VALUES (p_id, v_seat, v_user, v_name);
    v_names := v_names || v_name;
    v_seat := v_seat + 1;
  END LOOP;
  RETURN v_names;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_table_game(p_id uuid, p_game text, p_players jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_names text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF p_game NOT IN ('uno', 'uno_flip', 'uno_no_mercy') THEN
    RAISE EXCEPTION 'Ese juego no existe';
  END IF;
  v_count := CASE WHEN jsonb_typeof(p_players) = 'array' THEN jsonb_array_length(p_players) ELSE 0 END;
  IF v_count NOT BETWEEN 2 AND 10 THEN
    RAISE EXCEPTION 'Una partida necesita de 2 a 10 jugadores';
  END IF;

  INSERT INTO public.table_games(id, game, created_by)
  VALUES (p_id, p_game, v_uid)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN p_id;
  END IF;

  v_names := public._seat_table_game_players(p_id, p_players);

  PERFORM public._notify(
    public._everyone_except(public._table_game_users(p_id) || v_uid),
    '🃏 Ya están jugando',
    public._table_game_label(p_game) || ': ' || array_to_string(v_names, ', ') || '. Entra a verla en vivo.',
    'table-' || p_id
  );
  RETURN p_id;
END;
$$;

-- p_id viene del teléfono: así la cola sin internet puede reenviar sin duplicar
CREATE OR REPLACE FUNCTION public.start_poker_game(p_id uuid, p_players jsonb, p_start_chips integer, p_entry integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_names text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  v_count := CASE WHEN jsonb_typeof(p_players) = 'array' THEN jsonb_array_length(p_players) ELSE 0 END;
  IF v_count NOT BETWEEN 2 AND 10 THEN
    RAISE EXCEPTION 'Una partida necesita de 2 a 10 jugadores';
  END IF;
  IF p_start_chips IS NULL OR p_start_chips NOT BETWEEN 1 AND 1000000 THEN
    RAISE EXCEPTION 'Las fichas iniciales deben ser de 1 a 1.000.000';
  END IF;
  IF p_entry IS NULL OR p_entry < 1 OR p_entry > p_start_chips THEN
    RAISE EXCEPTION 'La entrada debe ser de al menos 1 ficha y no pasar de las fichas iniciales';
  END IF;

  INSERT INTO public.table_games(id, game, created_by, start_chips, entry_amount)
  VALUES (p_id, 'poker', v_uid, p_start_chips, p_entry)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN p_id;
  END IF;

  v_names := public._seat_table_game_players(p_id, p_players);

  PERFORM public._notify(
    public._everyone_except(public._table_game_users(p_id) || v_uid),
    '🃏 Ya están jugando',
    'Póker: ' || array_to_string(v_names, ', ') || '. Entra a verla en vivo.',
    'table-' || p_id
  );
  RETURN p_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- Fichas y manos
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._poker_chips(p_game uuid, p_except integer DEFAULT NULL)
RETURNS TABLE(seat integer, chips bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.seat,
         g.start_chips
         - COALESCE((SELECT SUM(c.value::bigint)
                     FROM public.poker_hands h, jsonb_each_text(h.contributions) c
                     WHERE h.game_id = p_game AND h.status = 'closed'
                       AND h.number IS DISTINCT FROM p_except AND c.key::integer = p.seat), 0)
         + COALESCE((SELECT SUM((w.value->>'amount')::bigint)
                     FROM public.poker_hands h, jsonb_array_elements(h.winners) w
                     WHERE h.game_id = p_game AND h.status = 'closed'
                       AND h.number IS DISTINCT FROM p_except AND (w.value->>'seat')::integer = p.seat), 0)
  FROM public.table_game_players p
  JOIN public.table_games g ON g.id = p.game_id
  WHERE p.game_id = p_game;
$$;

CREATE OR REPLACE FUNCTION public._can_score_poker_hand(p_game public.table_games, p_dealer_seat integer, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT DISTINCT FROM p_game.created_by
      OR public._is_admin(p_user)
      OR EXISTS (SELECT 1 FROM public.table_game_players
                 WHERE game_id = p_game.id AND seat = p_dealer_seat AND user_id = p_user);
$$;

CREATE OR REPLACE FUNCTION public._int_array(p_value jsonb)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(value::integer), '{}')
  FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END);
$$;

-- Abre, cierra o reabre la mano. Una vez abierta, las fichas solo cambian con
-- set_poker_seat: así dos teléfonos no se pisan. Repetir el envío no cambia nada.
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

-- Cada asiento se escribe aparte y con el total exacto: dos jugadores a la vez no se
-- pisan y la cola sin internet puede repetirlo. Lo que ya no aplica, como una apuesta
-- que llega con la mano cerrada, devuelve false y no se reintenta para siempre.
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

  -- Lo apostado no se devuelve y quien se retira no vuelve; solo quien reparte corrige
  IF NOT v_scorer AND (p_total < v_current OR v_was_folded) THEN
    RETURN false;
  END IF;

  IF p_total > (SELECT c.chips FROM public._poker_chips(p_game, p_number) c WHERE c.seat = p_seat) THEN
    RETURN false;
  END IF;

  UPDATE public.poker_hands
  SET contributions = jsonb_set(contributions, ARRAY[p_seat::text], to_jsonb(p_total)),
      folded = CASE WHEN p_folded THEN array_append(array_remove(folded, p_seat), p_seat)
                    ELSE array_remove(folded, p_seat) END,
      updated_at = now()
  WHERE game_id = p_game AND number = p_number;
  RETURN true;
END;
$$;

-- Una mano abierta por error se quita sin dejar rastro en las fichas
CREATE OR REPLACE FUNCTION public.cancel_poker_hand(p_game uuid, p_number integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
  v_hand public.poker_hands;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  SELECT * INTO v_game FROM public.table_games WHERE id = p_game FOR UPDATE;
  SELECT * INTO v_hand FROM public.poker_hands WHERE game_id = p_game AND number = p_number;
  IF v_hand.number IS NULL THEN
    RETURN;
  END IF;
  IF NOT public._can_score_poker_hand(v_game, v_hand.dealer_seat, v_uid) THEN
    RAISE EXCEPTION 'Solo quien reparte puede quitar esta mano';
  END IF;
  IF v_game.status <> 'active' OR v_hand.status <> 'open' THEN
    RAISE EXCEPTION 'Solo se quita una mano abierta';
  END IF;
  DELETE FROM public.poker_hands WHERE game_id = p_game AND number = p_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_table_game(p_id uuid, p_winner_seat integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
  v_last public.poker_hands;
  v_others uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT * INTO v_game FROM public.table_games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public._can_manage_table_game(v_game, v_uid) THEN
    RAISE EXCEPTION 'Solo alguien de la mesa puede terminar la partida';
  END IF;

  IF v_game.status <> 'active' THEN
    -- La cola sin internet puede reenviar el mismo final
    IF v_game.status <> 'cancelled' AND v_game.winner_seat = p_winner_seat THEN
      RETURN v_game.status;
    END IF;
    RAISE EXCEPTION 'Esta partida ya terminó';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.table_game_players WHERE game_id = p_id AND seat = p_winner_seat) THEN
    RAISE EXCEPTION 'El ganador no está en esta partida';
  END IF;

  IF v_game.game = 'poker' THEN
    SELECT * INTO v_last FROM public.poker_hands WHERE game_id = p_id ORDER BY number DESC LIMIT 1;
    IF v_last.number IS NULL THEN
      RAISE EXCEPTION 'Juega al menos una mano antes de terminar';
    END IF;
    IF v_last.status = 'open' THEN
      RAISE EXCEPTION 'Primero cierra la mano abierta';
    END IF;
    IF NOT public._can_score_poker_hand(v_game, v_last.dealer_seat, v_uid) THEN
      RAISE EXCEPTION 'Solo quien reparte puede terminar la partida';
    END IF;
    -- Con empate, quien reparte elige entre quienes llevan más fichas
    IF NOT EXISTS (SELECT 1 FROM public._poker_chips(p_id) c
                   WHERE c.seat = p_winner_seat
                     AND c.chips = (SELECT MAX(m.chips) FROM public._poker_chips(p_id) m)) THEN
      RAISE EXCEPTION 'Gana quien tenga más fichas';
    END IF;
  END IF;

  v_others := array_remove(public._table_game_users(p_id), v_uid);

  UPDATE public.table_games
  SET winner_seat = p_winner_seat, closed_by = v_uid, closed_at = now(),
      status = 'pending_confirmation', auto_confirm_at = now() + interval '1 minute'
  WHERE id = p_id;

  IF cardinality(v_others) = 0 THEN
    PERFORM public._complete_table_game(p_id);
    RETURN 'completed';
  END IF;

  PERFORM public._notify(v_others, '🏁 Confirma el resultado',
    'Tu partida de ' || public._table_game_label(v_game.game) || ' terminó. Entra a confirmar quién ganó.', 'table-confirm-' || p_id);
  RETURN 'pending_confirmation';
END;
$$;

-- Una noche de póker dura más que una de UNO: cuenta la última mano, no el inicio
CREATE OR REPLACE FUNCTION public.auto_confirm_table_games()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.table_games
    WHERE status = 'pending_confirmation' AND auto_confirm_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public._complete_table_game(v_id);
  END LOOP;

  UPDATE public.table_games g
  SET status = 'cancelled', closed_at = now()
  WHERE g.status = 'active'
    AND g.created_at < now() - interval '6 hours'
    AND NOT EXISTS (SELECT 1 FROM public.poker_hands h
                    WHERE h.game_id = g.id AND h.updated_at >= now() - interval '6 hours');
END;
$$;

-- Manos jugadas y mejor jugada ganada con cartas: la retirada no cuenta como jugada
CREATE OR REPLACE FUNCTION public.poker_ranking(p_from timestamptz DEFAULT NULL)
RETURNS TABLE(user_id uuid, display_name text, wins bigint, played bigint, hands bigint, best_hand text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH orden AS (
    SELECT ARRAY['royal_flush', 'straight_flush', 'four_of_a_kind', 'full_house', 'flush',
                 'straight', 'three_of_a_kind', 'two_pair', 'pair', 'high_card'] AS jugadas
  ), partidas AS (
    SELECT g.id, g.winner_seat FROM public.table_games g
    WHERE g.game = 'poker' AND g.status = 'completed' AND (p_from IS NULL OR g.closed_at >= p_from)
  ), base AS (
    SELECT p.user_id, COUNT(*) FILTER (WHERE g.winner_seat = p.seat) AS wins, COUNT(*) AS played
    FROM partidas g JOIN public.table_game_players p ON p.game_id = g.id
    WHERE p.user_id IS NOT NULL
    GROUP BY p.user_id
  ), manos AS (
    SELECT p.user_id, COUNT(*) AS hands,
           MIN(array_position(o.jugadas, h.best_hand)) FILTER (
             WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(h.winners) w
                           WHERE (w->>'seat')::integer = p.seat)
           ) AS mejor
    FROM partidas g
    JOIN public.poker_hands h ON h.game_id = g.id AND h.status = 'closed'
    JOIN public.table_game_players p ON p.game_id = g.id AND p.seat = ANY(h.entrants)
    CROSS JOIN orden o
    WHERE p.user_id IS NOT NULL
    GROUP BY p.user_id
  )
  SELECT b.user_id, pr.display_name, b.wins, b.played, COALESCE(m.hands, 0), o.jugadas[m.mejor]
  FROM base b
  JOIN public.profiles pr ON pr.id = b.user_id
  LEFT JOIN manos m ON m.user_id = b.user_id
  CROSS JOIN orden o
  ORDER BY b.wins DESC, COALESCE(m.hands, 0) DESC, pr.display_name
  LIMIT 100;
$$;

REVOKE EXECUTE ON FUNCTION public._seat_table_game_players(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._poker_chips(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._can_score_poker_hand(public.table_games, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._int_array(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_confirm_table_games() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.start_table_game(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finish_table_game(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_poker_game(uuid, jsonb, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_poker_hand(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_poker_seat(uuid, integer, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_poker_hand(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.poker_ranking(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_table_game(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_table_game(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_poker_game(uuid, jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_poker_hand(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_poker_seat(uuid, integer, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_poker_hand(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.poker_ranking(timestamptz) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las cuatro columnas deben salir en true
-- ==============================================================================
SELECT
  has_function_privilege('authenticated', 'public.set_poker_seat(uuid, integer, integer, integer, boolean)', 'EXECUTE') AS se_puede_apostar,
  NOT has_function_privilege('anon', 'public.start_poker_game(uuid, jsonb, integer, integer)', 'EXECUTE') AS sin_sesion_no,
  NOT has_function_privilege('authenticated', 'public._poker_chips(uuid, integer)', 'EXECUTE') AS fichas_protegidas,
  EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'poker_hands') AS en_vivo;
