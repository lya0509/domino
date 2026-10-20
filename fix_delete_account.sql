-- ==============================================================================
-- ELIMINAR CUENTA (derecho de borrado)
-- La función delete_user_account no existía en la base de datos: el botón
-- "Eliminar mi cuenta" decía "Cuenta Eliminada" pero no borraba nada.
-- Además, quien ya jugó no se puede borrar del todo: sus partidas y torneos
-- (que también son de los otros jugadores) apuntan a su perfil.
--
-- Ahora:
--   * se borra todo lo que es solo suyo (chats, fila, dúos, apuestas, inscripciones);
--   * si no tiene historial, se borran el perfil y el acceso por completo;
--   * si tiene historial, el perfil queda como "Jugador eliminado", sin nombre,
--     foto ni puntos, su nombre se quita de las partidas, y el acceso se cierra:
--     sin correo, sin contraseña y bloqueado.
--
-- Requiere fix_points_security.sql. Es seguro repetirlo.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sql text;
  v_deleted boolean := false;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;
  v_label := 'Jugador eliminado ' || upper(left(v_uid::text, 4));

  -- 1. Lo que es solo suyo (si una tabla o columna no existe, se salta)
  FOREACH v_sql IN ARRAY ARRAY[
    'DELETE FROM public.waitlist WHERE creator_id = $1 OR player1_id = $1 OR player2_id = $1',
    'DELETE FROM public.global_chat WHERE user_id = $1',
    'DELETE FROM public.live_chat WHERE user_id = $1',
    'DELETE FROM public.duos WHERE player1_id = $1 OR player2_id = $1',
    'DELETE FROM public.bets WHERE user_id = $1',
    'DELETE FROM public.wager_consents WHERE user_id = $1',
    'UPDATE public.tournament_participants SET partner_id = NULL, partner_status = NULL WHERE partner_id = $1',
    'DELETE FROM public.tournament_participants WHERE user_id = $1',
    'UPDATE public.tournaments SET created_by = NULL WHERE created_by = $1'
  ] LOOP
    BEGIN
      EXECUTE v_sql USING v_uid;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  -- 2. Su nombre fuera de las partidas guardadas (las partidas siguen siendo de los demás)
  BEGIN
    UPDATE public.matches m
    SET players_json = (
      SELECT jsonb_agg(CASE WHEN e->>'profileId' = v_uid::text
                            THEN e || jsonb_build_object('name', v_label, 'initials', '--')
                            ELSE e END)
      FROM jsonb_array_elements(m.players_json::jsonb) e
    )
    WHERE jsonb_typeof(m.players_json::jsonb) = 'array'
      AND m.players_json::jsonb @> jsonb_build_array(jsonb_build_object('profileId', v_uid::text));
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    NULL;
  END;

  -- 3. El perfil: borrarlo, o anonimizarlo si su historial lo necesita
  PERFORM set_config('app.allow_points_change', 'true', true);
  PERFORM set_config('app.allow_admin_toggle', 'true', true);
  BEGIN
    DELETE FROM public.profiles WHERE id = v_uid;
    v_deleted := true;
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE public.profiles p
    SET display_name = v_label,
        initials = '--',
        avatar_url = NULL,
        betting_points = 0,
        is_admin = false,
        inventory = r.inventory,
        achievements = r.achievements,
        equipped_items = r.equipped_items
    FROM jsonb_populate_record(NULL::public.profiles,
           '{"inventory": [], "achievements": [], "equipped_items": {}}'::jsonb) r
    WHERE p.id = v_uid;
  END;

  -- 4. El acceso: borrarlo, o quitarle correo y contraseña y bloquearlo
  IF v_deleted THEN
    DELETE FROM auth.users WHERE id = v_uid;
  ELSE
    DELETE FROM auth.identities WHERE user_id = v_uid;
    DELETE FROM auth.sessions WHERE user_id = v_uid;
    BEGIN
      DELETE FROM auth.refresh_tokens WHERE user_id = v_uid::text;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
    UPDATE auth.users
    SET email = 'eliminado+' || v_uid::text || '@invalid.local',
        phone = NULL,
        encrypted_password = '',
        raw_user_meta_data = '{}'::jsonb,
        banned_until = now() + interval '100 years'
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('deleted', true, 'mode', CASE WHEN v_deleted THEN 'deleted' ELSE 'anonymized' END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

COMMIT;


-- ==============================================================================
-- VERIFICACIÓN (mándame captura): debe salir delete_user_account con authenticated
-- ==============================================================================
SELECT routine_name, grantee
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'delete_user_account'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC');
