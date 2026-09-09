-- ═══════════════════════════════════════════════════════════════
-- 036_sequence_and_integrity.sql
--
-- Review findings M1, M5 and M3.
--
-- ─── M1: part-code sequence could suggest a duplicate ────────────
--
-- CodeGeneratorPage computed the next sequence number client-side from
-- db.fetchParts({ search: prefix }, 0, 200) — the first 200 rows,
-- ordered by created_at DESC, which has no relationship to sequence
-- order. Seven prefixes already exceed 200 parts (largest 927), so the
-- max was taken over an arbitrary subset.
--
-- It is not currently misfiring: the seed import created parts in code
-- order, so newest happens to mean highest, and all seven prefixes
-- were measured with a shortfall of 0. That coincidence is the only
-- thing holding it up — a CSV import of low-numbered parts into a big
-- prefix breaks it. insertPart() catches the duplicate, so it fails
-- safe, but the user is left stuck on a "code already exists" error.
--
-- next_part_sequence() computes the maximum server-side over the whole
-- prefix, under the same advisory lock next_asset_tag() uses. The
-- prefix match is anchored with LIKE 'PREFIX-%' rather than the old
-- ILIKE '%prefix%' across five columns, which could also pull in an
-- unrelated part whose part_no or location happened to contain the
-- string.
--
-- ─── M5: a maintenance line with no stock movement ───────────────
--
-- One row predates the posting trigger from migration 023: 2 units of
-- CP-GA-G04-ME-PST-0142 on WO-1001, counted as consumed by the
-- maintenance record and by the reliability views, but never deducted
-- from stock. Section 2 posts the missing issue for exactly that row
-- and links it, then adds a trigger so a line can never again be left
-- without one.
--
-- ─── M3: trashing a part that still holds stock ──────────────────
--
-- softDeletePart() had no guard, so a part with 38 on hand could be
-- trashed: the ledger keeps the balance but the part vanishes from
-- every stock report and alert, with no write-off entry to explain
-- where the value went. Section 3 refuses it and names the quantity.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Server-side part sequence ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_part_sequence(
  p_cat text, p_mfr text, p_model text, p_disc text, p_fg text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_next   int;
BEGIN
  v_prefix := p_cat || '-' || p_mfr || '-' || p_model || '-' || p_disc || '-' || p_fg;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_prefix, 0));

  -- Anchored prefix match, and only the trailing numeric segment.
  -- Includes soft-deleted parts on purpose: their codes are still
  -- taken (insertPart restores rather than duplicates them), so
  -- skipping them would hand out a colliding number.
  SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^.*-', ''), '')::int), 0) + 1
    INTO v_next
    FROM public.spare_parts
   WHERE code LIKE v_prefix || '-%'
     AND code ~ ('^' || v_prefix || '-[0-9]+$');

  RETURN lpad(v_next::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_part_sequence(text,text,text,text,text) IS
  'Next 4-digit sequence for a full part-code prefix, computed over every matching part rather than a client-side page (migration 036). Mirrors next_asset_tag: the advisory lock protects the read, so generate and insert in the same flow.';

REVOKE ALL ON FUNCTION public.next_part_sequence(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_part_sequence(text,text,text,text,text) TO authenticated;

-- ─── 2. Repair the orphan line, then make it impossible ───────────
DO $$
DECLARE
  r      record;
  v_txn  uuid;
  v_qty  numeric;
BEGIN
  FOR r IN
    SELECT mpu.id, mpu.part_id, mpu.quantity, me.event_date, me.id AS event_id,
           me.asset_id, me.work_order_no
    FROM public.maintenance_parts_used mpu
    JOIN public.maintenance_events me ON me.id = mpu.maintenance_event_id
    WHERE mpu.stock_transaction_id IS NULL
      AND me.deleted_at IS NULL
  LOOP
    INSERT INTO public.stock_transactions
      (part_id, txn_type, quantity, occurred_at, reference_no, notes,
       asset_id, maintenance_event_id)
    VALUES
      (r.part_id, 'issue', r.quantity, r.event_date,
       COALESCE(r.work_order_no, 'MNT-' || r.event_id::text),
       'Backfilled by migration 036: this maintenance line was recorded before the stock-posting trigger existed (023) and never deducted its parts.',
       r.asset_id, r.event_id)
    RETURNING id INTO v_txn;

    UPDATE public.maintenance_parts_used
       SET stock_transaction_id = v_txn
     WHERE id = r.id;

    RAISE NOTICE 'Backfilled issue for maintenance line %', r.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.maintenance_parts_require_txn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stock_transaction_id IS NULL THEN
    RAISE EXCEPTION
      'A maintenance part line must post a stock movement. Insert through log_maintenance_event() or let the posting trigger run — never write this row with a NULL stock_transaction_id.'
      USING ERRCODE = 'not_null_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER, so it observes what the BEFORE INSERT posting trigger from
-- migration 023 actually set rather than racing it.
DROP TRIGGER IF EXISTS trg_maintenance_parts_require_txn ON public.maintenance_parts_used;
CREATE CONSTRAINT TRIGGER trg_maintenance_parts_require_txn
  AFTER INSERT ON public.maintenance_parts_used
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_parts_require_txn();

-- ─── 3. Refuse to trash a part that still holds stock ─────────────
CREATE OR REPLACE FUNCTION public.spare_parts_block_delete_with_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
     AND COALESCE(NEW.qty_on_hand, 0) <> 0 THEN
    RAISE EXCEPTION
      'Cannot move % to Trash while it still holds % in stock. Write the stock off first (Stock Movements -> adjustment), so the ledger records where it went.',
      NEW.code, NEW.qty_on_hand
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spare_parts_block_delete_with_stock ON public.spare_parts;
CREATE TRIGGER trg_spare_parts_block_delete_with_stock
  BEFORE UPDATE ON public.spare_parts
  FOR EACH ROW EXECUTE FUNCTION public.spare_parts_block_delete_with_stock();

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS trg_spare_parts_block_delete_with_stock ON public.spare_parts;
-- DROP FUNCTION IF EXISTS public.spare_parts_block_delete_with_stock();
-- DROP TRIGGER IF EXISTS trg_maintenance_parts_require_txn ON public.maintenance_parts_used;
-- DROP FUNCTION IF EXISTS public.maintenance_parts_require_txn();
-- DROP FUNCTION IF EXISTS public.next_part_sequence(text,text,text,text,text);
