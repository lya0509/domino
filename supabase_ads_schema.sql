-- Crea la tabla de anuncios (ads)
CREATE TABLE IF NOT EXISTS ads (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    image_url TEXT NOT NULL,
    link_url TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilita la seguridad por fila (RLS)
ALTER TABLE ads ENABLE ROW LEVEL SECURITY;

-- Permite que CUALQUIER persona (anon o autenticado) pueda leer los anuncios
CREATE POLICY "Ads are viewable by everyone." 
ON ads FOR SELECT 
USING (true);

-- Crea un anuncio de prueba inicial (Por defecto inactivo)
-- Una vez que subas tu imagen al Storage, edita esta fila en Supabase poniendo tu URL real y cambiando is_active a TRUE
INSERT INTO ads (image_url, link_url, is_active)
VALUES (
    'https://tu-proyecto.supabase.co/storage/v1/object/public/ads/mi-anuncio-prueba.jpg',
    'https://www.google.com',
    false
);
