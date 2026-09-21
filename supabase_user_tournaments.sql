-- 1. Actualizar RLS en tournaments para permitir a usuarios crear torneos (pero NO vip_cash)
DROP POLICY IF EXISTS "Admins pueden insertar torneos" ON tournaments;

CREATE POLICY "Usuarios pueden insertar torneos no VIP" ON tournaments FOR INSERT WITH CHECK (
  (tournament_type != 'vip_cash') 
  OR 
  (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND is_admin = true))
);

-- 2. Función RPC para cancelar torneo y hacer reembolsos seguros
CREATE OR REPLACE FUNCTION cancel_tournament_and_refund(t_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_points NUMERIC;
  p_record RECORD;
BEGIN
  -- Verificar que el torneo exista y esté en registration
  SELECT status, entry_points INTO v_status, v_points 
  FROM tournaments WHERE id = t_id FOR UPDATE;

  IF v_status != 'registration' THEN
    RETURN; -- No se puede cancelar si ya empezó o terminó
  END IF;

  -- Cambiar estado a cancelado
  UPDATE tournaments SET status = 'cancelled' WHERE id = t_id;

  -- Si tenía costo en puntos, hacer el reembolso
  IF v_points > 0 THEN
    FOR p_record IN SELECT user_id FROM tournament_participants WHERE tournament_id = t_id LOOP
      UPDATE profiles 
      SET betting_points = betting_points + v_points 
      WHERE id = p_record.user_id;
    END LOOP;
  END IF;

  -- Borrar los participantes para limpiar? No, mejor dejarlos pero cambiar su payment_status o dejarlo así.
  -- Para mantener el historial, lo dejamos con status='cancelled' en la tabla tournaments.
END;
$$;
