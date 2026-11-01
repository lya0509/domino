-- ==============================================================================
-- FASE 0: FOTO DE PRODUCCIÓN (solo lectura)
-- No cambia nada. Devuelve una sola fila con un JSON.
-- Pega todo en el SQL Editor de Supabase, ejecútalo y copia el resultado completo.
-- El código de verify_admin_pin se omite a propósito.
-- ==============================================================================
SELECT jsonb_pretty(jsonb_build_object(
  'columnas', (
    SELECT jsonb_object_agg(table_name, cols) FROM (
      SELECT table_name, jsonb_agg(column_name || ' ' || data_type || CASE WHEN is_nullable = 'NO' THEN ' not null' ELSE '' END ORDER BY ordinal_position) AS cols
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_name
    ) c
  ),
  'rls', (
    SELECT jsonb_object_agg(relname, relrowsecurity)
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  ),
  'politicas', (
    SELECT jsonb_agg(jsonb_build_object('tabla', tablename, 'nombre', policyname, 'cmd', cmd, 'roles', roles, 'usando', qual, 'check', with_check) ORDER BY tablename, cmd, policyname)
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
  ),
  'funciones', (
    SELECT jsonb_agg(jsonb_build_object(
      'nombre', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'definer', p.prosecdef,
      'permisos', p.proacl::text,
      'codigo', CASE WHEN p.proname = 'verify_admin_pin' THEN '(omitido)' ELSE p.prosrc END
    ) ORDER BY p.proname)
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  ),
  'triggers', (
    SELECT jsonb_agg(jsonb_build_object('tabla', c.relname, 'nombre', t.tgname, 'def', pg_get_triggerdef(t.oid)) ORDER BY c.relname, t.tgname)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
  ),
  'llaves_foraneas', (
    SELECT jsonb_agg(jsonb_build_object('tabla', conrelid::regclass::text, 'nombre', conname, 'def', pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text, conname)
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  ),
  'realtime', (
    SELECT jsonb_agg(tablename ORDER BY tablename)
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
  ),
  'buckets', (
    SELECT jsonb_agg(jsonb_build_object('id', id, 'publico', public, 'limite_bytes', file_size_limit, 'tipos', allowed_mime_types))
    FROM storage.buckets
  ),
  'tareas_programadas', (
    SELECT CASE WHEN to_regclass('cron.job') IS NULL THEN '"pg_cron no instalado"'::jsonb ELSE '"pg_cron instalado"'::jsonb END
  )
)) AS foto_produccion;
