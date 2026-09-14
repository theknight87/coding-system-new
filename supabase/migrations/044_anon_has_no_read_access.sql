-- ═══════════════════════════════════════════════════════════════
-- 044_anon_has_no_read_access.sql
--
-- Closes the unauthenticated read that 043 found and only partly fixed.
--
-- CLAUDE.md §7 has said "anon has no access to anything" for a long
-- time. It was not true. Measured live on 2026-09-14 with SET ROLE anon
-- — the role the browser uses with the publishable key that ships in the
-- bundle, before anyone signs in:
--
--   audit_logs_with_user          58,472 rows, with user names
--   v_stock_status                 5,867
--   v_stock_transactions_detail    5,886
--   v_active_alerts                   38   (closed in 043)
--   v_maintenance_parts_used          26
--   v_stock_confidence                 6
--   v_stock_status_summary             5
--   v_assets_overview                  4
--   v_asset_cost_summary               4
--   v_asset_kpis                       1
--   v_asset_pm_due                     1
--
-- WHY THE TABLES WERE SAFE AND THE VIEWS WERE NOT: RLS protects the
-- tables, and every policy is TO authenticated, so anon selects nothing
-- from them. The pre-030 views are SECURITY DEFINER (migration 037 left
-- them that way on purpose, for a different reason — the User column on
-- Stock Movements). A SECURITY DEFINER view runs as its owner and does
-- not apply the caller's RLS, so anon reading the view read straight
-- past the policies. anon held SELECT on all of them.
--
-- WHY REVOKE RATHER THAN CONVERT THE VIEWS: converting them to
-- security_invoker is the change 037 deliberately did not make, and it
-- would blank the User column for department users. Revoking anon fixes
-- the exposure without touching what signed-in users see — verified
-- below, admin and department_user row counts are identical afterwards.
--
-- SCOPE: every table and view in public, not just the leaking ones. The
-- app authenticates before its first query; anon has no legitimate read
-- here at all. Writes were already impossible (RLS), but the grants
-- included INSERT, UPDATE, DELETE and TRUNCATE, and TRUNCATE is not
-- subject to RLS — PostgREST exposes no verb for it, so it was not
-- reachable over HTTP, but the grant should never have existed.
--
-- Default privileges are changed too. Without that, the next CREATE
-- TABLE or CREATE VIEW in public silently re-grants everything to anon
-- and re-opens this the moment someone writes migration 045.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Existing objects ────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','v')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
  END LOOP;
END;
$$;

-- ─── 2. Future objects ──────────────────────────────────────────
-- Supabase seeds these defaults from two roles. We own the postgres one;
-- the supabase_admin one may refuse, which is not fatal — the assertion
-- below reports what actually took effect rather than assuming.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE '044: could not alter supabase_admin default privileges (needs that role). Objects created BY supabase_admin will still grant anon — check with the query in the comment below after any dashboard-created table.';
END;
$$;

-- ─── 3. Assertions ──────────────────────────────────────────────
-- Both halves matter: anon must lose everything, and the two real roles
-- must see exactly what they saw before. A revoke that also silenced a
-- department user would be a worse bug than the leak.
DO $$
DECLARE r record; admin_id uuid; dept_id uuid;
        anon_readable int := 0;
        n_admin_parts int; n_admin_audit int;
        n_dept_parts int; n_dept_stock int; n_dept_tree int; n_dept_maint int;
        n_svc_alerts int;
BEGIN
  SELECT id INTO admin_id FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO dept_id  FROM public.user_profiles WHERE role = 'department_user' LIMIT 1;
  IF admin_id IS NULL OR dept_id IS NULL THEN
    RAISE EXCEPTION '044 cannot verify: needs one admin and one department_user profile';
  END IF;

  SET LOCAL ROLE anon;
  FOR r IN SELECT c.relname
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','v')
  LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', r.relname);
      anon_readable := anon_readable + 1;
      RAISE NOTICE '044: anon can still read %', r.relname;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RESET ROLE;

  IF anon_readable > 0 THEN
    RAISE EXCEPTION '044 failed: anon can still read % object(s) in public', anon_readable;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO n_admin_parts FROM public.spare_parts WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO n_admin_audit FROM public.audit_logs_with_user;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', dept_id)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO n_dept_parts FROM public.spare_parts WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO n_dept_stock FROM public.v_stock_status;
  SELECT COUNT(*) INTO n_dept_tree  FROM public.v_parts_tree_counts;
  SELECT COUNT(*) INTO n_dept_maint FROM public.v_maintenance_parts_used;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE service_role;
  SELECT COUNT(*) INTO n_svc_alerts FROM public.v_active_alerts;
  RESET ROLE;

  IF n_admin_parts = 0 OR n_admin_audit = 0 THEN
    RAISE EXCEPTION '044 failed: admin lost access (parts=%, audit=%)', n_admin_parts, n_admin_audit;
  END IF;
  IF n_dept_parts = 0 OR n_dept_stock = 0 OR n_dept_tree = 0 THEN
    RAISE EXCEPTION '044 failed: department_user lost access (parts=%, stock=%, tree=%)',
      n_dept_parts, n_dept_stock, n_dept_tree;
  END IF;
  IF n_svc_alerts = 0 THEN
    RAISE EXCEPTION '044 failed: service_role lost the alert view — the daily email would go silent';
  END IF;

  RAISE NOTICE '044 verified: anon reads 0 | admin parts=% audit=% | dept parts=% stock=% tree=% maint=% | service alerts=%',
    n_admin_parts, n_admin_audit, n_dept_parts, n_dept_stock, n_dept_tree, n_dept_maint, n_svc_alerts;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- To re-check later (should return zero rows):
--   SELECT c.relname
--     FROM information_schema.role_table_grants g
--     JOIN pg_class c ON c.relname = g.table_name
--     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
--    WHERE g.grantee = 'anon' AND g.table_schema = 'public';
--
-- NOT CHANGED HERE: anon still holds EXECUTE on 14 public functions.
-- Checked one by one — thirteen are SECURITY INVOKER (trigger functions
-- and RPCs that RLS still blocks for anon) and current_user_role() is
-- SECURITY DEFINER but returns 'anonymous' to an anon caller, which is
-- what it is for. No leak, so left alone rather than widened into.
--
-- ROLLBACK (commented out)
-- ⚠ Re-granting anon restores an unauthenticated read of the audit log,
--   every part, and the whole stock ledger. Do not.
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
-- ═══════════════════════════════════════════════════════════════
