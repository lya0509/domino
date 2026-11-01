-- ==============================================================================
-- FASE 0, PARTE 2: lo que no cupo en la primera foto (solo lectura)
-- No cambia nada. Devuelve una sola fila con un JSON corto.
-- Pega todo en el SQL Editor de Supabase, ejecútalo y copia el resultado completo.
-- ==============================================================================
SELECT jsonb_build_object(
  'politicas', (
    SELECT jsonb_agg(jsonb_build_object('t', tablename, 'n', policyname, 'c', cmd, 'r', roles, 'u', qual, 'k', with_check) ORDER BY tablename, cmd, policyname)
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
  ),
  'fks', (
    SELECT jsonb_agg(conrelid::regclass::text || ': ' || conname || ' ' || pg_get_constraintdef(oid) ORDER BY conrelid::regclass::text, conname)
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  ),
  'funciones_resto', (
    SELECT jsonb_agg(jsonb_build_object(
      'n', p.proname,
      'a', pg_get_function_identity_arguments(p.oid),
      'd', p.prosecdef,
      'p', p.proacl::text,
      -- El código solo de las que no están en el repo; verify_admin_pin nunca
      'c', CASE WHEN p.proname IN (
             'verify_admin_pin', 'propose_wager', 'protect_profile_sensitive_fields', 'resolve_match_bets',
             'resolve_match_wagers', 'respond_tournament_partner', 'respond_wager', 'settle_completed_match',
             'settle_my_pending_bets', 'start_tournament', 'store_catalog', 'trg_fn_advance_tournament',
             'trg_fn_protect_match_fields', 'trg_fn_protect_participant_payment', 'trg_fn_protect_profile_insert',
             'trg_fn_refund_bets_on_match_delete', 'trg_fn_settle_match_on_complete', 'trg_fn_validate_bet',
             'trg_fn_wager_consent_team'
           ) THEN NULL ELSE p.prosrc END
    ) ORDER BY p.proname)
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.proname >= 'propose_wager'
  ),
  'chat_messages_filas', (SELECT count(*) FROM public.chat_messages),
  'pg_cron', to_regclass('cron.job') IS NOT NULL
) AS foto_parte2;
