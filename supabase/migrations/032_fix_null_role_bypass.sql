-- ═══════════════════════════════════════════════════════════════
-- 032_fix_null_role_bypass.sql
--
-- CRITICAL SECURITY FIX (review findings C2 and C3).
--
-- ─── C2: NULL made every function role-gate a no-op ──────────────
--
-- Guards across the codebase are written as:
--
--   IF public.current_user_role() <> 'admin' THEN RAISE EXCEPTION ...
--
-- For a caller with no profile row (the anon role — the public key in
-- the frontend bundle), current_user_role() returned NULL. NULL <>
-- 'admin' evaluates to NULL, not TRUE, so the IF never fired and the
-- function ran. These are SECURITY DEFINER, so they execute as owner
-- and bypass RLS entirely.
--
-- Measured before this fix, as anon (rolled back):
--   void_stock_transaction()   = ALLOWED  (the "admin only" one)
--   void_stock_txn_internal()  = ALLOWED
--   post_physical_count()      = ALLOWED  — a part's stock 42 -> 999
--   reset_estimated_balances() = ALLOWED
--
-- Affected guards: migrations 011:266, 012:196/249, 013:24, 015:197,
-- 023:159, 025:63, 026:185 — eight sites, plus the NOT IN variant in
-- return_maintenance_part, which fails the same way.
--
-- FIX — one change at the root instead of eight at the leaves.
-- current_user_role() now returns 'anonymous' rather than NULL when
-- there is no profile. Every existing guard then compares against a
-- real string and fires correctly, with no edit to any function body:
--
--   'anonymous' <> 'admin'                    -> TRUE  -> raises
--   'anonymous' NOT IN ('admin','department_user') -> TRUE  -> raises
--
-- RLS policies are unaffected: they test `= 'admin'` or `= ANY(...)`,
-- which was already false for NULL and is still false for 'anonymous'.
-- Nothing in the codebase tests current_user_role() IS NULL (checked).
-- search_path is also pinned here, closing one of the linter's mutable
-- search_path warnings.
--
-- ─── C3: internal helpers were reachable from the public API ─────
--
-- post_stock_reversal() and void_stock_txn_internal() are deliberately
-- NOT role-gated — they are internal engines whose callers authorise.
-- Migration 026 revoked them FROM PUBLIC, but Supabase grants EXECUTE
-- to anon and authenticated explicitly, and REVOKE ... FROM PUBLIC
-- does not remove an explicit role grant. Both stayed callable at
-- /rest/v1/rpc/..., bypassing the admin gate by design.
--
-- Section 2 revokes EXECUTE on every SECURITY DEFINER function in the
-- public schema, then re-grants only the ones the app actually calls,
-- to authenticated only. The keep-list is derived from db.js:
-- the ten supabase.rpc() call sites, plus current_user_role(), which
-- RLS policies evaluate as the querying user and so must stay callable
-- by both roles.
--
-- Trigger functions do not need EXECUTE to fire — Postgres does not
-- check that privilege when a trigger runs — so revoking them breaks
-- nothing while removing them from the REST surface.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. The root fix ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()),
    'anonymous'
  )
$$;

COMMENT ON FUNCTION public.current_user_role() IS
  'The caller''s application role, or ''anonymous'' when there is no signed-in profile. Never returns NULL: the plpgsql guards throughout this schema are written as "IF current_user_role() <> ''admin'' THEN RAISE", and a NULL there evaluates the IF to NULL so the guard would not fire (migration 032).';

-- ─── 2. Lock the RPC surface down ─────────────────────────────────
DO $$
DECLARE
  fn record;
  -- Exactly the RPCs src/lib/db.js calls, plus current_user_role().
  keep_for_authenticated text[] := ARRAY[
    'current_user_role',
    'bulk_set_reorder_settings', 'cancel_maintenance_part', 'get_alert_counts',
    'get_unconfigured_count', 'log_maintenance_event', 'next_asset_tag',
    'post_physical_count', 'reset_estimated_balances', 'return_maintenance_part',
    'void_stock_transaction'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);

    IF fn.proname = 'current_user_role' THEN
      -- Evaluated inside RLS policies as the querying user; must stay
      -- callable or policy evaluation errors instead of denying.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', fn.sig);
    ELSIF fn.proname = ANY(keep_for_authenticated) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn.sig);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ⚠ Reverting section 1 restores an unauthenticated write path into
--   the stock ledger. Do not.
-- ═══════════════════════════════════════════════════════════════
-- CREATE OR REPLACE FUNCTION public.current_user_role()
-- RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
--   SELECT role FROM public.user_profiles WHERE id = auth.uid()
-- $$;
