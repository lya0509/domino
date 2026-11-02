-- ==============================================================================
-- TORNEOS
-- 1. Copia exacta de tres funciones que ya están en producción pero no estaban
--    en el repositorio: invitar compañero, responder la invitación y borrar la
--    partida cuando se borra su llave. Pegarlas de nuevo no cambia nada.
-- 2. El admin decide una llave trabada: el rival nunca confirmó, la partida se
--    abandonó o no se presentó un equipo. El torneo sigue solo desde ahí.
-- 3. Aprobar o rechazar un pago en Bs lo hace el servidor de una vez: el pozo es
--    siempre entrada × aprobados. Al rechazado se le avisa y puede inscribirse
--    de nuevo con otro comprobante.
-- 4. El historial de puntos dice "Premio de torneo" y "Reembolso de torneo".
--
-- Orden: después de 20261102_20_vip_victoria.sql. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.invite_tournament_partner(p_tournament_id uuid, p_partner_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.respond_tournament_partner(p_tournament_id uuid, p_accept boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_match_on_bracket_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF OLD.live_match_id IS NOT NULL THEN
        DELETE FROM matches WHERE id = OLD.live_match_id;
    END IF;
    RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_delete_match_on_bracket_delete ON public.tournament_brackets;
CREATE TRIGGER trigger_delete_match_on_bracket_delete
  AFTER DELETE ON public.tournament_brackets
  FOR EACH ROW EXECUTE FUNCTION public.delete_match_on_bracket_delete();

-- ------------------------------------------------------------------------------
-- 2. Avanzar una llave (lo usan el trigger de partidas y el admin)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tournament_advance(p_bracket_id uuid, p_winner integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bracket RECORD;
  v_pending integer;
  v_teams uuid[][];
  v_count integer;
  i integer;
  v_match integer := 1;
BEGIN
  IF p_winner IS NULL OR p_winner NOT IN (1, 2) THEN
    RETURN;
  END IF;

  SELECT * INTO v_bracket FROM public.tournament_brackets WHERE id = p_bracket_id FOR UPDATE;
  IF NOT FOUND OR v_bracket.winner_team IS NOT NULL THEN
    RETURN; -- ya procesada
  END IF;

  UPDATE public.tournament_brackets SET winner_team = p_winner WHERE id = v_bracket.id;

  -- Bloquear el torneo: dos finales de ronda simultáneas se procesan en orden
  PERFORM 1 FROM public.tournaments WHERE id = v_bracket.tournament_id FOR UPDATE;

  SELECT COUNT(*) FILTER (WHERE winner_team IS NULL), COUNT(*)
    INTO v_pending, v_count
  FROM public.tournament_brackets
  WHERE tournament_id = v_bracket.tournament_id AND round_number = v_bracket.round_number;

  IF v_pending > 0 THEN
    RETURN; -- faltan partidas de esta ronda
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_brackets
             WHERE tournament_id = v_bracket.tournament_id
               AND round_number = v_bracket.round_number + 1) THEN
    RETURN;
  END IF;

  IF v_count = 1 THEN
    UPDATE public.tournaments SET status = 'completed' WHERE id = v_bracket.tournament_id;
    PERFORM set_config('app.points_reason', 'Premio de torneo', true);
    PERFORM public.award_tournament_prize(v_bracket.tournament_id);
    PERFORM set_config('app.points_reason', '', true);
    RETURN;
  END IF;

  v_teams := ARRAY(
    SELECT CASE WHEN winner_team = 1 THEN ARRAY[team1_player1, team1_player2]
                ELSE ARRAY[team2_player1, team2_player2] END
    FROM public.tournament_brackets
    WHERE tournament_id = v_bracket.tournament_id AND round_number = v_bracket.round_number
    ORDER BY match_number
  );

  i := 1;
  WHILE i <= array_length(v_teams, 1) LOOP
    IF i + 1 <= array_length(v_teams, 1) THEN
      PERFORM public._tournament_create_bracket(v_bracket.tournament_id, v_bracket.round_number + 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], ARRAY[v_teams[i + 1][1], v_teams[i + 1][2]]);
    ELSE
      PERFORM public._tournament_create_bracket(v_bracket.tournament_id, v_bracket.round_number + 1, v_match,
        ARRAY[v_teams[i][1], v_teams[i][2]], NULL);
    END IF;
    v_match := v_match + 1;
    i := i + 2;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_advance_tournament()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner integer;
  v_bracket_id uuid;
BEGIN
  v_winner := NEW.winner_team;
  IF v_winner IS NULL THEN
    IF COALESCE(NEW.team1_total, 0) >= COALESCE(NEW.limit_score, 100) THEN v_winner := 1;
    ELSIF COALESCE(NEW.team2_total, 0) >= COALESCE(NEW.limit_score, 100) THEN v_winner := 2;
    END IF;
  END IF;
  IF v_winner IS NULL OR v_winner NOT IN (1, 2) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_bracket_id FROM public.tournament_brackets WHERE live_match_id = NEW.id;
  IF FOUND THEN
    PERFORM public._tournament_advance(v_bracket_id, v_winner);
  END IF;
  RETURN NEW;
END;
$$;

-- El admin decide una llave sin ganador. Cierra la partida si sigue abierta
-- (paga las apuestas de esa partida) y el torneo avanza.
CREATE OR REPLACE FUNCTION public.admin_decide_tournament_match(p_bracket_id uuid, p_winner integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.tournament_brackets;
  v_m public.matches;
BEGIN
  IF v_uid IS NULL OR NOT public._is_admin(v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede decidir una llave';
  END IF;
  IF p_winner IS NULL OR p_winner NOT IN (1, 2) THEN
    RAISE EXCEPTION 'El ganador es el equipo 1 o el 2';
  END IF;

  SELECT * INTO v_b FROM public.tournament_brackets WHERE id = p_bracket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa llave no existe';
  END IF;
  IF v_b.winner_team IS NOT NULL THEN
    RAISE EXCEPTION 'Esa llave ya tiene ganador';
  END IF;
  IF v_b.team2_player1 IS NULL THEN
    RAISE EXCEPTION 'Esa llave es un pase directo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = v_b.tournament_id AND status = 'in_progress') THEN
    RAISE EXCEPTION 'Ese torneo no está en curso';
  END IF;

  IF v_b.live_match_id IS NOT NULL THEN
    SELECT * INTO v_m FROM public.matches WHERE id = v_b.live_match_id FOR UPDATE;
    IF FOUND AND v_m.status IN ('active', 'pending_confirmation') THEN
      PERFORM set_config('app.allow_match_close', 'true', true);
      UPDATE public.matches
      SET status = 'completed', winner_team = p_winner, confirmed_by = v_uid, confirmed_at = now()
      WHERE id = v_m.id;
      PERFORM public.settle_completed_match(v_m.id);
      PERFORM set_config('app.allow_match_close', 'false', true);
    END IF;
  END IF;

  -- Partida cancelada, cerrada sin ganador o inexistente: avanzar directo
  PERFORM public._tournament_advance(p_bracket_id, p_winner);

  RETURN jsonb_build_object('winner', p_winner,
    'tournament_status', (SELECT status FROM public.tournaments WHERE id = v_b.tournament_id));
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Pagos en Bs: aprobar o rechazar en el servidor
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_tournament_payment(p_participant_id uuid, p_approve boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.tournament_participants;
  v_t public.tournaments;
  v_pool numeric;
BEGIN
  IF v_uid IS NULL OR NOT public._is_admin(v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede revisar pagos';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Falta aprobar o rechazar';
  END IF;

  SELECT * INTO v_p FROM public.tournament_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa inscripción ya no existe';
  END IF;
  SELECT * INTO v_t FROM public.tournaments WHERE id = v_p.tournament_id FOR UPDATE;
  IF v_t.status IS DISTINCT FROM 'registration' THEN
    RAISE EXCEPTION 'Las inscripciones de ese torneo están cerradas';
  END IF;
  IF v_p.payment_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Ese pago ya fue revisado';
  END IF;

  IF p_approve THEN
    UPDATE public.tournament_participants SET payment_status = 'approved' WHERE id = v_p.id;
  ELSE
    -- Se borra para que pueda inscribirse de nuevo con otro comprobante
    UPDATE public.tournament_participants SET partner_id = NULL, partner_status = 'none'
    WHERE tournament_id = v_p.tournament_id AND partner_id = v_p.user_id;
    DELETE FROM public.tournament_participants WHERE id = v_p.id;
  END IF;

  IF v_t.tournament_type = 'vip_cash' THEN
    SELECT COALESCE(v_t.entry_fee, 0) * COUNT(*) INTO v_pool
    FROM public.tournament_participants
    WHERE tournament_id = v_t.id AND payment_status = 'approved';
    UPDATE public.tournaments SET prize_pool = v_pool WHERE id = v_t.id;
  END IF;

  PERFORM public._notify(ARRAY[v_p.user_id],
    CASE WHEN p_approve THEN '¡Estás dentro del torneo!' ELSE 'Pago del torneo rechazado' END,
    CASE WHEN p_approve THEN 'Aprobaron tu pago de ' || v_t.name || '. Busca tu compañero.'
         ELSE 'No se pudo confirmar tu pago de ' || v_t.name || '. Puedes inscribirte de nuevo.' END,
    'tournament-payment');

  RETURN jsonb_build_object('approved', p_approve,
    'prize_pool', (SELECT prize_pool FROM public.tournaments WHERE id = v_t.id));
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Motivos en el historial de puntos
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_tournament(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator uuid;
  v_res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;
  SELECT created_by INTO v_creator FROM public.tournaments WHERE id = p_tournament_id;
  IF v_creator IS DISTINCT FROM auth.uid()
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Solo el creador o un administrador puede iniciar este torneo.';
  END IF;
  -- Lo único que mueve puntos al arrancar es devolverle la entrada al que queda sin pareja
  PERFORM set_config('app.points_reason', 'Reembolso de torneo', true);
  v_res := public._tournament_start_internal(p_tournament_id);
  PERFORM set_config('app.points_reason', '', true);
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_tournament_registration(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t RECORD;
  v_res jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id;
  IF NOT FOUND OR v_t.status IS DISTINCT FROM 'registration' OR v_t.tournament_type = 'vip_cash' THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;
  IF now() < v_t.created_at + interval '5 minutes' THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'not_expired');
  END IF;

  PERFORM set_config('app.points_reason', 'Reembolso de torneo', true);
  v_res := public._tournament_start_internal(p_tournament_id);
  IF (v_res->>'started')::boolean THEN
    PERFORM set_config('app.points_reason', '', true);
    RETURN jsonb_build_object('action', 'started') || v_res;
  END IF;
  IF v_res->>'reason' IS DISTINCT FROM 'not_enough_players' THEN
    PERFORM set_config('app.points_reason', '', true);
    RETURN jsonb_build_object('action', 'none'); -- otro usuario ya lo arrancó o canceló
  END IF;

  -- Menos de 4 jugadores: cancelar y reembolsar
  UPDATE public.tournaments SET status = 'cancelled'
  WHERE id = p_tournament_id AND status = 'registration';
  IF FOUND AND COALESCE(v_t.entry_points, 0) > 0 THEN
    PERFORM set_config('app.allow_points_change', 'true', true);
    UPDATE public.profiles p
    SET betting_points = COALESCE(p.betting_points, 0) + v_t.entry_points
    FROM public.tournament_participants tp
    WHERE tp.tournament_id = p_tournament_id AND tp.user_id = p.id AND tp.payment_status = 'approved';
  END IF;
  PERFORM set_config('app.points_reason', '', true);
  RETURN jsonb_build_object('action', 'cancelled');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_tournament_partner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_tournament_partner(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_tournament_partner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_tournament_partner(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._tournament_advance(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_advance_tournament() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_decide_tournament_match(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_tournament_match(uuid, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.review_tournament_payment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_tournament_payment(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_tournament(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_tournament(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_tournament_registration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_tournament_registration(uuid) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las tres columnas deben salir en true
-- ==============================================================================
SELECT
  has_function_privilege('authenticated', 'public.admin_decide_tournament_match(uuid, integer)', 'EXECUTE') AS admin_decide_llaves,
  has_function_privilege('authenticated', 'public.review_tournament_payment(uuid, boolean)', 'EXECUTE') AS pagos_en_el_servidor,
  position('Premio de torneo' IN pg_get_functiondef('public._tournament_advance(uuid, integer)'::regprocedure)) > 0 AS historial_con_motivo;
