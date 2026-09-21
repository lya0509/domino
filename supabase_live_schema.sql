-- ==============================================
-- DOMINO — ACTUALIZACIÓN: DUOS + PARTIDAS EN VIVO
-- Ejecuta TODO esto en el SQL Editor de Supabase
-- ==============================================

-- 1. Agregar columna de status a matches (para partidas activas/completadas)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';

-- 2. Agregar columna para guardar jugadores completos (para partidas en vivo)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS players_json JSONB;

-- 3. Agregar columna de modo de juego
ALTER TABLE matches ADD COLUMN IF NOT EXISTS game_mode TEXT DEFAULT 'teams';

-- 4. Hacer winner_team nullable (las partidas activas no tienen ganador aún)
ALTER TABLE matches ALTER COLUMN winner_team DROP NOT NULL;
ALTER TABLE matches ALTER COLUMN winner_team SET DEFAULT NULL;

-- 5. Permitir actualizaciones en matches (necesario para sincronización en vivo)
DROP POLICY IF EXISTS "Authenticated update matches" ON matches;
CREATE POLICY "Authenticated update matches" ON matches
  FOR UPDATE USING (auth.role() = 'authenticated');

-- 6. Crear tabla de DUOS
CREATE TABLE IF NOT EXISTS duos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player1_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  player2_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(player1_id, player2_id)
);

-- Si ya creaste la tabla antes, agrega la columna con esto:
ALTER TABLE duos ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE duos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public duos viewable" ON duos;
CREATE POLICY "Public duos viewable" ON duos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated insert duos" ON duos;
CREATE POLICY "Authenticated insert duos" ON duos
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ==============================================
-- IMPORTANTE: Después de ejecutar esto, ve a
-- Supabase Dashboard → Database → Replication
-- y activa Realtime para la tabla "matches"
-- ==============================================
