-- Ejecuta este script en el SQL Editor de Supabase para inyectar los 15 invitados

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Invitado 1', 'I1') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000001', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000002', 'Invitado 2', 'I2') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000002', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000003', 'Invitado 3', 'I3') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000003', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000004', 'Invitado 4', 'I4') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000004', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000005', 'Invitado 5', 'I5') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000005', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000006', 'Invitado 6', 'I6') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000006', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000007', 'Invitado 7', 'I7') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000007', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000008', 'Invitado 8', 'I8') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000008', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000009', 'Invitado 9', 'I9') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000009', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000010', 'Invitado 10', 'I10') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000010', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000011', 'Invitado 11', 'I11') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000011', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000012', 'Invitado 12', 'I12') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000012', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000013', 'Invitado 13', 'I13') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000013', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000014', 'Invitado 14', 'I14') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000014', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

INSERT INTO profiles (id, display_name, initials) 
VALUES ('00000000-0000-0000-0000-000000000015', 'Invitado 15', 'I15') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO tournament_participants (tournament_id, user_id, payment_status, partner_status) 
VALUES ('8c964c3e-d6b6-45c1-9559-2b0823f45195', '00000000-0000-0000-0000-000000000015', 'approved', 'none') 
ON CONFLICT (tournament_id, user_id) DO NOTHING;

