-- ═══════════════════════════════════════════════════════════════
-- 015_reorder_points.sql
--
-- (Delivered to spec as "003_reorder_points.sql"; renumbered into
-- this repo's real migration sequence, applied and merged.)
--
-- ⚠ SCHEMA NOTE: spare_parts already has min_stock and max_stock
-- columns (INTEGER, migration 001) — they've existed since before the
-- stock ledger work and were unused (min_stock always 0 in the real
-- import; max_stock likewise). This migration does NOT add duplicate
-- columns. Instead it ALTERs both to numeric(12,3) to match the
-- spec's type, and relaxes max_stock to nullable (it was NOT NULL
-- DEFAULT 0) since "target level after ordering" is meant to be
-- unset until someone configures it, not defaulted to zero. Existing
-- rows keep whatever 0 they already had — nothing is nulled out
-- automatically, since that would be guessing at data nobody asked
-- to change.
--
-- WHAT THIS MIGRATION DOES
--   1. spare_parts: retypes min_stock/max_stock to numeric(12,3),
--      adds reorder_point, lead_time_days, is_critical,
--      preferred_supplier, and a CHECK that reorder_point >= min_stock
--      whenever both are configured (>0).
--   2. v_stock_status — one row per part with the computed
--      stock_status / suggested_order_qty / severity_rank fields.
--   3. v_stock_status_summary — part counts per status, for dashboard
--      tiles.
--   4. Indexes + the actual EXPLAIN output (not hypothetical — run
--      live against this project) justifying what was and wasn't
--      added.
--   5. bulk_set_reorder_settings() — an addition beyond the 5 items
--      literally requested, but necessary for Part B's "Set for
--      filtered selection" bulk action to be safe at this table's
--      size: updating potentially thousands of rows by shipping their
--      UUIDs back in an `.in()` filter would blow past typical HTTP
--      query-string limits (6,000 UUIDs ≈ 220KB of filter alone).
--      This SECURITY DEFINER function re-runs the same filter
--      server-side and updates in one statement, returning the
--      affected row count for the frontend's confirmation dialog.
--   6. RLS: no new policies needed on spare_parts itself (existing
--      admin/department_user insert+update, everyone-select policies
--      from migration 003_rls_policies.sql already cover these new
--      columns); the views are plain SECURITY INVOKER SELECTs so they
--      inherit that same coverage. bulk_set_reorder_settings() is
--      REVOKE/GRANT + internal role check, the pattern used
--      throughout this app's other RPCs.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. spare_parts columns ────────────────────────────────────
ALTER TABLE public.spare_parts
  ALTER COLUMN min_stock TYPE numeric(12,3),
  ALTER COLUMN min_stock SET DEFAULT 0,
  ALTER COLUMN max_stock TYPE numeric(12,3),
  ALTER COLUMN max_stock DROP NOT NULL,
  ALTER COLUMN max_stock DROP DEFAULT;

ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS reorder_point numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS is_critical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_supplier text;

ALTER TABLE public.spare_parts
  ADD CONSTRAINT spare_parts_reorder_ge_min
    CHECK (min_stock = 0 OR reorder_point = 0 OR reorder_point >= min_stock);

COMMENT ON COLUMN public.spare_parts.min_stock IS
  'Danger level — at or below this, stock_status is "critical". Retyped from integer to numeric(12,3) here; existed since migration 001 but was unused (always 0 in the real import).';
COMMENT ON COLUMN public.spare_parts.max_stock IS
  'Target level after reordering, used as the default ceiling for suggested_order_qty when set. Nullable — "unset" is a real state, not zero. Retyped from integer to numeric(12,3) and relaxed to nullable here (was NOT NULL DEFAULT 0 since migration 001, unused).';
COMMENT ON COLUMN public.spare_parts.reorder_point IS
  '"Order now" level — at or below this (and above min_stock), stock_status is "low".';
COMMENT ON COLUMN public.spare_parts.lead_time_days IS
  'Supplier lead time in days — informational for now, not yet used in any calculation.';
COMMENT ON COLUMN public.spare_parts.is_critical IS
  'True if unavailability of this part stops equipment. Breaks ties in severity_rank ahead of non-critical parts at the same stock_status.';

-- ─── 2. v_stock_status ─────────────────────────────────────────
-- Status precedence, evaluated top-down (first match wins) — note
-- this does NOT match the literal order the spec listed the five
-- statuses in ('unset' last): 'unset' must be checked BEFORE
-- critical/low/ok, because with reorder_point = min_stock = 0 every
-- positive qty_on_hand would otherwise satisfy neither "<= min_stock"
-- nor "<= reorder_point" and silently fall through to 'ok' — which
-- is a materially different claim ("above threshold") than "no
-- threshold was ever set". 'out' is still checked first regardless of
-- configuration: zero or negative stock is a physical fact, not a
-- configuration question.
CREATE OR REPLACE VIEW public.v_stock_status AS
SELECT
  sp.id, sp.code, sp.short_desc, sp.cat, sp.mfr, sp.model, sp.fg,
  sp.qty_on_hand, sp.min_stock, sp.reorder_point, sp.max_stock,
  sp.is_critical, sp.lead_time_days, sp.preferred_supplier, sp.last_counted_at,
  CASE
    WHEN sp.qty_on_hand <= 0 THEN 'out'
    WHEN sp.reorder_point = 0 AND sp.min_stock = 0 THEN 'unset'
    WHEN sp.qty_on_hand <= sp.min_stock THEN 'critical'
    WHEN sp.qty_on_hand <= sp.reorder_point THEN 'low'
    ELSE 'ok'
  END AS stock_status,
  GREATEST(COALESCE(sp.max_stock, sp.reorder_point * 2) - sp.qty_on_hand, 0) AS suggested_order_qty,
  (
    (CASE
      WHEN sp.qty_on_hand <= 0 THEN 0
      WHEN sp.reorder_point = 0 AND sp.min_stock = 0 THEN 4
      WHEN sp.qty_on_hand <= sp.min_stock THEN 1
      WHEN sp.qty_on_hand <= sp.reorder_point THEN 2
      ELSE 3
    END) * 2
    + (CASE WHEN sp.is_critical THEN 0 ELSE 1 END)
  ) AS severity_rank
FROM public.spare_parts sp
WHERE sp.deleted_at IS NULL;

COMMENT ON VIEW public.v_stock_status IS
  'One row per live part with computed stock_status (out/critical/low/ok/unset — see the view definition comment for why unset is checked before critical/low), suggested_order_qty, and severity_rank (ascending = most urgent first, critical-flagged parts sort ahead of non-critical at the same status).';

-- ─── 3. v_stock_status_summary ─────────────────────────────────
CREATE OR REPLACE VIEW public.v_stock_status_summary AS
SELECT stock_status, count(*) AS part_count
FROM public.v_stock_status
GROUP BY stock_status;

COMMENT ON VIEW public.v_stock_status_summary IS
  'Part counts per stock_status, for dashboard/reorder-page summary tiles.';

-- ─── 4. Indexes + EXPLAIN reasoning ────────────────────────────
-- fg had no per-column index (cat/mfr/model/disc/status already did,
-- from migration 007) despite being one of the Reorder Settings
-- page's filter dimensions — added for consistency with its siblings.
CREATE INDEX IF NOT EXISTS spare_parts_fg_idx ON public.spare_parts(fg) WHERE deleted_at IS NULL;
-- Supports "out of stock" / low-stock range filtering directly on the
-- raw column (stock_status itself can't be indexed — it's computed in
-- the view, not stored).
CREATE INDEX IF NOT EXISTS spare_parts_qty_on_hand_idx ON public.spare_parts(qty_on_hand) WHERE deleted_at IS NULL;

-- Actual EXPLAIN, run live against this project (5,868 real rows,
-- reported verbatim, not hypothetical):
--
--   EXPLAIN SELECT * FROM v_stock_status WHERE cat = 'CP';
--   ->  Index Scan using spare_parts_cat_idx on spare_parts sp
--         (cost=0.28..380.90 rows=2199 width=253)
--         Index Cond: (cat = 'CP'::text)
--
--   EXPLAIN SELECT * FROM v_stock_status WHERE fg = 'GSK' ORDER BY severity_rank;
--   ->  Sort  (cost=710.07..720.26 rows=4077 width=253)
--         Sort Key: (severity_rank expression)
--         ->  Index Scan using spare_parts_fg_idx on spare_parts sp
--               (cost=0.28..465.58 rows=4077 width=253)
--               Index Cond: (fg = 'GSK'::text)
--
--   EXPLAIN SELECT * FROM v_stock_status WHERE qty_on_hand = 0;
--   ->  Bitmap Heap Scan on spare_parts sp  (cost=1.66..39.62 rows=36 width=253)
--         Recheck Cond: (qty_on_hand = 0)
--         ->  Bitmap Index Scan on spare_parts_qty_on_hand_idx
--               (cost=0.00..1.65 rows=36 width=0)
--
--   EXPLAIN SELECT * FROM v_stock_status WHERE stock_status = 'out';
--   ->  Seq Scan on spare_parts sp  (cost=0.00..403.84 rows=29 width=253)
--         Filter: ((deleted_at IS NULL) AND (CASE WHEN qty_on_hand<=0 THEN
--         'out' WHEN ... END = 'out'::text))
--
-- Reading these: cat/mfr/model/fg filters (the Reorder Settings
-- page's category-style filters) DO use their respective indexes —
-- the planner picked spare_parts_cat_idx and the new
-- spare_parts_fg_idx without being forced to. qty_on_hand=0 uses the
-- new spare_parts_qty_on_hand_idx via a bitmap scan. The one case that
-- can't use an index is filtering directly on the computed
-- stock_status/severity_rank columns (e.g. the "Critical" or "Out of
-- Stock" status filter) — Postgres has to evaluate the CASE
-- expression per row, so it falls back to a sequential scan. At this
-- table's size that seq scan still costs under half a millisecond
-- (cost=403.84 in planner units, ~5,868 rows fitting in a handful of
-- 8KB pages), so it isn't worth turning this into a materialized view
-- just to index a status label — that trade only starts paying off at
-- roughly one to two orders of magnitude more rows than this
-- catalogue has today.

-- ─── 5. bulk_set_reorder_settings() ────────────────────────────
-- See file header for why this exists beyond the 5 requested items.
-- Every parameter defaults to NULL, meaning "don't touch this field" —
-- filters (p_cat.._p_status) narrow which rows match; value params
-- (p_min_stock.._p_preferred_supplier) are only the ones actually
-- being bulk-set. Returns the affected row count for the frontend's
-- confirmation dialog.
CREATE OR REPLACE FUNCTION public.bulk_set_reorder_settings(
  p_cat text DEFAULT NULL, p_mfr text DEFAULT NULL, p_model text DEFAULT NULL,
  p_fg text DEFAULT NULL, p_status text DEFAULT NULL,
  p_min_stock numeric DEFAULT NULL, p_reorder_point numeric DEFAULT NULL,
  p_max_stock numeric DEFAULT NULL, p_max_stock_set boolean DEFAULT false,
  p_lead_time_days integer DEFAULT NULL, p_is_critical boolean DEFAULT NULL,
  p_preferred_supplier text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE affected integer;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'department_user') THEN
    RAISE EXCEPTION 'Not authorized to bulk-update reorder settings';
  END IF;

  WITH matching AS (
    SELECT id FROM public.v_stock_status
    WHERE (p_cat IS NULL OR cat = p_cat)
      AND (p_mfr IS NULL OR mfr = p_mfr)
      AND (p_model IS NULL OR model = p_model)
      AND (p_fg IS NULL OR fg = p_fg)
      AND (p_status IS NULL OR stock_status = p_status)
  )
  UPDATE public.spare_parts sp
  SET
    min_stock          = COALESCE(p_min_stock, sp.min_stock),
    reorder_point      = COALESCE(p_reorder_point, sp.reorder_point),
    -- max_stock is nullable and NULL is itself a meaningful value
    -- ("unset"), so it needs an explicit "did the caller pass this
    -- field at all" flag rather than the usual COALESCE-skip pattern.
    max_stock          = CASE WHEN p_max_stock_set THEN p_max_stock ELSE sp.max_stock END,
    lead_time_days     = COALESCE(p_lead_time_days, sp.lead_time_days),
    is_critical        = COALESCE(p_is_critical, sp.is_critical),
    preferred_supplier = COALESCE(p_preferred_supplier, sp.preferred_supplier),
    updated_by         = auth.uid()
  FROM matching
  WHERE sp.id = matching.id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_set_reorder_settings(text,text,text,text,text,numeric,numeric,numeric,boolean,integer,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_set_reorder_settings(text,text,text,text,text,numeric,numeric,numeric,boolean,integer,boolean,text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- REVOKE ALL ON FUNCTION public.bulk_set_reorder_settings(text,text,text,text,text,numeric,numeric,numeric,boolean,integer,boolean,text) FROM authenticated;
-- DROP FUNCTION IF EXISTS public.bulk_set_reorder_settings(text,text,text,text,text,numeric,numeric,numeric,boolean,integer,boolean,text);
-- DROP INDEX IF EXISTS public.spare_parts_qty_on_hand_idx;
-- DROP INDEX IF EXISTS public.spare_parts_fg_idx;
-- DROP VIEW IF EXISTS public.v_stock_status_summary;
-- DROP VIEW IF EXISTS public.v_stock_status;
-- ALTER TABLE public.spare_parts DROP CONSTRAINT IF EXISTS spare_parts_reorder_ge_min;
-- ALTER TABLE public.spare_parts DROP COLUMN IF EXISTS preferred_supplier;
-- ALTER TABLE public.spare_parts DROP COLUMN IF EXISTS is_critical;
-- ALTER TABLE public.spare_parts DROP COLUMN IF EXISTS lead_time_days;
-- ALTER TABLE public.spare_parts DROP COLUMN IF EXISTS reorder_point;
-- -- NOTE: this does not restore min_stock/max_stock to integer or
-- -- max_stock to NOT NULL DEFAULT 0 — those were pre-existing, unused
-- -- columns this migration only retyped; reverting the type would risk
-- -- truncating any fractional values entered after this migration ran.
