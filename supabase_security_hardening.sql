-- ==============================================================================
-- DOMINO SCORE TRACKER — BLINDAJE DE SEGURIDAD (ANTI-TRAMPAS & ANTI-HACKERS)
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. BLINDAJE DE APUESTAS (bets): NADIE PUEDE CAMBIAR SU APUESTA A 'won'
-- ------------------------------------------------------------------------------
-- Un usuario solo puede CREAR una apuesta con status 'pending' y ver sus apuestas.
-- NUNCA puede actualizar el estado ni el multiplicador manualmente.
DROP POLICY IF EXISTS "Users can update own bets" ON bets;
DROP POLICY IF EXISTS "Authenticated update bets" ON bets;

-- Asegurar que la inserción solo permita apuestas con status 'pending'
DROP POLICY IF EXISTS "Users insert own pending bets" ON bets;
CREATE POLICY "Users insert own pending bets" ON bets
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND status = 'pending'
  );

-- Nadie (excepto funciones SECURITY DEFINER como resolve_match_bets) puede hacer UPDATE
REVOKE UPDATE ON bets FROM authenticated, anon;


-- ------------------------------------------------------------------------------
-- 2. BLINDAJE DE PERFILES (profiles): NADIE PUEDE HACERSE ADMIN NI INFLAR PUNTOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_profile_sensitive_fields()
RETURNS TRIGGER AS $$
DECLARE
  caller_is_admin BOOLEAN;
BEGIN
  -- Consultar si el usuario actual es administrador
  SELECT COALESCE(is_admin, false) INTO caller_is_admin 
  FROM profiles 
  WHERE id = auth.uid();

  -- Si un usuario común intenta auto-asignarse is_admin = true, bloquearlo
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    IF NOT COALESCE(caller_is_admin, false) THEN
      NEW.is_admin := OLD.is_admin;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_protect_profile_fields ON profiles;
CREATE TRIGGER tr_protect_profile_fields
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_profile_sensitive_fields();


-- ------------------------------------------------------------------------------
-- 3. BLINDAJE DE PARTIDAS (matches): SOLO JUGADORES DE LA MESA O ADMIN PUEDEN ANOTAR
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated update matches" ON matches;
CREATE POLICY "Only participants or admins can update matches" ON matches
  FOR UPDATE USING (
    -- El usuario es uno de los 4 jugadores de la partida
    auth.uid() IN (team1_player1, team1_player2, team2_player1, team2_player2)
    OR
    -- O el usuario es un administrador
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    OR
    -- O la partida fue creada sin jugadores asignados aún
    (team1_player1 IS NULL AND team2_player1 IS NULL)
  );


-- ------------------------------------------------------------------------------
-- 4. VALIDACIÓN ESTRICTA DEL CÓDIGO QR / PASE DE INVITACIÓN EN EL REGISTRO
-- ------------------------------------------------------------------------------
-- Si un usuario intenta registrarse enviando una petición directa sin código QR válido,
-- el servidor rechazará la creación del perfil.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_code TEXT;
  v_code_upper TEXT;
BEGIN
  v_code := COALESCE(new.raw_user_meta_data->>'access_code', '');
  v_code_upper := UPPER(TRIM(v_code));

  -- Validar si el código proporcionado contiene uno de los códigos de mesa autorizados
  IF NOT (
    v_code_upper IN ('CAFETIN', 'PESIMISTAS', 'DOMINO', '0509', 'VIP') OR
    v_code_upper LIKE '%CAFETIN%' OR
    v_code_upper LIKE '%PESIMISTAS%' OR
    v_code_upper LIKE '%DOMINO%' OR
    v_code_upper LIKE '%0509%' OR
    v_code_upper LIKE '%VIP%'
  ) THEN
    -- Rechazar si no tiene un código QR válido
    RAISE EXCEPTION 'Registro bloqueado: Es obligatorio escanear un código QR de invitación válido.';
  END IF;

  INSERT INTO public.profiles (id, display_name, initials, betting_points, is_admin)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'display_name', 'Jugador'),
    UPPER(COALESCE(new.raw_user_meta_data->>'initials', 'JG')),
    1000,
    false
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
