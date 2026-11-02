-- ==============================================================================
-- VIP MENSUAL
-- - Un socio paga al asesor, sube el comprobante con la referencia y queda en revisión.
-- - Un administrador aprueba (suma vip_days, 30 al empezar) o rechaza con un motivo.
-- - El VIP sube una foto o GIF para su tarjeta; se ve cuando un administrador la aprueba.
-- - Tres días antes de vencer llega un aviso. Al vencer se apaga, y si pasan
--   vip_grace_days (3) sin renovar se borran su foto, GIF y frase.
-- - Solo es estilo: no da puntos ni cambia el juego.
--
-- Todo se escribe por funciones del servidor: nadie puede ponerse VIP a sí mismo.
-- Comprobantes en un almacenamiento privado (vip-receipts): solo los ven su dueño y
-- los administradores.
--
-- Orden: después de 20261102_16_tope_apuestas.sql. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

ALTER TABLE public.system_config ADD COLUMN IF NOT EXISTS vip_price_text text NOT NULL DEFAULT '5 USD al mes, al cambio BCV del día';
ALTER TABLE public.system_config ADD COLUMN IF NOT EXISTS vip_payment_info text NOT NULL DEFAULT '';
ALTER TABLE public.system_config ADD COLUMN IF NOT EXISTS vip_days integer NOT NULL DEFAULT 30;
ALTER TABLE public.system_config ADD COLUMN IF NOT EXISTS vip_grace_days integer NOT NULL DEFAULT 3;

-- ------------------------------------------------------------------------------
-- Tablas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vip_members (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  vip_until timestamptz NOT NULL,
  media_path text,
  pending_media_path text,
  tagline text,
  warned_at timestamptz,
  expired_notice_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vip_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vip_members FROM PUBLIC, anon, authenticated;
-- Todos ven quién es VIP y su tarjeta aprobada; la foto por aprobar no
GRANT SELECT (user_id, vip_until, media_path, tagline) ON public.vip_members TO anon, authenticated;
DROP POLICY IF EXISTS "VIP visibles para todos" ON public.vip_members;
CREATE POLICY "VIP visibles para todos" ON public.vip_members FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.vip_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reference text NOT NULL,
  receipt_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS vip_requests_one_pending ON public.vip_requests(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS vip_requests_status_idx ON public.vip_requests(status, created_at);

ALTER TABLE public.vip_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vip_requests FROM PUBLIC, anon, authenticated;

-- ¿Quien llama es administrador? Solo dice eso de uno mismo
CREATE OR REPLACE FUNCTION public.i_am_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false);
$$;
REVOKE EXECUTE ON FUNCTION public.i_am_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.i_am_admin() TO authenticated;

GRANT SELECT ON public.vip_requests TO authenticated;
DROP POLICY IF EXISTS "Cada quien ve sus solicitudes VIP" ON public.vip_requests;
CREATE POLICY "Cada quien ve sus solicitudes VIP" ON public.vip_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.i_am_admin());

-- ------------------------------------------------------------------------------
-- Almacenamiento
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vip-receipts', 'vip-receipts', false, 5242880, ARRAY['image/*']),
       ('vip-media', 'vip-media', true, 4194304, ARRAY['image/*'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "VIP sube su comprobante" ON storage.objects;
CREATE POLICY "VIP sube su comprobante" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vip-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "VIP ve su comprobante o el admin" ON storage.objects;
CREATE POLICY "VIP ve su comprobante o el admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vip-receipts' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.i_am_admin()));

DROP POLICY IF EXISTS "VIP sube su tarjeta" ON storage.objects;
CREATE POLICY "VIP sube su tarjeta" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vip-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "VIP ve sus archivos" ON storage.objects;
CREATE POLICY "VIP ve sus archivos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vip-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "VIP borra su tarjeta" ON storage.objects;
CREATE POLICY "VIP borra su tarjeta" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vip-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------------------------
-- Funciones
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._vip_active(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.vip_members WHERE user_id = p_user AND vip_until > now());
$$;

CREATE OR REPLACE FUNCTION public._admins()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(id), '{}') FROM public.profiles WHERE is_admin = true;
$$;

CREATE OR REPLACE FUNCTION public._own_upload(p_bucket text, p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_path IS NOT NULL
     AND p_path LIKE auth.uid()::text || '/%'
     AND position('..' IN p_path) = 0
     AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = p_bucket AND name = p_path);
$$;

-- El socio pide el VIP con la referencia del pago y la foto del comprobante
CREATE OR REPLACE FUNCTION public.request_vip(p_reference text, p_receipt_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ref text := btrim(COALESCE(p_reference, ''));
  v_id uuid;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  IF length(v_ref) < 4 OR length(v_ref) > 40 THEN
    RAISE EXCEPTION 'Escribe la referencia del pago (de 4 a 40 caracteres)';
  END IF;
  IF NOT public._own_upload('vip-receipts', p_receipt_path) THEN
    RAISE EXCEPTION 'Sube la foto del comprobante';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vip_requests WHERE user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'Ya tienes una solicitud en revisión';
  END IF;

  INSERT INTO public.vip_requests(user_id, reference, receipt_path)
  VALUES (v_uid, v_ref, p_receipt_path)
  RETURNING id INTO v_id;

  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_uid;
  PERFORM public._notify(public._admins(), 'Nueva solicitud VIP',
    COALESCE(v_name, 'Un socio') || ' pagó el VIP. Revísalo en Solicitudes VIP.', 'vip-request');
  RETURN v_id;
END;
$$;

-- Un administrador aprueba (suma los días) o rechaza
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
  v_until timestamptz;
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
    SELECT COALESCE((SELECT vip_days FROM public.system_config ORDER BY id LIMIT 1), 30) INTO v_days;
    INSERT INTO public.vip_members(user_id, vip_until)
    VALUES (v_req.user_id, now() + make_interval(days => v_days))
    ON CONFLICT (user_id) DO UPDATE
      SET vip_until = GREATEST(public.vip_members.vip_until, now()) + make_interval(days => v_days),
          warned_at = NULL, expired_notice_at = NULL, updated_at = now()
    RETURNING vip_until INTO v_until;

    UPDATE public.vip_requests
    SET status = 'approved', reason = v_reason, reviewed_by = v_uid, reviewed_at = now()
    WHERE id = p_id;
    PERFORM public._notify(ARRAY[v_req.user_id], '¡Ya eres VIP! ♛',
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

-- Lo que el socio necesita de su propio VIP, incluida la foto por aprobar
CREATE OR REPLACE FUNCTION public.get_my_vip()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m public.vip_members;
  v_r public.vip_requests;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  SELECT * INTO v_m FROM public.vip_members WHERE user_id = v_uid;
  SELECT * INTO v_r FROM public.vip_requests WHERE user_id = v_uid ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'vip_until', v_m.vip_until,
    'active', COALESCE(v_m.vip_until > now(), false),
    'media_path', v_m.media_path,
    'pending_media_path', v_m.pending_media_path,
    'tagline', v_m.tagline,
    'request', CASE WHEN v_r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'status', v_r.status, 'reason', v_r.reason, 'created_at', v_r.created_at) END
  );
END;
$$;

-- El VIP propone la foto o GIF de su tarjeta; se ve cuando la aprueban
CREATE OR REPLACE FUNCTION public.set_vip_media(p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL OR NOT public._vip_active(v_uid) THEN
    RAISE EXCEPTION 'Solo un VIP activo puede personalizar su tarjeta';
  END IF;
  IF NOT public._own_upload('vip-media', p_path) THEN
    RAISE EXCEPTION 'Sube primero la foto o el GIF';
  END IF;
  UPDATE public.vip_members SET pending_media_path = p_path, updated_at = now() WHERE user_id = v_uid;
  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_uid;
  PERFORM public._notify(public._admins(), 'Foto VIP por aprobar',
    COALESCE(v_name, 'Un VIP') || ' subió una foto para su tarjeta.', 'vip-media');
END;
$$;

CREATE OR REPLACE FUNCTION public.review_vip_media(p_user uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_m public.vip_members;
BEGIN
  IF v_uid IS NULL OR NOT public._is_admin(v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede revisar fotos VIP';
  END IF;
  SELECT * INTO v_m FROM public.vip_members WHERE user_id = p_user FOR UPDATE;
  IF v_m.pending_media_path IS NULL THEN
    RAISE EXCEPTION 'No hay foto por revisar';
  END IF;
  IF p_approve THEN
    UPDATE public.vip_members SET media_path = pending_media_path, pending_media_path = NULL, updated_at = now()
    WHERE user_id = p_user;
    PERFORM public._notify(ARRAY[p_user], 'Tu tarjeta VIP está lista', 'Aprobaron tu foto. Ya la ven todos.', 'vip-media-ok');
  ELSE
    UPDATE public.vip_members SET pending_media_path = NULL, updated_at = now() WHERE user_id = p_user;
    PERFORM public._notify(ARRAY[p_user], 'Foto VIP no aprobada', 'Sube otra foto o GIF para tu tarjeta.', 'vip-media-no');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_vip_tagline(p_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_text text := NULLIF(btrim(COALESCE(p_text, '')), '');
BEGIN
  IF v_uid IS NULL OR NOT public._vip_active(v_uid) THEN
    RAISE EXCEPTION 'Solo un VIP activo puede personalizar su tarjeta';
  END IF;
  IF length(v_text) > 60 THEN
    RAISE EXCEPTION 'La frase puede tener hasta 60 caracteres';
  END IF;
  UPDATE public.vip_members SET tagline = v_text, updated_at = now() WHERE user_id = v_uid;
END;
$$;

-- Listas para el panel de administración
CREATE OR REPLACE FUNCTION public.list_vip_requests(p_status text DEFAULT 'pending')
RETURNS TABLE(id uuid, user_id uuid, display_name text, avatar_url text, reference text, receipt_path text,
              status text, reason text, created_at timestamptz, vip_until timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public._is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las solicitudes VIP';
  END IF;
  RETURN QUERY
  SELECT r.id, r.user_id, p.display_name, p.avatar_url, r.reference, r.receipt_path,
         r.status, r.reason, r.created_at, m.vip_until
  FROM public.vip_requests r
  JOIN public.profiles p ON p.id = r.user_id
  LEFT JOIN public.vip_members m ON m.user_id = r.user_id
  WHERE p_status IS NULL OR r.status = p_status
  ORDER BY r.created_at DESC
  LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_vip_media_pending()
RETURNS TABLE(user_id uuid, display_name text, pending_media_path text, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public._is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las fotos VIP';
  END IF;
  RETURN QUERY
  SELECT m.user_id, p.display_name, m.pending_media_path, m.updated_at
  FROM public.vip_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.pending_media_path IS NOT NULL
  ORDER BY m.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_vip_settings(p_price_text text, p_payment_info text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public._is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar el VIP';
  END IF;
  IF length(btrim(COALESCE(p_price_text, ''))) = 0 OR length(p_price_text) > 120 THEN
    RAISE EXCEPTION 'Escribe el precio (hasta 120 caracteres)';
  END IF;
  IF length(COALESCE(p_payment_info, '')) > 500 THEN
    RAISE EXCEPTION 'Los datos de pago pueden tener hasta 500 caracteres';
  END IF;
  UPDATE public.system_config
  SET vip_price_text = btrim(p_price_text), vip_payment_info = btrim(COALESCE(p_payment_info, ''))
  WHERE id IS NOT NULL;
END;
$$;

-- Tarea diaria: aviso 3 días antes, aviso al vencer y limpieza tras la gracia
CREATE OR REPLACE FUNCTION public.expire_vips()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace integer := COALESCE((SELECT vip_grace_days FROM public.system_config ORDER BY id LIMIT 1), 3);
  r RECORD;
BEGIN
  FOR r IN
    UPDATE public.vip_members SET warned_at = now()
    WHERE vip_until > now() AND vip_until <= now() + interval '3 days' AND warned_at IS NULL
    RETURNING user_id, vip_until
  LOOP
    PERFORM public._notify(ARRAY[r.user_id], 'Tu VIP vence pronto',
      'Vence en ' || GREATEST(1, CEIL(EXTRACT(EPOCH FROM r.vip_until - now()) / 86400))::int
      || ' días. Renuévalo para no perder tu tarjeta.', 'vip-warning');
  END LOOP;

  FOR r IN
    UPDATE public.vip_members SET expired_notice_at = now()
    WHERE vip_until <= now() AND expired_notice_at IS NULL
    RETURNING user_id
  LOOP
    PERFORM public._notify(ARRAY[r.user_id], 'Tu VIP venció',
      'Renuévalo en ' || v_grace || ' días o se borrará tu tarjeta.', 'vip-expired');
  END LOOP;

  UPDATE public.vip_members
  SET media_path = NULL, pending_media_path = NULL, tagline = NULL, updated_at = now()
  WHERE vip_until + make_interval(days => v_grace) <= now()
    AND (media_path IS NOT NULL OR pending_media_path IS NOT NULL OR tagline IS NOT NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._vip_active(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._admins() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._own_upload(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_vips() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_vip(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_vip_request(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_vip() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_vip_media(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_vip_media(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_vip_tagline(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_vip_requests(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_vip_media_pending() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_vip_settings(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_vip(text, text), public.review_vip_request(uuid, boolean, text),
  public.get_my_vip(), public.set_vip_media(text), public.review_vip_media(uuid, boolean),
  public.set_vip_tagline(text), public.list_vip_requests(text), public.list_vip_media_pending(),
  public.set_vip_settings(text, text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('vencer-vip', '0 13 * * *', 'SELECT public.expire_vips()');
  END IF;
END $$;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las cuatro columnas deben salir en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'vip-receipts' AND public = false) AS comprobantes_privados,
  has_function_privilege('authenticated', 'public.request_vip(text, text)', 'EXECUTE') AS se_puede_pedir,
  NOT has_table_privilege('authenticated', 'public.vip_members', 'INSERT') AS nadie_se_pone_vip,
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vencer-vip') AS vencimiento_diario;
