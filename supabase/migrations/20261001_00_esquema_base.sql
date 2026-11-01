-- ==============================================================================
-- ESQUEMA BASE (archivo generado por scripts/baseline.mjs)
-- SOLO para una base de datos VACÍA. NO ejecutar en producción: producción ya tiene
-- todo esto, y el bloqueo de abajo detiene el archivo si la tabla profiles existe.
-- Las columnas salen de los scripts archivados y del código de la app; lo que no se
-- pudo reconstruir está anotado en supabase/README.md.
-- ==============================================================================
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'Este archivo es solo para una base vacía';
  END IF;
END $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  initials text NOT NULL,
  avatar_url text,
  betting_points numeric DEFAULT 1000,
  last_daily_bonus_at timestamptz,
  streak_count integer DEFAULT 0,
  last_streak_update_at date,
  inventory text[] DEFAULT '{}',
  achievements jsonb DEFAULT '[]',
  equipped_items jsonb DEFAULT '{}',
  is_admin boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  entry_fee numeric NOT NULL DEFAULT 0,
  prize_pool numeric DEFAULT 0,
  max_participants integer NOT NULL DEFAULT 16,
  status text NOT NULL DEFAULT 'registration',
  tournament_type text DEFAULT 'vip_cash',
  entry_points numeric DEFAULT 0,
  prize_paid boolean DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'completed',
  game_mode text DEFAULT 'teams',
  limit_score integer NOT NULL DEFAULT 100,
  rounds jsonb NOT NULL DEFAULT '[]',
  players_json jsonb,
  substitutions jsonb DEFAULT '[]',
  team1_player1 uuid REFERENCES public.profiles(id),
  team1_player2 uuid REFERENCES public.profiles(id),
  team2_player1 uuid REFERENCES public.profiles(id),
  team2_player2 uuid REFERENCES public.profiles(id),
  team1_total integer NOT NULL DEFAULT 0,
  team2_total integer NOT NULL DEFAULT 0,
  winner_team integer,
  is_zapato boolean DEFAULT false,
  wager_amount numeric DEFAULT 0,
  is_wager_match boolean DEFAULT false,
  wager_settled boolean DEFAULT false,
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  bet_on_team integer NOT NULL CHECK (bet_on_team IN (1, 2)),
  amount_wagered integer NOT NULL CHECK (amount_wagered > 0),
  multiplier numeric DEFAULT 2.0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.duos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  player2_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (player1_id, player2_id)
);

CREATE TABLE public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player1_id uuid NOT NULL REFERENCES public.profiles(id),
  player2_id uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'waiting'
);

CREATE TABLE public.tournament_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.profiles(id),
  partner_status text DEFAULT 'none',
  team_name text,
  payment_status text DEFAULT 'pending',
  payment_reference text,
  payment_receipt_url text,
  payout_details text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tournament_id, user_id)
);

CREATE TABLE public.tournament_brackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  match_number integer NOT NULL,
  team1_player1 uuid REFERENCES public.profiles(id),
  team1_player2 uuid REFERENCES public.profiles(id),
  team2_player1 uuid REFERENCES public.profiles(id),
  team2_player2 uuid REFERENCES public.profiles(id),
  winner_team integer,
  next_match_id uuid REFERENCES public.tournament_brackets(id),
  live_match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.live_chat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id),
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.global_chat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id),
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  link_url text,
  is_active boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.system_config (
  id integer PRIMARY KEY,
  min_app_version text
);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_brackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Perfiles visibles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Partidas visibles" ON public.matches FOR SELECT USING (true);
CREATE POLICY "Duos visibles" ON public.duos FOR SELECT USING (true);
CREATE POLICY "Torneos visibles" ON public.tournaments FOR SELECT USING (true);
CREATE POLICY "Participantes visibles" ON public.tournament_participants FOR SELECT USING (true);
CREATE POLICY "Usuarios pueden actualizar su propio registro" ON public.tournament_participants FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Admins pueden actualizar cualquier registro" ON public.tournament_participants FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "Admins pueden eliminar registros" ON public.tournament_participants FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "Admins pueden actualizar torneos" ON public.tournaments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "Llaves visibles" ON public.tournament_brackets FOR SELECT USING (true);
CREATE POLICY "Admins pueden gestionar llaves" ON public.tournament_brackets FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "Permitir leer live_chat" ON public.live_chat FOR SELECT USING (true);
CREATE POLICY "Permitir escribir live_chat" ON public.live_chat FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Permitir leer global_chat a todos" ON public.global_chat FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir escribir en global_chat" ON public.global_chat FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Ads are viewable by everyone." ON public.ads FOR SELECT USING (true);
CREATE POLICY "Permitir lectura de system_config" ON public.system_config FOR SELECT USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true), ('ads', 'ads', true), ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Se reemplaza por 20261101_03_rachas.sql
CREATE FUNCTION public.update_player_streaks_for_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END $$;

-- ------------------------------------------------------------------------------
-- Desde aplicados/fix_points_security.sql
-- ------------------------------------------------------------------------------
-- ==============================================================================
-- SEGURIDAD DE PUNTOS (SQL FINAL)
-- Después de esto, los puntos SOLO cambian dentro del servidor:
--   apuestas, pagos de apuestas/wagers, tienda, logros, bono diario y torneos.
-- La app ya no puede escribir betting_points, inventory, achievements ni
-- last_daily_bonus_at directamente; usa las funciones de este archivo.
--
-- IMPORTANTE: publica la nueva versión de la app AL MISMO TIEMPO.
-- Con la app vieja, apostar/comprar/reclamar dejará de funcionar.
--
-- Ejecuta todo en el SQL Editor de Supabase. Es seguro repetirlo.
-- Al final hay 3 consultas de verificación: mándame captura de los resultados.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. Columnas nuevas
-- ------------------------------------------------------------------------------
-- Quien crea la partida (aunque solo anote y no juegue) puede seguir actualizándola
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.matches ALTER COLUMN created_by SET DEFAULT auth.uid();
-- Evita pagar dos veces el premio de un torneo
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS prize_paid boolean DEFAULT false;

-- ¿La petición viene de la app (llave pública / sesión de usuario)?
-- Falso en el SQL Editor, service role y el registro de usuarios (handle_new_user).
CREATE OR REPLACE FUNCTION public._is_app_request()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.role(), '') IN ('anon', 'authenticated');
$$;

-- Catálogo de la tienda: mismo contenido que STORE_ITEMS en src/screens/StoreScreen.tsx
CREATE OR REPLACE FUNCTION public.store_catalog()
RETURNS TABLE (id text, type text, name text, price integer, value text, is_exclusive boolean, is_custom boolean)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('title_rey',         'title',       '👑 Rey del Zapato',        50000,  NULL,      false, false),
    ('title_custom',      'title',       '✏️ Etiqueta Personalizada', 250000, NULL,      false, true),
    ('title_veteran',     'title',       '🏅 Superviviente',          0,      NULL,      true,  false),
    ('title_mala_suerte', 'title',       '⛈️ Mala Suerte',            10000,  NULL,      false, false),
    ('title_millonario',  'title',       '💰 Millonario',             100000, NULL,      false, false),
    ('color_gold',        'color',       'Nombre Dorado',             80000,  '#F59E0B', false, false),
    ('color_fire',        'color',       'Nombre Fuego',              60000,  '#EF4444', false, false),
    ('color_rainbow',     'color',       'Nombre Arcoíris',           500000, 'rainbow', false, false),
    ('border_diamond',    'border',      'Marco Diamante',            150000, '#3B82F6', false, false),
    ('border_gold',       'border',      'Marco Oro',                 100000, '#F59E0B', false, false),
    ('border_veteran',    'border',      'Marco Titanio',             0,      '#94A3B8', true,  false),
    ('table_green',       'table_color', 'Tapete Verde Casino',       50000,  '#064e3b', false, false),
    ('table_red',         'table_color', 'Tapete Rojo Imperial',      100000, '#7f1d1d', false, false),
    ('table_black',       'table_color', 'Tapete Negro VIP',          250000, '#0f172a', false, false)
  ) AS s(id, type, name, price, value, is_exclusive, is_custom);
$$;

-- Un perfil creado desde la app no puede traer puntos/inventario/admin inventados
CREATE OR REPLACE FUNCTION public.trg_fn_protect_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset jsonb := '{}'::jsonb;
  v_new jsonb;
BEGIN
  IF NOT public._is_app_request() THEN
    RETURN NEW;
  END IF;
  v_new := to_jsonb(NEW);
  IF v_new ? 'betting_points' THEN v_reset := v_reset || '{"betting_points": 1000}'::jsonb; END IF;
  IF v_new ? 'inventory' THEN v_reset := v_reset || '{"inventory": []}'::jsonb; END IF;
  IF v_new ? 'achievements' THEN v_reset := v_reset || '{"achievements": []}'::jsonb; END IF;
  IF v_new ? 'equipped_items' THEN v_reset := v_reset || '{"equipped_items": {}}'::jsonb; END IF;
  IF v_new ? 'is_admin' THEN v_reset := v_reset || '{"is_admin": false}'::jsonb; END IF;
  RETURN jsonb_populate_record(NEW, v_reset);
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_profile_insert ON public.profiles;
CREATE TRIGGER tr_protect_profile_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_protect_profile_insert();


-- ------------------------------------------------------------------------------
-- 1. Perfiles: nadie cambia sus puntos/inventario/logros/bono desde la app
--    (solo las funciones de este archivo, que activan app.allow_points_change)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin BOOLEAN;
  v_old jsonb;
  v_keep jsonb;
  v_new_eq jsonb;
  v_old_eq jsonb;
  v_inv jsonb;
  v_slot text;
  v_val jsonb;
BEGIN
  -- SQL Editor / service role (las peticiones de la app siempre son anon o authenticated)
  IF NOT public._is_app_request() THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.allow_points_change', true) IS DISTINCT FROM 'true' THEN
    -- Restaurar los valores anteriores (solo de las columnas que existan en la tabla)
    v_old := to_jsonb(OLD);
    SELECT jsonb_object_agg(k, v_old->k) INTO v_keep
    FROM unnest(ARRAY['betting_points', 'inventory', 'achievements', 'last_daily_bonus_at']) AS k
    WHERE v_old ? k;
    IF v_keep IS NOT NULL THEN
      NEW := jsonb_populate_record(NEW, v_keep);
    END IF;

    -- Solo se puede equipar lo comprado: cada casilla queda igual, vacía,
    -- o con un artículo del inventario de ese tipo; si no, vuelve a su valor anterior
    v_new_eq := to_jsonb(NEW)->'equipped_items';
    v_old_eq := COALESCE(v_old->'equipped_items', '{}'::jsonb);
    IF v_new_eq IS NOT NULL AND jsonb_typeof(v_new_eq) = 'object'
       AND v_new_eq IS DISTINCT FROM v_old->'equipped_items' THEN
      IF jsonb_typeof(v_old_eq) <> 'object' THEN v_old_eq := '{}'::jsonb; END IF;
      v_inv := COALESCE(v_old->'inventory', '[]'::jsonb);
      IF jsonb_typeof(v_inv) <> 'array' THEN v_inv := '[]'::jsonb; END IF;

      FOREACH v_slot IN ARRAY ARRAY['title', 'color', 'border', 'table_color'] LOOP
        v_val := v_new_eq->v_slot;
        IF v_val IS NULL OR v_val = 'null'::jsonb OR v_val = '""'::jsonb
           OR v_val IS NOT DISTINCT FROM v_old_eq->v_slot THEN
          CONTINUE;
        END IF;
        -- Quien compró la etiqueta personalizada puede poner cualquier título
        IF v_slot = 'title' AND v_inv ? 'title_custom' THEN
          CONTINUE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.store_catalog() c
          WHERE c.type = v_slot
            AND v_inv ? c.id
            AND to_jsonb(CASE WHEN c.type = 'title' THEN c.name ELSE c.value END) = v_val
        ) THEN
          IF v_old_eq ? v_slot THEN
            v_new_eq := jsonb_set(v_new_eq, ARRAY[v_slot], v_old_eq->v_slot);
          ELSE
            v_new_eq := v_new_eq - v_slot;
          END IF;
        END IF;
      END LOOP;

      NEW := jsonb_populate_record(NEW, jsonb_build_object('equipped_items', v_new_eq));
    END IF;
  END IF;

  -- verify_admin_pin con PIN correcto
  IF current_setting('app.allow_admin_toggle', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS NOT DISTINCT FROM OLD.is_admin THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_admin, false) INTO caller_is_admin
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_is_admin THEN
    RETURN NEW;
  END IF;

  NEW.is_admin := OLD.is_admin;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_profile_fields ON public.profiles;
CREATE TRIGGER tr_protect_profile_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_fields();


-- ------------------------------------------------------------------------------
-- 2. Liquidación de apuestas y wagers: solo el servidor, con el ganador
--    que dice la partida (ya no lo elige quien llama)
-- ------------------------------------------------------------------------------
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
  v_payout integer;
  v_mult numeric;
BEGIN
  PERFORM set_config('app.allow_points_change', 'true', true);

  FOR r IN
    SELECT id, user_id, bet_on_team, amount_wagered, multiplier
    FROM public.bets
    WHERE match_id = p_match_id
      AND status = 'pending'
    FOR UPDATE
  LOOP
    IF p_winner_team IS NULL THEN
      -- Partida anulada: devolver puntos apostados
      UPDATE public.profiles
      SET betting_points = COALESCE(betting_points, 0) + r.amount_wagered
      WHERE id = r.user_id;

      UPDATE public.bets SET status = 'cancelled' WHERE id = r.id;

    ELSIF r.bet_on_team = p_winner_team THEN
      -- Ganada: paga monto * multiplicador (incluye capital + ganancia)
      v_mult := COALESCE(NULLIF(r.multiplier, 0), 2.0);
      v_payout := FLOOR(r.amount_wagered * v_mult);

      UPDATE public.profiles
      SET betting_points = COALESCE(betting_points, 0) + v_payout
      WHERE id = r.user_id;

      UPDATE public.bets SET status = 'won' WHERE id = r.id;

    ELSE
      -- Perdida (los puntos ya se descontaron al apostar)
      UPDATE public.bets SET status = 'lost' WHERE id = r.id;
    END IF;
  END LOOP;
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

  IF p_winner_team = 1 THEN
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

-- Ya no se pueden llamar desde la app (solo desde el trigger y settle_completed_match)
REVOKE EXECUTE ON FUNCTION public.resolve_match_bets(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_match_wagers(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Liquida una partida YA TERMINADA, tomando el ganador de la propia partida.
-- Seguro para cualquiera: no recibe ganador y no paga dos veces.
CREATE OR REPLACE FUNCTION public.settle_completed_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_winner integer;
BEGIN
  SELECT status, winner_team, team1_total, team2_total, limit_score
    INTO v_match
  FROM public.matches
  WHERE id = p_match_id;

  IF NOT FOUND OR v_match.status IS DISTINCT FROM 'completed' THEN
    RETURN;
  END IF;

  v_winner := v_match.winner_team;
  IF v_winner IS NULL THEN
    IF COALESCE(v_match.team1_total, 0) >= COALESCE(v_match.limit_score, 100) THEN
      v_winner := 1;
    ELSIF COALESCE(v_match.team2_total, 0) >= COALESCE(v_match.limit_score, 100) THEN
      v_winner := 2;
    END IF;
  END IF;

  PERFORM public.resolve_match_bets(p_match_id, v_winner);
  PERFORM public.resolve_match_wagers(p_match_id, v_winner);
END;
$$;

-- Liquida las apuestas pendientes del usuario cuyas partidas ya terminaron
CREATE OR REPLACE FUNCTION public.settle_my_pending_bets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_match_id uuid;
  v_won integer := 0;
  v_credited bigint := 0;
  v_balance numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT array_agg(b.id) INTO v_ids
  FROM public.bets b
  JOIN public.matches m ON m.id = b.match_id
  WHERE b.user_id = v_uid
    AND b.status = 'pending'
    AND m.status = 'completed';

  IF v_ids IS NOT NULL THEN
    FOR v_match_id IN
      SELECT DISTINCT match_id FROM public.bets WHERE id = ANY(v_ids)
    LOOP
      PERFORM public.settle_completed_match(v_match_id);
    END LOOP;

    SELECT
      COUNT(*) FILTER (WHERE status = 'won'),
      COALESCE(SUM(CASE
        WHEN status = 'won' THEN FLOOR(amount_wagered * COALESCE(NULLIF(multiplier, 0), 2.0))
        WHEN status = 'cancelled' THEN amount_wagered
        ELSE 0
      END), 0)
      INTO v_won, v_credited
    FROM public.bets
    WHERE id = ANY(v_ids);
  END IF;

  SELECT betting_points INTO v_balance FROM public.profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    'won_count', v_won,
    'total_credited', v_credited,
    'new_balance', v_balance
  );
END;
$$;

-- Si se borra una partida con apuestas pendientes, devolver los puntos
-- (antes se borraban en cascada y el apostador los perdía)
CREATE OR REPLACE FUNCTION public.trg_fn_refund_bets_on_match_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.resolve_match_bets(OLD.id, NULL);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_refund_bets_on_match_delete ON public.matches;
CREATE TRIGGER tr_refund_bets_on_match_delete
  BEFORE DELETE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_refund_bets_on_match_delete();


-- ------------------------------------------------------------------------------
-- 3. Apostar: el servidor descuenta el saldo, calcula la cuota y guarda la apuesta
--    en un solo paso (las reglas de 50 pts / equipo propio siguen en tr_validate_bet)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_bet(
  p_match_id uuid,
  p_bet_on_team integer,
  p_amount integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match RECORD;
  v_a uuid;
  v_b uuid;
  v_total integer;
  v_wins integer;
  v_wr numeric;
  v_mult numeric := 2.0;
  v_balance numeric;
  v_bet public.bets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para apostar.';
  END IF;
  IF p_bet_on_team NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Equipo inválido.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Ingresa una cantidad válida mayor a 0.';
  END IF;

  SELECT status, team1_total, team2_total,
         team1_player1, team1_player2, team2_player1, team2_player2
    INTO v_match
  FROM public.matches
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida no encontrada.';
  END IF;

  -- Mismas reglas que tr_validate_bet (doble barrera)
  IF v_match.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'La partida no está activa.';
  END IF;
  IF COALESCE(v_match.team1_total, 0) >= 50 OR COALESCE(v_match.team2_total, 0) >= 50 THEN
    RAISE EXCEPTION 'Apuestas cerradas: alguien llegó a 50 puntos.';
  END IF;
  IF (v_uid IN (v_match.team1_player1, v_match.team1_player2) AND p_bet_on_team <> 1)
     OR (v_uid IN (v_match.team2_player1, v_match.team2_player2) AND p_bet_on_team <> 2) THEN
    RAISE EXCEPTION 'Un jugador solo puede apostar por su propio equipo.';
  END IF;
  -- Bloquear el saldo ANTES de revisar apuestas previas: dos apuestas simultáneas
  -- del mismo usuario se ejecutan una tras otra y no usan los mismos puntos
  SELECT betting_points INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  -- Sin apuestas a los dos lados (con estas cuotas daría ganancia segura)
  IF EXISTS (
    SELECT 1 FROM public.bets
    WHERE user_id = v_uid AND match_id = p_match_id
      AND bet_on_team <> p_bet_on_team AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Ya apostaste por el otro equipo en esta partida.';
  END IF;

  -- Cuota según el historial de esa pareja (misma fórmula que muestra la app)
  IF p_bet_on_team = 1 THEN
    v_a := v_match.team1_player1; v_b := v_match.team1_player2;
  ELSE
    v_a := v_match.team2_player1; v_b := v_match.team2_player2;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE
      (winner_team = 1 AND ((team1_player1 IS NOT DISTINCT FROM v_a AND team1_player2 IS NOT DISTINCT FROM v_b)
                         OR (team1_player1 IS NOT DISTINCT FROM v_b AND team1_player2 IS NOT DISTINCT FROM v_a)))
      OR
      (winner_team = 2 AND ((team2_player1 IS NOT DISTINCT FROM v_a AND team2_player2 IS NOT DISTINCT FROM v_b)
                         OR (team2_player1 IS NOT DISTINCT FROM v_b AND team2_player2 IS NOT DISTINCT FROM v_a)))
    )
    INTO v_total, v_wins
  FROM public.matches
  WHERE status = 'completed'
    AND (
      (team1_player1 IS NOT DISTINCT FROM v_a AND team1_player2 IS NOT DISTINCT FROM v_b)
      OR (team1_player1 IS NOT DISTINCT FROM v_b AND team1_player2 IS NOT DISTINCT FROM v_a)
      OR (team2_player1 IS NOT DISTINCT FROM v_a AND team2_player2 IS NOT DISTINCT FROM v_b)
      OR (team2_player1 IS NOT DISTINCT FROM v_b AND team2_player2 IS NOT DISTINCT FROM v_a)
    );

  IF v_total > 0 THEN
    v_wr := LEAST(0.9, GREATEST(0.1, v_wins::numeric / v_total));
    v_mult := ROUND(1 / v_wr, 2);
  END IF;
  v_mult := LEAST(3.5, GREATEST(1.2, v_mult));

  IF COALESCE(v_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente. Tienes % pts disponibles.', COALESCE(v_balance, 0);
  END IF;

  INSERT INTO public.bets (user_id, match_id, bet_on_team, amount_wagered, multiplier, status)
  VALUES (v_uid, p_match_id, p_bet_on_team, p_amount, v_mult, 'pending')
  RETURNING * INTO v_bet;

  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.profiles
  SET betting_points = COALESCE(betting_points, 0) - p_amount
  WHERE id = v_uid
  RETURNING betting_points INTO v_balance;

  RETURN jsonb_build_object(
    'bet', to_jsonb(v_bet),
    'new_balance', v_balance,
    'multiplier', v_mult
  );
END;
$$;


-- ------------------------------------------------------------------------------
-- 4. Tienda: el precio lo pone el servidor
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buy_store_item(
  p_item_id text,
  p_custom_title text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item RECORD;
  v_prof jsonb;
  v_inv jsonb;
  v_eq jsonb;
  v_title text;
  v_balance numeric;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT * INTO v_item FROM public.store_catalog() c WHERE c.id = p_item_id;

  IF NOT FOUND OR v_item.is_exclusive THEN
    RAISE EXCEPTION 'Este artículo no está a la venta.';
  END IF;

  SELECT to_jsonb(p) INTO v_prof
  FROM public.profiles p
  WHERE p.id = v_uid
  FOR UPDATE;

  v_inv := COALESCE(v_prof->'inventory', '[]'::jsonb);
  IF jsonb_typeof(v_inv) <> 'array' THEN v_inv := '[]'::jsonb; END IF;
  v_eq := COALESCE(v_prof->'equipped_items', '{}'::jsonb);
  IF jsonb_typeof(v_eq) <> 'object' THEN v_eq := '{}'::jsonb; END IF;
  v_balance := COALESCE((v_prof->>'betting_points')::numeric, 0);

  IF v_item.is_custom THEN
    v_title := TRIM(COALESCE(p_custom_title, ''));
    IF length(v_title) = 0 OR length(v_title) > 20 THEN
      RAISE EXCEPTION 'La etiqueta debe tener entre 1 y 20 caracteres.';
    END IF;
  ELSIF v_inv ? p_item_id THEN
    RAISE EXCEPTION 'Ya has comprado este artículo.';
  END IF;

  IF v_balance < v_item.price THEN
    RAISE EXCEPTION 'Saldo insuficiente. Tienes % pts.', v_balance;
  END IF;

  -- Equipar automáticamente (igual que antes)
  v_eq := v_eq || jsonb_build_object(
    v_item.type,
    CASE
      WHEN v_item.is_custom THEN v_title
      WHEN v_item.type = 'title' THEN v_item.name
      ELSE v_item.value
    END
  );
  v_inv := v_inv || to_jsonb(p_item_id);

  PERFORM set_config('app.allow_points_change', 'true', true);
  -- jsonb_populate_record convierte al tipo real de cada columna (jsonb o text[])
  UPDATE public.profiles p
  SET betting_points = COALESCE(p.betting_points, 0) - v_item.price,
      inventory = r.inventory,
      equipped_items = r.equipped_items
  FROM jsonb_populate_record(
    NULL::public.profiles,
    jsonb_build_object('inventory', v_inv, 'equipped_items', v_eq)
  ) AS r
  WHERE p.id = v_uid
  RETURNING to_jsonb(p) INTO v_out;

  RETURN v_out;
END;
$$;


-- ------------------------------------------------------------------------------
-- 5. Logros: el premio lo pone el servidor y cada logro se cobra una sola vez
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_achievement(p_achievement_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_points integer;
  v_prof jsonb;
  v_ach jsonb;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  -- Mismos premios que src/screens/AchievementsScreen.tsx (ACHIEVEMENTS)
  SELECT s.points INTO v_points
  FROM (VALUES
    ('play_1', 50),
    ('play_10', 100),
    ('play_50', 300),
    ('play_100', 1000),
    ('win_1', 50),
    ('win_10', 200),
    ('win_50', 500),
    ('win_100', 2000),
    ('zapato_1', 100),
    ('zapato_5', 300),
    ('zapato_15', 1000),
    ('zapato_50', 5000),
    ('lose_1', 10),
    ('lose_10', 50),
    ('lose_50', 200),
    ('zapatorecv_1', 20),
    ('zapatorecv_5', 100),
    ('zapatorecv_15', 500),
    ('bet_win_1', 50),
    ('bet_win_10', 200),
    ('bet_win_50', 1000),
    ('bet_lose_1', 10),
    ('bet_lose_10', 50),
    ('win_streak_3', 200),
    ('win_streak_5', 500),
    ('win_streak_10', 2000),
    ('rich_1000', 100),
    ('rich_5000', 500),
    ('rich_10000', 2000),
    ('night_owl', 100),
    ('early_bird', 100),
    ('loyal_3', 150),
    ('loyal_7', 400),
    ('loyal_30', 2000),
    ('play_vs_3', 100),
    ('play_vs_10', 300),
    ('partner_3', 100),
    ('partner_10', 300),
    ('close_win_1', 100),
    ('close_win_5', 400),
    ('comeback_1', 300),
    ('fast_match_1', 200),
    ('long_match_1', 200),
    ('bet_100', 200),
    ('bet_1000', 1000),
    ('chat_10', 50),
    ('chat_100', 300),
    ('store_1', 50),
    ('store_5', 300),
    ('billetera_gorda', 100)
  ) AS s(id, points)
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
-- 6. Bono diario: 10 pts, uno por día (el día cambia a las 7 AM hora de Venezuela)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_daily_bonus()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prof jsonb;
  v_last timestamptz;
  v_today date;
  v_balance numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT to_jsonb(p) INTO v_prof
  FROM public.profiles p
  WHERE p.id = v_uid
  FOR UPDATE;

  v_last := NULLIF(v_prof->>'last_daily_bonus_at', '')::timestamptz;
  v_today := ((now() AT TIME ZONE 'America/Caracas') - interval '7 hours')::date;

  IF v_last IS NOT NULL
     AND ((v_last AT TIME ZONE 'America/Caracas') - interval '7 hours')::date >= v_today THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'new_balance', COALESCE((v_prof->>'betting_points')::numeric, 0)
    );
  END IF;

  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.profiles
  SET betting_points = COALESCE(betting_points, 0) + 10,
      last_daily_bonus_at = now()
  WHERE id = v_uid
  RETURNING betting_points INTO v_balance;

  RETURN jsonb_build_object('claimed', true, 'new_balance', v_balance);
END;
$$;


-- ------------------------------------------------------------------------------
-- 7. Torneos con puntos: inscripción, premio y cancelación
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_tournament_with_points(p_tournament_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t RECORD;
  v_cost integer;
  v_count integer;
  v_balance numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Torneo no encontrado.';
  END IF;
  IF v_t.tournament_type = 'vip_cash' THEN
    RAISE EXCEPTION 'Este torneo se paga en Bs, no con puntos.';
  END IF;
  IF v_t.status IS DISTINCT FROM 'registration' THEN
    RAISE EXCEPTION 'Las inscripciones de este torneo están cerradas.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_participants
    WHERE tournament_id = p_tournament_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Ya estás registrado en este torneo.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id;
  IF v_t.max_participants IS NOT NULL AND v_count >= v_t.max_participants THEN
    RAISE EXCEPTION 'El torneo está lleno.';
  END IF;

  v_cost := COALESCE(v_t.entry_points, 0)::integer;
  IF v_cost > 0 THEN
    SELECT betting_points INTO v_balance FROM public.profiles WHERE id = v_uid FOR UPDATE;
    IF COALESCE(v_balance, 0) < v_cost THEN
      RAISE EXCEPTION 'No tienes suficientes puntos para entrar a este torneo.';
    END IF;

    PERFORM set_config('app.allow_points_change', 'true', true);
    UPDATE public.profiles
    SET betting_points = COALESCE(betting_points, 0) - v_cost
    WHERE id = v_uid;
  END IF;

  INSERT INTO public.tournament_participants (tournament_id, user_id, payment_status)
  VALUES (p_tournament_id, v_uid, 'approved');

  UPDATE public.tournaments
  SET prize_pool = COALESCE(prize_pool, 0) + v_cost
  WHERE id = p_tournament_id;
END;
$$;

-- Paga el pozo a los campeones de la final. Los campeones salen de las llaves
-- (que solo el admin gestiona), así que cualquiera puede llamarla sin riesgo.
CREATE OR REPLACE FUNCTION public.award_tournament_prize(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t RECORD;
  v_round integer;
  v_n integer;
  v_final RECORD;
  v_champs uuid[];
  v_pool numeric;
  v_creator_admin boolean;
  v_approved integer;
  v_each integer := 0;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_t.tournament_type = 'vip_cash' OR COALESCE(v_t.prize_paid, false) THEN
    RETURN jsonb_build_object('paid', false);
  END IF;

  SELECT MAX(round_number) INTO v_round
  FROM public.tournament_brackets
  WHERE tournament_id = p_tournament_id;

  SELECT COUNT(*) INTO v_n
  FROM public.tournament_brackets
  WHERE tournament_id = p_tournament_id AND round_number = v_round;

  IF v_round IS NULL OR v_n <> 1 THEN
    RETURN jsonb_build_object('paid', false);
  END IF;

  SELECT * INTO v_final
  FROM public.tournament_brackets
  WHERE tournament_id = p_tournament_id AND round_number = v_round;

  IF v_final.winner_team IS NULL OR v_final.winner_team NOT IN (1, 2) THEN
    RETURN jsonb_build_object('paid', false);
  END IF;

  IF v_final.winner_team = 1 THEN
    v_champs := array_remove(ARRAY[v_final.team1_player1, v_final.team1_player2], NULL);
  ELSE
    v_champs := array_remove(ARRAY[v_final.team2_player1, v_final.team2_player2], NULL);
  END IF;

  v_pool := COALESCE(v_t.prize_pool, 0);

  -- Torneos creados por usuarios normales: el premio no puede superar lo que se pagó de entrada
  SELECT COALESCE(is_admin, false) INTO v_creator_admin
  FROM public.profiles WHERE id = v_t.created_by;
  IF NOT COALESCE(v_creator_admin, false) THEN
    SELECT COUNT(*) INTO v_approved
    FROM public.tournament_participants
    WHERE tournament_id = p_tournament_id AND payment_status = 'approved';
    v_pool := LEAST(v_pool, COALESCE(v_t.entry_points, 0) * v_approved);
  END IF;

  IF v_pool > 0 AND COALESCE(array_length(v_champs, 1), 0) > 0 THEN
    v_each := FLOOR(v_pool / array_length(v_champs, 1));
    PERFORM set_config('app.allow_points_change', 'true', true);
    UPDATE public.profiles
    SET betting_points = COALESCE(betting_points, 0) + v_each
    WHERE id = ANY(v_champs);
  END IF;

  UPDATE public.tournaments
  SET prize_paid = true, status = 'completed'
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object('paid', v_each > 0, 'per_champion', v_each);
END;
$$;

-- Cancelar y reembolsar: solo el admin o quien creó el torneo
CREATE OR REPLACE FUNCTION public.cancel_tournament_and_refund(t_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t RECORD;
  v_is_admin boolean;
BEGIN
  SELECT status, entry_points, created_by, tournament_type INTO v_t
  FROM public.tournaments WHERE id = t_id FOR UPDATE;

  IF NOT FOUND OR v_t.status IS DISTINCT FROM 'registration' THEN
    RETURN; -- No se puede cancelar si ya empezó o terminó
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM public.profiles WHERE id = auth.uid();
  IF auth.uid() IS NOT NULL AND NOT COALESCE(v_is_admin, false)
     AND v_t.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solo el creador o un administrador puede cancelar este torneo.';
  END IF;

  UPDATE public.tournaments SET status = 'cancelled' WHERE id = t_id;

  -- Reembolso solo a quienes pagaron con puntos (inscripción aprobada, torneo no en Bs)
  IF COALESCE(v_t.entry_points, 0) > 0 AND v_t.tournament_type IS DISTINCT FROM 'vip_cash' THEN
    PERFORM set_config('app.allow_points_change', 'true', true);
    UPDATE public.profiles p
    SET betting_points = COALESCE(p.betting_points, 0) + v_t.entry_points
    FROM public.tournament_participants tp
    WHERE tp.tournament_id = t_id AND tp.user_id = p.id AND tp.payment_status = 'approved';
  END IF;
END;
$$;


-- Logro "Zapatero Maestro" (3 zapatos dados): el servidor cuenta las partidas antes de darlo
CREATE OR REPLACE FUNCTION public.award_zapatero_maestro(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_ach jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(to_jsonb(p)->'achievements', '[]'::jsonb) INTO v_ach
  FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(v_ach) <> 'array' THEN v_ach := '[]'::jsonb; END IF;
  IF v_ach ? 'zapatero_maestro' THEN
    RETURN false;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.matches
  WHERE status = 'completed' AND is_zapato = true
    AND ((winner_team = 1 AND p_user_id IN (team1_player1, team1_player2))
      OR (winner_team = 2 AND p_user_id IN (team2_player1, team2_player2)));

  IF v_count < 3 THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.profiles p
  SET achievements = r.achievements
  FROM jsonb_populate_record(
    NULL::public.profiles,
    jsonb_build_object('achievements', v_ach || '"zapatero_maestro"'::jsonb)
  ) AS r
  WHERE p.id = p_user_id;

  RETURN true;
END;
$$;


-- ------------------------------------------------------------------------------
-- 8. Permisos de las funciones nuevas: solo usuarios con sesión
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.settle_completed_match(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.settle_my_pending_bets() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.place_bet(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.buy_store_item(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_achievement(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_daily_bonus() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.join_tournament_with_points(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.award_tournament_prize(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_tournament_and_refund(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.award_zapatero_maestro(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_fn_refund_bets_on_match_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_protect_profile_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_zapatero_maestro(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.settle_completed_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_my_pending_bets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bet(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_store_item(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_achievement(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_bonus() TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_tournament_with_points(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.award_tournament_prize(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_tournament_and_refund(uuid) TO authenticated;


-- ------------------------------------------------------------------------------
-- 9. Cerrar las políticas abiertas
-- ------------------------------------------------------------------------------
-- bets: se pueden VER, pero crear/cambiar/borrar solo desde el servidor (place_bet)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bets' AND cmd <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.bets', pol.policyname);
  END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.bets FROM anon, authenticated;

-- matches: solo jugadores de la mesa, quien la creó, o un admin pueden anotar
DROP POLICY IF EXISTS "Authenticated users can update matches" ON public.matches;
DROP POLICY IF EXISTS "Authenticated update matches" ON public.matches;
DROP POLICY IF EXISTS "Only participants or admins can update matches" ON public.matches;
CREATE POLICY "Only participants or admins can update matches" ON public.matches
  FOR UPDATE USING (
    auth.uid() IN (team1_player1, team1_player2, team2_player1, team2_player2)
    OR created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    OR (team1_player1 IS NULL AND team2_player1 IS NULL)
  );

-- matches: la apuesta VIP se fija al crear la partida y nadie (salvo admin) la cambia después;
-- created_by siempre es quien la crea y wager_settled solo lo marca el servidor
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
    RETURN NEW;
  END IF;

  IF current_setting('app.allow_points_change', true) = 'true' THEN
    RETURN NEW; -- resolve_match_wagers marcando wager_settled
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    NEW.wager_amount := OLD.wager_amount;
    NEW.is_wager_match := OLD.is_wager_match;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.wager_settled := OLD.wager_settled;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_fn_protect_match_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_protect_match_fields ON public.matches;
CREATE TRIGGER tr_protect_match_fields
  BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_protect_match_fields();

-- tournament_participants: inscribirse uno mismo solo como 'pending' (pago en Bs por verificar).
-- La inscripción con puntos la hace join_tournament_with_points; aprobar pagos, el admin.
DROP POLICY IF EXISTS "Usuarios pueden registrarse a si mismos" ON public.tournament_participants;
CREATE POLICY "Usuarios pueden registrarse a si mismos" ON public.tournament_participants
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND COALESCE(payment_status, 'pending') = 'pending'
  );
DROP POLICY IF EXISTS "Admins pueden insertar participantes" ON public.tournament_participants;
CREATE POLICY "Admins pueden insertar participantes" ON public.tournament_participants
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Un usuario puede editar su inscripción (compañero, datos de cobro) pero no aprobarse el pago
CREATE OR REPLACE FUNCTION public.trg_fn_protect_participant_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_app_request() THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    NEW.payment_status := OLD.payment_status;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_fn_protect_participant_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_protect_participant_payment ON public.tournament_participants;
CREATE TRIGGER tr_protect_participant_payment
  BEFORE UPDATE ON public.tournament_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_protect_participant_payment();

COMMIT;

-- ------------------------------------------------------------------------------
-- Desde aplicados/fix_wager_consent.sql
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- Desde aplicados/fix_wager_substitutes.sql
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- Desde aplicados/fix_bets_rules.sql
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- Desde aplicados/fix_tournament_engine.sql
-- ------------------------------------------------------------------------------
-- ==============================================================================
-- MOTOR DE TORNEOS EN EL SERVIDOR
-- Las llaves (tournament_brackets) y el estado del torneo solo los puede cambiar
-- un admin. Por eso:
--   * un usuario normal que crea un torneo no podía arrancarlo, y
--   * al terminar una partida de torneo, el jugador (no admin) no podía marcar
--     el ganador ni crear la siguiente ronda: el torneo se quedaba atascado.
-- Ahora:
--   * start_tournament: el creador o un admin arranca el torneo.
--   * expire_tournament_registration: al vencer la inscripción (5 min), si hay
--     4 o más inscritos arranca con parejas al azar; si no, cancela y reembolsa.
--   * Un trigger en matches avanza las llaves solo, cuando una partida de torneo
--     termina (también si se terminó sin internet y se sincronizó después),
--     y al terminar la final paga el premio.
--
-- Requiere haber ejecutado antes fix_points_security.sql (award_tournament_prize).
-- Ejecuta todo en el SQL Editor de Supabase. Es seguro repetirlo.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Helper: crea la partida en vivo y la llave de un cruce entre dos equipos.
-- p_t2 vacío = pase directo (bye): la llave nace ganada por el equipo 1.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_create_bracket(
  p_tournament_id uuid,
  p_round integer,
  p_match_number integer,
  p_t1 uuid[],
  p_t2 uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_id uuid;
  v_players jsonb;
BEGIN
  IF p_t2 IS NULL OR array_length(p_t2, 1) IS NULL THEN
    INSERT INTO public.tournament_brackets
      (tournament_id, round_number, match_number, team1_player1, team1_player2, winner_team)
    VALUES (p_tournament_id, p_round, p_match_number, p_t1[1], p_t1[2], 1);
    RETURN;
  END IF;

  -- Mismo formato de players_json que crea la app
  SELECT jsonb_agg(jsonb_build_object(
           'id', x.slot::text, 'profileId', x.pid, 'name', p.display_name,
           'initials', p.initials, 'teamNumber', x.team, 'position', x.pos)
         ORDER BY x.slot)
    INTO v_players
  FROM (VALUES
    (1, p_t1[1], 1, 'bottom'),
    (2, p_t2[1], 2, 'right'),
    (3, p_t1[2], 1, 'top'),
    (4, p_t2[2], 2, 'left')
  ) AS x(slot, pid, team, pos)
  LEFT JOIN public.profiles p ON p.id = x.pid;

  INSERT INTO public.matches
    (tournament_id, status, game_mode, limit_score, team1_total, team2_total,
     team1_player1, team1_player2, team2_player1, team2_player2, rounds, players_json)
  VALUES
    (p_tournament_id, 'active', 'teams', 100, 0, 0,
     p_t1[1], p_t1[2], p_t2[1], p_t2[2], '[]'::jsonb, v_players)
  RETURNING id INTO v_match_id;

  INSERT INTO public.tournament_brackets
    (tournament_id, round_number, match_number,
     team1_player1, team1_player2, team2_player1, team2_player2, live_match_id)
  VALUES (p_tournament_id, p_round, p_match_number,
          p_t1[1], p_t1[2], p_t2[1], p_t2[2], v_match_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- Arranque interno (sin revisar quién llama): arma equipos y la ronda 1
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_start_internal(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t RECORD;
  v_teams uuid[][] := '{}';
  v_singles uuid[] := '{}';
  v_used uuid[] := '{}';
  v_left uuid;
  r RECORD;
  i integer;
  v_n integer;
  v_match integer := 1;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_t.status IS DISTINCT FROM 'registration' THEN
    RETURN jsonb_build_object('started', false, 'reason', 'not_registration');
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND payment_status = 'approved';
  IF v_n < 4 THEN
    RETURN jsonb_build_object('started', false, 'reason', 'not_enough_players');
  END IF;
  IF v_t.tournament_type = 'vip_cash' AND v_n % 8 <> 0 THEN
    RETURN jsonb_build_object('started', false, 'reason', 'vip_needs_multiple_of_8');
  END IF;

  -- 1. Dúos confirmados (los dos aprobados)
  FOR r IN
    SELECT a.user_id AS p1, a.partner_id AS p2
    FROM public.tournament_participants a
    JOIN public.tournament_participants b
      ON b.tournament_id = a.tournament_id AND b.user_id = a.partner_id
    WHERE a.tournament_id = p_tournament_id
      AND a.payment_status = 'approved' AND b.payment_status = 'approved'
      AND a.partner_status = 'confirmed' AND b.partner_status = 'confirmed'
      AND b.partner_id = a.user_id
      AND a.user_id < a.partner_id
  LOOP
    v_teams := v_teams || ARRAY[ARRAY[r.p1, r.p2]];
    v_used := v_used || r.p1 || r.p2;
  END LOOP;

  -- 2. Los demás, en parejas al azar
  SELECT COALESCE(array_agg(user_id ORDER BY random()), '{}') INTO v_singles
  FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND payment_status = 'approved'
    AND NOT (user_id = ANY(v_used));

  i := 1;
  WHILE i + 1 <= COALESCE(array_length(v_singles, 1), 0) LOOP
    v_teams := v_teams || ARRAY[ARRAY[v_singles[i], v_singles[i + 1]]];
    UPDATE public.tournament_participants
    SET partner_id = CASE WHEN user_id = v_singles[i] THEN v_singles[i + 1] ELSE v_singles[i] END,
        partner_status = 'confirmed'
    WHERE tournament_id = p_tournament_id AND user_id IN (v_singles[i], v_singles[i + 1]);
    i := i + 2;
  END LOOP;

  -- 3. Si sobra un jugador sin pareja: queda fuera y se le devuelven sus puntos
  IF COALESCE(array_length(v_singles, 1), 0) % 2 = 1 THEN
    v_left := v_singles[array_length(v_singles, 1)];
    DELETE FROM public.tournament_participants
    WHERE tournament_id = p_tournament_id AND user_id = v_left;
    IF COALESCE(v_t.entry_points, 0) > 0 AND v_t.tournament_type IS DISTINCT FROM 'vip_cash' THEN
      PERFORM set_config('app.allow_points_change', 'true', true);
      UPDATE public.profiles SET betting_points = COALESCE(betting_points, 0) + v_t.entry_points
      WHERE id = v_left;
      UPDATE public.tournaments SET prize_pool = GREATEST(COALESCE(prize_pool, 0) - v_t.entry_points, 0)
      WHERE id = p_tournament_id;
    END IF;
  END IF;

  -- 4. Ronda 1 en orden aleatorio; si hay número impar de equipos, el último pasa directo
  v_teams := ARRAY(
    SELECT ARRAY[v_teams[k][1], v_teams[k][2]]
    FROM generate_subscripts(v_teams, 1) AS k
    ORDER BY random()
  );

  i := 1;
  WHILE i <= COALESCE(array_length(v_teams, 1), 0) LOOP
    IF i + 1 <= array_length(v_teams, 1) THEN
      PERFORM public._tournament_create_bracket(p_tournament_id, 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], ARRAY[v_teams[i + 1][1], v_teams[i + 1][2]]);
    ELSE
      PERFORM public._tournament_create_bracket(p_tournament_id, 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], NULL);
    END IF;
    v_match := v_match + 1;
    i := i + 2;
  END LOOP;

  UPDATE public.tournaments SET status = 'in_progress' WHERE id = p_tournament_id;

  RETURN jsonb_build_object('started', true, 'teams', array_length(v_teams, 1), 'left_out', v_left);
END;
$$;

-- ------------------------------------------------------------------------------
-- Arrancar: solo el creador o un admin
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_tournament(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;
  SELECT created_by INTO v_creator FROM public.tournaments WHERE id = p_tournament_id;
  IF v_creator IS DISTINCT FROM auth.uid()
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Solo el creador o un administrador puede iniciar este torneo.';
  END IF;
  RETURN public._tournament_start_internal(p_tournament_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- Fin de la inscripción (5 min, igual que el contador de la app).
-- Cualquiera puede llamarla, pero solo actúa si el plazo ya venció.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_tournament_registration(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t RECORD;
  v_res jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id;
  IF NOT FOUND OR v_t.status IS DISTINCT FROM 'registration' OR v_t.tournament_type = 'vip_cash' THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;
  IF now() < v_t.created_at + interval '5 minutes' THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'not_expired');
  END IF;

  v_res := public._tournament_start_internal(p_tournament_id);
  IF (v_res->>'started')::boolean THEN
    RETURN jsonb_build_object('action', 'started') || v_res;
  END IF;
  IF v_res->>'reason' IS DISTINCT FROM 'not_enough_players' THEN
    RETURN jsonb_build_object('action', 'none'); -- otro usuario ya lo arrancó o canceló
  END IF;

  -- Menos de 4 jugadores: cancelar y reembolsar
  UPDATE public.tournaments SET status = 'cancelled'
  WHERE id = p_tournament_id AND status = 'registration';
  IF FOUND AND COALESCE(v_t.entry_points, 0) > 0 THEN
    PERFORM set_config('app.allow_points_change', 'true', true);
    UPDATE public.profiles p
    SET betting_points = COALESCE(p.betting_points, 0) + v_t.entry_points
    FROM public.tournament_participants tp
    WHERE tp.tournament_id = p_tournament_id AND tp.user_id = p.id AND tp.payment_status = 'approved';
  END IF;
  RETURN jsonb_build_object('action', 'cancelled');
END;
$$;

-- ------------------------------------------------------------------------------
-- Trigger: una partida de torneo terminó → marcar la llave y avanzar
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_advance_tournament()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bracket RECORD;
  v_winner integer;
  v_pending integer;
  v_teams uuid[][];
  v_count integer;
  i integer;
  v_match integer := 1;
BEGIN
  v_winner := NEW.winner_team;
  IF v_winner IS NULL THEN
    IF COALESCE(NEW.team1_total, 0) >= COALESCE(NEW.limit_score, 100) THEN v_winner := 1;
    ELSIF COALESCE(NEW.team2_total, 0) >= COALESCE(NEW.limit_score, 100) THEN v_winner := 2;
    END IF;
  END IF;
  IF v_winner IS NULL OR v_winner NOT IN (1, 2) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_bracket FROM public.tournament_brackets
  WHERE live_match_id = NEW.id
  FOR UPDATE;
  IF NOT FOUND OR v_bracket.winner_team IS NOT NULL THEN
    RETURN NEW; -- ya procesada
  END IF;

  UPDATE public.tournament_brackets SET winner_team = v_winner WHERE id = v_bracket.id;

  -- Bloquear el torneo: dos finales de ronda simultáneas se procesan en orden
  PERFORM 1 FROM public.tournaments WHERE id = v_bracket.tournament_id FOR UPDATE;

  SELECT COUNT(*) FILTER (WHERE winner_team IS NULL), COUNT(*)
    INTO v_pending, v_count
  FROM public.tournament_brackets
  WHERE tournament_id = v_bracket.tournament_id AND round_number = v_bracket.round_number;

  IF v_pending > 0 THEN
    RETURN NEW; -- faltan partidas de esta ronda
  END IF;

  -- ¿Ya existe la siguiente ronda? (no duplicar)
  IF EXISTS (SELECT 1 FROM public.tournament_brackets
             WHERE tournament_id = v_bracket.tournament_id
               AND round_number = v_bracket.round_number + 1) THEN
    RETURN NEW;
  END IF;

  IF v_count = 1 THEN
    -- Era la final: terminar y pagar el premio (si es de puntos)
    UPDATE public.tournaments SET status = 'completed' WHERE id = v_bracket.tournament_id;
    PERFORM public.award_tournament_prize(v_bracket.tournament_id);
    RETURN NEW;
  END IF;

  -- Ganadores de la ronda, en orden de llave
  v_teams := ARRAY(
    SELECT CASE WHEN winner_team = 1 THEN ARRAY[team1_player1, team1_player2]
                ELSE ARRAY[team2_player1, team2_player2] END
    FROM public.tournament_brackets
    WHERE tournament_id = v_bracket.tournament_id AND round_number = v_bracket.round_number
    ORDER BY match_number
  );

  i := 1;
  WHILE i <= array_length(v_teams, 1) LOOP
    IF i + 1 <= array_length(v_teams, 1) THEN
      PERFORM public._tournament_create_bracket(v_bracket.tournament_id, v_bracket.round_number + 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], ARRAY[v_teams[i + 1][1], v_teams[i + 1][2]]);
    ELSE
      PERFORM public._tournament_create_bracket(v_bracket.tournament_id, v_bracket.round_number + 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], NULL);
    END IF;
    v_match := v_match + 1;
    i := i + 2;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_advance_tournament ON public.matches;
CREATE TRIGGER tr_advance_tournament
  AFTER UPDATE OF status ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.tournament_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_fn_advance_tournament();

-- ------------------------------------------------------------------------------
-- Desde peligrosos/supabase_maintenance_fix.sql (solo el pago automático al terminar)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_settle_match_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner integer;
BEGIN
  IF NEW.status = 'completed' THEN
    v_winner := NEW.winner_team;
    IF v_winner IS NULL THEN
      IF COALESCE(NEW.team1_total, 0) >= COALESCE(NEW.limit_score, 100) THEN
        v_winner := 1;
      ELSIF COALESCE(NEW.team2_total, 0) >= COALESCE(NEW.limit_score, 100) THEN
        v_winner := 2;
      END IF;
    END IF;

    PERFORM public.resolve_match_bets(NEW.id, v_winner);
    PERFORM public.resolve_match_wagers(NEW.id, v_winner);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_resolve_match_bets ON public.matches;
CREATE TRIGGER trg_auto_resolve_match_bets
  AFTER INSERT OR UPDATE OF status, winner_team
  ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.trg_fn_settle_match_on_complete();
