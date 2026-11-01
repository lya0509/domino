-- ============================================
-- ACTUALIZACIÓN PARA CONFIRMACIÓN DE DUOS
-- Ejecuta esto en el SQL Editor de Supabase
-- ============================================

-- Agregar la columna 'partner_status' a la tabla tournament_participants
ALTER TABLE tournament_participants ADD COLUMN IF NOT EXISTS partner_status TEXT DEFAULT 'none';
-- Los valores posibles serán: 'none', 'pending', 'confirmed'

-- Actualizar los registros existentes para que tengan estado 'confirmed' si ya tenían un partner_id
UPDATE tournament_participants SET partner_status = 'confirmed' WHERE partner_id IS NOT NULL;
