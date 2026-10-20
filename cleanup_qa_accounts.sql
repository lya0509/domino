-- ==============================================================================
-- LIMPIEZA DE LAS CUENTAS DE PRUEBA (QA Prueba 1–4)
-- Borra las 4 cuentas y TODO lo que generaron: partidas, apuestas, chats,
-- fila de espera, dúos, torneos de prueba e inscripciones.
-- No toca a ningún usuario real (ningún usuario real jugó ni apostó con ellas).
--
-- Ejecútalo SOLO cuando terminemos las pruebas. Al final muestra un conteo.
-- ==============================================================================

DO $$
DECLARE
  v_ids uuid[];
  v_matches uuid[];
  v_tournaments uuid[];
  v_sql text;
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM auth.users
  WHERE email IN ('juanluislaya+qa1@gmail.com', 'juanluislaya+qa2@gmail.com',
                  'juanluislaya+qa3@gmail.com', 'juanluislaya+qa4@gmail.com');

  IF v_ids IS NULL THEN
    RAISE NOTICE 'No hay cuentas QA: nada que borrar.';
    RETURN;
  END IF;

  SELECT array_agg(id) INTO v_matches FROM public.matches
  WHERE team1_player1 = ANY(v_ids) OR team1_player2 = ANY(v_ids)
     OR team2_player1 = ANY(v_ids) OR team2_player2 = ANY(v_ids)
     OR created_by = ANY(v_ids);

  SELECT array_agg(id) INTO v_tournaments FROM public.tournaments
  WHERE created_by = ANY(v_ids);

  -- Cada paso por separado: si una tabla o columna no existe, se salta y sigue
  FOREACH v_sql IN ARRAY ARRAY[
    'DELETE FROM public.bets WHERE user_id = ANY($1) OR match_id = ANY($2)',
    'DELETE FROM public.live_chat WHERE user_id = ANY($1) OR match_id = ANY($2)',
    'DELETE FROM public.global_chat WHERE user_id = ANY($1)',
    'DELETE FROM public.waitlist WHERE player1_id = ANY($1) OR player2_id = ANY($1)',
    'DELETE FROM public.duos WHERE player1_id = ANY($1) OR player2_id = ANY($1)',
    'DELETE FROM public.tournament_brackets WHERE tournament_id = ANY($3) OR team1_player1 = ANY($1) OR team1_player2 = ANY($1) OR team2_player1 = ANY($1) OR team2_player2 = ANY($1)',
    'DELETE FROM public.tournament_participants WHERE tournament_id = ANY($3) OR user_id = ANY($1)',
    'DELETE FROM public.tournaments WHERE id = ANY($3)',
    'DELETE FROM public.matches WHERE id = ANY($2)',
    'DELETE FROM public.profiles WHERE id = ANY($1)',
    'DELETE FROM auth.users WHERE id = ANY($1)'
  ] LOOP
    BEGIN
      EXECUTE v_sql USING v_ids, COALESCE(v_matches, '{}'), COALESCE(v_tournaments, '{}');
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      RAISE NOTICE 'Saltado (no existe): %', v_sql;
    END;
  END LOOP;

  RAISE NOTICE 'Borradas % cuentas, % partidas y % torneos de prueba.',
    array_length(v_ids, 1), COALESCE(array_length(v_matches, 1), 0), COALESCE(array_length(v_tournaments, 1), 0);
END $$;

-- Verificación: debe salir 0
SELECT COUNT(*) AS cuentas_qa_restantes
FROM auth.users
WHERE email LIKE 'juanluislaya+qa_@gmail.com';
