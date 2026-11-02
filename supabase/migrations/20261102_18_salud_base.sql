-- ==============================================================================
-- SALUD DE LA BASE (revisión del 2026-11-02)
-- - Historial de puntos: el reinicio del club vació points_ledger. Cada cuenta sin
--   movimientos recibe uno, "Reinicio del club", con su saldo actual, para que el
--   historial del perfil arranque cuadrado.
-- - Tres funciones de disparador se podían llamar desde la API sin sesión. Solo
--   deben correr como disparador.
-- - Ocho funciones sin search_path fijo: se fija en public, como las demás.
--
-- No cambia reglas ni datos de juego. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

INSERT INTO public.points_ledger(user_id, delta, balance, reason)
SELECT p.id, COALESCE(p.betting_points, 0), COALESCE(p.betting_points, 0), 'Reinicio del club'
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.points_ledger l WHERE l.user_id = p.id);

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('handle_new_user', 'protect_profile_sensitive_fields', 'trg_fn_settle_match_on_complete')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;

  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('_team_names', 'delete_match_on_bracket_delete', 'check_global_chat_spam', '_is_app_request',
                        'store_catalog', '_club_day', '_streak_continues', '_match_not_started')
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', f.sig);
  END LOOP;
END $$;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las tres columnas deben salir en true
-- ==============================================================================
SELECT
  NOT EXISTS (SELECT 1 FROM public.profiles p
              WHERE NOT EXISTS (SELECT 1 FROM public.points_ledger l WHERE l.user_id = p.id)) AS historial_completo,
  NOT has_function_privilege('anon', 'public.protect_profile_sensitive_fields()', 'EXECUTE') AS disparadores_cerrados,
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('_club_day', 'store_catalog', '_is_app_request')
                AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')) AS rutas_fijas;
