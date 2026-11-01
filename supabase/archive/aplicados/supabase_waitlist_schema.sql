-- 1. Añadir columna avatar_url a profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- 2. Crear tabla waitlist
CREATE TABLE IF NOT EXISTS public.waitlist (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    creator_id uuid REFERENCES public.profiles(id) NOT NULL,
    player1_id uuid REFERENCES public.profiles(id) NOT NULL,
    player2_id uuid REFERENCES public.profiles(id) NOT NULL,
    status text DEFAULT 'waiting' NOT NULL -- 'waiting', 'playing', 'cancelled'
);

-- 3. Habilitar Realtime para waitlist
ALTER PUBLICATION supabase_realtime ADD TABLE waitlist;

-- 4. Políticas de Seguridad (RLS) para waitlist
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Waitlist visible para todos" ON public.waitlist
    FOR SELECT USING (true);

CREATE POLICY "Usuarios autenticados pueden insertar en waitlist" ON public.waitlist
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuarios pueden editar su entrada en waitlist" ON public.waitlist
    FOR UPDATE USING (
        auth.uid() = creator_id OR 
        auth.uid() = player1_id OR 
        auth.uid() = player2_id
    );

-- 5. Crear el bucket de Storage para avatares
-- Nota: Si esto falla porque el bucket ya existe, puedes ignorar el error
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Políticas de Seguridad para Storage (avatars)
-- Permitir a cualquiera ver las fotos
CREATE POLICY "Avatares publicos" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');

-- Permitir a usuarios autenticados subir fotos
CREATE POLICY "Usuarios autenticados pueden subir avatares" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'avatars' AND 
        auth.role() = 'authenticated'
    );

-- Permitir a los usuarios actualizar/borrar sus propias fotos
CREATE POLICY "Usuarios pueden actualizar sus avatares" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'avatars' AND 
        auth.role() = 'authenticated'
    );
    
CREATE POLICY "Usuarios pueden borrar sus avatares" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'avatars' AND 
        auth.role() = 'authenticated'
    );
