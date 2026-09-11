-- ═══════════════════════════════════════════════════════════════
-- 042_attribution_is_server_derived.sql
--
-- SECURITY FIX (security audit finding #3) — forgeable attribution.
--
-- Every "who did this" column was sent by the browser and checked by
-- nobody:
--
--   db.js audit()                 -> audit_logs.user_id   = <client>
--   db.js insertStockTransaction  -> stock_transactions.created_by = <client>
--   ...and ten more tables the audit did not name.
--
-- Measured live before this fix — 12 tables, 22 columns:
--   column_default = NULL on every one of them, and not a single
--   INSERT policy mentioned the column. audit_logs was the worst:
--   WITH CHECK (true), so any signed-in user could write an audit
--   entry attributed to anyone. stock_transactions checked only the
--   caller's ROLE, never the value.
--   (push_subscriptions was already correct: WITH CHECK (auth.uid() =
--   user_id). It is deliberately left alone.)
--
-- Nothing here can forge a BALANCE — signed_qty is GENERATED ALWAYS
-- from txn_type (migration 011). What was forgeable is the record of
-- who moved the stock, which is exactly what the audit log exists to
-- establish.
--
-- APPROACH: force, do not reject.
-- A BEFORE trigger overwrites the column with auth.uid() rather than a
-- policy rejecting a mismatch. Two reasons:
--   1. Rejecting would break every existing call site that sends the
--      value; forcing leaves them working and simply makes the value
--      true. No business logic changes.
--   2. For attribution, the right outcome is the correct name on the
--      row, not an error. A rejected insert tells an attacker what the
--      rule is; a forced one just records reality.
--
-- auth.uid() IS NULL is left untouched on purpose: that is a
-- SECURITY DEFINER maintenance path or a service_role job with no user
-- session, where the function has deliberately set the column itself.
-- A user-facing request always carries a uid, so this is never a way
-- for a browser to opt out.
--
-- SECURITY INVOKER on all three functions is load-bearing: a DEFINER
-- function would see the owner as current_user and auth.uid() would
-- still work, but INVOKER keeps them honest and matches migration 039.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Defaults, so an omitted column is still correct ─────────
ALTER TABLE public.audit_logs             ALTER COLUMN user_id    SET DEFAULT auth.uid();
ALTER TABLE public.stock_transactions     ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.stock_movements        ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.spare_parts            ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.spare_parts            ALTER COLUMN updated_by SET DEFAULT auth.uid();
ALTER TABLE public.assets                 ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.assets                 ALTER COLUMN updated_by SET DEFAULT auth.uid();
ALTER TABLE public.maintenance_events     ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.maintenance_parts_used ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.categories             ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.categories             ALTER COLUMN updated_by SET DEFAULT auth.uid();
ALTER TABLE public.manufacturers          ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.manufacturers          ALTER COLUMN updated_by SET DEFAULT auth.uid();
ALTER TABLE public.models                 ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.models                 ALTER COLUMN updated_by SET DEFAULT auth.uid();
ALTER TABLE public.disciplines            ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.disciplines            ALTER COLUMN updated_by SET DEFAULT auth.uid();
ALTER TABLE public.engine_systems         ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.engine_systems         ALTER COLUMN updated_by SET DEFAULT auth.uid();
ALTER TABLE public.functional_groups      ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.functional_groups      ALTER COLUMN updated_by SET DEFAULT auth.uid();

-- ─── 2. Triggers, so a supplied column is overwritten ───────────
-- Static field assignment rather than a jsonb round-trip: rebuilding
-- NEW from jsonb would also try to write stock_transactions.signed_qty,
-- which is GENERATED ALWAYS and cannot be assigned in a BEFORE trigger.
CREATE OR REPLACE FUNCTION public.force_created_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.force_updated_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.updated_by := auth.uid(); END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.force_user_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.user_id := auth.uid(); END IF;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.force_created_by() IS
  'Overwrites created_by with auth.uid() on insert so the browser cannot attribute a row to another user. No-op when there is no session (SECURITY DEFINER maintenance paths set the column themselves) — migration 042.';
COMMENT ON FUNCTION public.force_updated_by() IS
  'Overwrites updated_by with auth.uid() — migration 042.';
COMMENT ON FUNCTION public.force_user_id() IS
  'Overwrites user_id with auth.uid() on insert, closing the audit_logs WITH CHECK (true) hole — migration 042.';

DO $$
DECLARE
  t text;
  created_by_tables text[] := ARRAY[
    'stock_transactions','stock_movements','spare_parts','assets',
    'maintenance_events','maintenance_parts_used','categories',
    'manufacturers','models','disciplines','engine_systems','functional_groups'];
  updated_by_tables text[] := ARRAY[
    'spare_parts','assets','categories','manufacturers','models',
    'disciplines','engine_systems','functional_groups'];
BEGIN
  FOREACH t IN ARRAY created_by_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS force_created_by ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER force_created_by BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.force_created_by()', t);
  END LOOP;

  FOREACH t IN ARRAY updated_by_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS force_updated_by ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER force_updated_by BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.force_updated_by()', t);
  END LOOP;
END; $$;

DROP TRIGGER IF EXISTS force_user_id ON public.audit_logs;
CREATE TRIGGER force_user_id BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.force_user_id();

-- ─── 3. audit_logs: close WITH CHECK (true) as well ─────────────
-- The trigger already makes the value true, but a policy reading
-- "true" invites someone to conclude nothing is enforced here.
DROP POLICY IF EXISTS "audit_insert" ON public.audit_logs;
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT DISTINCT FROM auth.uid());

COMMENT ON POLICY "audit_insert" ON public.audit_logs IS
  'A signed-in user may only write audit entries attributed to themselves. Was WITH CHECK (true), which let anyone forge an entry as anyone (migration 042). The force_user_id trigger makes this hold automatically; the policy states the rule.';

-- ─── 4. Assertions ──────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE NOT t.tgisinternal AND t.tgname = 'force_created_by';
  IF n <> 12 THEN RAISE EXCEPTION '042 failed: expected 12 force_created_by triggers, found %', n; END IF;

  SELECT COUNT(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE NOT t.tgisinternal AND t.tgname = 'force_updated_by';
  IF n <> 8 THEN RAISE EXCEPTION '042 failed: expected 8 force_updated_by triggers, found %', n; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                 WHERE NOT t.tgisinternal AND t.tgname='force_user_id'
                   AND c.relname='audit_logs') THEN
    RAISE EXCEPTION '042 failed: force_user_id trigger missing on audit_logs';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
             WHERE c.relname='audit_logs' AND p.polcmd='a'
               AND pg_get_expr(p.polwithcheck,p.polrelid) = 'true') THEN
    RAISE EXCEPTION '042 failed: audit_logs insert policy is still WITH CHECK (true)';
  END IF;
END; $$;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ⚠ Reverting makes every "who did this" column forgeable again,
--   including the audit log. Do not.
-- ═══════════════════════════════════════════════════════════════
