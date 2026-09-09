-- ═══════════════════════════════════════════════════════════════
-- 034_protect_cached_stock_columns.sql
--
-- DATA INTEGRITY FIX (review finding H2, first half).
--
-- spare_parts.qty_on_hand is a cache of SUM(signed_qty) over the
-- stock_transactions ledger. Migration 011 documented it as "never
-- write this column directly", but nothing enforced it: the
-- spare_parts_update policy is column-agnostic, there is no
-- column-level grant, and no trigger. Any signed-in user could PATCH
-- qty_on_hand straight through PostgREST and desynchronise the cache
-- from the ledger with no transaction row to explain it — precisely
-- the drift the monthly drift query hunts for.
--
-- The app itself is already well behaved: savePart() builds an
-- explicit column whitelist and the Master Table CSV import builds
-- another, and neither ever sends qty_on_hand, stock_source or
-- last_counted_at. So this trigger blocks a path the UI never uses,
-- and no application change is needed.
--
-- HOW THE SANCTIONED PATHS STILL WORK
-- recalc_part_stock(), recalc_all_stock() and post_physical_count()
-- are SECURITY DEFINER and owned by postgres, so inside them
-- current_user is the owner, not the caller. Only writes arriving
-- directly as anon/authenticated — i.e. straight from the REST API —
-- are refused.
--
-- The trigger function is SECURITY INVOKER, and that is load-bearing.
-- Written as SECURITY DEFINER (the first attempt here) current_user
-- inside the function is the function's owner no matter who called it,
-- so the guard could never see 'authenticated' and never fired —
-- verified failing before the correction. As an invoker function it
-- observes the real caller, which is the whole point.
--
-- Deliberately NOT included: restricting which OTHER columns a
-- department_user may edit. CLAUDE.md limits them to Functional
-- Group, Sequential Number and Description, but the Master Table part
-- form applies no role gating today, so tightening that at the
-- database level would start rejecting edits your storekeepers
-- currently make. That needs a product decision and a matching UI
-- change, so it is left for a follow-up.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.spare_parts_protect_cached_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Only direct API callers are restricted. Inside the SECURITY
  -- DEFINER stock functions current_user is the table owner.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.qty_on_hand    IS DISTINCT FROM OLD.qty_on_hand
    OR NEW.stock_source   IS DISTINCT FROM OLD.stock_source
    OR NEW.last_counted_at IS DISTINCT FROM OLD.last_counted_at THEN
      RAISE EXCEPTION
        'qty_on_hand, stock_source and last_counted_at are maintained from the stock ledger and cannot be written directly. Post a stock transaction, or use the Stock Count page, instead.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.spare_parts_protect_cached_stock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_spare_parts_protect_cached_stock ON public.spare_parts;
CREATE TRIGGER trg_spare_parts_protect_cached_stock
  BEFORE UPDATE ON public.spare_parts
  FOR EACH ROW EXECUTE FUNCTION public.spare_parts_protect_cached_stock();

COMMENT ON TRIGGER trg_spare_parts_protect_cached_stock ON public.spare_parts IS
  'Blocks direct API writes to the ledger-derived columns (migration 034). The recalc/physical-count functions are SECURITY DEFINER and so are unaffected.';

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS trg_spare_parts_protect_cached_stock ON public.spare_parts;
-- DROP FUNCTION IF EXISTS public.spare_parts_protect_cached_stock();
