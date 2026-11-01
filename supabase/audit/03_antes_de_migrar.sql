-- Solo lectura: revisa que producción tenga lo que esperan las migraciones 20261101.
-- No cambia nada. El resultado se puede pegar en el chat para revisarlo.
SELECT jsonb_build_object(
  'partidas_activas_recientes', (SELECT count(*) FROM public.matches WHERE status = 'active' AND created_at > now() - interval '3 hours'),
  'estados_de_partida', (SELECT jsonb_object_agg(s, c) FROM (SELECT status s, count(*) c FROM public.matches GROUP BY status) t),
  'chat_messages_filas', (SELECT count(*) FROM public.chat_messages),
  'apuestas_pendientes', (SELECT count(*) FROM public.bets WHERE status = 'pending'),
  'duelos_vivos', (SELECT count(*) FROM public.matches WHERE is_wager_match AND NOT COALESCE(wager_settled, false) AND status = 'active'),
  'funciones_que_faltan', (
    SELECT COALESCE(jsonb_agg(f), '[]'::jsonb)
    FROM unnest(ARRAY['_is_app_request', '_match_not_started', 'settle_completed_match', 'award_zapatero_maestro',
                      'resolve_match_bets', 'resolve_match_wagers', 'trg_fn_refund_bets_on_match_delete', 'place_bet']) f
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = f)
  ),
  'columnas', (
    SELECT jsonb_object_agg(table_name || '.' || column_name, data_type)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (
      (table_name = 'matches' AND column_name IN ('status', 'rounds', 'winner_team', 'created_by', 'wager_amount', 'is_zapato'))
      OR (table_name = 'profiles' AND column_name IN ('betting_points', 'streak_count', 'last_streak_update_at', 'inventory', 'achievements'))
      OR (table_name = 'wager_consents' AND column_name IN ('amount', 'team', 'status'))
      OR (table_name = 'live_chat' AND column_name = 'user_id')
      OR table_name IN ('system_config', 'waitlist')
    )
  ),
  'restricciones_de_partidas', (SELECT jsonb_agg(conname || ': ' || pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid = 'public.matches'::regclass AND contype = 'c'),
  'disparadores_de_partidas', (SELECT jsonb_agg(tgname ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.matches'::regclass AND NOT tgisinternal),
  'pg_cron', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
) AS revision_previa;
