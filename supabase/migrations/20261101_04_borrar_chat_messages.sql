-- ==============================================================================
-- BORRAR chat_messages
-- La app no usa esta tabla: el chat real está en global_chat y live_chat.
--
-- Orden: ejecutar al final, después de 20261101_03_rachas.sql.
-- Compatibilidad: no afecta a ninguna versión publicada.
-- El borrado no se puede deshacer, así que se detiene si la tabla tiene filas:
-- en ese caso, revísalas antes de seguir.
-- ==============================================================================
DO $$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.chat_messages') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.chat_messages' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'chat_messages tiene % filas: no se borró', v_rows;
  END IF;
  DROP TABLE public.chat_messages;
END $$;

-- VERIFICACIÓN: debe salir true
SELECT to_regclass('public.chat_messages') IS NULL AS tabla_borrada;
