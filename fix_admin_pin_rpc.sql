-- ==============================================================================
-- ⚠️ OBSOLETO — NO EJECUTAR. Pisaría la protección de fix_points_security.sql.
-- Usa fix_admin_pin.sql.
-- ==============================================================================
-- FIX MODO ADMINISTRADOR: RPC CON SECURITY DEFINER Y BYPASS DE SEGURIDAD
-- Ejecuta este script en Supabase Cloud -> SQL Editor
-- ==============================================================================

-- 1. Crear o reemplazar la función RPC que verifica el PIN y asigna/quita el rol
CREATE OR REPLACE FUNCTION public.verify_admin_pin(p_pin TEXT, p_enable BOOLEAN)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF TRIM(p_pin) = '05090105' THEN
    -- Establecer variable transaccional para autorizar el cambio en el trigger
    PERFORM set_config('app.allow_admin_toggle', 'true', true);

    -- Actualizar el estado de administrador
    UPDATE public.profiles 
    SET is_admin = p_enable 
    WHERE id = v_user_id;

    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Conceder permisos de ejecución a usuarios autenticados
GRANT EXECUTE ON FUNCTION public.verify_admin_pin(TEXT, BOOLEAN) TO authenticated;

-- 3. Actualizar la función protect_profile_sensitive_fields para que no bloquee 
-- cuando un usuario verificado con el PIN o el SQL Editor haga el cambio
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS TRIGGER AS $$
DECLARE
  caller_is_admin BOOLEAN;
BEGIN
  -- 1. Si la consulta proviene del SQL Editor de Supabase / Service Role / Postgres superuser (auth.uid() IS NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Si la llamada proviene de verify_admin_pin (con bypass de PIN maestro verificado)
  IF current_setting('app.allow_admin_toggle', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- 3. Si no se está modificando is_admin, permitir
  IF NEW.is_admin IS NOT DISTINCT FROM OLD.is_admin THEN
    RETURN NEW;
  END IF;

  -- 4. Si el llamador ya es admin, permitir
  SELECT COALESCE(is_admin, false) INTO caller_is_admin 
  FROM public.profiles 
  WHERE id = auth.uid();

  IF caller_is_admin THEN
    RETURN NEW;
  END IF;

  -- 5. Si no es admin y se intenta modificar is_admin directamente sin la RPC
  -- revertir is_admin a su valor anterior
  NEW.is_admin := OLD.is_admin;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
