-- ═══════════════════════════════════════════════════════════════
-- 026_partial_returns.sql
--
-- PROBLEM: issue 4 of a part on a maintenance event, use 3, return 1
-- — there was no way to record that. Cancelling a line was
-- all-or-nothing, and a return posted from Record Movement was a
-- standalone transaction with nothing tying it to the maintenance
-- record, so the event still claimed all 4 were consumed.
--
-- NOTE ON THE WORK ORDER IDEA: the link the request asks the work
-- order number to provide already exists — every maintenance-generated
-- movement carries maintenance_event_id (migration 023), which is a
-- stronger key than a text field anyone can retype. So the returns
-- below link on that. The sequential work order number is still added
-- (section 1) because it is genuinely useful as the human-readable
-- reference on paperwork and on the ledger, just not as the plumbing.
--
-- APPROACH: a return is NOT a void. Voiding says "this never
-- happened"; returning says "it happened, then some came back". Both
-- are now the same mechanic — post a counter-entry for N units — with
-- different labels and permissions:
--
--   post_stock_reversal()          the engine, any quantity up to what
--                                  is left un-reversed
--   void_stock_transaction()       admin, full or partial, marks the
--                                  original void when fully reversed
--   return_maintenance_part()      admin/department_user, partial
--                                  return tied to a maintenance line
--
-- The balance maths already handles partial reversals correctly since
-- migration 024 (every row counts): issue -4 plus return +1 = -3.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Sequential work order numbers ───────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.maintenance_wo_seq START 1001;

CREATE OR REPLACE FUNCTION public.next_work_order_no()
RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'WO-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.maintenance_wo_seq')::text, 4, '0');
$$;

CREATE OR REPLACE FUNCTION public.maintenance_event_set_wo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.work_order_no IS NULL OR btrim(NEW.work_order_no) = '' THEN
    NEW.work_order_no := public.next_work_order_no();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintenance_event_set_wo ON public.maintenance_events;
CREATE TRIGGER trg_maintenance_event_set_wo
  BEFORE INSERT ON public.maintenance_events
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_event_set_wo();

-- Existing events without one get a number too, so every record has a
-- reference. Ordered by date so the numbering follows history.
DO $backfill$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.maintenance_events
           WHERE work_order_no IS NULL OR btrim(work_order_no) = ''
           ORDER BY event_date, created_at
  LOOP
    UPDATE public.maintenance_events
    SET work_order_no = public.next_work_order_no()
    WHERE id = r.id;
  END LOOP;
END
$backfill$;

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_events_wo_unique
  ON public.maintenance_events (work_order_no) WHERE work_order_no IS NOT NULL;

-- ─── 2. The reversal engine (partial or full) ───────────────────
-- Not role-gated and not granted to authenticated — the wrappers
-- below are responsible for authorisation, same arrangement as
-- void_stock_txn_internal in migration 023.
CREATE OR REPLACE FUNCTION public.post_stock_reversal(
  p_txn_id    uuid,
  p_quantity  numeric DEFAULT NULL,   -- NULL = everything still un-reversed
  p_reason    text    DEFAULT NULL,
  p_mark_void boolean DEFAULT true    -- only applies to a full reversal
)
RETURNS public.stock_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  orig            public.stock_transactions;
  already         numeric;
  remaining       numeric;
  qty             numeric;
  reversing_type  public.stock_txn_type;
  new_txn         public.stock_transactions;
BEGIN
  SELECT * INTO orig FROM public.stock_transactions WHERE id = p_txn_id FOR UPDATE;
  IF orig.id IS NULL THEN
    RAISE EXCEPTION 'Stock transaction % not found', p_txn_id;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO already
  FROM public.stock_transactions
  WHERE reverses_txn_id = p_txn_id AND is_void = false;

  remaining := orig.quantity - already;
  IF remaining <= 0 THEN
    RETURN NULL;   -- nothing left to reverse; callers treat this as a no-op
  END IF;

  qty := COALESCE(p_quantity, remaining);
  IF qty <= 0 THEN
    RAISE EXCEPTION 'Quantity to reverse must be greater than zero';
  END IF;
  IF qty > remaining THEN
    RAISE EXCEPTION 'Only % of the original % remain un-reversed — cannot reverse %', remaining, orig.quantity, qty;
  END IF;

  reversing_type := CASE orig.txn_type
    WHEN 'opening_balance'  THEN 'adjustment_out'
    WHEN 'receipt'          THEN 'adjustment_out'
    WHEN 'return_to_store'  THEN 'adjustment_out'
    WHEN 'adjustment_in'    THEN 'adjustment_out'
    WHEN 'transfer_in'      THEN 'transfer_out'
    WHEN 'issue'            THEN 'return_to_store'
    WHEN 'adjustment_out'   THEN 'adjustment_in'
    WHEN 'transfer_out'     THEN 'transfer_in'
    WHEN 'scrap'            THEN 'adjustment_in'
  END::public.stock_txn_type;

  INSERT INTO public.stock_transactions (
    part_id, txn_type, quantity, location_from, location_to,
    reference_no, unit_cost, currency, notes, occurred_at, created_by, reverses_txn_id,
    asset_id, maintenance_event_id
  ) VALUES (
    orig.part_id, reversing_type, qty,
    orig.location_to, orig.location_from,
    orig.reference_no, orig.unit_cost, orig.currency,
    COALESCE(p_reason, 'Reversal of transaction ' || orig.id::text),
    now(), auth.uid(), orig.id,
    orig.asset_id, orig.maintenance_event_id
  ) RETURNING * INTO new_txn;

  -- Only a reversal that consumes the whole remainder retires the
  -- original. A partial one leaves it live, because part of it still
  -- stands.
  IF p_mark_void AND qty = remaining AND orig.is_void = false THEN
    UPDATE public.stock_transactions SET is_void = true WHERE id = p_txn_id;
  END IF;

  RETURN new_txn;
END;
$$;

REVOKE ALL ON FUNCTION public.post_stock_reversal(uuid, numeric, text, boolean) FROM PUBLIC;

COMMENT ON FUNCTION public.post_stock_reversal(uuid, numeric, text, boolean) IS
  'Posts a counter-entry against a transaction for any quantity up to what is still un-reversed. Returns NULL when nothing is left. NOT role-gated — callers authorise.';

-- Full reversal, keeping the old idempotent contract for the
-- maintenance triggers from migration 023.
CREATE OR REPLACE FUNCTION public.void_stock_txn_internal(p_txn_id uuid, p_reason text DEFAULT NULL)
RETURNS public.stock_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.post_stock_reversal(p_txn_id, NULL, p_reason, true);
END;
$$;

-- ─── 3. Void, now with an optional quantity ─────────────────────
-- Replaces the 2-argument version; p_quantity defaults to NULL (full
-- void), so existing callers are unaffected.
DROP FUNCTION IF EXISTS public.void_stock_transaction(uuid, text);

CREATE OR REPLACE FUNCTION public.void_stock_transaction(
  p_txn_id   uuid,
  p_reason   text    DEFAULT NULL,
  p_quantity numeric DEFAULT NULL
)
RETURNS public.stock_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_txn public.stock_transactions;
BEGIN
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may void a stock transaction';
  END IF;

  new_txn := public.post_stock_reversal(p_txn_id, p_quantity, p_reason, true);
  IF new_txn.id IS NULL THEN
    RAISE EXCEPTION 'Stock transaction % is already fully reversed', p_txn_id;
  END IF;
  RETURN new_txn;
END;
$$;

REVOKE ALL ON FUNCTION public.void_stock_transaction(uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_stock_transaction(uuid, text, numeric) TO authenticated;

-- ─── 4. Return part of a maintenance line ───────────────────────
-- admin OR department_user: both can already post a return_to_store
-- by hand from Record Movement, so this only adds the link back to
-- the maintenance record — it grants no new power over stock.
CREATE OR REPLACE FUNCTION public.return_maintenance_part(
  p_line_id  uuid,
  p_quantity numeric,
  p_reason   text DEFAULT NULL
)
RETURNS public.stock_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_txn  uuid;
  v_wo   text;
  result public.stock_transactions;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'department_user') THEN
    RAISE EXCEPTION 'You do not have permission to return parts';
  END IF;

  SELECT mpu.stock_transaction_id, me.work_order_no INTO v_txn, v_wo
  FROM public.maintenance_parts_used mpu
  JOIN public.maintenance_events me ON me.id = mpu.maintenance_event_id
  WHERE mpu.id = p_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maintenance part line % not found', p_line_id;
  END IF;
  IF v_txn IS NULL THEN
    RAISE EXCEPTION 'This part line never issued stock, so there is nothing to return';
  END IF;

  result := public.post_stock_reversal(
    v_txn, p_quantity,
    COALESCE(p_reason, 'Returned to store from ' || COALESCE(v_wo, 'maintenance')),
    true
  );

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'The whole issued quantity has already been returned';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.return_maintenance_part(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_maintenance_part(uuid, numeric, text) TO authenticated;

-- ─── 5. Per-line issued / returned / net ────────────────────────
CREATE OR REPLACE VIEW public.v_maintenance_parts_used AS
SELECT
  mpu.id, mpu.maintenance_event_id, mpu.part_id, mpu.unit_cost, mpu.notes,
  mpu.created_at, mpu.stock_transaction_id,
  mpu.quantity                                   AS issued_qty,
  COALESCE(r.returned, 0)                        AS returned_qty,
  mpu.quantity - COALESCE(r.returned, 0)         AS net_qty,
  COALESCE(st.is_void, false)                    AS is_cancelled,
  sp.code AS part_code, sp.short_desc AS part_short_desc, sp.fg AS part_fg
FROM public.maintenance_parts_used mpu
JOIN public.spare_parts sp ON sp.id = mpu.part_id
LEFT JOIN public.stock_transactions st ON st.id = mpu.stock_transaction_id
LEFT JOIN LATERAL (
  SELECT SUM(rt.quantity) AS returned
  FROM public.stock_transactions rt
  WHERE rt.reverses_txn_id = mpu.stock_transaction_id AND rt.is_void = false
) r ON true;

COMMENT ON VIEW public.v_maintenance_parts_used IS
  'Maintenance part lines with how much was issued, how much has come back, and the net actually consumed. is_cancelled means the whole line was reversed (net_qty is then 0).';

GRANT SELECT ON public.v_maintenance_parts_used TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
--
-- ⚠ Restore migration 023's 2-argument void_stock_transaction and its
-- standalone void_stock_txn_internal body before dropping these.
-- ═══════════════════════════════════════════════════════════════
-- DROP VIEW IF EXISTS public.v_maintenance_parts_used;
-- DROP FUNCTION IF EXISTS public.return_maintenance_part(uuid, numeric, text);
-- DROP FUNCTION IF EXISTS public.void_stock_transaction(uuid, text, numeric);
-- DROP FUNCTION IF EXISTS public.post_stock_reversal(uuid, numeric, text, boolean);
-- DROP TRIGGER IF EXISTS trg_maintenance_event_set_wo ON public.maintenance_events;
-- DROP FUNCTION IF EXISTS public.maintenance_event_set_wo();
-- DROP FUNCTION IF EXISTS public.next_work_order_no();
-- DROP INDEX IF EXISTS public.maintenance_events_wo_unique;
-- DROP SEQUENCE IF EXISTS public.maintenance_wo_seq;
