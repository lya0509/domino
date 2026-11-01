-- ==============================================================================
-- DIRECCIÓN DE LA FUNCIÓN DE ENVÍO
-- Supabase publicó la función send-push con la dirección interna swift-endpoint.
--
-- Orden: ejecutar después de 20261101_10_notificaciones_push.sql.
-- Compatibilidad: no afecta a la app. Se puede repetir sin daño.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public._wake_send_push()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://jnejvuprgreghfucnswv.supabase.co/functions/v1/swift-endpoint',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._wake_send_push() FROM PUBLIC, anon, authenticated;

-- Los avisos de antes de este arreglo ya no sirven: no deben llegar todos de golpe
DELETE FROM public.notification_queue WHERE sent_at IS NULL;

-- VERIFICACIÓN: debe salir true
SELECT pg_get_functiondef('public._wake_send_push()'::regprocedure) LIKE '%swift-endpoint%' AS direccion_correcta;
