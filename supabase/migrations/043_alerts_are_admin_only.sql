-- ═══════════════════════════════════════════════════════════════
-- 043_alerts_are_admin_only.sql
--
-- Stock alerts become admin-only, enforced in the database rather
-- than in React.
--
-- WHY IN THE VIEW AND NOT IN A GRANT: every signed-in user reaches
-- PostgREST as the same Postgres role, `authenticated`. A grant cannot
-- tell an admin from a department user — revoking SELECT would lock out
-- both. The role distinction lives in user_profiles, which only
-- current_user_role() can read, so the guard has to sit in the view.
--
-- WHY NOT AN RLS POLICY: v_active_alerts is a pre-030 SECURITY DEFINER
-- view (security_invoker = false). It bypasses RLS on the tables it
-- reads, which is exactly why the row filter has to be inside it.
--
-- WHY current_user AND NOT auth.role(): the alert Edge Functions call
-- this view as service_role, and they must keep working. auth.role()
-- reads request.jwt.claims, which is unset outside a PostgREST request,
-- so it cannot be tested or trusted here. current_user reflects the
-- role PostgREST SET ROLEs into and was measured to return
-- 'service_role' and 'authenticated' correctly from inside a view.
--
-- ─── The anon leak this also closes ────────────────────────────
-- Measured live before this migration, as the anon role — the key that
-- ships in the browser bundle, with no sign-in at all:
--
--   v_active_alerts             38 rows readable
--
-- and it is not alone. The same SET ROLE anon probe read
-- audit_logs_with_user (58,472 rows, with user names), v_stock_status
-- (5,867), v_stock_transactions_detail (5,886), v_maintenance_parts_used,
-- v_stock_confidence, v_stock_status_summary and four asset views.
--
-- The tables underneath are protected by RLS; these SECURITY DEFINER
-- views walk around it, and anon holds SELECT on all of them. CLAUDE.md
-- §7 states "anon has no access to anything" — that was not true.
--
-- This migration revokes anon on v_active_alerts only, because that is
-- the view in scope. THE OTHER VIEWS ARE STILL EXPOSED. Closing them is
-- migration 044 and should not wait.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. The view, with the role guard ───────────────────────────
-- Identical to the previous definition except for the final AND.
CREATE OR REPLACE VIEW public.v_active_alerts AS
SELECT vs.id AS part_id,
       vs.code,
       vs.short_desc,
       vs.cat,
       vs.mfr,
       vs.model,
       vs.fg,
       sp.disc,
       sp.location,
       sp.unit,
       sp.status,
       vs.qty_on_hand,
       vs.min_stock,
       vs.reorder_point,
       vs.max_stock,
       vs.is_critical,
       vs.lead_time_days,
       vs.preferred_supplier,
       vs.last_counted_at,
       vs.stock_status,
       vs.severity_rank,
       GREATEST(COALESCE(vs.reorder_point, vs.min_stock, 0::numeric) - vs.qty_on_hand, 0::numeric) AS shortage_qty,
       ack.acknowledged_at,
       ack.acknowledged_by,
       ack.snooze_until,
       ack.note AS ack_note,
       ack.id IS NOT NULL AND (ack.snooze_until IS NULL OR ack.snooze_until > now()) AS is_acknowledged
  FROM v_stock_status vs
       JOIN spare_parts sp ON sp.id = vs.id
       LEFT JOIN alert_acknowledgements ack
              ON ack.part_id = vs.id AND ack.severity = vs.stock_status
 WHERE (vs.stock_status = ANY (ARRAY['out'::text, 'critical'::text, 'low'::text]))
   AND sp.status = 'Active'::text
   AND (current_user = 'service_role' OR public.current_user_role() = 'admin');

COMMENT ON VIEW public.v_active_alerts IS
  'Parts needing attention, visible to admins only. A department user gets zero rows, which also zeroes get_alert_counts() and therefore the header bell — the UI hides the page, this makes it true. service_role is admitted so the low-stock-alert and send-stock-alerts Edge Functions keep working. anon is revoked outright (migration 043).';

-- ─── 2. anon loses the view entirely ────────────────────────────
-- A denial, not an empty result: anon has no legitimate use for this.
REVOKE ALL ON public.v_active_alerts FROM anon;

-- Writes were never possible (the view has joins, so it is not
-- auto-updatable) but the grants existed and read as if they were.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.v_active_alerts FROM authenticated;
GRANT SELECT ON public.v_active_alerts TO authenticated, service_role;

-- ─── 3. Assertions ──────────────────────────────────────────────
-- Each of the four callers is checked, because getting any one of them
-- wrong is silent: an over-tight guard breaks the daily alert email and
-- nobody finds out until the mail stops arriving.
DO $$
DECLARE admin_id uuid; dept_id uuid;
        s_anon text; n_admin int; n_dept int; n_svc int;
BEGIN
  SELECT id INTO admin_id FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO dept_id  FROM public.user_profiles WHERE role = 'department_user' LIMIT 1;
  IF admin_id IS NULL OR dept_id IS NULL THEN
    RAISE EXCEPTION '043 cannot verify: needs one admin and one department_user profile';
  END IF;

  BEGIN
    SET LOCAL ROLE anon;
    PERFORM COUNT(*) FROM public.v_active_alerts;
    RESET ROLE;
    RAISE EXCEPTION '043 failed: anon can still read v_active_alerts';
  EXCEPTION WHEN insufficient_privilege THEN
    s_anon := 'denied';
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO n_admin FROM public.v_active_alerts;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', dept_id)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO n_dept FROM public.v_active_alerts;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE service_role;
  SELECT COUNT(*) INTO n_svc FROM public.v_active_alerts;
  RESET ROLE;

  IF n_dept <> 0 THEN
    RAISE EXCEPTION '043 failed: department_user sees % alert rows, expected 0', n_dept;
  END IF;
  IF n_admin = 0 THEN
    RAISE EXCEPTION '043 failed: admin sees no alerts — the guard is too tight';
  END IF;
  IF n_svc <> n_admin THEN
    RAISE EXCEPTION '043 failed: service_role sees % but admin sees % — the alert emails would be wrong', n_svc, n_admin;
  END IF;

  RAISE NOTICE '043 verified: anon=% admin=% dept=% service_role=%', s_anon, n_admin, n_dept, n_svc;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- Restores the previous definition — every signed-in user sees alerts
-- again, and anon regains SELECT.
--
-- CREATE OR REPLACE VIEW public.v_active_alerts AS
--   ... same SELECT without the final AND ...;
-- GRANT SELECT ON public.v_active_alerts TO anon;
--
-- ⚠ Re-granting anon re-opens an unauthenticated read of live stock
--   data. Restore the role guard only, not the anon grant.
-- ═══════════════════════════════════════════════════════════════
