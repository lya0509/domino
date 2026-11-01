-- ============================================
-- DATOS DE PRUEBA — Domino Score Tracker
-- Ejecuta esto en el SQL Editor de Supabase
-- DESPUÉS de haber ejecutado el schema principal
-- ============================================

-- 1. Crear 4 usuarios de prueba en auth.users
--    (el trigger creará sus perfiles automáticamente)
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'a1111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'juan@test.com',
    crypt('test1234', gen_salt('bf')),
    now(),
    '{"display_name": "Juan López", "initials": "JL"}'::jsonb,
    now(), now()
  ),
  (
    'b2222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'maria@test.com',
    crypt('test1234', gen_salt('bf')),
    now(),
    '{"display_name": "María García", "initials": "MG"}'::jsonb,
    now(), now()
  ),
  (
    'c3333333-3333-3333-3333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'carlos@test.com',
    crypt('test1234', gen_salt('bf')),
    now(),
    '{"display_name": "Carlos Pérez", "initials": "CP"}'::jsonb,
    now(), now()
  ),
  (
    'd4444444-4444-4444-4444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'ana@test.com',
    crypt('test1234', gen_salt('bf')),
    now(),
    '{"display_name": "Ana Martínez", "initials": "AM"}'::jsonb,
    now(), now()
  )
ON CONFLICT (id) DO NOTHING;

-- 2. Verificar que los perfiles se crearon (el trigger debió hacerlo)
--    Si no se crearon, insertarlos manualmente:
INSERT INTO public.profiles (id, display_name, initials) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Juan López', 'JL'),
  ('b2222222-2222-2222-2222-222222222222', 'María García', 'MG'),
  ('c3333333-3333-3333-3333-333333333333', 'Carlos Pérez', 'CP'),
  ('d4444444-4444-4444-4444-444444444444', 'Ana Martínez', 'AM')
ON CONFLICT (id) DO NOTHING;

-- 3. Insertar partidas de prueba
--    Equipo 1: Juan (JL) & María (MG)
--    Equipo 2: Carlos (CP) & Ana (AM)

-- Partida 1: JL & MG ganan 100-65 (HOY)
INSERT INTO matches (team1_player1, team1_player2, team2_player1, team2_player2, limit_score, rounds, team1_total, team2_total, winner_team, is_zapato, created_at)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'c3333333-3333-3333-3333-333333333333',
  'd4444444-4444-4444-4444-444444444444',
  100,
  '[{"id":"r1","roundNumber":1,"scorerId":"team1","points":35,"endingType":"normal"},{"id":"r2","roundNumber":2,"scorerId":"team2","points":40,"endingType":"normal"},{"id":"r3","roundNumber":3,"scorerId":"team1","points":25,"endingType":"normal"},{"id":"r4","roundNumber":4,"scorerId":"team2","points":25,"endingType":"trancado"},{"id":"r5","roundNumber":5,"scorerId":"team1","points":40,"endingType":"normal"}]',
  100, 65, 1, false,
  now() - interval '2 hours'
);

-- Partida 2: CP & AM ganan ZAPATO 100-0 (HOY)
INSERT INTO matches (team1_player1, team1_player2, team2_player1, team2_player2, limit_score, rounds, team1_total, team2_total, winner_team, is_zapato, created_at)
VALUES (
  'c3333333-3333-3333-3333-333333333333',
  'd4444444-4444-4444-4444-444444444444',
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  100,
  '[{"id":"r6","roundNumber":1,"scorerId":"team1","points":45,"endingType":"normal"},{"id":"r7","roundNumber":2,"scorerId":"team1","points":30,"endingType":"normal"},{"id":"r8","roundNumber":3,"scorerId":"team1","points":25,"endingType":"trancado"}]',
  100, 0, 1, true,
  now() - interval '1 hour'
);

-- Partida 3: Equipos mezclados — JL & CP vs MG & AM, ganan JL & CP (AYER)
INSERT INTO matches (team1_player1, team1_player2, team2_player1, team2_player2, limit_score, rounds, team1_total, team2_total, winner_team, is_zapato, created_at)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'c3333333-3333-3333-3333-333333333333',
  'b2222222-2222-2222-2222-222222222222',
  'd4444444-4444-4444-4444-444444444444',
  150,
  '[{"id":"r9","roundNumber":1,"scorerId":"team1","points":50,"endingType":"normal"},{"id":"r10","roundNumber":2,"scorerId":"team2","points":35,"endingType":"normal"},{"id":"r11","roundNumber":3,"scorerId":"team1","points":60,"endingType":"normal"},{"id":"r12","roundNumber":4,"scorerId":"team2","points":45,"endingType":"trancado"},{"id":"r13","roundNumber":5,"scorerId":"team1","points":40,"endingType":"normal"}]',
  150, 80, 1, false,
  now() - interval '1 day'
);

-- Partida 4: MG & AM ganan a JL & CP (AYER)
INSERT INTO matches (team1_player1, team1_player2, team2_player1, team2_player2, limit_score, rounds, team1_total, team2_total, winner_team, is_zapato, created_at)
VALUES (
  'b2222222-2222-2222-2222-222222222222',
  'd4444444-4444-4444-4444-444444444444',
  'a1111111-1111-1111-1111-111111111111',
  'c3333333-3333-3333-3333-333333333333',
  100,
  '[{"id":"r14","roundNumber":1,"scorerId":"team1","points":55,"endingType":"normal"},{"id":"r15","roundNumber":2,"scorerId":"team2","points":30,"endingType":"normal"},{"id":"r16","roundNumber":3,"scorerId":"team1","points":50,"endingType":"normal"}]',
  105, 30, 1, false,
  now() - interval '20 hours'
);

-- Partida 5: ZAPATO de JL & MG contra CP & AM (HACE 3 DÍAS)
INSERT INTO matches (team1_player1, team1_player2, team2_player1, team2_player2, limit_score, rounds, team1_total, team2_total, winner_team, is_zapato, created_at)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'c3333333-3333-3333-3333-333333333333',
  'd4444444-4444-4444-4444-444444444444',
  100,
  '[{"id":"r17","roundNumber":1,"scorerId":"team1","points":40,"endingType":"normal"},{"id":"r18","roundNumber":2,"scorerId":"team1","points":35,"endingType":"normal"},{"id":"r19","roundNumber":3,"scorerId":"team1","points":25,"endingType":"normal"}]',
  100, 0, 1, true,
  now() - interval '3 days'
);

-- ============================================
-- RESUMEN DE DATOS DE PRUEBA:
-- ============================================
-- 5 partidas totales
-- 4 jugadores: Juan(JL), María(MG), Carlos(CP), Ana(AM)
--
-- RANKINGS ESPERADOS (Historial completo):
--   🥇 Juan (JL):    3 wins, 2 losses, 1 zapato dado, 1 recibido
--   🥇 Carlos (CP):  3 wins, 2 losses, 1 zapato dado, 1 recibido  
--   🥉 María (MG):   3 wins, 2 losses, 1 zapato dado, 1 recibido
--   🥉 Ana (AM):     3 wins, 2 losses, 1 zapato dado, 1 recibido
--
-- DUOS:
--   JL & MG: 2 wins (+ 1 zapato dado)
--   CP & AM: 1 win  (+ 1 zapato dado)
--   JL & CP: 1 win
--   MG & AM: 1 win
--
-- Para login de prueba usa:  
--   juan@test.com / test1234
--   maria@test.com / test1234
-- ============================================

-- Verificar que todo se insertó:
SELECT '--- PERFILES ---' as info;
SELECT id, display_name, initials FROM profiles;

SELECT '--- PARTIDAS ---' as info;
SELECT id, winner_team, is_zapato, team1_total, team2_total, created_at FROM matches ORDER BY created_at DESC;
