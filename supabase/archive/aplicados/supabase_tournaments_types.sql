-- Agregar el tipo de torneo a la tabla tournaments
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tournament_type TEXT DEFAULT 'vip_cash'; -- 'brackets', 'vip_cash', 'leaderboard'
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS entry_points NUMERIC DEFAULT 0;

-- Asegurarnos de que status por defecto también pueda aplicar para crear las llaves
-- 'registration' -> 'brackets_generation' -> 'in_progress' -> 'completed'
