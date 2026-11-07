-- ==============================================================================
-- MESA: PÓKER, UNO E INVITADOS
-- - "Estoy en la mesa": cada jugador con cuenta lo confirma en su teléfono. Sin eso
--   no arranca la primera mano de póker ni se termina ninguna partida de mesa.
--   Quien creó la partida puede pasar a invitado a quien no confirma.
-- - No hay dos partidas abiertas del mismo juego con la misma persona, y una
--   partida terminada tiene una sola revancha ("Otra con los mismos"), aunque dos
--   teléfonos la pidan a la vez.
-- - Una partida de póker sin ninguna mano se anula sola a los 15 minutos.
-- - El repartidor se elige en cada mano y puede ser alguien que no juega: no tiene
--   fichas, no entra en la mano y no puede ganar.
-- - Un jugador puede retirarse a mitad de partida: sus fichas quedan anotadas,
--   pero ya no entra en manos ni puede ganar.
-- - Invitados: la lista del club recuerda sus nombres para sugerirlos. Una partida
--   con más de un invitado no cuenta para el ranking, no da premio y no admite
--   apuestas.
--
-- Orden: después de 20261102_21_torneos.sql. La app publicada funciona con o sin
-- este archivo: lo nuevo aparece cuando se ejecuta. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

-- ------------------------------------------------------------------------------
-- Columnas nuevas
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'table_game_players' AND column_name = 'checked_in_at') THEN
    ALTER TABLE public.table_game_players ADD COLUMN checked_in_at timestamptz;
    -- Las partidas de antes no se trancan: todos cuentan como presentes
    UPDATE public.table_game_players SET checked_in_at = now();
  END IF;
END $$;

ALTER TABLE public.table_game_players ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player';
ALTER TABLE public.table_game_players ADD COLUMN IF NOT EXISTS left_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_game_players_role_check') THEN
    ALTER TABLE public.table_game_players
      ADD CONSTRAINT table_game_players_role_check CHECK (role IN ('player', 'dealer'));
  END IF;
END $$;

ALTER TABLE public.table_games ADD COLUMN IF NOT EXISTS rematch_of uuid REFERENCES public.table_games(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_games_rematch ON public.table_games(rematch_of) WHERE rematch_of IS NOT NULL;

-- ------------------------------------------------------------------------------
-- Lista de invitados del club: solo nombres, para sugerirlos al escribir
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_guests (
  name_key text PRIMARY KEY,
  name text NOT NULL,
  uses integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.club_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_guests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.club_guests TO authenticated;
DROP POLICY IF EXISTS "Con sesion se ven los invitados" ON public.club_guests;
CREATE POLICY "Con sesion se ven los invitados" ON public.club_guests
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public._guest_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public._remember_guest(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g');
BEGIN
  IF length(v_name) NOT BETWEEN 1 AND 30 THEN
    RETURN;
  END IF;
  INSERT INTO public.club_guests(name_key, name, created_by)
  VALUES (public._guest_key(v_name), v_name, auth.uid())
  ON CONFLICT (name_key) DO UPDATE
    SET uses = public.club_guests.uses + 1, last_used_at = now();
END;
$$;

-- El dominó guarda sus invitados al empezar la partida
CREATE OR REPLACE FUNCTION public.remember_club_guests(p_names text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF cardinality(p_names) > 10 THEN
    RAISE EXCEPTION 'Demasiados invitados de una vez';
  END IF;
  FOREACH v_name IN ARRAY COALESCE(p_names, '{}') LOOP
    PERFORM public._remember_guest(v_name);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.forget_club_guest(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar invitados';
  END IF;
  DELETE FROM public.club_guests WHERE name_key = public._guest_key(p_name);
END;
$$;

-- ------------------------------------------------------------------------------
-- Ayudantes de la mesa
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._table_game_family(p_game text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_game = 'poker' THEN 'poker' ELSE 'uno' END;
$$;

-- Quien juega (no quien solo reparte), con o sin cuenta
CREATE OR REPLACE FUNCTION public._table_game_guests(p_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer FROM public.table_game_players
  WHERE game_id = p_id AND role = 'player' AND user_id IS NULL;
$$;

-- Jugadores con cuenta que todavía no confirmaron que están en la mesa
CREATE OR REPLACE FUNCTION public._table_game_missing(p_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(name ORDER BY seat), '{}') FROM public.table_game_players
  WHERE game_id = p_id AND role = 'player' AND user_id IS NOT NULL
    AND checked_in_at IS NULL AND left_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public._require_table_game_ready(p_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing text[] := public._table_game_missing(p_id);
BEGIN
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Falta que confirmen que están en la mesa: %', array_to_string(v_missing, ', ');
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- Sentar a los jugadores: confirmación, partida repetida e invitados
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._seat_table_game_players(p_id uuid, p_players jsonb)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text;
  v_seat integer := 0;
  v_entry jsonb;
  v_user uuid;
  v_name text;
  v_names text[] := '{}';
  v_others uuid[] := '{}';
  v_creator text;
BEGIN
  SELECT game INTO v_kind FROM public.table_games WHERE id = p_id;

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
      -- Dos teléfonos que crean la misma mesa a la vez: el segundo espera al primero
      PERFORM pg_advisory_xact_lock(hashtext('mesa:' || v_user::text));
      IF EXISTS (SELECT 1 FROM public.table_game_players p
                 JOIN public.table_games g ON g.id = p.game_id
                 WHERE p.user_id = v_user AND p.game_id <> p_id AND p.role = 'player' AND p.left_at IS NULL
                   AND g.status = 'active'
                   AND public._table_game_family(g.game) = public._table_game_family(v_kind)) THEN
        RAISE EXCEPTION '% ya está en otra partida de % abierta. Entren a esa o anúlenla primero.',
          v_name, CASE WHEN v_kind = 'poker' THEN 'póker' ELSE 'UNO' END;
      END IF;
      IF v_user IS DISTINCT FROM v_uid THEN
        v_others := v_others || v_user;
      END IF;
    ELSE
      v_name := regexp_replace(btrim(COALESCE(v_entry->>'name', '')), '\s+', ' ', 'g');
      IF length(v_name) NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'Quien juega sin cuenta necesita un nombre de hasta 30 letras';
      END IF;
      PERFORM public._remember_guest(v_name);
    END IF;

    -- Quien crea la partida y los invitados ya están; los demás lo confirman en su teléfono
    INSERT INTO public.table_game_players(game_id, seat, user_id, name, role, checked_in_at)
    VALUES (p_id, v_seat, v_user, v_name, 'player',
            CASE WHEN v_user IS NULL OR v_user = v_uid THEN now() END);
    v_names := v_names || v_name;
    v_seat := v_seat + 1;
  END LOOP;

  IF cardinality(v_others) > 0 THEN
    SELECT COALESCE(display_name, 'Alguien') INTO v_creator FROM public.profiles WHERE id = v_uid;
    PERFORM public._notify(v_others, '🃏 ¿Estás en la mesa?',
      COALESCE(v_creator, 'Alguien') || ' te puso en una partida de ' || public._table_game_label(v_kind)
      || '. Entra y toca "Estoy en la mesa".', 'table-checkin-' || p_id);
  END IF;
  RETURN v_names;
END;
$$;

-- p_rematch_of: "Otra con los mismos". Si ya existe, se devuelve esa y no se crea otra.
DROP FUNCTION IF EXISTS public.start_table_game(uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.start_table_game(p_id uuid, p_game text, p_players jsonb, p_rematch_of uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_names text[];
  v_prev public.table_games;
  v_existing uuid;
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

  -- Reenvío de la cola sin internet
  IF EXISTS (SELECT 1 FROM public.table_games WHERE id = p_id) THEN
    RETURN p_id;
  END IF;

  IF p_rematch_of IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.table_games WHERE rematch_of = p_rematch_of;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
    SELECT * INTO v_prev FROM public.table_games WHERE id = p_rematch_of;
    IF NOT FOUND OR NOT public._can_manage_table_game(v_prev, v_uid) THEN
      RAISE EXCEPTION 'Solo alguien de esa mesa puede pedir la revancha';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.table_games(id, game, created_by, rematch_of)
    VALUES (p_id, p_game, v_uid, p_rematch_of);
  EXCEPTION WHEN unique_violation THEN
    -- Otro teléfono pidió la misma revancha en el mismo instante
    SELECT id INTO v_existing FROM public.table_games WHERE rematch_of = p_rematch_of;
    RETURN COALESCE(v_existing, p_id);
  END;

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

DROP FUNCTION IF EXISTS public.start_poker_game(uuid, jsonb, integer, integer);
CREATE OR REPLACE FUNCTION public.start_poker_game(p_id uuid, p_players jsonb, p_start_chips integer, p_entry integer, p_rematch_of uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_names text[];
  v_prev public.table_games;
  v_existing uuid;
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

  IF EXISTS (SELECT 1 FROM public.table_games WHERE id = p_id) THEN
    RETURN p_id;
  END IF;

  IF p_rematch_of IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.table_games WHERE rematch_of = p_rematch_of;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
    SELECT * INTO v_prev FROM public.table_games WHERE id = p_rematch_of;
    IF NOT FOUND OR NOT public._can_manage_table_game(v_prev, v_uid) THEN
      RAISE EXCEPTION 'Solo alguien de esa mesa puede pedir la revancha';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.table_games(id, game, created_by, start_chips, entry_amount, rematch_of)
    VALUES (p_id, 'poker', v_uid, p_start_chips, p_entry, p_rematch_of);
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing FROM public.table_games WHERE rematch_of = p_rematch_of;
    RETURN COALESCE(v_existing, p_id);
  END;

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
-- "Estoy en la mesa", pasar a invitado, repartidor de afuera y retirarse
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_in_table_game(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.table_games WHERE id = p_id AND status = 'active') THEN
    RETURN false;
  END IF;
  UPDATE public.table_game_players SET checked_in_at = now()
  WHERE game_id = p_id AND user_id = v_uid AND checked_in_at IS NULL;
  RETURN EXISTS (SELECT 1 FROM public.table_game_players WHERE game_id = p_id AND user_id = v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.make_table_game_guest(p_id uuid, p_seat integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
  v_player public.table_game_players;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  SELECT * INTO v_game FROM public.table_games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR (v_uid IS DISTINCT FROM v_game.created_by AND NOT public._is_admin(v_uid)) THEN
    RAISE EXCEPTION 'Solo quien creó la partida puede pasar a alguien a invitado';
  END IF;
  IF v_game.status <> 'active' THEN
    RAISE EXCEPTION 'Esta partida ya terminó';
  END IF;
  SELECT * INTO v_player FROM public.table_game_players WHERE game_id = p_id AND seat = p_seat;
  IF NOT FOUND OR v_player.user_id IS NULL OR v_player.role <> 'player' THEN
    RETURN;
  END IF;
  IF v_player.checked_in_at IS NOT NULL THEN
    RAISE EXCEPTION '% ya confirmó que está en la mesa', v_player.name;
  END IF;
  UPDATE public.table_game_players SET user_id = NULL, checked_in_at = now()
  WHERE game_id = p_id AND seat = p_seat;
  PERFORM public._remember_guest(v_player.name);
END;
$$;

-- El repartidor de una mano puede ser alguien que no juega: entra sin fichas
CREATE OR REPLACE FUNCTION public.add_table_game_dealer(p_id uuid, p_user uuid, p_name text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
  v_seat integer;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  SELECT * INTO v_game FROM public.table_games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_game.game <> 'poker' THEN
    RAISE EXCEPTION 'Esa partida de póker no existe';
  END IF;
  IF NOT public._can_manage_table_game(v_game, v_uid) THEN
    RAISE EXCEPTION 'Solo alguien de la mesa puede elegir quién reparte';
  END IF;
  IF v_game.status <> 'active' THEN
    RAISE EXCEPTION 'Esta partida ya terminó';
  END IF;

  IF p_user IS NOT NULL THEN
    SELECT seat INTO v_seat FROM public.table_game_players WHERE game_id = p_id AND user_id = p_user;
    IF v_seat IS NOT NULL THEN
      RETURN v_seat;
    END IF;
    SELECT COALESCE(display_name, 'Jugador') INTO v_name FROM public.profiles WHERE id = p_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esa persona no existe';
    END IF;
  ELSE
    v_name := regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g');
    IF length(v_name) NOT BETWEEN 1 AND 30 THEN
      RAISE EXCEPTION 'Quien reparte sin cuenta necesita un nombre de hasta 30 letras';
    END IF;
    SELECT seat INTO v_seat FROM public.table_game_players
    WHERE game_id = p_id AND user_id IS NULL AND public._guest_key(name) = public._guest_key(v_name);
    IF v_seat IS NOT NULL THEN
      RETURN v_seat;
    END IF;
    PERFORM public._remember_guest(v_name);
  END IF;

  IF (SELECT COUNT(*) FROM public.table_game_players WHERE game_id = p_id) >= 20 THEN
    RAISE EXCEPTION 'Ya hay demasiadas personas en esta mesa';
  END IF;
  SELECT COALESCE(MAX(seat), -1) + 1 INTO v_seat FROM public.table_game_players WHERE game_id = p_id;
  INSERT INTO public.table_game_players(game_id, seat, user_id, name, role, checked_in_at)
  VALUES (p_id, v_seat, p_user, v_name, 'dealer', now());
  RETURN v_seat;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_table_game(p_id uuid, p_seat integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game public.table_games;
  v_player public.table_game_players;
  v_open public.poker_hands;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  SELECT * INTO v_game FROM public.table_games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa partida no existe';
  END IF;
  SELECT * INTO v_player FROM public.table_game_players WHERE game_id = p_id AND seat = p_seat;
  IF NOT FOUND OR v_player.role <> 'player' THEN
    RAISE EXCEPTION 'Ese jugador no está en la partida';
  END IF;
  IF v_uid IS DISTINCT FROM v_player.user_id AND v_uid IS DISTINCT FROM v_game.created_by AND NOT public._is_admin(v_uid) THEN
    RAISE EXCEPTION 'Solo el jugador o quien creó la partida puede retirarlo';
  END IF;
  IF v_game.status <> 'active' THEN
    RAISE EXCEPTION 'Esta partida ya terminó';
  END IF;
  IF v_player.left_at IS NOT NULL THEN
    RETURN;
  END IF;
  IF v_game.game = 'poker' THEN
    SELECT * INTO v_open FROM public.poker_hands WHERE game_id = p_id AND status = 'open';
    IF v_open.number IS NOT NULL AND p_seat = ANY(v_open.entrants) AND NOT p_seat = ANY(v_open.folded) THEN
      RAISE EXCEPTION 'Primero retírate de la mano que se está jugando';
    END IF;
  END IF;
  UPDATE public.table_game_players SET left_at = now() WHERE game_id = p_id AND seat = p_seat;
END;
$$;

-- ------------------------------------------------------------------------------
-- Fichas y manos: quien solo reparte no tiene fichas ni entra en la mano
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
  WHERE p.game_id = p_game AND p.role = 'player';
$$;

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
  v_all integer[];
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
    SELECT array_agg(seat) INTO v_seats FROM public.table_game_players WHERE game_id = p_game AND role = 'player';
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
    PERFORM public._require_table_game_ready(p_game);
    v_new := true;
    -- Quien se retiró de la partida ya no entra en manos nuevas
    SELECT array_agg(seat) INTO v_seats FROM public.table_game_players
    WHERE game_id = p_game AND role = 'player' AND left_at IS NULL;
  END IF;

  SELECT array_agg(seat) INTO v_all FROM public.table_game_players WHERE game_id = p_game;
  IF NOT v_dealer = ANY(v_all) THEN
    RAISE EXCEPTION 'Quien reparte no está en esta partida';
  END IF;
  IF cardinality(v_entrants) < 2
     OR NOT v_entrants <@ COALESCE(v_seats, '{}')
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

-- ------------------------------------------------------------------------------
-- Terminar y cerrar: solo gana quien sigue jugando; premio sin granja de invitados
-- ------------------------------------------------------------------------------
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

  IF NOT EXISTS (SELECT 1 FROM public.table_game_players
                 WHERE game_id = p_id AND seat = p_winner_seat AND role = 'player' AND left_at IS NULL) THEN
    RAISE EXCEPTION 'El ganador tiene que estar jugando todavía';
  END IF;
  PERFORM public._require_table_game_ready(p_id);

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
    -- Con empate, quien reparte elige entre quienes llevan más fichas y siguen jugando
    IF NOT EXISTS (SELECT 1 FROM public._poker_chips(p_id) c
                   WHERE c.seat = p_winner_seat
                     AND c.chips = (SELECT MAX(m.chips) FROM public._poker_chips(p_id) m
                                    JOIN public.table_game_players q ON q.game_id = p_id AND q.seat = m.seat
                                    WHERE q.left_at IS NULL)) THEN
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

CREATE OR REPLACE FUNCTION public._complete_table_game(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_players uuid[];
  v_day date := public._club_day(now());
  v_winner uuid;
BEGIN
  UPDATE public.table_games
  SET status = 'completed', confirmed_at = now(), auto_confirm_at = NULL
  WHERE id = p_id;

  -- Quien solo repartió no jugó
  SELECT COALESCE(array_agg(user_id), '{}') INTO v_players FROM public.table_game_players
  WHERE game_id = p_id AND role = 'player' AND user_id IS NOT NULL;

  -- La racha nunca debe impedir que una partida se cierre
  BEGIN
    PERFORM public._bump_play_streak(v_players);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo actualizar la racha de %: %', p_id, SQLERRM;
  END;

  SELECT p.user_id INTO v_winner
  FROM public.table_game_players p
  JOIN public.table_games g ON g.id = p.game_id AND g.winner_seat = p.seat
  WHERE g.id = p_id;

  -- Ganarles a puros invitados no da premio
  IF v_winner IS NULL OR cardinality(v_players) < 3 OR public._table_game_guests(p_id) > 1 THEN
    RETURN;
  END IF;

  -- Bloquear el saldo: dos cierres simultáneos no se saltan el tope
  PERFORM 1 FROM public.profiles WHERE id = v_winner FOR UPDATE;
  IF public._prizes_on_day(v_winner, v_day) >= 3 THEN
    RETURN;
  END IF;

  INSERT INTO public.table_game_prizes(game_id, user_id, club_day, amount)
  VALUES (p_id, v_winner, v_day, 20)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    PERFORM set_config('app.allow_points_change', 'true', true);
    PERFORM set_config('app.points_reason', 'Premio por ganar', true);
    UPDATE public.profiles SET betting_points = COALESCE(betting_points, 0) + 20 WHERE id = v_winner;
    PERFORM set_config('app.points_reason', '', true);
    PERFORM set_config('app.allow_points_change', 'false', true);
  END IF;
END;
$$;

-- Corre cada minuto: resultados sin respuesta y partidas olvidadas
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

  -- Una mesa de póker que nunca repartió una mano en 15 minutos se creó de más
  UPDATE public.table_games g
  SET status = 'cancelled', closed_at = now()
  WHERE g.status = 'active' AND g.game = 'poker'
    AND g.created_at < now() - interval '15 minutes'
    AND NOT EXISTS (SELECT 1 FROM public.poker_hands h WHERE h.game_id = g.id);

  -- Una noche de póker dura más que una de UNO: cuenta la última mano, no el inicio
  UPDATE public.table_games g
  SET status = 'cancelled', closed_at = now()
  WHERE g.status = 'active'
    AND g.created_at < now() - interval '6 hours'
    AND NOT EXISTS (SELECT 1 FROM public.poker_hands h
                    WHERE h.game_id = g.id AND h.updated_at >= now() - interval '6 hours');
END;
$$;

-- ------------------------------------------------------------------------------
-- Rankings: sin repartidores y sin partidas de más de un invitado
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.table_game_ranking(p_game text, p_from timestamptz DEFAULT NULL)
RETURNS TABLE(user_id uuid, display_name text, wins bigint, played bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.user_id, pr.display_name,
         COUNT(*) FILTER (WHERE g.winner_seat = p.seat) AS wins,
         COUNT(*) AS played
  FROM public.table_games g
  JOIN public.table_game_players p ON p.game_id = g.id AND p.role = 'player'
  JOIN public.profiles pr ON pr.id = p.user_id
  WHERE g.game = p_game
    AND g.status = 'completed'
    AND (p_from IS NULL OR g.closed_at >= p_from)
    AND (SELECT COUNT(*) FROM public.table_game_players q
         WHERE q.game_id = g.id AND q.role = 'player' AND q.user_id IS NULL) <= 1
  GROUP BY p.user_id, pr.display_name
  ORDER BY wins DESC, played ASC, pr.display_name
  LIMIT 100;
$$;

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
      AND (SELECT COUNT(*) FROM public.table_game_players q
           WHERE q.game_id = g.id AND q.role = 'player' AND q.user_id IS NULL) <= 1
  ), base AS (
    SELECT p.user_id, COUNT(*) FILTER (WHERE g.winner_seat = p.seat) AS wins, COUNT(*) AS played
    FROM partidas g JOIN public.table_game_players p ON p.game_id = g.id AND p.role = 'player'
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

-- ------------------------------------------------------------------------------
-- Dominó: con más de un invitado no se apuesta
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_bets_need_players()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m public.matches;
BEGIN
  SELECT * INTO v_m FROM public.matches WHERE id = NEW.match_id;
  IF FOUND AND (CASE WHEN v_m.team1_player1 IS NULL THEN 1 ELSE 0 END
              + CASE WHEN v_m.team1_player2 IS NULL THEN 1 ELSE 0 END
              + CASE WHEN v_m.team2_player1 IS NULL THEN 1 ELSE 0 END
              + CASE WHEN v_m.team2_player2 IS NULL THEN 1 ELSE 0 END) > 1 THEN
    RAISE EXCEPTION 'En una partida con más de un invitado no se apuesta.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_bets_need_players ON public.bets;
CREATE TRIGGER tr_bets_need_players
  BEFORE INSERT ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_bets_need_players();

-- ------------------------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._guest_key(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._remember_guest(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._table_game_family(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._table_game_guests(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._table_game_missing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._require_table_game_ready(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._seat_table_game_players(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._poker_chips(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._complete_table_game(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_confirm_table_games() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_bets_need_players() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.start_table_game(uuid, text, jsonb, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_poker_game(uuid, jsonb, integer, integer, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_in_table_game(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.make_table_game_guest(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_table_game_dealer(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_table_game(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remember_club_guests(text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.forget_club_guest(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_poker_hand(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finish_table_game(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.table_game_ranking(text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.poker_ranking(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_table_game(uuid, text, jsonb, uuid), public.start_poker_game(uuid, jsonb, integer, integer, uuid),
  public.check_in_table_game(uuid), public.make_table_game_guest(uuid, integer), public.add_table_game_dealer(uuid, uuid, text),
  public.leave_table_game(uuid, integer), public.remember_club_guests(text[]), public.forget_club_guest(text),
  public.save_poker_hand(uuid, jsonb), public.finish_table_game(uuid, integer),
  public.table_game_ranking(text, timestamptz), public.poker_ranking(timestamptz) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las cuatro columnas deben salir en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'table_game_players' AND column_name = 'checked_in_at') AS confirmacion_en_mesa,
  has_function_privilege('authenticated', 'public.start_poker_game(uuid, jsonb, integer, integer, uuid)', 'EXECUTE') AS revancha_unica,
  has_function_privilege('authenticated', 'public.add_table_game_dealer(uuid, uuid, text)', 'EXECUTE') AS repartidor_de_afuera,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_bets_need_players') AS invitados_sin_apuestas;
