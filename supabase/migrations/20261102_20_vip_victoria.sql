-- ==============================================================================
-- VIP: ANIMACIÓN DE VICTORIA
-- El VIP elige qué ven todos cuando gana: confeti dorado, lluvia de fichas de
-- dominó, fuegos artificiales o lluvia de coronas. Solo estilo.
--
-- Orden: después de 20261102_19_vip_extras.sql. Se puede repetir sin daño.
-- ==============================================================================
BEGIN;

ALTER TABLE public.vip_members ADD COLUMN IF NOT EXISTS win_style text NOT NULL DEFAULT 'confeti';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vip_members_win_style_check') THEN
    ALTER TABLE public.vip_members ADD CONSTRAINT vip_members_win_style_check
      CHECK (win_style IN ('confeti', 'domino', 'fuegos', 'coronas'));
  END IF;
END $$;

GRANT SELECT (win_style) ON public.vip_members TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_vip_win_style(p_style text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public._vip_active(v_uid) THEN
    RAISE EXCEPTION 'Solo un VIP activo puede elegir su animación';
  END IF;
  IF p_style IS NULL OR p_style NOT IN ('confeti', 'domino', 'fuegos', 'coronas') THEN
    RAISE EXCEPTION 'Esa animación no existe';
  END IF;
  UPDATE public.vip_members SET win_style = p_style, updated_at = now() WHERE user_id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_vip_win_style(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vip_win_style(text) TO authenticated;

COMMIT;

-- ==============================================================================
-- VERIFICACIÓN: las dos columnas deben salir en true
-- ==============================================================================
SELECT
  has_column_privilege('anon', 'public.vip_members', 'win_style', 'SELECT') AS todos_ven_la_animacion,
  has_function_privilege('authenticated', 'public.set_vip_win_style(text)', 'EXECUTE') AS se_puede_elegir;
