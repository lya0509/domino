-- ==============================================================================
-- CIERRE URGENTE DE PERMISOS
-- Compatible con la versión de la app que está publicada hoy.
-- Requiere fix_points_security.sql. Es seguro repetirlo.
-- Tiene dos bloques BEGIN..COMMIT: si el segundo falla, el primero ya quedó aplicado.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Bloque 1: tablas y funciones
-- ------------------------------------------------------------------------------
BEGIN;

-- Partidas: crear requiere sesión; anotar, ser parte de la partida.
-- WITH CHECK (true) deja que un sustituto entre aunque quien anota salga de la mesa.
DROP POLICY IF EXISTS "Matches insert" ON public.matches;
DROP POLICY IF EXISTS "Matches update" ON public.matches;
DROP POLICY IF EXISTS "Authenticated users can update matches" ON public.matches;
DROP POLICY IF EXISTS "Only participants or admins can update matches" ON public.matches;
DROP POLICY IF EXISTS "Usuarios con sesion crean partidas" ON public.matches;
DROP POLICY IF EXISTS "Participantes actualizan partidas" ON public.matches;

CREATE POLICY "Usuarios con sesion crean partidas" ON public.matches
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Participantes actualizan partidas" ON public.matches
  FOR UPDATE TO authenticated
  USING (
    auth.uid() IN (team1_player1, team1_player2, team2_player1, team2_player2)
    OR created_by = auth.uid()
    OR COALESCE(substitutions, '[]'::jsonb)
         @> jsonb_build_array(jsonb_build_object('originalProfileId', auth.uid()::text))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (true);

-- Dúos: solo sus dos miembros
DROP POLICY IF EXISTS "Duos insert" ON public.duos;
DROP POLICY IF EXISTS "Duos update" ON public.duos;
DROP POLICY IF EXISTS "Miembros crean su duo" ON public.duos;
CREATE POLICY "Miembros crean su duo" ON public.duos
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (player1_id, player2_id));

-- Tabla vieja que la app no usa
DROP POLICY IF EXISTS "Anyone can insert emojis." ON public.chat_messages;

-- Torneos: crear requiere sesión; creador, estado y pozo los pone el servidor
DROP POLICY IF EXISTS "Usuarios pueden insertar torneos no VIP" ON public.tournaments;
CREATE POLICY "Usuarios pueden insertar torneos no VIP" ON public.tournaments
  FOR INSERT TO authenticated
  WITH CHECK (
    tournament_type <> 'vip_cash'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE OR REPLACE FUNCTION public.trg_fn_protect_tournament_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_app_request() THEN
    RETURN NEW;
  END IF;
  NEW.created_by := auth.uid();
  NEW.status := 'registration';
  NEW.prize_pool := 0;
  NEW.prize_paid := false;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_fn_protect_tournament_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_protect_tournament_insert ON public.tournaments;
CREATE TRIGGER tr_protect_tournament_insert
  BEFORE INSERT ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_protect_tournament_insert();

-- Inscripciones: nadie aprueba su pago ni mueve su inscripción a otro torneo
CREATE OR REPLACE FUNCTION public.trg_fn_protect_participant_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_app_request() THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    NEW.payment_status := OLD.payment_status;
    NEW.tournament_id := OLD.tournament_id;
    NEW.user_id := OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_fn_protect_participant_payment() FROM PUBLIC, anon, authenticated;

-- Limpieza: borrar un torneo arrastraba sus llaves y sus partidas jugadas.
-- Ahora solo se limpian cancelados viejos y sin partidas.
CREATE OR REPLACE FUNCTION public.clean_old_tournaments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.tournaments t
  WHERE t.status = 'cancelled'
    AND t.created_at < now() - interval '15 days'
    AND NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.tournament_id = t.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clean_old_tournaments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clean_old_tournaments() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_player_streaks_for_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_player_streaks_for_match(uuid) TO authenticated;

COMMIT;

-- ------------------------------------------------------------------------------
-- Bloque 2: archivos
-- ------------------------------------------------------------------------------
BEGIN;

DROP POLICY IF EXISTS "Allow avatar uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow avatar updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow ad uploads" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios suben su avatar" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios cambian su avatar" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios borran su avatar" ON storage.objects;

-- Cada quien solo toca su carpeta: avatars/<su id>/...
CREATE POLICY "Usuarios suben su avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Usuarios cambian su avatar" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Usuarios borran su avatar" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Máximo 5 MB y solo imágenes
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/*']
WHERE id IN ('avatars', 'ads', 'receipts');

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las 4 columnas deben salir en 0 y "cierre_aplicado" en true
-- ==============================================================================
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matches' AND policyname IN ('Matches insert', 'Matches update')) AS matches_abiertas,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'duos' AND policyname IN ('Duos insert', 'Duos update')) AS duos_abiertas,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname IN ('Allow avatar uploads', 'Allow avatar updates', 'Allow ad uploads')) AS archivos_abiertas,
  (SELECT count(*) FROM storage.buckets WHERE file_size_limit IS NULL) AS buckets_sin_limite,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_protect_tournament_insert') AS cierre_aplicado;
