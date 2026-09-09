-- ═══════════════════════════════════════════════════════════════
-- 035_parts_tree_counts.sql
--
-- PERFORMANCE FIX (review finding H4).
--
-- The Hierarchy Tree loaded every part into the browser: a loop of
-- db.fetchTreeParts(page, 1000) up to 20 pages — six sequential
-- round-trips for the current 5,868 parts — then kept the whole array
-- in memory and re-filtered it at each of five tree levels to produce
-- counts. It is the only page in the app that does this; Master Table,
-- Assets, Movements and Alerts are all properly paginated.
--
-- The tree only ever needed counts per branch. This view returns one
-- row per populated (cat, mfr, model, disc, fg) combination — a few
-- hundred rows instead of thousands — and the leaf part lists are
-- fetched per functional group when a node is actually expanded.
--
-- Grouped on the same columns the tree nests by, so every level's
-- count is a sum over this result rather than a scan of all parts.
--
-- security_invoker so it reads with the caller's permissions and
-- honours the spare_parts RLS policy (deleted parts excluded, which
-- the WHERE already does explicitly too).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_parts_tree_counts
WITH (security_invoker = on) AS
SELECT
  cat, mfr, model, disc, fg,
  COUNT(*) AS part_count
FROM public.spare_parts
WHERE deleted_at IS NULL
GROUP BY cat, mfr, model, disc, fg;

COMMENT ON VIEW public.v_parts_tree_counts IS
  'Part counts per (cat, mfr, model, disc, fg) branch, for the Hierarchy Tree. Replaces loading all parts client-side just to count them (migration 035); leaf part lists are fetched per functional group on expand.';

GRANT SELECT ON public.v_parts_tree_counts TO authenticated;

-- Supports the GROUP BY above and the per-branch leaf lookups the tree
-- issues on expand (cat+mfr+model+disc+fg equality).
CREATE INDEX IF NOT EXISTS spare_parts_tree_idx
  ON public.spare_parts (cat, mfr, model, disc, fg)
  WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP VIEW IF EXISTS public.v_parts_tree_counts;
-- DROP INDEX IF EXISTS public.spare_parts_tree_idx;
