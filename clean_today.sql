-- ============================================
-- LIMPIAR TODOS LOS DATOS CREADOS HOY
-- Ejecuta esto en el SQL Editor de Supabase
-- ============================================

-- Borrar llaves de torneos de hoy (tienen referencia a matches)
DELETE FROM tournament_brackets 
WHERE DATE(created_at) = CURRENT_DATE;

-- Borrar matches de hoy (incluye live_chat y rounds por cascada, si están configurados)
DELETE FROM matches 
WHERE DATE(created_at) = CURRENT_DATE;

-- Borrar participantes de torneos inscritos hoy
DELETE FROM tournament_participants 
WHERE DATE(created_at) = CURRENT_DATE;

-- Borrar torneos creados hoy
DELETE FROM tournaments 
WHERE DATE(created_at) = CURRENT_DATE;

-- Borrar lista de espera de hoy
DELETE FROM waitlist 
WHERE DATE(created_at) = CURRENT_DATE;

-- ¡Listo! Los datos de hoy han sido eliminados.
