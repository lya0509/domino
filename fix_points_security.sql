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


-- ==============================================================================
-- VERIFICACIÓN (mándame captura de las 3)
-- ==============================================================================

-- A. Políticas que quedan en bets / matches / profiles
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('bets', 'matches', 'profiles', 'tournament_participants')
ORDER BY tablename, cmd, policyname;

-- B. Quién puede ejecutar las funciones de puntos (resolve_* NO debe salir con anon/authenticated)
SELECT routine_name, grantee
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND routine_name IN ('resolve_match_bets', 'resolve_match_wagers', 'place_bet',
                       'settle_completed_match', 'settle_my_pending_bets', 'buy_store_item',
                       'claim_achievement', 'claim_daily_bonus', 'join_tournament_with_points',
                       'award_tournament_prize', 'cancel_tournament_and_refund')
ORDER BY routine_name, grantee;

-- C. Otras funciones del servidor que tocan betting_points y que yo no conozco
--    (si sale alguna, dime su nombre: puede que necesite el mismo ajuste)
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ILIKE '%betting_points%'
  AND p.proname NOT IN ('protect_profile_sensitive_fields', 'resolve_match_bets', 'resolve_match_wagers',
                        'place_bet', 'buy_store_item', 'claim_achievement', 'claim_daily_bonus',
                        'join_tournament_with_points', 'award_tournament_prize',
                        'cancel_tournament_and_refund', 'settle_my_pending_bets', 'handle_new_user',
                        'award_zapatero_maestro', 'trg_fn_protect_profile_insert');
