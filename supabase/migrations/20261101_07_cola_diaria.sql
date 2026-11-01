-- ==============================================================================
-- COLA DIARIA
-- La cola se vacía cada día a las 7 AM hora de Venezuela, cuando cambia el día del
-- club. Así una entrada olvidada no sigue llamándose días después.
--
-- Orden: ejecutar después de 20261101_06_partidas_abandonadas.sql.
-- Compatibilidad: no afecta a ninguna versión publicada. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.expire_old_waitlist()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.waitlist
  SET status = 'cancelled'
  WHERE status = 'waiting'
    AND public._club_day(created_at) < public._club_day(now());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_old_waitlist() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('vaciar-cola-diaria', '10 11 * * *', 'SELECT public.expire_old_waitlist()');
  END IF;
END $$;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: debe salir true
-- ==============================================================================
SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vaciar-cola-diaria') AS cola_diaria;
