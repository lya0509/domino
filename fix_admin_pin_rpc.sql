-- ==============================================================================
-- FIX MODO ADMINISTRADOR: RPC CON SECURITY DEFINER
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
    -- Al ser SECURITY DEFINER, esta función tiene permisos elevados para modificar is_admin
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
-- cuando un usuario ya autenticado con el PIN haga el cambio
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS TRIGGER AS $$
DECLARE
  caller_is_admin BOOLEAN;
BEGIN
  -- Si no se está modificando is_admin, permitir
  IF NEW.is_admin IS NOT DISTINCT FROM OLD.is_admin THEN
    RETURN NEW;
  END IF;

  -- Si el llamador ya es admin, permitir
  SELECT COALESCE(is_admin, false) INTO caller_is_admin 
  FROM public.profiles 
  WHERE id = auth.uid();

  IF caller_is_admin THEN
    RETURN NEW;
  END IF;

  -- Si no es admin y se intenta modificar is_admin directamente sin la RPC
  -- revertir is_admin a su valor anterior
  NEW.is_admin := OLD.is_admin;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
