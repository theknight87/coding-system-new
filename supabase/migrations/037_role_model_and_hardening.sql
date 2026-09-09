-- ═══════════════════════════════════════════════════════════════
-- 037_role_model_and_hardening.sql
--
-- Review findings M2, M7 and L3.
--
-- ─── M2: "Department User ... cannot delete anything" ────────────
--
-- CLAUDE.md's role model says a department user cannot delete. The UI
-- gated asset Trash and Remove Event on canEdit (admin OR department
-- user), and the policies agreed with the UI rather than the spec:
-- soft delete is an UPDATE that sets deleted_at, and the assets and
-- maintenance_events UPDATE policies allow department users. The UI is
-- now gated on isAdmin; this closes the same gap at the API, so it
-- holds whichever way the row is reached.
--
-- Everything else a department user does with these rows is untouched
-- — they can still create assets, log maintenance, update hours and
-- edit descriptive fields. Only the transition from live to trashed,
-- and back, becomes admin-only.
--
-- ─── M7: alert_notifications_log had RLS on and no policies ──────
--
-- Nothing but service_role could read it, which is correct — it is the
-- send-dedup ledger written by the alert edge functions — but that was
-- implicit. Recorded explicitly so the next reader does not "fix" it
-- by adding a policy.
--
-- ─── L3: functions with a mutable search_path ────────────────────
--
-- Pins search_path on the remaining SECURITY DEFINER functions flagged
-- by the linter. Without it, a caller can prepend a schema and shadow
-- an unqualified reference inside a function that runs as its owner.
--
-- NOT DONE, deliberately: converting the 11 pre-030 SECURITY DEFINER
-- views to security_invoker (review L4). v_stock_transactions_detail
-- joins user_profiles, whose policy is own-row-or-admin, so as an
-- invoker view every department user would see NULL in the User column
-- for anyone else's movements — a visible regression on the Stock
-- Movements page. Migration 014 called this out at the time. Left as
-- definer views on purpose; revisit only alongside a decision about
-- whether staff may see each other's names.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Only admins may trash or restore ──────────────────────────
DROP POLICY IF EXISTS assets_update ON public.assets;
CREATE POLICY assets_update ON public.assets
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = ANY (ARRAY['admin','department_user']))
  WITH CHECK (
    public.current_user_role() = 'admin'
    -- a department user may edit a live asset, but may not move it to
    -- Trash and may not pull one back out
    OR (deleted_at IS NULL)
  );

COMMENT ON POLICY assets_update ON public.assets IS
  'Admins may update any asset. Department users may edit live assets but cannot set or clear deleted_at — soft delete is a delete (migration 037).';

DROP POLICY IF EXISTS maintenance_events_update ON public.maintenance_events;
CREATE POLICY maintenance_events_update ON public.maintenance_events
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = ANY (ARRAY['admin','department_user']))
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (deleted_at IS NULL)
  );

COMMENT ON POLICY maintenance_events_update ON public.maintenance_events IS
  'Admins may update any event. Department users may edit live events but cannot remove one — removing reverses its stock movements (migration 037).';

-- ─── 2. Say out loud that this table is service-role only ─────────
COMMENT ON TABLE public.alert_notifications_log IS
  'Send-dedup ledger for the stock-alert edge functions. RLS is enabled with NO policies on purpose: only service_role (which bypasses RLS) writes or reads it. Do not add a policy to "fix" the linter INFO — the app never needs this table.';

-- ─── 3. Pin search_path on the remaining definer functions ────────
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (p.proconfig IS NULL OR NOT (p.proconfig::text LIKE '%search_path%'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn.sig);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP POLICY IF EXISTS assets_update ON public.assets;
-- CREATE POLICY assets_update ON public.assets FOR UPDATE TO authenticated
--   USING (public.current_user_role() = ANY (ARRAY['admin','department_user']));
-- DROP POLICY IF EXISTS maintenance_events_update ON public.maintenance_events;
-- CREATE POLICY maintenance_events_update ON public.maintenance_events FOR UPDATE TO authenticated
--   USING (public.current_user_role() = ANY (ARRAY['admin','department_user']));
