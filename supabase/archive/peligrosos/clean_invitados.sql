-- ==========================================================
-- SCRIPT PARA ELIMINAR TODOS LOS INVITADOS Y HHKTHK
-- Ejecuta este código en el SQL Editor de tu Supabase
-- ==========================================================

-- 1. Eliminar de la tabla pública de perfiles
DELETE FROM public.profiles 
WHERE display_name ILIKE 'Invitado%' 
   OR display_name ILIKE 'hhkthk'
   OR initials ILIKE 'I%'
   OR initials = 'JUV';

-- 2. Eliminar los usuarios huérfanos de autenticación (auth.users)
DELETE FROM auth.users 
WHERE id NOT IN (SELECT id FROM public.profiles);

-- ¡Listo! Todos los Invitados 1-15 y hhkthk han sido eliminados de raíz.
