-- ═══════════════════════════════════════════════════════════════
-- 013_fix_post_physical_count_cast.sql
--
-- Bug fix found live on the Stock Count page: "Confirm" failed with
-- `column "txn_type" is of type stock_txn_type but expression is of
-- type text`. post_physical_count()'s
--   CASE WHEN diff > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END
-- resolves as plain text and Postgres does not implicitly cast text
-- into an enum column on INSERT. void_stock_transaction()'s equivalent
-- CASE already had the explicit `::public.stock_txn_type` cast — this
-- migration adds the same cast to post_physical_count(). No schema
-- change, no data affected; CREATE OR REPLACE FUNCTION only.
-- ═══════════════════════════════════════════════════════════════

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
      (CASE WHEN diff > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END)::public.stock_txn_type,
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

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK — restores the pre-fix (broken) version. Included for
-- completeness only; there is no reason to ever run this.
-- ═══════════════════════════════════════════════════════════════
-- CREATE OR REPLACE FUNCTION public.post_physical_count(
--   p_part_id uuid, p_counted_qty numeric, p_location text DEFAULT NULL, p_notes text DEFAULT NULL
-- ) RETURNS public.stock_transactions
-- LANGUAGE plpgsql SECURITY DEFINER AS $$
-- DECLARE
--   cur_qty numeric(12,3);
--   diff    numeric(12,3);
--   new_txn public.stock_transactions;
-- BEGIN
--   IF public.current_user_role() NOT IN ('admin', 'department_user') THEN
--     RAISE EXCEPTION 'Not authorized to record a physical count';
--   END IF;
--   IF p_counted_qty < 0 THEN
--     RAISE EXCEPTION 'Counted quantity cannot be negative';
--   END IF;
--   SELECT qty_on_hand INTO cur_qty FROM public.spare_parts WHERE id = p_part_id;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Part % not found', p_part_id; END IF;
--   diff := p_counted_qty - cur_qty;
--   IF diff <> 0 THEN
--     INSERT INTO public.stock_transactions (
--       part_id, txn_type, quantity, location_from, location_to,
--       notes, is_estimated, occurred_at, created_by
--     ) VALUES (
--       p_part_id,
--       CASE WHEN diff > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END,
--       abs(diff),
--       CASE WHEN diff < 0 THEN p_location END,
--       CASE WHEN diff > 0 THEN p_location END,
--       COALESCE(p_notes, 'Physical count correction'),
--       false, now(), auth.uid()
--     ) RETURNING * INTO new_txn;
--   END IF;
--   UPDATE public.spare_parts SET stock_source = 'counted', last_counted_at = now() WHERE id = p_part_id;
--   RETURN new_txn;
-- END;
-- $$;
