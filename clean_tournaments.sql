-- Función para limpiar torneos que tienen más de 15 días de antigüedad
CREATE OR REPLACE FUNCTION clean_old_tournaments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Se ejecuta con permisos de administrador para poder borrar
AS $$
BEGIN
  -- Borramos los torneos cuya fecha de creación sea menor a hace 15 días
  -- Al borrar el torneo, el "ON DELETE CASCADE" eliminará automáticamente
  -- todas las llaves, partidas y participantes asociados a él.
  DELETE FROM tournaments
  WHERE created_at < NOW() - INTERVAL '15 days';
END;
$$;
