-- ==============================================================================
-- VIP: ANTIGÜEDAD, ESTILO DEL BORDE Y FUNDADORES
-- - streak_months: meses pagados seguidos. Renovar antes de vencer, o dentro de
--   los días de gracia, suma uno; si no, la racha vuelve a 1. La app muestra la
--   insignia de 1, 3, 6 y 12 meses.
-- - ring_style: el VIP elige el borde (oro, diamante, fuego o arcoíris).
-- - founder_number: los primeros 10 socios que se hacen VIP reciben el sello de
--   Fundador, para siempre. Se da en la primera aprobación de cada socio.
-- Todo lo escribe el servidor: la app solo lee.
--
-- Orden: después de 20261102_17_vip.sql. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

ALTER TABLE public.vip_members ADD COLUMN IF NOT EXISTS streak_months integer NOT NULL DEFAULT 1;
ALTER TABLE public.vip_members ADD COLUMN IF NOT EXISTS ring_style text NOT NULL DEFAULT 'oro';
ALTER TABLE public.vip_members ADD COLUMN IF NOT EXISTS founder_number integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vip_members_ring_style_check') THEN
    ALTER TABLE public.vip_members ADD CONSTRAINT vip_members_ring_style_check
      CHECK (ring_style IN ('oro', 'diamante', 'fuego', 'arcoiris'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vip_members_founder_check') THEN
    ALTER TABLE public.vip_members ADD CONSTRAINT vip_members_founder_check
      CHECK (founder_number IS NULL OR founder_number BETWEEN 1 AND 10);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS vip_members_founder_unique ON public.vip_members(founder_number) WHERE founder_number IS NOT NULL;

GRANT SELECT (streak_months, ring_style, founder_number) ON public.vip_members TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_vip_request(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.vip_requests;
  v_days integer;
  v_grace integer;
  v_old public.vip_members;
  v_until timestamptz;
  v_first boolean;
  v_founder integer;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL OR NOT public._is_admin(v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede revisar el VIP';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Falta aprobar o rechazar';
  END IF;

  SELECT * INTO v_req FROM public.vip_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa solicitud no existe';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Esa solicitud ya fue revisada';
  END IF;

  IF p_approve THEN
    -- Una sola aprobación a la vez decide los números de fundador
    PERFORM 1 FROM public.system_config ORDER BY id LIMIT 1 FOR UPDATE;
    SELECT COALESCE(vip_days, 30), COALESCE(vip_grace_days, 3) INTO v_days, v_grace
    FROM public.system_config ORDER BY id LIMIT 1;
    v_days := COALESCE(v_days, 30);
    v_grace := COALESCE(v_grace, 3);

    SELECT * INTO v_old FROM public.vip_members WHERE user_id = v_req.user_id FOR UPDATE;
    v_first := NOT EXISTS (SELECT 1 FROM public.vip_requests WHERE user_id = v_req.user_id AND status = 'approved');
    IF v_first AND (SELECT count(*) FROM public.vip_members WHERE founder_number IS NOT NULL) < 10 THEN
      SELECT min(n) INTO v_founder FROM generate_series(1, 10) n
      WHERE NOT EXISTS (SELECT 1 FROM public.vip_members WHERE founder_number = n);
    END IF;

    INSERT INTO public.vip_members(user_id, vip_until, streak_months, founder_number)
    VALUES (v_req.user_id, now() + make_interval(days => v_days), 1, v_founder)
    ON CONFLICT (user_id) DO UPDATE
      SET vip_until = GREATEST(public.vip_members.vip_until, now()) + make_interval(days => v_days),
          -- Renovar a tiempo (o en la gracia) sigue la racha; si no, empieza de nuevo
          streak_months = CASE WHEN public.vip_members.vip_until + make_interval(days => v_grace) >= now()
                               THEN public.vip_members.streak_months + 1 ELSE 1 END,
          founder_number = COALESCE(public.vip_members.founder_number, EXCLUDED.founder_number),
          warned_at = NULL, expired_notice_at = NULL, updated_at = now()
    RETURNING vip_until INTO v_until;

    UPDATE public.vip_requests
    SET status = 'approved', reason = v_reason, reviewed_by = v_uid, reviewed_at = now()
    WHERE id = p_id;
    PERFORM public._notify(ARRAY[v_req.user_id],
      CASE WHEN v_founder IS NOT NULL THEN '¡Ya eres VIP Fundador #' || v_founder || '! ♛' ELSE '¡Ya eres VIP! ♛' END,
      'Tu VIP está activo. Personaliza tu tarjeta en tu perfil.', 'vip-approved');
    RETURN v_until;
  END IF;

  UPDATE public.vip_requests
  SET status = 'rejected', reason = COALESCE(v_reason, 'No se pudo confirmar el pago'), reviewed_by = v_uid, reviewed_at = now()
  WHERE id = p_id;
  PERFORM public._notify(ARRAY[v_req.user_id], 'Solicitud VIP rechazada',
    COALESCE(v_reason, 'No se pudo confirmar el pago') || '. Puedes enviarla de nuevo.', 'vip-rejected');
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_vip_ring_style(p_style text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public._vip_active(v_uid) THEN
    RAISE EXCEPTION 'Solo un VIP activo puede elegir su borde';
  END IF;
  IF p_style IS NULL OR p_style NOT IN ('oro', 'diamante', 'fuego', 'arcoiris') THEN
    RAISE EXCEPTION 'Ese borde no existe';
  END IF;
  UPDATE public.vip_members SET ring_style = p_style, updated_at = now() WHERE user_id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_vip_ring_style(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vip_ring_style(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.review_vip_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_vip_request(uuid, boolean, text) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las tres columnas deben salir en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vip_members' AND column_name = 'founder_number') AS fundadores,
  position('streak_months' IN pg_get_functiondef('public.review_vip_request(uuid, boolean, text)'::regprocedure)) > 0 AS antiguedad,
  has_function_privilege('authenticated', 'public.set_vip_ring_style(text)', 'EXECUTE') AS bordes;
