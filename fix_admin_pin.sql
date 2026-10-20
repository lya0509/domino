-- ==============================================================================
-- ARREGLO DEL PIN DE ADMINISTRADOR
-- La función instalada respondía "PIN correcto" pero no activaba el permiso que
-- exige la protección de perfiles, así que el cambio a admin se deshacía y nadie
-- podía ser admin. Ahora sí lo activa, y solo responde true si de verdad cambió.
--
-- El PIN no cambia. Aquí solo se guarda su huella (sha256), no el PIN en claro.
-- NO vuelvas a ejecutar fix_admin_pin_rpc.sql: pisaría la protección nueva.
-- Es seguro repetir este archivo.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_admin_pin(p_pin text, p_enable boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  IF encode(sha256(convert_to(TRIM(COALESCE(p_pin, '')), 'UTF8')), 'hex')
     <> 'd71ef7eb6793164cba521ad85e7b885e6762ebe3676f6cdfe9c86ba79040cf7c' THEN
    RETURN false;
  END IF;

  -- protect_profile_sensitive_fields deja pasar el cambio de is_admin con este permiso
  PERFORM set_config('app.allow_admin_toggle', 'true', true);
  UPDATE public.profiles SET is_admin = p_enable WHERE id = v_uid
  RETURNING is_admin INTO v_now;

  RETURN v_now IS NOT DISTINCT FROM p_enable;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_admin_pin(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin(text, boolean) TO authenticated;

COMMIT;


-- ==============================================================================
-- VERIFICACIÓN (mándame captura): respeta_pin debe salir true
-- ==============================================================================
SELECT proname, position('allow_admin_toggle' in prosrc) > 0 AS respeta_pin
FROM pg_proc WHERE proname = 'verify_admin_pin';
