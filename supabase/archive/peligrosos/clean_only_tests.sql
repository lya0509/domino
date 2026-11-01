-- ==============================================================================
-- LIMPIEZA QUIRÚRGICA: SOLO BORRA LOS TESTERS Y LAS 7 PARTIDAS DE PRUEBA
-- NO BORRA NINGÚN USUARIO REAL, NI PUNTOS, NI MEDALLAS, NI CONFIGURACIONES
-- ==============================================================================

-- 1. Eliminar únicamente las apuestas asociadas a los testers o partidas de prueba
DELETE FROM public.bets 
WHERE match_id IN (
  'cfbf08a3-ff64-4934-abf9-d28eb53f7cff',
  '8044f875-8c52-4b2f-baf5-7674dfe2a61d',
  '305dd184-5660-4ea4-b890-fdf658735816',
  '32460452-bc5a-4a85-9361-f45fc99ef3bd',
  '288a3e3c-f84d-42f6-a8e7-4cbe3878d9ff',
  'b3277d72-bf15-4516-8126-07eb0f7a38fa',
  'd82d34f4-1d0f-4887-b517-2f67601308d6'
);

-- 2. Eliminar chats de prueba asociados a esas 7 partidas
DELETE FROM public.live_chat 
WHERE match_id IN (
  'cfbf08a3-ff64-4934-abf9-d28eb53f7cff',
  '8044f875-8c52-4b2f-baf5-7674dfe2a61d',
  '305dd184-5660-4ea4-b890-fdf658735816',
  '32460452-bc5a-4a85-9361-f45fc99ef3bd',
  '288a3e3c-f84d-42f6-a8e7-4cbe3878d9ff',
  'b3277d72-bf15-4516-8126-07eb0f7a38fa',
  'd82d34f4-1d0f-4887-b517-2f67601308d6'
);

-- 3. Eliminar ÚNICAMENTE las 7 partidas de prueba
DELETE FROM public.matches 
WHERE id IN (
  'cfbf08a3-ff64-4934-abf9-d28eb53f7cff',
  '8044f875-8c52-4b2f-baf5-7674dfe2a61d',
  '305dd184-5660-4ea4-b890-fdf658735816',
  '32460452-bc5a-4a85-9361-f45fc99ef3bd',
  '288a3e3c-f84d-42f6-a8e7-4cbe3878d9ff',
  'b3277d72-bf15-4516-8126-07eb0f7a38fa',
  'd82d34f4-1d0f-4887-b517-2f67601308d6'
);

-- 4. Eliminar ÚNICAMENTE los 7 perfiles y cuentas de prueba que creamos
DELETE FROM auth.users 
WHERE id IN (
  SELECT id FROM public.profiles 
  WHERE display_name IN ('Hacker', 'BetHacker', 'Tester Bet', 'Tester Loss', 'Test Definer', 'Test Agent', 'Test Player')
);

DELETE FROM public.profiles 
WHERE display_name IN ('Hacker', 'BetHacker', 'Tester Bet', 'Tester Loss', 'Test Definer', 'Test Agent', 'Test Player');
