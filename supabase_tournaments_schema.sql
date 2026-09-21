-- 1. Agregar flag is_admin a la tabla profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- 2. Crear tabla de Torneos
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  entry_fee NUMERIC NOT NULL,
  prize_pool NUMERIC DEFAULT 0,
  max_participants INTEGER NOT NULL DEFAULT 16,
  status TEXT NOT NULL DEFAULT 'registration', -- 'registration', 'in_progress', 'completed'
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Habilitar RLS para tournaments
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos pueden ver torneos" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Admins pueden insertar torneos" ON tournaments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins pueden actualizar torneos" ON tournaments FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND is_admin = true)
);

-- 3. Crear tabla de Participantes del Torneo
CREATE TABLE IF NOT EXISTS tournament_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES profiles(id), -- Nullable inicialmente, se llena al armar duplas fijas
  team_name TEXT,
  payment_status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  payment_reference TEXT,
  payment_receipt_url TEXT,
  payout_details TEXT, -- Datos de pago móvil para recibir premio (del que gana)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, user_id)
);

-- Habilitar RLS para participantes
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos pueden ver participantes" ON tournament_participants FOR SELECT USING (true);
CREATE POLICY "Usuarios pueden registrarse a si mismos" ON tournament_participants FOR INSERT WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY "Usuarios pueden actualizar su propio registro" ON tournament_participants FOR UPDATE USING (
  user_id = auth.uid()
);
CREATE POLICY "Admins pueden actualizar cualquier registro" ON tournament_participants FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins pueden eliminar registros" ON tournament_participants FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND is_admin = true)
);

-- 4. Crear tabla de Brackets (Llaves Eliminatorias)
CREATE TABLE IF NOT EXISTS tournament_brackets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL, -- 1 = Octavos, 2 = Cuartos, 3 = Semifinal, 4 = Final
  match_number INTEGER NOT NULL, -- Número de partida dentro de la ronda
  team1_player1 UUID REFERENCES profiles(id),
  team1_player2 UUID REFERENCES profiles(id),
  team2_player1 UUID REFERENCES profiles(id),
  team2_player2 UUID REFERENCES profiles(id),
  winner_team INTEGER, -- 1 o 2 (Null si no ha terminado)
  next_match_id UUID REFERENCES tournament_brackets(id), -- Hacia dónde avanza el ganador
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tournament_brackets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos pueden ver llaves" ON tournament_brackets FOR SELECT USING (true);
CREATE POLICY "Admins pueden gestionar llaves" ON tournament_brackets FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND is_admin = true)
);

-- 5. Actualizar la tabla matches para Duelos VIP (Apuestas con puntos/saldo)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS wager_amount NUMERIC DEFAULT 0;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_wager_match BOOLEAN DEFAULT false;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament_id UUID REFERENCES tournaments(id);

-- 6. Crear Storage Bucket para los Captures de Pago
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas del bucket receipts
CREATE POLICY "Cualquiera puede ver captures"
ON storage.objects FOR SELECT
USING ( bucket_id = 'receipts' );

CREATE POLICY "Usuarios pueden subir captures"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'receipts' AND auth.uid() = owner );

CREATE POLICY "Usuarios pueden actualizar sus captures"
ON storage.objects FOR UPDATE
USING ( bucket_id = 'receipts' AND auth.uid() = owner );
