-- ═══════════════════════════════════════════════════════════════
-- Migration 010 — Stock Transaction Ledger
--
-- Adds an append-only stock movement ledger so a part's quantity on
-- hand (spare_parts.qty) is computed from movements (Receipt, Issue,
-- Consumption, Return, Transfer) instead of being typed in directly.
-- Quantity on hand is tracked as a single running balance per part
-- across all locations (no per-location balances).
--
-- spare_parts.qty is NOT removed — it stays as the fast-to-read
-- "current balance" column, but from this migration onward it must
-- only ever be changed by the apply_stock_movement() trigger below.
-- The application layer must stop writing to spare_parts.qty
-- directly (see FILES MODIFIED in the accompanying response).
--
-- A nullable asset_id column is included now (uuid, no FK yet) so
-- the future Asset Registry feature can link a Consumption/Issue
-- movement to the physical unit it was consumed on without another
-- migration having to alter this table.
-- ═══════════════════════════════════════════════════════════════

-- ─── STOCK MOVEMENTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id                BIGSERIAL PRIMARY KEY,
  part_code         TEXT NOT NULL REFERENCES public.spare_parts(code),
  transaction_type  TEXT NOT NULL CHECK (transaction_type IN ('RECEIPT','ISSUE','CONSUMPTION','RETURN','TRANSFER')),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  reference         TEXT NOT NULL DEFAULT '',   -- e.g. PO number, work order, transfer note
  notes             TEXT NOT NULL DEFAULT '',
  asset_id          UUID,                       -- reserved for the future Asset Registry (item 3); no FK yet
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id)
);

-- Ledger rows are immutable — no updated_at/deleted_at. A mistaken
-- entry is corrected with a compensating movement, never edited in place.

CREATE INDEX IF NOT EXISTS stock_movements_part_idx    ON public.stock_movements(part_code);
CREATE INDEX IF NOT EXISTS stock_movements_type_idx    ON public.stock_movements(transaction_type);
CREATE INDEX IF NOT EXISTS stock_movements_created_idx ON public.stock_movements(created_at DESC);

-- ─── TRIGGER: apply each movement to spare_parts.qty ──────────────
-- RECEIPT and RETURN add to stock; ISSUE and CONSUMPTION remove from
-- stock; TRANSFER (a location-to-location move) is logged for audit
-- purposes but does not change the total on-hand balance since qty
-- is tracked as a single running total across all locations.
-- Runs AFTER INSERT so a rejected movement (insufficient stock) rolls
-- back the whole insert, and locks the spare_parts row (FOR UPDATE)
-- so concurrent movements against the same part can't race.
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  delta   INTEGER;
  cur_qty INTEGER;
BEGIN
  delta := CASE NEW.transaction_type
             WHEN 'RECEIPT'     THEN NEW.quantity
             WHEN 'RETURN'      THEN NEW.quantity
             WHEN 'ISSUE'       THEN -NEW.quantity
             WHEN 'CONSUMPTION' THEN -NEW.quantity
             WHEN 'TRANSFER'    THEN 0
           END;

  SELECT qty INTO cur_qty FROM public.spare_parts WHERE code = NEW.part_code FOR UPDATE;

  IF cur_qty IS NULL THEN
    RAISE EXCEPTION 'Spare part % not found', NEW.part_code;
  END IF;

  IF cur_qty + delta < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for part %: on hand %, requested %', NEW.part_code, cur_qty, NEW.quantity;
  END IF;

  UPDATE public.spare_parts SET qty = cur_qty + delta WHERE code = NEW.part_code;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_movement_apply ON public.stock_movements;
CREATE TRIGGER stock_movement_apply
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

-- ─── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read the ledger (same visibility as
-- spare_parts itself — inventory movements aren't admin-only like
-- audit_logs).
CREATE POLICY "stock_movements_select" ON public.stock_movements FOR SELECT
  TO authenticated USING (TRUE);

-- Admin and Department User can both post movements, matching the
-- existing spare_parts_insert / spare_parts_update policies.
CREATE POLICY "stock_movements_insert" ON public.stock_movements FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('admin', 'department_user')
  );

-- No UPDATE or DELETE policy — the ledger is immutable, exactly like audit_logs.

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out — uncomment and run to fully revert this
-- migration; spare_parts.qty is left as whatever value the ledger
-- last computed it to be, since qty itself is not touched here)
-- ═══════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS stock_movement_apply ON public.stock_movements;
-- DROP FUNCTION IF EXISTS public.apply_stock_movement();
-- DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
-- DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;
-- DROP INDEX IF EXISTS public.stock_movements_part_idx;
-- DROP INDEX IF EXISTS public.stock_movements_type_idx;
-- DROP INDEX IF EXISTS public.stock_movements_created_idx;
-- DROP TABLE IF EXISTS public.stock_movements;
