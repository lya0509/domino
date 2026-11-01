-- Solo lectura: lista columnas, disparadores y tareas programadas de producción para
-- compararlas con supabase/migrations/20261001_00_esquema_base.sql. No cambia nada.
SELECT jsonb_build_object(
  'columnas', (SELECT jsonb_object_agg(table_name, cols) FROM (
    SELECT table_name, jsonb_agg(column_name || ' ' || data_type || COALESCE(' = ' || column_default, '') ORDER BY ordinal_position) AS cols
    FROM information_schema.columns WHERE table_schema = 'public' GROUP BY table_name) t),
  'disparadores', (SELECT jsonb_agg(c.relname || ': ' || g.tgname ORDER BY c.relname, g.tgname)
    FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT g.tgisinternal),
  'restricciones', (SELECT jsonb_agg(conrelid::regclass::text || ': ' || pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'c')
) AS foto_columnas;
