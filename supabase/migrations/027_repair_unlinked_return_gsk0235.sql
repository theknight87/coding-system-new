-- ═══════════════════════════════════════════════════════════════
-- 027_repair_unlinked_return_gsk0235.sql
--
-- ONE-OFF DATA REPAIR (not a schema change).
--
-- CP-GA-G04-ME-GSK-0235 was issued 4 against maintenance event
-- 2b790b96-…, and 1 was later put back with a standalone
-- return_to_store entry that carried no reference and no
-- maintenance_event_id — recorded before migration 026 gave the UI a
-- way to link a return to the event it came from.
--
-- The stock balance is already correct (41 − 4 + 1 = 38); what is
-- wrong is the maintenance record, which still reports 4 consumed
-- because nothing ties the return to the issue.
--
-- The ledger is append-only (migration 011), so this does NOT edit
-- either row. It posts two new entries through post_stock_reversal():
--
--   1. Reverse the stray return in full  → adjustment_out 1  (−1),
--      marking that entry void.
--   2. Reverse 1 unit of the issue       → return_to_store 1  (+1),
--      inheriting the issue's reference_no and maintenance_event_id,
--      and leaving the issue live because 3 units still stand.
--
-- Net effect on stock: −1 + 1 = 0, so qty_on_hand stays 38.
-- Net effect on the record: v_maintenance_parts_used.net_qty for that
-- line goes 4 → 3.
--
-- created_by on the two new rows is NULL: this runs in the SQL editor,
-- where auth.uid() is null, and the immutability trigger forbids
-- setting it afterwards. The notes below identify the rows instead.
--
-- Safe to run only once — section 3 asserts the expected end state and
-- aborts the whole migration if anything does not match.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_part  uuid;
  v_issue uuid;
  v_stray uuid;
  v_bal   numeric;
  v_net   numeric;
BEGIN
  SELECT id INTO v_part FROM public.spare_parts WHERE code = 'CP-GA-G04-ME-GSK-0235';
  IF v_part IS NULL THEN
    RAISE EXCEPTION 'Part CP-GA-G04-ME-GSK-0235 not found — nothing to repair';
  END IF;

  -- ─── 1. Identify the two rows, defensively ───────────────────
  SELECT id INTO v_issue FROM public.stock_transactions
  WHERE part_id = v_part AND txn_type = 'issue' AND is_void = false
    AND maintenance_event_id IS NOT NULL;

  SELECT id INTO v_stray FROM public.stock_transactions
  WHERE part_id = v_part AND txn_type = 'return_to_store' AND is_void = false
    AND maintenance_event_id IS NULL AND reverses_txn_id IS NULL;

  IF v_issue IS NULL OR v_stray IS NULL THEN
    RAISE EXCEPTION 'Expected exactly one linked issue and one unlinked return; found issue=%, return=% — already repaired, or the data has changed. Aborting.', v_issue, v_stray;
  END IF;

  -- ─── 2. Post the two correcting entries ──────────────────────
  PERFORM public.post_stock_reversal(
    v_stray, NULL,
    'Data repair (migration 027): this return was recorded without a link to the maintenance event it came from. Reversed here and re-posted as a linked return.',
    true);

  PERFORM public.post_stock_reversal(
    v_issue, 1,
    'Data repair (migration 027): re-posting the 1 unit returned to store as a return linked to this maintenance event, so the record shows 3 consumed instead of 4.',
    false);

  PERFORM public.recalc_part_stock(v_part);

  -- ─── 3. Assert the end state ─────────────────────────────────
  SELECT qty_on_hand INTO v_bal FROM public.spare_parts WHERE id = v_part;
  IF v_bal <> 38 THEN
    RAISE EXCEPTION 'Repair changed the balance to % — expected it to stay 38. Rolled back.', v_bal;
  END IF;

  SELECT net_qty INTO v_net FROM public.v_maintenance_parts_used
  WHERE stock_transaction_id = v_issue;
  IF v_net <> 3 THEN
    RAISE EXCEPTION 'Maintenance line net quantity is % — expected 3. Rolled back.', v_net;
  END IF;

  RAISE NOTICE 'Repaired: balance still %, maintenance line now % consumed.', v_bal, v_net;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
--
-- The ledger is append-only, so undoing this means reversing the two
-- entries it posted, not deleting them — which restores the original
-- (wrong) maintenance figure of 4. There is no reason to do this.
-- ═══════════════════════════════════════════════════════════════
