-- ==============================================================================
-- PARTIDAS ABANDONADAS
-- La limpieza nocturna de partidas con más de 6 horas abiertas ahora respeta la
-- confirmación del rival. Sustituye a la tarea limpiar_partidas_zombies.
-- - Sin nada en juego: se cierra como siempre, sin ganador.
-- - Con apuestas, Duelo VIP o torneo que llegó al límite: queda por confirmar.
-- - Con apuestas, Duelo VIP o torneo sin terminar: se cancela y se devuelve todo.
--
-- Orden: ejecutar después de 20261101_05_borrar_chat_messages.sql.
-- Compatibilidad: no afecta a ninguna versión publicada. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_abandoned_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.matches;
  v_limit integer;
  v_count integer := 0;
BEGIN
  FOR m IN
    SELECT * FROM public.matches
    WHERE status = 'active' AND created_at < now() - interval '6 hours'
    FOR UPDATE
  LOOP
    v_limit := COALESCE(m.limit_score, 100);

    IF NOT public._match_needs_confirmation(m) THEN
      UPDATE public.matches SET status = 'completed', winner_team = NULL WHERE id = m.id;
    ELSIF GREATEST(COALESCE(m.team1_total, 0), COALESCE(m.team2_total, 0)) >= v_limit
          AND COALESCE(m.team1_total, 0) <> COALESCE(m.team2_total, 0) THEN
      UPDATE public.matches
      SET status = 'pending_confirmation',
          winner_team = CASE WHEN COALESCE(m.team1_total, 0) > COALESCE(m.team2_total, 0) THEN 1 ELSE 2 END,
          closed_at = now()
      WHERE id = m.id;
    ELSE
      PERFORM public.resolve_match_bets(m.id, NULL);
      PERFORM public.resolve_match_wagers(m.id, NULL);
      UPDATE public.matches SET status = 'cancelled' WHERE id = m.id;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_abandoned_matches() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('limpiar_partidas_zombies', '0 3 * * *', 'SELECT public.cancel_abandoned_matches()');
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cancelar-partidas-abandonadas') THEN
      PERFORM cron.unschedule('cancelar-partidas-abandonadas');
    END IF;
  END IF;
END $$;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las dos columnas deben salir en true
-- ==============================================================================
SELECT
  (SELECT command LIKE '%cancel_abandoned_matches%' FROM cron.job WHERE jobname = 'limpiar_partidas_zombies') AS limpieza_nueva,
  NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cancelar-partidas-abandonadas') AS sin_tarea_repetida;
