-- ==============================================================================
-- PAREJAS DE TORNEO
-- Invitar / aceptar / rechazar compañero cambia DOS inscripciones (la tuya y la
-- del otro). Desde la app solo puedes editar la tuya, así que la del compañero
-- nunca se actualizaba y la invitación no le llegaba.
-- Estas funciones hacen los dos cambios en el servidor, validando todo.
--
-- Ejecuta todo en el SQL Editor de Supabase. Es seguro repetirlo.
-- ==============================================================================

BEGIN;

-- Invitar a un compañero. Si esa persona ya te había invitado a ti, el dúo queda confirmado.
CREATE OR REPLACE FUNCTION public.invite_tournament_partner(
  p_tournament_id uuid,
  p_partner_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_me RECORD;
  v_other RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;
  IF p_partner_id IS NULL OR p_partner_id = v_uid THEN
    RAISE EXCEPTION 'Compañero inválido.';
  END IF;

  SELECT status INTO v_status FROM public.tournaments WHERE id = p_tournament_id;
  IF v_status IS DISTINCT FROM 'registration' THEN
    RAISE EXCEPTION 'Las inscripciones de este torneo están cerradas.';
  END IF;

  -- Bloquear las dos filas en orden fijo (evita bloqueos cruzados entre dos invitaciones)
  PERFORM 1 FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND user_id IN (v_uid, p_partner_id)
  ORDER BY user_id
  FOR UPDATE;

  SELECT * INTO v_me FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND user_id = v_uid;
  SELECT * INTO v_other FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND user_id = p_partner_id;

  IF v_me IS NULL OR v_me.payment_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Primero debes estar inscrito y aprobado en el torneo.';
  END IF;
  IF v_other IS NULL OR v_other.payment_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Ese jugador no está inscrito y aprobado en el torneo.';
  END IF;
  IF v_me.partner_status = 'confirmed' THEN
    RAISE EXCEPTION 'Ya tienes compañero.';
  END IF;

  -- Invitación cruzada: el otro ya me había invitado → confirmar
  IF v_other.partner_id = v_uid AND v_other.partner_status = 'sent' THEN
    UPDATE public.tournament_participants
    SET partner_id = CASE WHEN user_id = v_uid THEN p_partner_id ELSE v_uid END,
        partner_status = 'confirmed'
    WHERE tournament_id = p_tournament_id AND user_id IN (v_uid, p_partner_id);
    RETURN 'confirmed';
  END IF;

  IF v_other.partner_id IS NOT NULL AND COALESCE(v_other.partner_status, 'none') <> 'none' THEN
    RAISE EXCEPTION 'Ese jugador ya tiene o está esperando a otro compañero.';
  END IF;

  -- Si yo esperaba a otra persona, liberarla
  IF v_me.partner_id IS NOT NULL AND v_me.partner_id <> p_partner_id THEN
    UPDATE public.tournament_participants
    SET partner_id = NULL, partner_status = 'none'
    WHERE tournament_id = p_tournament_id AND user_id = v_me.partner_id AND partner_id = v_uid;
  END IF;

  UPDATE public.tournament_participants
  SET partner_id = p_partner_id, partner_status = 'sent'
  WHERE tournament_id = p_tournament_id AND user_id = v_uid;

  UPDATE public.tournament_participants
  SET partner_id = v_uid, partner_status = 'pending'
  WHERE tournament_id = p_tournament_id AND user_id = p_partner_id;

  RETURN 'sent';
END;
$$;

-- Aceptar o rechazar la invitación que te llegó
CREATE OR REPLACE FUNCTION public.respond_tournament_partner(
  p_tournament_id uuid,
  p_accept boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_me RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT * INTO v_me FROM public.tournament_participants
  WHERE tournament_id = p_tournament_id AND user_id = v_uid
  FOR UPDATE;

  IF v_me IS NULL OR v_me.partner_id IS NULL OR v_me.partner_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'No tienes ninguna invitación pendiente en este torneo.';
  END IF;

  IF p_accept THEN
    UPDATE public.tournament_participants
    SET partner_status = 'confirmed'
    WHERE tournament_id = p_tournament_id
      AND ((user_id = v_uid) OR (user_id = v_me.partner_id AND partner_id = v_uid));
    RETURN 'confirmed';
  END IF;

  UPDATE public.tournament_participants
  SET partner_id = NULL, partner_status = 'none'
  WHERE tournament_id = p_tournament_id
    AND ((user_id = v_uid) OR (user_id = v_me.partner_id AND partner_id = v_uid));
  RETURN 'rejected';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_tournament_partner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_tournament_partner(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_tournament_partner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_tournament_partner(uuid, boolean) TO authenticated;

COMMIT;


-- ==============================================================================
-- VERIFICACIÓN (mándame captura de las 2)
-- ==============================================================================

-- A. Las dos funciones nuevas: deben salir solo con authenticated
SELECT routine_name, grantee
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND routine_name IN ('invite_tournament_partner', 'respond_tournament_partner')
ORDER BY routine_name, grantee;

-- B. Quién puede crear llaves y arrancar/terminar torneos
--    (para saber si un usuario normal que crea un torneo puede iniciarlo)
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('tournament_brackets', 'tournaments', 'tournament_participants')
ORDER BY tablename, cmd, policyname;
