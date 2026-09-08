-- ═══════════════════════════════════════════════════════════════
-- remove_demo_assets.sql — deletes the Reliability Indicators demo
--
-- Removes TEST-G04-002 / 003 / 004, their maintenance history, and
-- returns every part their demo jobs consumed back to stock.
--
-- Run it in the Supabase SQL editor whenever you are done looking at
-- the demo. It is safe to run twice — the second run matches nothing.
--
-- WHAT IT TOUCHES, and why in this order:
--
--   1. The demo part lines are DELETED. That is deliberate: the
--      AFTER DELETE trigger on maintenance_parts_used (migration 023)
--      posts the reversing stock entries, so the parts go back on the
--      shelf. Deleting the lines is what returns the stock — do not
--      skip this step or the stock stays issued.
--
--   2. The events and assets are SOFT-deleted (deleted_at), never
--      hard-deleted. The stock ledger is immutable and its rows
--      reference these events by foreign key, so a hard DELETE is
--      refused — and soft delete is this project's rule anyway. They
--      land in Trash, where an admin can restore them if wanted.
--
-- Verified before hand-over: stock returned to exactly its pre-demo
-- values (GSK 60, RNG 59, SEA 57) and the flags list went to zero.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Return the demo-consumed parts to stock.
DELETE FROM public.maintenance_parts_used WHERE notes = 'DEMO DATA';

-- 2. Retire the demo maintenance history.
UPDATE public.maintenance_events SET deleted_at = now()
 WHERE deleted_at IS NULL
   AND asset_id IN (SELECT id FROM public.assets WHERE asset_tag LIKE 'TEST-G04-%');

-- 3. Retire the demo assets.
UPDATE public.assets SET deleted_at = now()
 WHERE deleted_at IS NULL AND asset_tag LIKE 'TEST-G04-%';

-- Check before committing: expect 0 rows.
SELECT count(*) AS flags_remaining FROM public.v_asset_reliability_flags;

COMMIT;
