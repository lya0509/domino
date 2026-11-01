-- ==============================================================================
-- NOTIFICACIONES PUSH
-- Avisos que llegan con la app cerrada. El servidor decide a quién y deja el aviso
-- en notification_queue; la función send-push lo entrega a cada teléfono.
-- Avisos: empezó una partida, apuestas en la mesa, confirma el resultado, partida
-- reabierta, a la mesa, casi es su turno, quedaste de primero y empezó el torneo.
--
-- Orden: ejecutar después de 20261101_09_confirmacion_1_minuto.sql.
-- Compatibilidad: no afecta a la app publicada. Si la función send-push aún no
-- existe, los avisos solo esperan en la cola. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ids uuid[] NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  tag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- Sin políticas: la app solo entra por las funciones de abajo
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notification_queue FROM PUBLIC, anon, authenticated;

-- Un teléfono es de quien tenga la sesión abierta en él
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  INSERT INTO public.push_subscriptions(endpoint, user_id, p256dh, auth, updated_at)
  VALUES (p_endpoint, auth.uid(), p_p256dh, p_auth, now())
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = auth.uid(), p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public._wake_send_push()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://jnejvuprgreghfucnswv.supabase.co/functions/v1/send-push',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
END;
$$;

-- Un aviso nunca debe impedir que se guarde una partida o una apuesta
CREATE OR REPLACE FUNCTION public._notify(p_user_ids uuid[], p_title text, p_body text, p_tag text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_targets uuid[];
BEGIN
  SELECT array_agg(DISTINCT s.user_id) INTO v_targets
  FROM public.push_subscriptions s
  WHERE s.user_id = ANY(p_user_ids);

  IF v_targets IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.notification_queue(user_ids, title, body, tag)
  VALUES (v_targets, p_title, p_body, p_tag);
  PERFORM public._wake_send_push();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'No se pudo encolar el aviso: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public._everyone_except(p_excluded uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT user_id), '{}')
  FROM public.push_subscriptions
  WHERE NOT (user_id = ANY(COALESCE(p_excluded, '{}')));
$$;

CREATE OR REPLACE FUNCTION public._team_names(p_players jsonb, p_team integer)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(string_agg(COALESCE(e->>'name', e->>'initials'), ' y '), 'Equipo ' || p_team)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_players) = 'array' THEN p_players ELSE '[]'::jsonb END) e
  WHERE (e->>'teamNumber')::integer = p_team;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_push_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN
      PERFORM public._notify(
        public._everyone_except(ARRAY[NEW.team1_player1, NEW.team1_player2, NEW.team2_player1, NEW.team2_player2, NEW.created_by]),
        '🎲 Ya están jugando',
        public._team_names(NEW.players_json, 1) || ' contra ' || public._team_names(NEW.players_json, 2) || '. Entra a verla en vivo.',
        'match-' || NEW.id
      );
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.status = 'pending_confirmation' AND OLD.status IS DISTINCT FROM 'pending_confirmation' THEN
    PERFORM public._notify(public._match_rivals(NEW), '🏁 Confirma el resultado',
      'Tu partida terminó. Entra a confirmar quién ganó.', 'confirm-' || NEW.id);
  ELSIF NEW.status = 'active' AND OLD.status = 'pending_confirmation' AND OLD.closed_by IS NOT NULL THEN
    PERFORM public._notify(ARRAY[OLD.closed_by], '🔁 Partida reabierta',
      'Un rival no estuvo de acuerdo. Entra a corregir la última mano.', 'confirm-' || NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_push_match ON public.matches;
CREATE TRIGGER tr_push_match
  AFTER INSERT OR UPDATE OF status ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_push_match();

CREATE OR REPLACE FUNCTION public.trg_fn_push_bet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_players jsonb;
  v_total bigint;
BEGIN
  SELECT players_json INTO v_players FROM public.matches WHERE id = NEW.match_id;
  SELECT COALESCE(SUM(amount_wagered), 0) INTO v_total
  FROM public.bets
  WHERE match_id = NEW.match_id AND bet_on_team = NEW.bet_on_team AND status <> 'cancelled';

  PERFORM public._notify(
    public._everyone_except(ARRAY[NEW.user_id]),
    '💰 Apuestas en la mesa',
    'Hay ' || v_total || ' puntos apostados por ' || public._team_names(v_players, NEW.bet_on_team) || '. ¡Entra rápido y apuesta tú también!',
    'bets-' || NEW.match_id
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_push_bet ON public.bets;
CREATE TRIGGER tr_push_bet
  AFTER INSERT ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_push_bet();

ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS first_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.trg_fn_push_waitlist_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.called_at IS DISTINCT FROM OLD.called_at AND NEW.called_at IS NOT NULL THEN
    PERFORM public._notify(ARRAY[NEW.player1_id, NEW.player2_id], '🚨 ¡A la mesa!',
      COALESCE(NEW.called_by_name, 'La mesa') || ' llamó a tu dúo. ¡Tienen 30 segundos!', 'call-' || NEW.id);
  END IF;
  IF NEW.near_turn_at IS DISTINCT FROM OLD.near_turn_at AND NEW.near_turn_at IS NOT NULL THEN
    PERFORM public._notify(ARRAY[NEW.player1_id, NEW.player2_id], '⏳ ¡Casi es su turno!',
      'La partida va por ' || NEW.near_turn_score || ' de ' || NEW.near_turn_limit || '. ¡Vayan preparándose!', 'near-' || NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_push_waitlist_alerts ON public.waitlist;
CREATE TRIGGER tr_push_waitlist_alerts
  AFTER UPDATE ON public.waitlist
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_push_waitlist_alerts();

-- Avisa cuando un dúo avanza al primer lugar. Quien se anota con la cola vacía ya lo sabe.
CREATE OR REPLACE FUNCTION public.trg_fn_push_first_in_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first public.waitlist;
BEGIN
  SELECT * INTO v_first FROM public.waitlist WHERE status = 'waiting' ORDER BY created_at LIMIT 1;
  IF NOT FOUND OR v_first.first_notified_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.allow_waitlist_call', 'true', true);
  UPDATE public.waitlist SET first_notified_at = now() WHERE id = v_first.id;
  PERFORM set_config('app.allow_waitlist_call', 'false', true);

  IF TG_OP <> 'INSERT' OR NEW.id <> v_first.id THEN
    PERFORM public._notify(ARRAY[v_first.player1_id, v_first.player2_id], '🥇 Quedaste de primero',
      'Tu dúo es el siguiente en la lista de espera. ¡Vayan preparándose!', 'first-' || v_first.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_push_first_in_line ON public.waitlist;
CREATE TRIGGER tr_push_first_in_line
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.waitlist
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_push_first_in_line();

CREATE OR REPLACE FUNCTION public.trg_fn_push_tournament()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_users uuid[];
BEGIN
  SELECT array_agg(user_id) INTO v_users
  FROM public.tournament_participants
  WHERE tournament_id = NEW.id AND payment_status = 'approved';

  PERFORM public._notify(COALESCE(v_users, '{}'), '🏆 Empezó el torneo', NEW.name || ' ya comenzó. Entra a ver tu llave.', 'tournament-' || NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_push_tournament ON public.tournaments;
CREATE TRIGGER tr_push_tournament
  AFTER UPDATE OF status ON public.tournaments
  FOR EACH ROW
  WHEN (NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress')
  EXECUTE FUNCTION public.trg_fn_push_tournament();

REVOKE EXECUTE ON FUNCTION public.save_push_subscription(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_push_subscription(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._wake_send_push() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._notify(uuid[], text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._everyone_except(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_push_match() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_push_bet() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_push_waitlist_alerts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_push_first_in_line() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_push_tournament() FROM PUBLIC, anon, authenticated;

-- Respaldo: si una llamada se pierde, la cola se revisa cada minuto
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('enviar-notificaciones', '* * * * *',
      'SELECT public._wake_send_push() WHERE EXISTS (SELECT 1 FROM public.notification_queue WHERE sent_at IS NULL)');
  END IF;
END $$;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las tres columnas deben salir en true
-- ==============================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') AS llamadas_activas,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_push_match') AS avisos_activos,
  has_function_privilege('authenticated', 'public.save_push_subscription(text, text, text)', 'EXECUTE') AS app_se_registra;
