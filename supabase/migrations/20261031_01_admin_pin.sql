-- ==============================================================================
-- ACCESO DE ADMINISTRADOR
--   * El PIN se guarda cifrado con bcrypt en un esquema privado, fuera del repo.
--   * 5 intentos fallidos bloquean a esa persona 30 minutos.
--   * Mientras no se defina un PIN nuevo, nadie puede activar el modo admin.
--
-- Requiere fix_points_security.sql. Es seguro repetirlo.
-- El PIN NO se escribe aquí: se define aparte, con el paso final de este archivo.
-- ==============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.admin_pin (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pin_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private.admin_pin_attempts (
  user_id uuid PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);

-- Solo se puede llamar desde el SQL Editor: la app no tiene permiso
CREATE OR REPLACE FUNCTION private.set_admin_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, extensions
AS $$
BEGIN
  IF length(COALESCE(p_pin, '')) < 8 THEN
    RAISE EXCEPTION 'El PIN debe tener al menos 8 caracteres.';
  END IF;
  INSERT INTO private.admin_pin (id, pin_hash, updated_at)
  VALUES (true, crypt(p_pin, gen_salt('bf', 10)), now())
  ON CONFLICT (id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = now();
  DELETE FROM private.admin_pin_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_admin_pin(p_pin text, p_enable boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hash text;
  v_locked timestamptz;
  v_failures integer;
  v_now boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT locked_until INTO v_locked FROM private.admin_pin_attempts WHERE user_id = v_uid;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RAISE EXCEPTION 'Demasiados intentos. Prueba más tarde.';
  END IF;

  SELECT pin_hash INTO v_hash FROM private.admin_pin WHERE id;

  IF v_hash IS NULL OR crypt(TRIM(COALESCE(p_pin, '')), v_hash) IS DISTINCT FROM v_hash THEN
    INSERT INTO private.admin_pin_attempts AS a (user_id, failures)
    VALUES (v_uid, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET failures = CASE WHEN a.locked_until IS NOT NULL THEN 1 ELSE a.failures + 1 END,
          locked_until = NULL
    RETURNING failures INTO v_failures;

    IF v_failures >= 5 THEN
      UPDATE private.admin_pin_attempts
      SET locked_until = now() + interval '30 minutes'
      WHERE user_id = v_uid;
    END IF;
    RETURN false;
  END IF;

  DELETE FROM private.admin_pin_attempts WHERE user_id = v_uid;

  -- protect_profile_sensitive_fields deja pasar el cambio de is_admin con este permiso
  PERFORM set_config('app.allow_admin_toggle', 'true', true);
  UPDATE public.profiles SET is_admin = p_enable WHERE id = v_uid
  RETURNING is_admin INTO v_now;

  RETURN v_now IS NOT DISTINCT FROM p_enable;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_admin_pin(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin(text, boolean) TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

COMMIT;

-- ==============================================================================
-- PASO FINAL, EN UNA CONSULTA APARTE. No guardes esta línea en ningún archivo.
-- Cambia el texto por tu PIN nuevo (mínimo 8 caracteres) y ejecútala una sola vez:
--
--   SELECT private.set_admin_pin('ESCRIBE-AQUI-TU-PIN-NUEVO');
--
-- Después, borra esa consulta del historial del SQL Editor.
-- ==============================================================================
