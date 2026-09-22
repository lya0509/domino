-- ==============================================================================
-- LIMPIEZA DE DATOS DE PRUEBA (PARTIDAS Y USUARIOS TESTERS / HACKERS)
-- Ejecuta este comando en el SQL Editor de tu Dashboard de Supabase.
-- ==============================================================================

-- 1. Eliminar apuestas de prueba
DELETE FROM public.bets 
WHERE DATE(created_at) = CURRENT_DATE
   OR user_id IN (
     SELECT id FROM public.profiles 
     WHERE display_name IN ('Hacker', 'BetHacker', 'Tester Bet', 'Tester Loss', 'Test Definer', 'Test Agent', 'Test Player')
   );

-- 2. Eliminar chats de prueba
DELETE FROM public.live_chat 
WHERE DATE(created_at) = CURRENT_DATE;

-- 3. Eliminar partidas de prueba
DELETE FROM public.matches 
WHERE DATE(created_at) = CURRENT_DATE;

-- 4. Eliminar llaves de torneo y listas de espera de prueba
DELETE FROM public.tournament_brackets WHERE DATE(created_at) = CURRENT_DATE;
DELETE FROM public.tournament_participants WHERE DATE(created_at) = CURRENT_DATE;
DELETE FROM public.tournaments WHERE DATE(created_at) = CURRENT_DATE;
DELETE FROM public.waitlist WHERE DATE(created_at) = CURRENT_DATE;

-- 5. Eliminar usuarios de prueba (Hacker, Tester, etc.) de auth.users y profiles
DELETE FROM auth.users 
WHERE id IN (
  SELECT id FROM public.profiles 
  WHERE display_name IN ('Hacker', 'BetHacker', 'Tester Bet', 'Tester Loss', 'Test Definer', 'Test Agent', 'Test Player')
);

DELETE FROM public.profiles 
WHERE display_name IN ('Hacker', 'BetHacker', 'Tester Bet', 'Tester Loss', 'Test Definer', 'Test Agent', 'Test Player');

-- ==============================================================================
-- ¡LISTO! La base de datos queda 100% limpia con solo los usuarios y partidas reales.
-- ==============================================================================
