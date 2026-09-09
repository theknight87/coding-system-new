-- ═══════════════════════════════════════════════════════════════
-- 031_enable_rls_drift_fix.sql
--
-- CRITICAL SECURITY FIX (review finding C1) — production drift.
--
-- Migration 003 enables RLS on nine tables. Eight of them were found
-- with relrowsecurity = false in production: the ALTER statements
-- never took effect there, while the CREATE POLICY statements did.
-- Policies without RLS enabled are inert, and Supabase grants anon and
-- authenticated full DML on public tables by default, so the result
-- was unauthenticated read/write/delete on the whole catalogue.
--
-- Measured before this fix, as the anon role (rolled back):
--   anon SELECT spare_parts  -> 5,870 rows
--   anon UPDATE spare_parts  -> 5,870 rows affected
--   anon DELETE audit_logs   -> 64,286 rows removed
--   anon UPDATE assets       -> 0 rows   (RLS was on there; correct)
--
-- The anon key ships in the frontend bundle, so this needed nothing
-- but a browser and the public site.
--
-- This migration only enables RLS. The policies already exist, are all
-- scoped TO authenticated, and already cover SELECT/INSERT/UPDATE/
-- DELETE on every table below — so enabling RLS blocks anon outright
-- while leaving signed-in users exactly as they were.
--
-- One intended behaviour change: audit_logs SELECT is admin-only, so
-- non-admins stop being able to read the audit log through the API.
-- That already matches the UI, where Audit Log is an admin-only page.
--
-- Section 2 re-asserts the state and aborts if any table is still
-- unprotected, so this cannot half-apply the way 003 did.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disciplines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_systems    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.functional_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_parts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs        ENABLE ROW LEVEL SECURITY;

-- ─── 2. Assert, do not assume ─────────────────────────────────────
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relrowsecurity = false;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS still disabled on: % — aborting', missing;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ⚠ Reverting re-exposes the entire catalogue to the public internet.
-- ═══════════════════════════════════════════════════════════════
-- ALTER TABLE public.categories        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.manufacturers     DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.models            DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.disciplines       DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.engine_systems    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.functional_groups DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.spare_parts       DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.audit_logs        DISABLE ROW LEVEL SECURITY;
