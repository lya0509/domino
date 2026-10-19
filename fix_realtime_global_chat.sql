-- ============================================
-- ACTIVAR TIEMPO REAL PARA EL CHAT GLOBAL (notificaciones de mensajes nuevos)
-- Ejecuta esto en el SQL Editor de Supabase. Es seguro repetirlo.
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'global_chat'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.global_chat;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'waitlist'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist;
  END IF;
END $$;

-- Verificación: deben aparecer global_chat y waitlist
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY tablename;
