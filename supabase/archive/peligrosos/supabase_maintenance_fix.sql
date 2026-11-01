-- =============================================================================
-- DOMINO VIP / PeSiMistas — SUPABASE MAINTENANCE & REALTIME/BETTING FIX
-- Ejecuta este script en el SQL Editor de Supabase (Idempotente / Seguro)
-- =============================================================================

-- 1. Asegurar columnas necesarias en matches, bets y waitlist
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS substitutions jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS wager_amount integer DEFAULT 0;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS is_wager_match boolean DEFAULT false;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS wager_settled boolean DEFAULT false;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS tournament_id uuid;

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  player1_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  player2_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  status text DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS status text DEFAULT 'waiting';

CREATE TABLE IF NOT EXISTS public.bets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE NOT NULL,
  bet_on_team integer NOT NULL CHECK (bet_on_team IN (1, 2)),
  amount_wagered integer NOT NULL CHECK (amount_wagered > 0),
  multiplier numeric DEFAULT 2.0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS multiplier numeric DEFAULT 2.0;

-- 2. Índices de rendimiento para eliminar lentitud en consultas
CREATE INDEX IF NOT EXISTS idx_matches_status_created ON public.matches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_t1p1 ON public.matches(team1_player1);
CREATE INDEX IF NOT EXISTS idx_matches_t1p2 ON public.matches(team1_player2);
CREATE INDEX IF NOT EXISTS idx_matches_t2p1 ON public.matches(team2_player1);
CREATE INDEX IF NOT EXISTS idx_matches_t2p2 ON public.matches(team2_player2);
CREATE INDEX IF NOT EXISTS idx_bets_match_status ON public.bets(match_id, status);
CREATE INDEX IF NOT EXISTS idx_bets_user_status ON public.bets(user_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_status_created ON public.waitlist(status, created_at ASC);

-- 3. Políticas RLS para Waitlist (Pedir Mesa) y Bets (Apuestas)
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Waitlist viewable by everyone" ON public.waitlist;
CREATE POLICY "Waitlist viewable by everyone" ON public.waitlist
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert waitlist" ON public.waitlist;
CREATE POLICY "Authenticated users can insert waitlist" ON public.waitlist
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update waitlist" ON public.waitlist;
CREATE POLICY "Authenticated users can update waitlist" ON public.waitlist
  FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete waitlist" ON public.waitlist;
CREATE POLICY "Authenticated users can delete waitlist" ON public.waitlist
  FOR DELETE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Bets viewable by everyone" ON public.bets;
CREATE POLICY "Bets viewable by everyone" ON public.bets
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert bets" ON public.bets;
CREATE POLICY "Authenticated users can insert bets" ON public.bets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can update bets" ON public.bets;
CREATE POLICY "Authenticated users can update bets" ON public.bets
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Permitir también que matches se puedan actualizar e insertar con ID generado offline
DROP POLICY IF EXISTS "Authenticated users can update matches" ON public.matches;
CREATE POLICY "Authenticated users can update matches" ON public.matches
  FOR UPDATE USING (auth.role() = 'authenticated');

-- 4. Función RPC SECURITY DEFINER para resolver apuestas de espectadores
--    (Ignora el bloqueo RLS de profiles para poder acreditar puntos a TODOS los ganadores)
CREATE OR REPLACE FUNCTION public.resolve_match_bets(
  p_match_id uuid,
  p_winner_team integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_payout integer;
  v_mult numeric;
BEGIN
  FOR r IN
    SELECT id, user_id, bet_on_team, amount_wagered, multiplier
    FROM public.bets
    WHERE match_id = p_match_id
      AND status = 'pending'
    FOR UPDATE
  LOOP
    IF p_winner_team IS NULL THEN
      -- Partida anulada: devolver puntos apostados
      UPDATE public.profiles
      SET betting_points = COALESCE(betting_points, 0) + r.amount_wagered
      WHERE id = r.user_id;

      UPDATE public.bets
      SET status = 'cancelled'
      WHERE id = r.id;

    ELSIF r.bet_on_team = p_winner_team THEN
      -- ¡Apuesta ganada! Pagar monto * multiplicador (incluye capital + ganancia)
      v_mult := COALESCE(NULLIF(r.multiplier, 0), 2.0);
      v_payout := FLOOR(r.amount_wagered * v_mult);

      UPDATE public.profiles
      SET betting_points = COALESCE(betting_points, 0) + v_payout
      WHERE id = r.user_id;

      UPDATE public.bets
      SET status = 'won'
      WHERE id = r.id;

    ELSE
      -- Apuesta perdida (los puntos ya fueron descontados al crear la apuesta)
      UPDATE public.bets
      SET status = 'lost'
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_match_bets(uuid, integer) TO authenticated, anon;

-- 5. Función RPC SECURITY DEFINER para resolver apuestas directas entre jugadores (VIP Wager Match)
CREATE OR REPLACE FUNCTION public.resolve_match_wagers(
  p_match_id uuid,
  p_winner_team integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_wager integer;
BEGIN
  IF p_winner_team IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(v_match.is_wager_match, false) = false
     OR COALESCE(v_match.wager_amount, 0) <= 0
     OR COALESCE(v_match.wager_settled, false) = true THEN
    RETURN;
  END IF;

  v_wager := v_match.wager_amount;

  IF p_winner_team = 1 THEN
    UPDATE public.profiles
    SET betting_points = COALESCE(betting_points, 0) + v_wager
    WHERE id IN (v_match.team1_player1, v_match.team1_player2);

    UPDATE public.profiles
    SET betting_points = GREATEST(0, COALESCE(betting_points, 0) - v_wager)
    WHERE id IN (v_match.team2_player1, v_match.team2_player2);
  ELSIF p_winner_team = 2 THEN
    UPDATE public.profiles
    SET betting_points = COALESCE(betting_points, 0) + v_wager
    WHERE id IN (v_match.team2_player1, v_match.team2_player2);

    UPDATE public.profiles
    SET betting_points = GREATEST(0, COALESCE(betting_points, 0) - v_wager)
    WHERE id IN (v_match.team1_player1, v_match.team1_player2);
  END IF;

  UPDATE public.matches
  SET wager_settled = true
  WHERE id = p_match_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_match_wagers(uuid, integer) TO authenticated, anon;

-- 6. Trigger automático en matches: Cuando una partida pasa a 'completed',
--    liquida automáticamente todas las apuestas pendientes y wagers en la BD.
CREATE OR REPLACE FUNCTION public.trg_fn_settle_match_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner integer;
BEGIN
  IF NEW.status = 'completed' THEN
    v_winner := NEW.winner_team;
    IF v_winner IS NULL THEN
      IF COALESCE(NEW.team1_total, 0) >= COALESCE(NEW.limit_score, 100) THEN
        v_winner := 1;
      ELSIF COALESCE(NEW.team2_total, 0) >= COALESCE(NEW.limit_score, 100) THEN
        v_winner := 2;
      END IF;
    END IF;

    PERFORM public.resolve_match_bets(NEW.id, v_winner);
    PERFORM public.resolve_match_wagers(NEW.id, v_winner);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_resolve_match_bets ON public.matches;
CREATE TRIGGER trg_auto_resolve_match_bets
  AFTER INSERT OR UPDATE OF status, winner_team
  ON public.matches
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.trg_fn_settle_match_on_complete();

-- 7. Reparación retroactiva: Liquidar inmediatamente cualquier apuesta pendiente
--    de partidas que ya habían terminado anteriormente.
DO $$
DECLARE
  m RECORD;
  v_win integer;
BEGIN
  FOR m IN
    SELECT DISTINCT mt.id, mt.winner_team, mt.team1_total, mt.team2_total, mt.limit_score
    FROM public.matches mt
    INNER JOIN public.bets b ON b.match_id = mt.id
    WHERE b.status = 'pending'
      AND (
        mt.status = 'completed'
        OR COALESCE(mt.team1_total, 0) >= COALESCE(mt.limit_score, 100)
        OR COALESCE(mt.team2_total, 0) >= COALESCE(mt.limit_score, 100)
      )
  LOOP
    v_win := m.winner_team;
    IF v_win IS NULL THEN
      IF COALESCE(m.team1_total, 0) >= COALESCE(m.limit_score, 100) THEN
        v_win := 1;
      ELSIF COALESCE(m.team2_total, 0) >= COALESCE(m.limit_score, 100) THEN
        v_win := 2;
      END IF;
    END IF;
    PERFORM public.resolve_match_bets(m.id, v_win);
  END LOOP;
END;
$$;

-- 8. Habilitar Realtime en tablas críticas (idempotente)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bets;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;
