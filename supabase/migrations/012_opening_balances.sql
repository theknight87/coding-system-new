-- ═══════════════════════════════════════════════════════════════
-- 012_opening_balances.sql
--
-- Depends on 011_stock_transactions.sql already being applied
-- (stock_txn_type enum, stock_transactions table, spare_parts.id /
-- qty_on_hand, current_user_role(), void_stock_transaction()).
--
-- WHAT THIS MIGRATION DOES
--   PART A1 — Renames spare_parts.qty → qty_per_assembly and marks it
--             clearly as catalogue data, not stock. Deprecates the
--             OLD stock_movements trigger that depended on the old
--             column name (see ⚠ below — this is load-bearing, read it).
--   PART A2 — Adds spare_parts.stock_source / last_counted_at, and
--             stock_transactions.is_estimated.
--   PART A3 — Seeds a deterministic ESTIMATED opening_balance per part,
--             sized by functional group / category, skipping parts
--             that already have one. Full band mapping is in the
--             comment block below — read it before running.
--   PART A4 — post_physical_count(): turns an estimate into a real,
--             counted figure via a correction transaction.
--   PART A5 — reset_estimated_balances(): admin-only bulk undo for the
--             seeded estimates (voids them properly, never touches
--             counted parts).
--   PART A6 — v_stock_confidence: parts-by-stock_source, overall and
--             per category, for the UI's progress indicator.
--   PART A7 — RLS/grants for the two new RPCs.
--
-- ⚠ CRITICAL, READ BEFORE APPLYING — LIVE SCHEMA CHECKED DIRECTLY:
--
-- 1) migration 010 (stock_movements.sql) IS live in this database.
--    Its `apply_stock_movement()` trigger runs
--    `UPDATE spare_parts SET qty = qty ± NEW.quantity` — a hardcoded
--    reference to the column this migration renames. Left alone, the
--    very next insert into stock_movements (e.g. from the existing
--    "Stock Ledger" page / "Record Movement" button built in an
--    earlier session) would fail with "column qty does not exist"
--    and abort. This migration therefore DROPS that trigger and its
--    function (PART A1, step 3). The stock_movements TABLE itself is
--    left in place (historical rows preserved, nothing deleted) but
--    it becomes inert: new rows can still be inserted into it, but
--    nothing recalculates from it anymore. spare_parts.qty_on_hand
--    (from migration 011) is now the only real running balance,
--    driven exclusively by stock_transactions.
--    >>> Practical effect on the app: the "Stock Ledger" page and the
--    >>> "📒 Record Movement" button in Part Detail (built two
--    >>> sessions ago) still render and still let a user insert a
--    >>> row into stock_movements, but it will no longer change any
--    >>> number anywhere. That UI is not touched by this SQL-only
--    >>> migration — flagging it so you can decide whether to remove
--    >>> it in the frontend follow-up.
--
-- 2) categories has no uuid id column (PK is `code text`, confirmed
--    live). Your spec's reset_estimated_balances(p_category_id uuid)
--    is written here as reset_estimated_balances(p_category_code text)
--    instead of silently inventing another surrogate uuid column on a
--    table that has no other need for one. Say the word if you'd
--    rather I add categories.id uuid to match the literal signature.
--
-- FULL FUNCTIONAL-GROUP → BAND MAPPING (all 49 live groups, read from
-- the actual functional_groups table — adjust the VALUES list in
-- PART A3 below if you want a code moved to a different band):
--
--   Band A — consumables & seals            (12–60): GSK, RNG, SEA
--   Band B — filters / small electrical      (6–25): FIL, FLT, DRY, LGA,
--            PGA, TGA, TTS, TTT, PTS, PTT, FLM, HOS,
--            ALT, BAT, CAB, ECU, MOT, PCB, PSU, REL, SEN, SOL, STR, SWI
--   Band C — fasteners / small hardware     (20–80): FIT
--            (no dedicated "fastener" functional group exists yet in
--            this catalogue beyond Fitting — everything else lands in
--            another band or the fallback)
--   Band D — lubricants & coolants           (4–20): applied whenever
--            spare_parts.cat = 'LC' (any functional group), AND
--            whenever fg IN ('OIL','COL') even outside category LC
--   Band E — wear parts                       (2–8): PST, VAL, BRG,
--            PRV, SOV, ROD, PIRO (valves and single per-cylinder wear
--            assemblies grouped with the piston/valve/bearing examples
--            you gave)
--   Band F — major components                 (0–3): CYL, CYLH, CRK,
--            BLK, CMK, FLYW, EXM
--   Band G — unmatched fallback               (2–10): CPL, FAN, PUL,
--            SHA, SEP (discrete mechanical parts that don't cleanly
--            fit A–F) and any functional group not listed above at all
-- ═══════════════════════════════════════════════════════════════

-- ─── PART A1. Rename the legacy catalogue-quantity column ─────
ALTER TABLE public.spare_parts RENAME COLUMN qty TO qty_per_assembly;

COMMENT ON COLUMN public.spare_parts.qty_per_assembly IS
  'Quantity used per assembly, from the manufacturer parts catalogue. NOT stock on hand.';

-- Deprecate the old stock_movements trigger — see ⚠ note above.
-- stock_movements the table is left untouched (historical data kept);
-- only its automatic mutation of a now-renamed column is removed.
DROP TRIGGER IF EXISTS stock_movement_apply ON public.stock_movements;
DROP FUNCTION IF EXISTS public.apply_stock_movement();

-- ─── PART A2. New columns ──────────────────────────────────────
ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS stock_source text NOT NULL DEFAULT 'none'
    CHECK (stock_source IN ('none','estimated','counted')),
  ADD COLUMN IF NOT EXISTS last_counted_at timestamptz;

COMMENT ON COLUMN public.spare_parts.stock_source IS
  'Provenance of qty_on_hand: none = never set, estimated = seeded from a catalogue-derived guess, counted = confirmed by a physical count.';

ALTER TABLE public.stock_transactions
  ADD COLUMN IF NOT EXISTS is_estimated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stock_transactions.is_estimated IS
  'True for the seeded opening_balance rows created by this migration''s estimator. False for every real receipt/issue/count correction.';

-- ─── PART A3. Seed deterministic ESTIMATED opening balances ───
-- Deterministic: derived from hashtext(code), not random() — re-running
-- this block produces identical numbers every time. Idempotent: skips
-- any part that already has an opening_balance transaction (of any
-- kind, estimated or not).
WITH fg_bands (fg_code, lo, hi) AS (
  VALUES
    -- Band A — consumables & seals
    ('GSK', 12, 60), ('RNG', 12, 60), ('SEA', 12, 60),
    -- Band B — filters, elements, small electrical items
    ('FIL', 6, 25), ('FLT', 6, 25), ('DRY', 6, 25), ('LGA', 6, 25),
    ('PGA', 6, 25), ('TGA', 6, 25), ('TTS', 6, 25), ('TTT', 6, 25),
    ('PTS', 6, 25), ('PTT', 6, 25), ('FLM', 6, 25), ('HOS', 6, 25),
    ('ALT', 6, 25), ('BAT', 6, 25), ('CAB', 6, 25), ('ECU', 6, 25),
    ('MOT', 6, 25), ('PCB', 6, 25), ('PSU', 6, 25), ('REL', 6, 25),
    ('SEN', 6, 25), ('SOL', 6, 25), ('STR', 6, 25), ('SWI', 6, 25),
    -- Band C — fasteners / small hardware
    ('FIT', 20, 80),
    -- Band D — lubricants & coolants (functional-group-level; the
    -- category-level override for cat = 'LC' is applied below)
    ('OIL', 4, 20), ('COL', 4, 20),
    -- Band E — wear parts
    ('PST', 2, 8), ('VAL', 2, 8), ('BRG', 2, 8), ('PRV', 2, 8),
    ('SOV', 2, 8), ('ROD', 2, 8), ('PIRO', 2, 8),
    -- Band F — major components
    ('CYL', 0, 3), ('CYLH', 0, 3), ('CRK', 0, 3), ('BLK', 0, 3),
    ('CMK', 0, 3), ('FLYW', 0, 3), ('EXM', 0, 3)
    -- CPL, FAN, PUL, SHA, SEP and anything else not listed above
    -- intentionally fall through to the (2,10) unmatched default below.
),
bounds AS (
  SELECT
    sp.id AS part_id,
    sp.code AS part_code,
    CASE WHEN sp.cat = 'LC' THEN 4    ELSE COALESCE(b.lo, 2)  END AS lo,
    CASE WHEN sp.cat = 'LC' THEN 20   ELSE COALESCE(b.hi, 10) END AS hi
  FROM public.spare_parts sp
  LEFT JOIN fg_bands b ON b.fg_code = sp.fg
  WHERE sp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.stock_transactions st
      WHERE st.part_id = sp.id AND st.txn_type = 'opening_balance'
    )
),
-- Band F (major components) can land on 0. stock_transactions requires
-- quantity > 0 (no zero-quantity movements), so a zero estimate marks
-- the part 'estimated' directly (qty_on_hand correctly stays 0) without
-- posting a meaningless zero-quantity ledger row.
sized AS (
  SELECT
    part_id,
    (lo + (abs(hashtext(part_code)::bigint) % (hi - lo + 1)))::numeric(12,3) AS est_qty
  FROM bounds
),
inserted AS (
  INSERT INTO public.stock_transactions (
    part_id, txn_type, quantity, notes, is_estimated, occurred_at, created_by
  )
  SELECT
    part_id,
    'opening_balance'::public.stock_txn_type,
    est_qty,
    'Estimated starting balance — not physically counted',
    true,
    now(),
    NULL
  FROM sized
  WHERE est_qty > 0
  RETURNING part_id
)
UPDATE public.spare_parts
SET stock_source = 'estimated'
WHERE id IN (SELECT part_id FROM sized);

-- ─── PART A4. post_physical_count() — estimate becomes real ───
CREATE OR REPLACE FUNCTION public.post_physical_count(
  p_part_id uuid, p_counted_qty numeric, p_location text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS public.stock_transactions
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cur_qty numeric(12,3);
  diff    numeric(12,3);
  new_txn public.stock_transactions;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'department_user') THEN
    RAISE EXCEPTION 'Not authorized to record a physical count';
  END IF;
  IF p_counted_qty < 0 THEN
    RAISE EXCEPTION 'Counted quantity cannot be negative';
  END IF;

  SELECT qty_on_hand INTO cur_qty FROM public.spare_parts WHERE id = p_part_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Part % not found', p_part_id;
  END IF;

  diff := p_counted_qty - cur_qty;

  IF diff <> 0 THEN
    INSERT INTO public.stock_transactions (
      part_id, txn_type, quantity, location_from, location_to,
      notes, is_estimated, occurred_at, created_by
    ) VALUES (
      p_part_id,
      CASE WHEN diff > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END,
      abs(diff),
      CASE WHEN diff < 0 THEN p_location END,
      CASE WHEN diff > 0 THEN p_location END,
      COALESCE(p_notes, 'Physical count correction'),
      false,
      now(),
      auth.uid()
    ) RETURNING * INTO new_txn;
  END IF;

  -- Confirming a count is information even when nothing changed.
  UPDATE public.spare_parts
  SET stock_source = 'counted', last_counted_at = now()
  WHERE id = p_part_id;

  RETURN new_txn;  -- NULL when diff = 0: "confirmed as-is", no transaction posted
END;
$$;

REVOKE ALL ON FUNCTION public.post_physical_count(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_physical_count(uuid, numeric, text, text) TO authenticated;

-- ─── PART A5. reset_estimated_balances() — admin escape hatch ─
-- NOTE: p_category_code (text, categories.code) — see ⚠ note above
-- for why this isn't p_category_id uuid.
CREATE OR REPLACE FUNCTION public.reset_estimated_balances(p_category_code text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  txn RECORD;
  voided_count integer := 0;
BEGIN
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may reset estimated balances';
  END IF;

  FOR txn IN
    SELECT st.id
    FROM public.stock_transactions st
    JOIN public.spare_parts sp ON sp.id = st.part_id
    WHERE st.txn_type = 'opening_balance'
      AND st.is_estimated = true
      AND st.is_void = false
      AND sp.stock_source = 'estimated'
      AND (p_category_code IS NULL OR sp.cat = p_category_code)
  LOOP
    PERFORM public.void_stock_transaction(txn.id, 'Reset by admin via reset_estimated_balances');
    voided_count := voided_count + 1;
  END LOOP;

  -- Never touches a part whose stock_source is already 'counted'.
  UPDATE public.spare_parts sp
  SET stock_source = 'none'
  WHERE sp.stock_source = 'estimated'
    AND (p_category_code IS NULL OR sp.cat = p_category_code)
    AND EXISTS (
      SELECT 1 FROM public.stock_transactions st
      WHERE st.part_id = sp.id AND st.txn_type = 'opening_balance'
        AND st.is_estimated = true AND st.is_void = true
    );

  RETURN voided_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_estimated_balances(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_estimated_balances(text) TO authenticated;

-- ─── PART A6. v_stock_confidence ───────────────────────────────
-- One row per (category, stock_source); a NULL cat row is the
-- "overall, all categories" total for that stock_source, produced by
-- the GROUPING SETS rollup — the UI sums/filters on that convention.
CREATE OR REPLACE VIEW public.v_stock_confidence AS
SELECT
  cat,
  stock_source,
  count(*) AS part_count
FROM public.spare_parts
WHERE deleted_at IS NULL
GROUP BY GROUPING SETS ((cat, stock_source), (stock_source))
ORDER BY cat NULLS FIRST, stock_source;

COMMENT ON VIEW public.v_stock_confidence IS
  'Parts counted per stock_source. Rows with cat IS NULL are the overall total for that stock_source across every category — drives the Stock Count page progress bar and the dashboard confidence tile.';

-- ─── PART A7. RLS ──────────────────────────────────────────────
-- stock_transactions RLS (select/insert) already covers rows this
-- migration inserts (opening_balance, adjustment_in/out) — no new
-- table-level policy needed. spare_parts.stock_source/last_counted_at
-- are columns on an already-RLS-covered table (migration 003). The
-- two new functions are gated by their own internal role checks
-- (above) plus REVOKE/GRANT, the same pattern as void_stock_transaction
-- in migration 001.

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out — uncomment and run to fully revert this
-- migration, in dependency order). Cleanly removes the seeded
-- estimated balances rather than leaving them behind as orphaned
-- catalogue rows.
-- ═══════════════════════════════════════════════════════════════
-- -- 1) Remove every seeded estimated opening_balance and its effect
-- DELETE FROM public.stock_transactions
--   WHERE txn_type = 'opening_balance' AND is_estimated = true;
-- UPDATE public.spare_parts SET stock_source = 'none', last_counted_at = NULL
--   WHERE stock_source IN ('estimated');
-- SELECT public.recalc_all_stock();  -- from migration 001; re-zeroes qty_on_hand for affected parts
--
-- -- 2) Drop the new functions/view
-- REVOKE ALL ON FUNCTION public.reset_estimated_balances(text) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.post_physical_count(uuid, numeric, text, text) FROM authenticated;
-- DROP FUNCTION IF EXISTS public.reset_estimated_balances(text);
-- DROP FUNCTION IF EXISTS public.post_physical_count(uuid, numeric, text, text);
-- DROP VIEW IF EXISTS public.v_stock_confidence;
--
-- -- 3) Drop the new columns
-- ALTER TABLE public.stock_transactions DROP COLUMN IF EXISTS is_estimated;
-- ALTER TABLE public.spare_parts DROP COLUMN IF EXISTS last_counted_at;
-- ALTER TABLE public.spare_parts DROP COLUMN IF EXISTS stock_source;
--
-- -- 4) Restore the OLD stock_movements trigger this migration dropped
-- --    (paste the exact apply_stock_movement() body from migration
-- --    010_stock_movements.sql here if you need it back — omitted so
-- --    this rollback doesn't silently resurrect a trigger pointed at
-- --    a column name that no longer exists).
--
-- -- 5) Rename the column back
-- ALTER TABLE public.spare_parts RENAME COLUMN qty_per_assembly TO qty;
