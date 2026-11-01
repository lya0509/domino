-- ⚠️ OBSOLETO — NO EJECUTAR. Falla con quien ya jugó partidas. Usa fix_delete_account.sql.
-- ==============================================================================
-- ELIMINACIÓN DE CUENTA DE USUARIO (DERECHO AL OLVIDO / COMPLIANCE DE TIENDAS)
-- Ejecuta este script en Supabase Dashboard -> SQL Editor
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Obtener el usuario autenticado que realiza la solicitud
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado para eliminar cuenta';
  END IF;

  -- 1. Eliminar datos dependientes si no tienen ON DELETE CASCADE
  DELETE FROM public.waitlist WHERE player1_id = v_user_id OR player2_id = v_user_id;
  DELETE FROM public.tournament_participants WHERE user_id = v_user_id;
  DELETE FROM public.bets WHERE user_id = v_user_id;
  DELETE FROM public.live_chat WHERE user_id = v_user_id;
  DELETE FROM public.global_chat WHERE user_id = v_user_id;
  DELETE FROM public.duos WHERE player1_id = v_user_id OR player2_id = v_user_id;

  -- 2. Eliminar el perfil del usuario
  DELETE FROM public.profiles WHERE id = v_user_id;

  -- 3. Eliminar el registro de autenticación en auth.users
  DELETE FROM auth.users WHERE id = v_user_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Conceder permisos de ejecución para usuarios autenticados
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;
