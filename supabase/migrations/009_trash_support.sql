-- ═══════════════════════════════════════════════════════════════
-- Migration 009 — Trash / Recycle Bin support
--
-- The existing SELECT policies on every master-data table and on
-- spare_parts filter `deleted_at IS NULL`, so soft-deleted rows are
-- completely invisible to every client query, including admins.
-- This migration adds:
--   1) trash_select policies — admins can see deleted_at IS NOT NULL rows
--   2) hard_delete policies — admins can permanently purge a row
--      (previously no DELETE policy existed at all, so hard deletes
--      were impossible for anyone, by design)
--   3) new audit_logs action types for restore/purge operations
-- Restoring a row (setting deleted_at back to NULL) already works via
-- the existing admin UPDATE policies — no change needed for that part.
-- ═══════════════════════════════════════════════════════════════

-- Widen the audit_logs action check constraint so Trash operations
-- (restore, permanent delete, empty-trash) can be logged.
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN ('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','UPLOAD','EXPORT','RESTORE','PURGE','PURGE_ALL'));

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['categories','manufacturers','models','disciplines','engine_systems','functional_groups','spare_parts']
  LOOP
    -- Admins can see soft-deleted rows (for the Trash page)
    EXECUTE format('DROP POLICY IF EXISTS "%s_trash_select" ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_trash_select" ON public.%I FOR SELECT TO authenticated USING (deleted_at IS NOT NULL AND public.current_user_role() = ''admin'')',
      tbl, tbl
    );

    -- Admins can permanently purge a soft-deleted row
    EXECUTE format('DROP POLICY IF EXISTS "%s_hard_delete" ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_hard_delete" ON public.%I FOR DELETE TO authenticated USING (deleted_at IS NOT NULL AND public.current_user_role() = ''admin'')',
      tbl, tbl
    );
  END LOOP;
END;
$$;
