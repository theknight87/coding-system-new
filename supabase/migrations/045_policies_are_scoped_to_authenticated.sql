-- ═══════════════════════════════════════════════════════════════
-- 045_policies_are_scoped_to_authenticated.sql
--
-- Restores the second layer of defence that the full review of
-- 2026-09-14 found missing (finding #6 in docs/SECURITY_History.md).
--
-- MEASURED BEFORE THIS MIGRATION:
--   27 policies across 8 tables were addressed TO PUBLIC, which
--   includes the anon role. Four of them read USING (true):
--
--     alert_acknowledgements.alert_ack_select                USING (true)
--     asset_documents.asset_documents_select                 USING (true)
--     asset_hours_log.asset_hours_log_select                 USING (true)
--     maintenance_parts_used.maintenance_parts_used_select   USING (true)
--
--   and two more carried no role test at all:
--
--     assets.assets_select                     USING (deleted_at IS NULL)
--     maintenance_events.maintenance_events_select  USING (deleted_at IS NULL)
--
-- WHY THIS MATTERS EVEN THOUGH NOTHING IS EXPOSED TODAY: since 044 the
-- anon role holds no grant, so it cannot reach these tables at all. That
-- makes the grant the ONLY thing standing between anon and the rows —
-- and the grant is precisely what was wrong until 044. Proven by
-- restoring the pre-044 grants inside a transaction that rolled back:
-- as anon, maintenance_parts_used returned 26 rows, maintenance_events
-- 21, alert_acknowledgements 11, assets 4, asset_documents 3.
--
-- This migration does not close a hole. It makes a second, independent
-- thing have to fail before one opens.
--
-- NO BEHAVIOUR CHANGE FOR REAL USERS. Both application roles pass the
-- role test, so every read that worked before still works — asserted
-- below with row counts for admin and department_user.
--
-- SERVICE ROLE IS UNAFFECTED: service_role has BYPASSRLS (measured
-- true), so the alert Edge Functions never evaluate these policies.
-- The SECURITY DEFINER views also read as their owner, not the caller,
-- so none of them changes either.
--
-- SIGNUP IS UNAFFECTED: handle_new_user() is SECURITY DEFINER owned by
-- postgres, which has BYPASSRLS, so profiles_insert is not evaluated
-- during account creation.
--
-- Written out policy by policy rather than generated in a loop: a
-- rebuilt-from-catalogue policy is unreviewable in a diff, and these
-- are the rules that hold the system up.
-- ═══════════════════════════════════════════════════════════════

-- ─── alert_acknowledgements ─────────────────────────────────────
DROP POLICY IF EXISTS "alert_ack_select" ON public.alert_acknowledgements;
CREATE POLICY "alert_ack_select" ON public.alert_acknowledgements FOR SELECT
  TO authenticated
  USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "alert_ack_insert" ON public.alert_acknowledgements;
CREATE POLICY "alert_ack_insert" ON public.alert_acknowledgements FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "alert_ack_update" ON public.alert_acknowledgements;
CREATE POLICY "alert_ack_update" ON public.alert_acknowledgements FOR UPDATE
  TO authenticated
  USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "alert_ack_delete" ON public.alert_acknowledgements;
CREATE POLICY "alert_ack_delete" ON public.alert_acknowledgements FOR DELETE
  TO authenticated
  USING (current_user_role() = ANY (ARRAY['admin','department_user']));

-- ─── asset_documents ────────────────────────────────────────────
DROP POLICY IF EXISTS "asset_documents_select" ON public.asset_documents;
CREATE POLICY "asset_documents_select" ON public.asset_documents FOR SELECT
  TO authenticated
  USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "asset_documents_insert" ON public.asset_documents;
CREATE POLICY "asset_documents_insert" ON public.asset_documents FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "asset_documents_delete" ON public.asset_documents;
CREATE POLICY "asset_documents_delete" ON public.asset_documents FOR DELETE
  TO authenticated
  USING (current_user_role() = 'admin');

-- ─── asset_hours_log ────────────────────────────────────────────
DROP POLICY IF EXISTS "asset_hours_log_select" ON public.asset_hours_log;
CREATE POLICY "asset_hours_log_select" ON public.asset_hours_log FOR SELECT
  TO authenticated
  USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "asset_hours_log_insert" ON public.asset_hours_log;
CREATE POLICY "asset_hours_log_insert" ON public.asset_hours_log FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

-- ─── assets ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "assets_select" ON public.assets;
CREATE POLICY "assets_select" ON public.assets FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL
         AND current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "assets_trash_select" ON public.assets;
CREATE POLICY "assets_trash_select" ON public.assets FOR SELECT
  TO authenticated
  USING (deleted_at IS NOT NULL AND current_user_role() = 'admin');

DROP POLICY IF EXISTS "assets_insert" ON public.assets;
CREATE POLICY "assets_insert" ON public.assets FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "assets_hard_delete" ON public.assets;
CREATE POLICY "assets_hard_delete" ON public.assets FOR DELETE
  TO authenticated
  USING (deleted_at IS NOT NULL AND current_user_role() = 'admin');

-- ─── maintenance_events ─────────────────────────────────────────
DROP POLICY IF EXISTS "maintenance_events_select" ON public.maintenance_events;
CREATE POLICY "maintenance_events_select" ON public.maintenance_events FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL
         AND current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "maintenance_events_trash_select" ON public.maintenance_events;
CREATE POLICY "maintenance_events_trash_select" ON public.maintenance_events FOR SELECT
  TO authenticated
  USING (deleted_at IS NOT NULL AND current_user_role() = 'admin');

DROP POLICY IF EXISTS "maintenance_events_insert" ON public.maintenance_events;
CREATE POLICY "maintenance_events_insert" ON public.maintenance_events FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "maintenance_events_hard_delete" ON public.maintenance_events;
CREATE POLICY "maintenance_events_hard_delete" ON public.maintenance_events FOR DELETE
  TO authenticated
  USING (deleted_at IS NOT NULL AND current_user_role() = 'admin');

-- ─── maintenance_parts_used ─────────────────────────────────────
DROP POLICY IF EXISTS "maintenance_parts_used_select" ON public.maintenance_parts_used;
CREATE POLICY "maintenance_parts_used_select" ON public.maintenance_parts_used FOR SELECT
  TO authenticated
  USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "maintenance_parts_used_insert" ON public.maintenance_parts_used;
CREATE POLICY "maintenance_parts_used_insert" ON public.maintenance_parts_used FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "maintenance_parts_used_update" ON public.maintenance_parts_used;
CREATE POLICY "maintenance_parts_used_update" ON public.maintenance_parts_used FOR UPDATE
  TO authenticated
  USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS "maintenance_parts_used_delete" ON public.maintenance_parts_used;
CREATE POLICY "maintenance_parts_used_delete" ON public.maintenance_parts_used FOR DELETE
  TO authenticated
  USING (current_user_role() = 'admin');

-- ─── push_subscriptions ─────────────────────────────────────────
-- Expressions already correct (own row only); only the role list changes.
DROP POLICY IF EXISTS "push_sub_select" ON public.push_subscriptions;
CREATE POLICY "push_sub_select" ON public.push_subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_sub_insert" ON public.push_subscriptions;
CREATE POLICY "push_sub_insert" ON public.push_subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_sub_delete" ON public.push_subscriptions;
CREATE POLICY "push_sub_delete" ON public.push_subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ─── user_profiles ──────────────────────────────────────────────
-- Expressions unchanged, including the self-promotion guard from 029.
DROP POLICY IF EXISTS "profiles_select" ON public.user_profiles;
CREATE POLICY "profiles_select" ON public.user_profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR current_user_role() = 'admin');

DROP POLICY IF EXISTS "profiles_insert" ON public.user_profiles;
CREATE POLICY "profiles_insert" ON public.user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() = 'admin'
              OR (id = auth.uid() AND role = 'department_user'));

DROP POLICY IF EXISTS "profiles_update" ON public.user_profiles;
CREATE POLICY "profiles_update" ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin'
              OR (id = auth.uid()
                  AND NOT (role IS DISTINCT FROM current_user_role())
                  AND is_active IS TRUE));

-- ─── Assertions ─────────────────────────────────────────────────
-- Three things have to hold: no policy left addressed to PUBLIC, anon
-- still shut out, and both application roles reading exactly what they
-- read before. The third is the one that catches an over-tight rule.
DO $$
DECLARE admin_id uuid; dept_id uuid; n_public int;
        a_assets int; a_events int; a_lines int; a_docs int; a_hours int; a_acks int;
        d_assets int; d_events int; d_lines int; d_docs int; d_hours int; d_acks int;
        anon_readable int := 0; r record;
BEGIN
  SELECT COUNT(*) INTO n_public
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
   WHERE p.polroles = '{0}'::oid[];
  IF n_public <> 0 THEN
    RAISE EXCEPTION '045 failed: % policies are still addressed to PUBLIC', n_public;
  END IF;

  SELECT id INTO admin_id FROM public.user_profiles WHERE role='admin' LIMIT 1;
  SELECT id INTO dept_id  FROM public.user_profiles WHERE role='department_user' LIMIT 1;
  IF admin_id IS NULL OR dept_id IS NULL THEN
    RAISE EXCEPTION '045 cannot verify: needs one admin and one department_user profile';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO a_assets FROM public.assets WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO a_events FROM public.maintenance_events WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO a_lines  FROM public.maintenance_parts_used;
  SELECT COUNT(*) INTO a_docs   FROM public.asset_documents;
  SELECT COUNT(*) INTO a_hours  FROM public.asset_hours_log;
  SELECT COUNT(*) INTO a_acks   FROM public.alert_acknowledgements;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', dept_id)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO d_assets FROM public.assets WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO d_events FROM public.maintenance_events WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO d_lines  FROM public.maintenance_parts_used;
  SELECT COUNT(*) INTO d_docs   FROM public.asset_documents;
  SELECT COUNT(*) INTO d_hours  FROM public.asset_hours_log;
  SELECT COUNT(*) INTO d_acks   FROM public.alert_acknowledgements;
  RESET ROLE;

  IF a_assets = 0 OR a_events = 0 OR a_lines = 0 THEN
    RAISE EXCEPTION '045 failed: admin lost reads (assets=%, events=%, lines=%)',
      a_assets, a_events, a_lines;
  END IF;
  IF d_assets <> a_assets OR d_events <> a_events OR d_lines <> a_lines
     OR d_docs <> a_docs OR d_hours <> a_hours OR d_acks <> a_acks THEN
    RAISE EXCEPTION '045 failed: department_user no longer matches admin (assets %/%, events %/%, lines %/%, docs %/%, hours %/%, acks %/%)',
      d_assets, a_assets, d_events, a_events, d_lines, a_lines,
      d_docs, a_docs, d_hours, a_hours, d_acks, a_acks;
  END IF;

  SET LOCAL ROLE anon;
  FOR r IN SELECT c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','v')
  LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', r.relname);
      anon_readable := anon_readable + 1;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RESET ROLE;
  IF anon_readable > 0 THEN
    RAISE EXCEPTION '045 failed: anon can read % object(s)', anon_readable;
  END IF;

  RAISE NOTICE '045 verified: 0 PUBLIC policies, anon reads 0, admin=dept on assets=% events=% lines=% docs=% hours=% acks=%',
    a_assets, a_events, a_lines, a_docs, a_hours, a_acks;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- To re-check later (should return zero rows):
--   SELECT c.relname, p.polname
--     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
--    WHERE p.polroles = '{0}'::oid[];
--
-- ROLLBACK (commented out)
-- ⚠ Reverting re-addresses every one of these policies to PUBLIC and
--   restores four USING (true) read rules. The only thing that would
--   then separate anon from this data is a table grant. Do not.
-- ═══════════════════════════════════════════════════════════════
