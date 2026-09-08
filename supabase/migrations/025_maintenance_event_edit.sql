-- ═══════════════════════════════════════════════════════════════
-- 025_maintenance_event_edit.sql
--
-- Makes maintenance records correctable without breaking the ledger:
--
--   1. A guard so the fields the posted stock movements were built
--      from (event_date, asset_id) cannot drift once stock exists,
--      while the descriptive fields stay freely editable.
--
--   2. cancel_maintenance_part() — cancels a part line by voiding its
--      stock movement WITHOUT deleting the line, so the maintenance
--      record still shows that the part was logged and then cancelled.
--      Deleting the line (the existing AFTER DELETE trigger from 023)
--      also reverses the stock, but leaves no trace in the record;
--      this is the visible alternative.
--
-- No new columns: a part line is "cancelled" exactly when its linked
-- stock_transaction is void. That is already the source of truth, and
-- it also means a line voided from the Stock Movements page shows as
-- cancelled in the maintenance record automatically.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Keep event_date / asset_id in step with the ledger ──────
CREATE OR REPLACE FUNCTION public.maintenance_event_block_desync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_posted boolean;
BEGIN
  IF NEW.event_date IS DISTINCT FROM OLD.event_date
     OR NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN

    SELECT EXISTS (
      SELECT 1 FROM public.maintenance_parts_used mpu
      JOIN public.stock_transactions st ON st.id = mpu.stock_transaction_id
      WHERE mpu.maintenance_event_id = OLD.id AND st.is_void = false
    ) INTO has_posted;

    IF has_posted THEN
      RAISE EXCEPTION 'This event has already issued parts from stock. Its date and asset are locked because the stock movements were posted against them — cancel the part lines first if you need to change either.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintenance_event_block_desync ON public.maintenance_events;
CREATE TRIGGER trg_maintenance_event_block_desync
  BEFORE UPDATE ON public.maintenance_events
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_event_block_desync();

-- ─── 2. Cancel one part line, keeping it visible ────────────────
-- Admin-gated, matching the existing maintenance_parts_used DELETE
-- policy (migration 020) — cancelling and deleting have the same
-- effect on stock, so they get the same permission. Say the word if
-- department_user should be able to correct their own lines too.
CREATE OR REPLACE FUNCTION public.cancel_maintenance_part(p_line_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_txn uuid;
BEGIN
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may cancel a logged part';
  END IF;

  SELECT stock_transaction_id INTO v_txn
  FROM public.maintenance_parts_used WHERE id = p_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maintenance part line % not found', p_line_id;
  END IF;
  IF v_txn IS NULL THEN
    RAISE EXCEPTION 'This part line never posted a stock movement, so there is nothing to cancel — delete the line instead';
  END IF;

  -- Returns NULL (no error) if it was already void, so re-cancelling
  -- is harmless.
  PERFORM public.void_stock_txn_internal(v_txn, COALESCE(p_reason, 'Part line cancelled on the maintenance record'));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_maintenance_part(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_maintenance_part(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_maintenance_part(uuid, text) IS
  'Voids the stock movement a maintenance part line posted, keeping the line itself so the record shows the part was logged and then cancelled. A line is "cancelled" exactly when its linked stock_transaction is void.';

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP FUNCTION IF EXISTS public.cancel_maintenance_part(uuid, text);
-- DROP TRIGGER IF EXISTS trg_maintenance_event_block_desync ON public.maintenance_events;
-- DROP FUNCTION IF EXISTS public.maintenance_event_block_desync();
