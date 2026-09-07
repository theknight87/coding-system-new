-- ═══════════════════════════════════════════════════════════════
-- 011_stock_transactions.sql
--
-- RESOLVED (see migration 012_opening_balances.sql): the old
-- stock_movements ledger from migration 010 is deprecated there — its
-- trigger is dropped and spare_parts.qty is renamed to
-- qty_per_assembly (pure catalogue data). qty_on_hand, maintained by
-- this migration's stock_transactions ledger, is the one real
-- "quantity on hand" going forward.
--
-- ⚠ SCHEMA PREREQUISITE: spare_parts has no uuid `id` column in this
-- repo — its primary key is `code TEXT`. This migration ADDS a uuid
-- `id` column to spare_parts (backfilled, unique) so that
-- stock_transactions.part_id can be the uuid FK you specified. If you
-- intended part_id to reference spare_parts.code instead, this file
-- needs a different FK type — as written it takes your column list
-- literally and adds what's missing to make it true.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds spare_parts.id (uuid, backfilled, unique) and
--      spare_parts.qty_on_hand (cached running balance).
--   2. Creates the stock_txn_type enum and the immutable, append-only
--      stock_transactions ledger table with a generated signed_qty
--      column (direction derived from txn_type, never user-entered).
--   3. Blocks UPDATE/DELETE on stock_transactions except flipping
--      is_void false → true; corrections are reversing entries, never
--      edits.
--   4. Adds void_stock_transaction(), an admin-only RPC that voids a
--      transaction and posts the opposite-direction reversing entry.
--   5. Adds recalc_part_stock()/recalc_all_stock() to (re)compute
--      spare_parts.qty_on_hand from non-void transactions, wired to
--      fire automatically on every insert/void.
--   6. Adds v_negative_stock, a view of parts whose cached balance has
--      gone below zero (allowed, not blocked — flagged for cleanup).
--   7. RLS: any authenticated user can read; admin or department_user
--      can insert (this app's two existing roles — see
--      current_user_role() from migration 003); nobody can UPDATE or
--      DELETE; only admins can call void_stock_transaction.
--   8. Audits every post and void into the existing audit_logs table.
--
-- PREREQUISITES: migrations 001 (spare_parts, audit_logs, pgcrypto),
-- 003 (public.current_user_role()) must already be applied.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. spare_parts: add the uuid id FK target + cached balance ──
ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.spare_parts
  ADD CONSTRAINT spare_parts_id_unique UNIQUE (id);

ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS qty_on_hand numeric(12,3) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.spare_parts.id IS
  'Surrogate uuid key added for stock_transactions.part_id. The 6-segment code column remains the natural primary key.';
COMMENT ON COLUMN public.spare_parts.qty_on_hand IS
  'Cached running balance = SUM(signed_qty) over non-void stock_transactions for this part. Maintained only by recalc_part_stock() / recalc_all_stock() — never write this column directly.';

-- ─── 2. Transaction type enum ─────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.stock_txn_type AS ENUM (
    'opening_balance', 'receipt', 'issue', 'return_to_store',
    'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out', 'scrap'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. stock_transactions — the immutable ledger ─────────────
CREATE TABLE IF NOT EXISTS public.stock_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id           uuid NOT NULL REFERENCES public.spare_parts(id) ON DELETE RESTRICT,
  txn_type          public.stock_txn_type NOT NULL,
  quantity          numeric(12,3) NOT NULL CHECK (quantity > 0),
  -- Direction is derived from txn_type, never entered by the user.
  signed_qty        numeric(12,3) GENERATED ALWAYS AS (
                      quantity * CASE txn_type
                        WHEN 'opening_balance'  THEN  1
                        WHEN 'receipt'          THEN  1
                        WHEN 'return_to_store'  THEN  1
                        WHEN 'adjustment_in'    THEN  1
                        WHEN 'transfer_in'      THEN  1
                        WHEN 'issue'            THEN -1
                        WHEN 'adjustment_out'   THEN -1
                        WHEN 'transfer_out'     THEN -1
                        WHEN 'scrap'            THEN -1
                      END
                    ) STORED,
  location_from     text,
  location_to       text,
  reference_no      text,        -- PO number, work order number, delivery note
  unit_cost         numeric(14,4),
  currency          text NOT NULL DEFAULT 'EGP',
  notes             text,
  occurred_at       timestamptz NOT NULL DEFAULT now(),  -- when it physically happened
  created_at        timestamptz NOT NULL DEFAULT now(),  -- when it was recorded
  created_by        uuid REFERENCES auth.users(id),
  is_void           boolean NOT NULL DEFAULT false,
  reverses_txn_id   uuid REFERENCES public.stock_transactions(id)
);

COMMENT ON TABLE public.stock_transactions IS
  'Append-only stock movement ledger. Rows are immutable except for flipping is_void; corrections are posted as new reversing entries via void_stock_transaction(). spare_parts.qty_on_hand is a cache derived from this table — this table is the source of truth.';

-- ─── 4. Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS stock_transactions_part_occurred_idx
  ON public.stock_transactions (part_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS stock_transactions_type_idx
  ON public.stock_transactions (txn_type);
CREATE INDEX IF NOT EXISTS stock_transactions_occurred_idx
  ON public.stock_transactions (occurred_at DESC);
CREATE INDEX IF NOT EXISTS stock_transactions_reference_idx
  ON public.stock_transactions (reference_no);
CREATE INDEX IF NOT EXISTS stock_transactions_not_void_idx
  ON public.stock_transactions (part_id) WHERE is_void = false;

-- ─── 5. Immutability trigger ───────────────────────────────────
-- Blocks every UPDATE/DELETE except a same-row change that only
-- flips is_void from false to true (i.e. voiding). Every other
-- column is compared old-vs-new; any other difference is rejected.
CREATE OR REPLACE FUNCTION public.stock_transactions_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock_transactions rows are immutable (id=%) — delete is not permitted. Post a reversing transaction instead.', OLD.id;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.is_void = false AND NEW.is_void = true
     AND NEW.id               = OLD.id
     AND NEW.part_id          = OLD.part_id
     AND NEW.txn_type         = OLD.txn_type
     AND NEW.quantity         = OLD.quantity
     AND NEW.location_from    IS NOT DISTINCT FROM OLD.location_from
     AND NEW.location_to      IS NOT DISTINCT FROM OLD.location_to
     AND NEW.reference_no     IS NOT DISTINCT FROM OLD.reference_no
     AND NEW.unit_cost        IS NOT DISTINCT FROM OLD.unit_cost
     AND NEW.currency         = OLD.currency
     AND NEW.notes            IS NOT DISTINCT FROM OLD.notes
     AND NEW.occurred_at      = OLD.occurred_at
     AND NEW.created_at       = OLD.created_at
     AND NEW.created_by       IS NOT DISTINCT FROM OLD.created_by
     AND NEW.reverses_txn_id  IS NOT DISTINCT FROM OLD.reverses_txn_id
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'stock_transactions rows are immutable except for voiding (id=%). Post a reversing transaction instead of editing history.', OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_transactions_immutable ON public.stock_transactions;
CREATE TRIGGER trg_stock_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.stock_transactions
  FOR EACH ROW EXECUTE FUNCTION public.stock_transactions_block_mutation();

-- ─── 6. Cached balance maintenance ─────────────────────────────
CREATE OR REPLACE FUNCTION public.recalc_part_stock(p_part_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.spare_parts
  SET qty_on_hand = COALESCE(
    (SELECT SUM(signed_qty) FROM public.stock_transactions
      WHERE part_id = p_part_id AND is_void = false),
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
    WHERE is_void = false
    GROUP BY part_id
  ) t
  WHERE sp.id = t.part_id;

  -- Parts with no (non-void) transactions at all reset to zero.
  UPDATE public.spare_parts
  SET qty_on_hand = 0
  WHERE qty_on_hand <> 0
    AND id NOT IN (
      SELECT DISTINCT part_id FROM public.stock_transactions WHERE is_void = false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.stock_transactions_recalc_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.recalc_part_stock(NEW.part_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_transactions_recalc ON public.stock_transactions;
CREATE TRIGGER trg_stock_transactions_recalc
  AFTER INSERT OR UPDATE ON public.stock_transactions
  FOR EACH ROW EXECUTE FUNCTION public.stock_transactions_recalc_trigger();

-- ─── 7. Negative-stock visibility (allowed, not blocked) ──────
CREATE OR REPLACE VIEW public.v_negative_stock AS
SELECT sp.id AS part_id, sp.code, sp.short_desc, sp.qty_on_hand
FROM public.spare_parts sp
WHERE sp.deleted_at IS NULL
  AND sp.qty_on_hand < 0
ORDER BY sp.qty_on_hand ASC;

COMMENT ON VIEW public.v_negative_stock IS
  'Parts whose cached qty_on_hand has gone below zero. Negative stock is allowed (unrecorded receipts happen) — this view is the worklist for finding and fixing the underlying data problem.';

-- ─── 8. Audit logging ──────────────────────────────────────────
-- Widen the existing audit_logs action check (same pattern as
-- migration 009's RESTORE/PURGE/PURGE_ALL) to allow VOID.
-- NOTE: the live constraint (checked directly) already includes 'INSERT' —
-- an out-of-band change not present in any committed migration file
-- (migrations 001/009 only list CREATE/UPDATE/DELETE/…). Preserved here
-- rather than silently dropped, since 5 existing audit_logs rows use it.
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN ('CREATE','INSERT','UPDATE','DELETE','LOGIN','LOGOUT','UPLOAD','EXPORT','RESTORE','PURGE','PURGE_ALL','VOID'));

CREATE OR REPLACE FUNCTION public.stock_transactions_audit_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (action, table_name, record_id, old_values, new_values, user_id)
    VALUES ('CREATE', 'stock_transactions', NEW.id::text, NULL, row_to_json(NEW)::jsonb, auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_void = false AND NEW.is_void = true THEN
    INSERT INTO public.audit_logs (action, table_name, record_id, old_values, new_values, user_id)
    VALUES ('VOID', 'stock_transactions', NEW.id::text, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, auth.uid());
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_transactions_audit ON public.stock_transactions;
CREATE TRIGGER trg_stock_transactions_audit
  AFTER INSERT OR UPDATE ON public.stock_transactions
  FOR EACH ROW EXECUTE FUNCTION public.stock_transactions_audit_fn();

-- ─── 9. void_stock_transaction() — admin-only RPC ─────────────
-- Marks the original void (the immutability trigger permits exactly
-- this change) and posts the opposite-direction reversing entry,
-- linked back through reverses_txn_id. SECURITY DEFINER so it can
-- perform the voiding UPDATE and the INSERT despite there being no
-- general UPDATE policy on the table; the admin check below is what
-- actually gates who may call it (RLS is bypassed by definition for
-- a SECURITY DEFINER function's own body).
CREATE OR REPLACE FUNCTION public.void_stock_transaction(p_txn_id uuid, p_reason text DEFAULT NULL)
RETURNS public.stock_transactions
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  orig            public.stock_transactions;
  reversing_type  public.stock_txn_type;
  new_txn         public.stock_transactions;
BEGIN
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins may void a stock transaction';
  END IF;

  SELECT * INTO orig FROM public.stock_transactions WHERE id = p_txn_id FOR UPDATE;
  IF orig.id IS NULL THEN
    RAISE EXCEPTION 'Stock transaction % not found', p_txn_id;
  END IF;
  IF orig.is_void THEN
    RAISE EXCEPTION 'Stock transaction % is already void', p_txn_id;
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

  UPDATE public.stock_transactions SET is_void = true WHERE id = p_txn_id;

  INSERT INTO public.stock_transactions (
    part_id, txn_type, quantity, location_from, location_to,
    reference_no, unit_cost, currency, notes, occurred_at, created_by, reverses_txn_id
  ) VALUES (
    orig.part_id, reversing_type, orig.quantity,
    orig.location_to, orig.location_from,   -- swapped: a reversal runs the movement backwards
    orig.reference_no, orig.unit_cost, orig.currency,
    COALESCE(p_reason, 'Reversal of transaction ' || orig.id::text),
    now(), auth.uid(), orig.id
  ) RETURNING * INTO new_txn;

  RETURN new_txn;
END;
$$;

REVOKE ALL ON FUNCTION public.void_stock_transaction(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_stock_transaction(uuid, text) TO authenticated;

-- ─── 10. RLS ───────────────────────────────────────────────────
ALTER TABLE public.stock_transactions ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read the ledger.
CREATE POLICY "stock_transactions_select" ON public.stock_transactions FOR SELECT
  TO authenticated USING (true);

-- This app has two roles (see public.current_user_role(), migration
-- 003): 'admin' and 'department_user'. Both already have write access
-- to spare_parts itself, so both map to the "write/editor" role here.
CREATE POLICY "stock_transactions_insert" ON public.stock_transactions FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('admin', 'department_user')
  );

-- No UPDATE or DELETE policy for anyone — the only sanctioned mutation
-- (voiding) happens exclusively through the admin-gated, SECURITY
-- DEFINER void_stock_transaction() RPC above; the immutability
-- trigger is the second, independent line of defense against a
-- direct UPDATE/DELETE even from within that function.

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out — uncomment and run to fully revert this
-- migration, in dependency order)
-- ═══════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS trg_stock_transactions_audit ON public.stock_transactions;
-- DROP TRIGGER IF EXISTS trg_stock_transactions_recalc ON public.stock_transactions;
-- DROP TRIGGER IF EXISTS trg_stock_transactions_immutable ON public.stock_transactions;
-- DROP FUNCTION IF EXISTS public.void_stock_transaction(uuid, text);
-- DROP FUNCTION IF EXISTS public.stock_transactions_audit_fn();
-- DROP FUNCTION IF EXISTS public.stock_transactions_recalc_trigger();
-- DROP FUNCTION IF EXISTS public.stock_transactions_block_mutation();
-- DROP FUNCTION IF EXISTS public.recalc_all_stock();
-- DROP FUNCTION IF EXISTS public.recalc_part_stock(uuid);
-- DROP VIEW IF EXISTS public.v_negative_stock;
-- DROP POLICY IF EXISTS "stock_transactions_select" ON public.stock_transactions;
-- DROP POLICY IF EXISTS "stock_transactions_insert" ON public.stock_transactions;
-- DROP TABLE IF EXISTS public.stock_transactions;
-- DROP TYPE IF EXISTS public.stock_txn_type;
-- ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
-- ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check
--   CHECK (action IN ('CREATE','INSERT','UPDATE','DELETE','LOGIN','LOGOUT','UPLOAD','EXPORT','RESTORE','PURGE','PURGE_ALL'));
-- ALTER TABLE public.spare_parts DROP COLUMN IF EXISTS qty_on_hand;
-- ALTER TABLE public.spare_parts DROP CONSTRAINT IF EXISTS spare_parts_id_unique;
-- ALTER TABLE public.spare_parts DROP COLUMN IF EXISTS id;
