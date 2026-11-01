// Builds supabase/migrations/20261001_00_esquema_base.sql from the archived scripts, in the
// order production received them. `npm run baseline` regenerates it; the tests build their
// database from the resulting file, so a broken baseline fails `npm run test:db`.
import fs from 'node:fs';
const R = new URL('../', import.meta.url).pathname;
const leer = (f) => fs.readFileSync(`${R}supabase/archive/${f}`, 'utf8');
const hasta = (text, marca) => {
  const i = text.indexOf(marca);
  if (i < 0) throw new Error(`Falta la marca: ${marca}`);
  return text.slice(0, i).replace(/-- =+\s*$/, '');
};
const entre = (text, inicio, fin) => {
  const i = text.indexOf(inicio);
  const j = text.indexOf(fin, i);
  if (i < 0 || j < 0) throw new Error(`Falta: ${inicio}`);
  return text.slice(i, j + fin.length);
};

const TABLAS = `-- ==============================================================================
-- ESQUEMA BASE (archivo generado por scripts/baseline.mjs)
-- SOLO para una base de datos VACÍA. NO ejecutar en producción: producción ya tiene
-- todo esto, y el bloqueo de abajo detiene el archivo si la tabla profiles existe.
-- Las columnas salen de los scripts archivados y del código de la app; lo que no se
-- pudo reconstruir está anotado en supabase/README.md.
-- ==============================================================================
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'Este archivo es solo para una base vacía';
  END IF;
END $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  initials text NOT NULL,
  avatar_url text,
  betting_points numeric DEFAULT 1000,
  last_daily_bonus_at timestamptz,
  streak_count integer DEFAULT 0,
  last_streak_update_at date,
  inventory text[] DEFAULT '{}',
  achievements jsonb DEFAULT '[]',
  equipped_items jsonb DEFAULT '{}',
  is_admin boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  entry_fee numeric NOT NULL DEFAULT 0,
  prize_pool numeric DEFAULT 0,
  max_participants integer NOT NULL DEFAULT 16,
  status text NOT NULL DEFAULT 'registration',
  tournament_type text DEFAULT 'vip_cash',
  entry_points numeric DEFAULT 0,
  prize_paid boolean DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'completed',
  game_mode text DEFAULT 'teams',
  limit_score integer NOT NULL DEFAULT 100,
  rounds jsonb NOT NULL DEFAULT '[]',
  players_json jsonb,
  substitutions jsonb DEFAULT '[]',
  team1_player1 uuid REFERENCES public.profiles(id),
  team1_player2 uuid REFERENCES public.profiles(id),
  team2_player1 uuid REFERENCES public.profiles(id),
  team2_player2 uuid REFERENCES public.profiles(id),
  team1_total integer NOT NULL DEFAULT 0,
  team2_total integer NOT NULL DEFAULT 0,
  winner_team integer,
  is_zapato boolean DEFAULT false,
  wager_amount numeric DEFAULT 0,
  is_wager_match boolean DEFAULT false,
  wager_settled boolean DEFAULT false,
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  bet_on_team integer NOT NULL CHECK (bet_on_team IN (1, 2)),
  amount_wagered integer NOT NULL CHECK (amount_wagered > 0),
  multiplier numeric DEFAULT 2.0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.duos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  player2_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (player1_id, player2_id)
);

CREATE TABLE public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player1_id uuid NOT NULL REFERENCES public.profiles(id),
  player2_id uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'waiting'
);

CREATE TABLE public.tournament_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.profiles(id),
  partner_status text DEFAULT 'none',
  team_name text,
  payment_status text DEFAULT 'pending',
  payment_reference text,
  payment_receipt_url text,
  payout_details text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tournament_id, user_id)
);

CREATE TABLE public.tournament_brackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  match_number integer NOT NULL,
  team1_player1 uuid REFERENCES public.profiles(id),
  team1_player2 uuid REFERENCES public.profiles(id),
  team2_player1 uuid REFERENCES public.profiles(id),
  team2_player2 uuid REFERENCES public.profiles(id),
  winner_team integer,
  next_match_id uuid REFERENCES public.tournament_brackets(id),
  live_match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.live_chat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id),
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.global_chat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id),
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  link_url text,
  is_active boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.system_config (
  id integer PRIMARY KEY,
  min_app_version text
);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_brackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Perfiles visibles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Partidas visibles" ON public.matches FOR SELECT USING (true);
CREATE POLICY "Duos visibles" ON public.duos FOR SELECT USING (true);
CREATE POLICY "Torneos visibles" ON public.tournaments FOR SELECT USING (true);
CREATE POLICY "Participantes visibles" ON public.tournament_participants FOR SELECT USING (true);
CREATE POLICY "Usuarios pueden actualizar su propio registro" ON public.tournament_participants FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Admins pueden actualizar cualquier registro" ON public.tournament_participants FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "Admins pueden eliminar registros" ON public.tournament_participants FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "Admins pueden actualizar torneos" ON public.tournaments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "Llaves visibles" ON public.tournament_brackets FOR SELECT USING (true);
CREATE POLICY "Admins pueden gestionar llaves" ON public.tournament_brackets FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "Permitir leer live_chat" ON public.live_chat FOR SELECT USING (true);
CREATE POLICY "Permitir escribir live_chat" ON public.live_chat FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Permitir leer global_chat a todos" ON public.global_chat FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir escribir en global_chat" ON public.global_chat FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Ads are viewable by everyone." ON public.ads FOR SELECT USING (true);
CREATE POLICY "Permitir lectura de system_config" ON public.system_config FOR SELECT USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true), ('ads', 'ads', true), ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Registro de usuarios: copiado de producción
CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_code_upper text;
BEGIN
  v_code := COALESCE(new.raw_user_meta_data->>'access_code', '');
  v_code_upper := UPPER(TRIM(v_code));

  IF NOT (
    v_code_upper IN ('CAFETIN', 'PESIMISTAS', 'DOMINO', '0509', 'VIP') OR
    v_code_upper LIKE '%CAFETIN%' OR
    v_code_upper LIKE '%PESIMISTAS%' OR
    v_code_upper LIKE '%DOMINO%' OR
    v_code_upper LIKE '%0509%' OR
    v_code_upper LIKE '%VIP%'
  ) THEN
    RAISE EXCEPTION 'Registro bloqueado: Es obligatorio escanear un código QR de invitación válido.';
  END IF;

  INSERT INTO public.profiles (id, display_name, initials, betting_points, is_admin)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'display_name', 'Jugador'),
    UPPER(COALESCE(new.raw_user_meta_data->>'initials', 'JG')),
    1000,
    false
  );
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Límite de un mensaje cada 3 segundos en el chat global: copiado de producción
CREATE FUNCTION public.check_global_chat_spam()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  last_msg_time timestamptz;
BEGIN
  SELECT created_at INTO last_msg_time
  FROM public.global_chat
  WHERE user_id = NEW.user_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF last_msg_time IS NOT NULL AND EXTRACT(EPOCH FROM (NEW.created_at - last_msg_time)) < 3 THEN
    RAISE EXCEPTION 'Por favor, espera 3 segundos antes de enviar otro mensaje.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER anti_spam_global_chat
  BEFORE INSERT ON public.global_chat
  FOR EACH ROW
  EXECUTE FUNCTION public.check_global_chat_spam();

-- Se reemplaza por 20261101_03_rachas.sql
CREATE FUNCTION public.update_player_streaks_for_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END $$;
`;

const mant = leer('peligrosos/supabase_maintenance_fix.sql');
const partes = [
  ['aplicados/fix_points_security.sql', hasta(leer('aplicados/fix_points_security.sql'), '-- VERIFICACIÓN (mándame captura de las 3)')],
  ['aplicados/fix_wager_consent.sql', hasta(leer('aplicados/fix_wager_consent.sql'), '-- VERIFICACIÓN (mándame captura de las 2)')],
  ['aplicados/fix_wager_substitutes.sql', hasta(leer('aplicados/fix_wager_substitutes.sql'), '-- VERIFICACIÓN (mándame captura)')],
  ['aplicados/fix_bets_rules.sql', leer('aplicados/fix_bets_rules.sql')],
  ['aplicados/fix_tournament_engine.sql', hasta(leer('aplicados/fix_tournament_engine.sql'), '-- Permisos: los internos')],
  ['peligrosos/supabase_maintenance_fix.sql (solo el pago automático al terminar)',
    entre(mant, 'CREATE OR REPLACE FUNCTION public.trg_fn_settle_match_on_complete()', 'END;\n$$;') + '\n\n' +
    entre(mant, 'DROP TRIGGER IF EXISTS trg_auto_resolve_match_bets', 'EXECUTE FUNCTION public.trg_fn_settle_match_on_complete();')],
];

const salida = TABLAS + partes.map(([f, t]) => `\n-- ------------------------------------------------------------------------------\n-- Desde ${f}\n-- ------------------------------------------------------------------------------\n${t.trim()}\n`).join('');
fs.writeFileSync(`${R}supabase/migrations/20261001_00_esquema_base.sql`, salida);
console.log(`Esquema base: ${salida.split('\n').length} líneas`);
