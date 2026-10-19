-- ============================================
-- LIMPIEZA DE DUOS DUPLICADOS (A,B) / (B,A)
-- Ejecuta esto en el SQL Editor de Supabase.
-- 1) Revisa primero qué se borraría (SELECT), 2) luego ejecuta el bloque BEGIN..COMMIT.
-- ============================================

-- 0. COLUMNAS QUE FALTAN EN PRODUCCIÓN (seguro repetirlo; los duos existentes quedan activos)
ALTER TABLE public.duos ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.duos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 1. VISTA PREVIA: filas duplicadas que se eliminarían (se conserva 1 por pareja: la activa más antigua)
WITH ranked AS (
  SELECT id, player1_id, player2_id, is_active, created_at,
         ROW_NUMBER() OVER (
           PARTITION BY LEAST(player1_id, player2_id), GREATEST(player1_id, player2_id)
           ORDER BY (is_active IS NOT FALSE) DESC, created_at ASC
         ) AS rn
  FROM public.duos
  WHERE player1_id IS NOT NULL AND player2_id IS NOT NULL
)
SELECT * FROM ranked WHERE rn > 1;

-- 2. LIMPIEZA + REGLA PARA QUE NO VUELVA A PASAR
BEGIN;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY LEAST(player1_id, player2_id), GREATEST(player1_id, player2_id)
           ORDER BY (is_active IS NOT FALSE) DESC, created_at ASC
         ) AS rn
  FROM public.duos
  WHERE player1_id IS NOT NULL AND player2_id IS NOT NULL
)
DELETE FROM public.duos d
USING ranked r
WHERE d.id = r.id AND r.rn > 1;

-- Un duo no puede ser consigo mismo
DELETE FROM public.duos WHERE player1_id = player2_id;

-- Unicidad sin importar el orden de los jugadores
CREATE UNIQUE INDEX IF NOT EXISTS duos_unique_pair_any_order
  ON public.duos (LEAST(player1_id, player2_id), GREATEST(player1_id, player2_id));

-- Permitir que SOLO los 2 miembros del duo lo cancelen/reactiven (antes no había política UPDATE)
DROP POLICY IF EXISTS "Duo members can update duo" ON public.duos;
CREATE POLICY "Duo members can update duo" ON public.duos
  FOR UPDATE USING (auth.uid() IN (player1_id, player2_id))
  WITH CHECK (auth.uid() IN (player1_id, player2_id));

COMMIT;
