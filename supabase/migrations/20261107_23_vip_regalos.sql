-- ==============================================================================
-- VIP: REGALO DEL MES, "MI MES EN EL CAFETÍN" Y PRECIO DE 3 USD
-- - Cada mes con VIP activo trae un título y un marco que solo existen ese mes.
--   Se quedan para siempre en "Lo que tienes", aunque el VIP venza. No se venden.
-- - El día 1 cada VIP recibe un aviso: su resumen del mes anterior está listo.
-- - El precio que ven los socios baja a 3 USD (si todavía decía 5).
-- - Néstor (Nestea_D_Durazno) recibe 30 días más, una sola vez.
--
-- Orden: después de 20261107_22_mesa.sql (puede ir antes también: no depende de él).
-- La app funciona antes y después de pegarlo. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

-- ------------------------------------------------------------------------------
-- Los regalos: un título y un marco por mes, de noviembre 2026 a diciembre 2030
-- (la app tiene la misma lista en src/lib/storeCatalog.ts)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vip_gift_catalog()
RETURNS TABLE (id text, type text, name text, price integer, value text, is_exclusive boolean, is_custom boolean)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH meses AS (
    SELECT m::date AS mes,
           (ARRAY['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
                  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'])[EXTRACT(MONTH FROM m)::int] AS nombre,
           (ARRAY['🎆', '💘', '🌺', '🌧️', '🌻', '⚽', '☀️', '🌴', '📚', '🎃', '🃏', '🎄'])[EXTRACT(MONTH FROM m)::int] AS emoji,
           (ARRAY['#F472B6', '#E11D48', '#F97316', '#38BDF8', '#FACC15', '#22C55E', '#14B8A6', '#84CC16',
                  '#6366F1', '#EA580C', '#A855F7', '#DC2626'])[EXTRACT(MONTH FROM m)::int] AS color
    FROM generate_series(DATE '2026-11-01', DATE '2030-12-01', interval '1 month') AS m
  )
  SELECT 'gift_' || to_char(mes, 'YYYY_MM'), 'title', emoji || ' VIP ' || nombre || ' ' || to_char(mes, 'YYYY'), 0, NULL::text, true, false
  FROM meses
  UNION ALL
  SELECT 'giftb_' || to_char(mes, 'YYYY_MM'), 'border', 'Marco ' || nombre || ' ' || to_char(mes, 'YYYY'), 0, color, true, false
  FROM meses;
$$;

-- Lo que se puede llevar puesto: la tienda más los regalos
CREATE OR REPLACE FUNCTION public.cosmetic_catalog()
RETURNS TABLE (id text, type text, name text, price integer, value text, is_exclusive boolean, is_custom boolean)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT * FROM public.store_catalog()
  UNION ALL
  SELECT * FROM public.vip_gift_catalog();
$$;

-- Igual que antes; lo único nuevo es que un regalo del inventario también se puede poner
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

    -- Solo se puede equipar lo comprado o regalado: cada casilla queda igual, vacía,
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
          SELECT 1 FROM public.cosmetic_catalog() c
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

-- ------------------------------------------------------------------------------
-- Entregar el regalo del mes
-- ------------------------------------------------------------------------------
-- El mes del cafetín (hora de Venezuela)
CREATE OR REPLACE FUNCTION public._club_month(p_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT date_trunc('month', p_at AT TIME ZONE 'America/Caracas')::date;
$$;

-- Devuelve true si lo entregó ahora (false si ya lo tenía o ese mes no tiene regalo)
CREATE OR REPLACE FUNCTION public._grant_vip_gift(p_user uuid, p_month date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text := 'gift_' || to_char(p_month, 'YYYY_MM');
  v_border text := 'giftb_' || to_char(p_month, 'YYYY_MM');
  v_name text;
  v_inv text[];
BEGIN
  SELECT name INTO v_name FROM public.vip_gift_catalog() WHERE id = v_title;
  IF v_name IS NULL THEN
    RETURN false;
  END IF;
  SELECT COALESCE(inventory, '{}') INTO v_inv FROM public.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND OR (v_title = ANY(v_inv) AND v_border = ANY(v_inv)) THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.allow_points_change', 'true', true);
  UPDATE public.profiles
  SET inventory = (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(inventory, '{}') || ARRAY[v_title, v_border]) x)
  WHERE id = p_user;
  PERFORM set_config('app.allow_points_change', 'false', true);

  PERFORM public._notify(ARRAY[p_user], '🎁 Tu regalo VIP del mes',
    'Ya tienes "' || v_name || '" y su marco. Póntelos en la Tienda, en "Lo que tienes". Son tuyos para siempre.', 'vip-gift');
  RETURN true;
END;
$$;

-- Al aprobar o renovar un VIP, el regalo del mes llega en el acto
CREATE OR REPLACE FUNCTION public.trg_fn_vip_gift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.vip_until IS NOT NULL AND NEW.vip_until > now() THEN
    -- El regalo nunca debe impedir que se apruebe un pago
    BEGIN
      PERFORM public._grant_vip_gift(NEW.user_id, public._club_month(now()));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo entregar el regalo VIP a %: %', NEW.user_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_vip_gift ON public.vip_members;
CREATE TRIGGER tr_vip_gift
  AFTER INSERT OR UPDATE OF vip_until ON public.vip_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_vip_gift();

-- ------------------------------------------------------------------------------
-- Todos los días: regalo del mes a cada VIP activo y, el día 1, el aviso del resumen
-- ------------------------------------------------------------------------------
ALTER TABLE public.vip_members ADD COLUMN IF NOT EXISTS recap_notified_month date;

CREATE OR REPLACE FUNCTION public.vip_monthly()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date := public._club_month(now());
  v_prev text;
  r RECORD;
BEGIN
  FOR r IN SELECT user_id FROM public.vip_members WHERE vip_until > now() LOOP
    PERFORM public._grant_vip_gift(r.user_id, v_month);
  END LOOP;

  -- El aviso del resumen solo sale a comienzo de mes: quien se hace VIP el 15 no recibe el del mes pasado
  IF EXTRACT(DAY FROM now() AT TIME ZONE 'America/Caracas') > 3 THEN
    RETURN;
  END IF;

  v_prev := (ARRAY['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                   'septiembre', 'octubre', 'noviembre', 'diciembre'])[EXTRACT(MONTH FROM v_month - 1)::int];
  FOR r IN
    UPDATE public.vip_members SET recap_notified_month = v_month
    WHERE vip_until > now() AND recap_notified_month IS DISTINCT FROM v_month
    RETURNING user_id
  LOOP
    PERFORM public._notify(ARRAY[r.user_id], '📊 Tu mes en el cafetín',
      'Ya está tu resumen de ' || v_prev || ': partidas, victorias, tu mejor pareja y tu rival más duro. Míralo en tu perfil y compártelo.',
      'vip-recap');
  END LOOP;
END;
$$;

-- ------------------------------------------------------------------------------
-- Precio y Néstor
-- ------------------------------------------------------------------------------
ALTER TABLE public.system_config ALTER COLUMN vip_price_text SET DEFAULT '3 USD al mes, al cambio BCV del día';
UPDATE public.system_config SET vip_price_text = '3 USD al mes, al cambio BCV del día'
WHERE vip_price_text = '5 USD al mes, al cambio BCV del día';

-- 30 días más para Néstor, una sola vez: después de sumarlos su VIP pasa del 20 de diciembre
UPDATE public.vip_members SET vip_until = vip_until + interval '30 days', warned_at = NULL, updated_at = now()
WHERE user_id = (SELECT id FROM public.profiles WHERE display_name = 'Nestea_D_Durazno')
  AND vip_until < TIMESTAMPTZ '2026-12-20 00:00:00-04';

-- Los VIP de hoy reciben ya el regalo de este mes (y el aviso del resumen no se manda hoy)
UPDATE public.vip_members SET recap_notified_month = public._club_month(now())
WHERE recap_notified_month IS NULL;
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT user_id FROM public.vip_members WHERE vip_until > now() LOOP
    PERFORM public._grant_vip_gift(r.user_id, public._club_month(now()));
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- Permisos y tarea diaria
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._club_month(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._grant_vip_gift(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_vip_gift() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vip_monthly() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vip_gift_catalog(), public.cosmetic_catalog() TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('regalo-y-resumen-vip', '10 13 * * *', 'SELECT public.vip_monthly()');
  END IF;
END $$;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las cuatro columnas deben salir en true
-- ==============================================================================
SELECT
  (SELECT COUNT(*) FROM public.vip_gift_catalog()) = 100 AS regalos_hasta_2030,
  position('cosmetic_catalog' IN pg_get_functiondef('public.protect_profile_sensitive_fields()'::regprocedure)) > 0 AS regalos_se_pueden_poner,
  (SELECT vip_price_text FROM public.system_config ORDER BY id LIMIT 1) LIKE '3 USD%' AS precio_3_usd,
  (SELECT vip_until FROM public.vip_members WHERE user_id = (SELECT id FROM public.profiles WHERE display_name = 'Nestea_D_Durazno')) > TIMESTAMPTZ '2026-12-20 00:00:00-04' AS nestor_dos_meses;
