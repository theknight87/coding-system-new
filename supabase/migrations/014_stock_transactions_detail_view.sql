-- ═══════════════════════════════════════════════════════════════
-- 014_stock_transactions_detail_view.sql
--
-- Adds a read-only, denormalized view over stock_transactions for the
-- new Stock Movements page: a running per-part balance_after (via a
-- window function, ignoring voided rows — matches recalc_part_stock's
-- own logic exactly), plus joined part and user display fields so the
-- frontend doesn't need N+1 lookups.
--
-- ⚠ RLS NOTE: this is a plain (SECURITY INVOKER, the Postgres default)
-- view — it runs with the *querying user's* row-level permissions, not
-- the view owner's. Two consequences:
--   1. stock_transactions_select (migration 011) already allows any
--      authenticated user to read every transaction, and spare_parts
--      is likewise readable by all — so part_code/part_short_desc/
--      cat/mfr/model always resolve correctly for everyone.
--   2. user_profiles' RLS (migration 003, profiles_select) only lets a
--      user read their OWN profile unless they're admin. A
--      department_user viewing this page will therefore see NULL
--      user_email/user_full_name for movements posted by other users
--      (their own movements still show correctly). This is an
--      existing app-wide restriction, not something new introduced
--      here — flagging it because the Stock Movements page has a
--      "User" column visible to non-admins. If you want every user to
--      see who posted a movement, the fix is loosening profiles_select
--      (e.g. adding a policy letting any authenticated user read
--      id/email/full_name), which is a separate decision — say so if
--      you want that as a follow-up migration.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_stock_transactions_detail AS
SELECT
  st.id, st.part_id, st.txn_type, st.quantity, st.signed_qty,
  st.location_from, st.location_to, st.reference_no, st.unit_cost, st.currency,
  st.notes, st.occurred_at, st.created_at, st.created_by, st.is_void,
  st.reverses_txn_id, st.is_estimated,
  SUM(CASE WHEN st.is_void THEN 0 ELSE st.signed_qty END)
    OVER (PARTITION BY st.part_id ORDER BY st.occurred_at, st.created_at, st.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_after,
  sp.code AS part_code, sp.short_desc AS part_short_desc,
  sp.cat, sp.mfr, sp.model, sp.unit AS part_unit,
  up.email AS user_email, up.full_name AS user_full_name
FROM public.stock_transactions st
JOIN public.spare_parts sp ON sp.id = st.part_id
LEFT JOIN public.user_profiles up ON up.id = st.created_by;

COMMENT ON VIEW public.v_stock_transactions_detail IS
  'Read-only, denormalized stock_transactions for the Stock Movements page. balance_after is a running per-part sum of signed_qty (voided rows contribute 0, matching recalc_part_stock), ties broken by created_at then id. SECURITY INVOKER — see migration file header for the user_profiles RLS caveat on the user_email/user_full_name columns.';

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP VIEW IF EXISTS public.v_stock_transactions_detail;
