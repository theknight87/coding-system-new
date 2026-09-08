-- ═══════════════════════════════════════════════════════════════
-- 024_fix_void_double_count.sql
--
-- BUG (introduced in migration 011, found while testing 023):
-- voiding a transaction changed the balance by TWICE the intended
-- amount.
--
-- 011 combined two mutually exclusive correction models:
--   * recalc_part_stock() summed only rows WHERE is_void = false,
--     i.e. voiding a row removed its effect from the balance; and
--   * void_stock_transaction() ALSO posted an opposite-direction
--     reversing entry, which counted normally.
-- So a voided -3 issue both stopped subtracting 3 AND added 3 back:
-- a +6 swing where +3 was intended.
--
-- Measured on live data before this fix (2 affected parts):
--   CP-GA-G04-ME-PST-0133  cached 6  → correct 3
--   CP-GA-G04-ME-PST-0142  cached 10 → correct 7
--
-- FIX — keep the reversing entry (it is the audit trail, and 011's
-- stated design) and stop excluding voided rows from the maths. The
-- original and its reversal then cancel to exactly zero. is_void
-- remains meaningful for display ("this entry was cancelled") but no
-- longer changes any balance.
--
-- This inverts the claim in 011's comment on spare_parts.qty_on_hand
-- and in 014's v_stock_transactions_detail comment; both are
-- corrected here.
--
-- Section 4 recomputes every cached balance, repairing the two parts
-- above. Parts that never had a void are unaffected — their sum is
-- identical either way.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Cached balance: count every row ─────────────────────────
CREATE OR REPLACE FUNCTION public.recalc_part_stock(p_part_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.spare_parts
  SET qty_on_hand = COALESCE(
    (SELECT SUM(signed_qty) FROM public.stock_transactions WHERE part_id = p_part_id),
    0
  )
  WHERE id = p_part_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_all_stock()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.spare_parts sp
  SET qty_on_hand = COALESCE(t.total, 0)
  FROM (
    SELECT part_id, SUM(signed_qty) AS total
    FROM public.stock_transactions
    GROUP BY part_id
  ) t
  WHERE sp.id = t.part_id;

  UPDATE public.spare_parts
  SET qty_on_hand = 0
  WHERE qty_on_hand <> 0
    AND id NOT IN (SELECT DISTINCT part_id FROM public.stock_transactions);
END;
$$;

COMMENT ON COLUMN public.spare_parts.qty_on_hand IS
  'Cached running balance = SUM(signed_qty) over ALL stock_transactions for this part, voided rows included — a voided row is cancelled by its reversing entry, so excluding it as well would double-count the correction (see migration 024). Maintained only by recalc_part_stock() / recalc_all_stock() — never write this column directly.';

-- ─── 2. Running balance in the movements view ───────────────────
DROP VIEW IF EXISTS public.v_stock_transactions_detail;

CREATE VIEW public.v_stock_transactions_detail AS
SELECT
  st.id, st.part_id, st.txn_type, st.quantity, st.signed_qty,
  st.location_from, st.location_to, st.reference_no, st.unit_cost, st.currency,
  st.notes, st.occurred_at, st.created_at, st.created_by, st.is_void,
  st.reverses_txn_id, st.is_estimated,
  st.asset_id, st.maintenance_event_id,
  SUM(st.signed_qty)
    OVER (PARTITION BY st.part_id ORDER BY st.occurred_at, st.created_at, st.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_after,
  sp.code AS part_code, sp.short_desc AS part_short_desc,
  sp.cat, sp.mfr, sp.model, sp.unit AS part_unit,
  a.asset_tag, me.title AS maintenance_title,
  up.email AS user_email, up.full_name AS user_full_name
FROM public.stock_transactions st
JOIN public.spare_parts sp ON sp.id = st.part_id
LEFT JOIN public.assets a ON a.id = st.asset_id
LEFT JOIN public.maintenance_events me ON me.id = st.maintenance_event_id
LEFT JOIN public.user_profiles up ON up.id = st.created_by;

COMMENT ON VIEW public.v_stock_transactions_detail IS
  'Read-only, denormalized stock_transactions for the Stock Movements page, including the asset/maintenance event that generated the movement. balance_after is a running per-part sum of signed_qty over ALL rows — voided rows included, because each is cancelled by its own reversing entry (migration 024). SECURITY INVOKER — see migration 014 for the user_profiles RLS caveat.';

GRANT SELECT ON public.v_stock_transactions_detail TO authenticated;

-- ─── 3. The now-pointless partial index ─────────────────────────
-- Built for the "WHERE is_void = false" balance scan that no longer
-- exists. stock_transactions_part_occurred_idx (part_id, occurred_at)
-- already serves the per-part lookups.
DROP INDEX IF EXISTS public.stock_transactions_not_void_idx;

-- ─── 4. Repair every cached balance ─────────────────────────────
SELECT public.recalc_all_stock();

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
--
-- ⚠ Reverting reinstates the double-count. If you do revert, restore
-- migration 011's recalc_part_stock/recalc_all_stock bodies and 023's
-- view definition, then run SELECT public.recalc_all_stock(); again.
-- ═══════════════════════════════════════════════════════════════
-- CREATE INDEX IF NOT EXISTS stock_transactions_not_void_idx
--   ON public.stock_transactions (part_id) WHERE is_void = false;
