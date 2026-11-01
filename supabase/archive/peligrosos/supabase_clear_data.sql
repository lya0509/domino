-- ============================================
-- LIMPIAR TODOS LOS DATOS — Domino Score Tracker
-- Ejecuta esto en el SQL Editor de Supabase
-- ============================================

-- 1. Eliminar TODAS las partidas (Scores, Rankings, etc.)
TRUNCATE TABLE matches CASCADE;

-- 2. Eliminar TODOS los usuarios y perfiles
-- Al eliminar de auth.users, se eliminan automáticamente los perfiles 
-- correspondientes en la tabla "profiles" gracias al "ON DELETE CASCADE".
DELETE FROM auth.users;

-- ¡Listo! La base de datos está completamente en blanco.
