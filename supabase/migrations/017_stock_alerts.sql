-- ═══════════════════════════════════════════════════════════════
-- 017_stock_alerts.sql
--
-- Turns the existing passive stock_status colour-coding (Reorder
-- Settings page) into an active alerting layer: acknowledge/snooze
-- tracking, a counts RPC for the Dashboard tiles + header bell, and a
-- detail view for the new Stock Alerts page.
--
-- ⚠ DELIBERATELY DOES NOT create a parallel v_stock_alerts view.
-- v_stock_status (migration 015) already computes the exact same
-- out/critical/low/ok/unset severity logic with severity_rank. This
-- migration builds v_active_alerts ON TOP of it instead of duplicating
-- the CASE expression a second time — one source of truth.
--
-- v_stock_status itself is NOT modified: Reorder Settings currently
-- relies on it showing every part regardless of status/disc/location,
-- so adding a `status = 'Active'` filter there would silently hide
-- Inactive/Obsolete parts from that existing page. That filter is
-- applied only in the new v_active_alerts, scoped to alerts.
--
-- 'unset' (v_stock_status's existing term for "no reorder_point/
-- min_stock configured") is kept as-is rather than renamed to the
-- spec's "unconfigured" — Reorder Settings' STOCK_STATUS_META and
-- filter logic already key off the literal string 'unset'; renaming
-- it would break that page for no functional benefit. The new Alerts
-- UI labels it "Not Configured" for the user without touching the
-- underlying value.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Acknowledge / snooze table ──────────────────────────────
-- Alerts are computed live from v_stock_status; only "a user has
-- seen or deferred this" is persisted. UNIQUE(part_id, severity)
-- means a part that degrades from low -> critical no longer matches
-- its old acknowledgement row, so the alert reappears automatically.
-- This is intentional.
CREATE TABLE IF NOT EXISTS public.alert_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.spare_parts(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('low','critical','out')),
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  snooze_until timestamptz,
  note text,
  UNIQUE (part_id, severity)
);

CREATE INDEX IF NOT EXISTS idx_alert_ack_part ON public.alert_acknowledgements(part_id);

COMMENT ON TABLE public.alert_acknowledgements IS
  'Persists that a user acknowledged or snoozed a part''s current alert severity. Alerts themselves are never stored — always computed live from v_stock_status. UNIQUE(part_id,severity) means a severity change (e.g. low -> critical) drops the old ack and the alert reappears.';

-- RLS — mirrors stock_transactions' pattern (migration 011): any
-- authenticated user may read (needed so everyone sees acknowledged
-- state reflected in the UI), only admin/department_user may write,
-- matching every other write-capable table in this project.
ALTER TABLE public.alert_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_ack_select ON public.alert_acknowledgements;
CREATE POLICY alert_ack_select ON public.alert_acknowledgements
  FOR SELECT USING (true);

DROP POLICY IF EXISTS alert_ack_insert ON public.alert_acknowledgements;
CREATE POLICY alert_ack_insert ON public.alert_acknowledgements
  FOR INSERT WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS alert_ack_update ON public.alert_acknowledgements;
CREATE POLICY alert_ack_update ON public.alert_acknowledgements
  FOR UPDATE USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS alert_ack_delete ON public.alert_acknowledgements;
CREATE POLICY alert_ack_delete ON public.alert_acknowledgements
  FOR DELETE USING (current_user_role() = ANY (ARRAY['admin','department_user']));

-- ─── 2. v_active_alerts ─────────────────────────────────────────
-- Built on v_stock_status (not spare_parts directly) so the severity
-- CASE expression is defined exactly once. Adds the columns the
-- Alerts page needs that v_stock_status doesn't carry (disc,
-- location, unit, status), the spec's shortage_qty formula
-- (distinct from v_stock_status's existing suggested_order_qty,
-- which uses a different max_stock-aware formula used by Reorder
-- Settings — both are kept, for their respective pages), and
-- acknowledgement state.
--
-- Excludes status <> 'Active' (confirmed) and stock_status = 'unset'
-- or 'ok' (unset parts surface separately via get_unconfigured_count).
--
-- last_movement_at is deliberately omitted (see migration comment in
-- 014 for why a per-row LATERAL subquery over stock_transactions is
-- avoided at this scale) — the Alerts page fetches it only for the
-- current page of visible rows, not for the whole view.
CREATE OR REPLACE VIEW public.v_active_alerts AS
SELECT
  vs.id AS part_id, vs.code, vs.short_desc, vs.cat, vs.mfr, vs.model, vs.fg,
  sp.disc, sp.location, sp.unit, sp.status,
  vs.qty_on_hand, vs.min_stock, vs.reorder_point, vs.max_stock,
  vs.is_critical, vs.lead_time_days, vs.preferred_supplier, vs.last_counted_at,
  vs.stock_status, vs.severity_rank,
  GREATEST(COALESCE(vs.reorder_point, vs.min_stock, 0) - vs.qty_on_hand, 0) AS shortage_qty,
  ack.acknowledged_at, ack.acknowledged_by, ack.snooze_until, ack.note AS ack_note,
  (ack.id IS NOT NULL AND (ack.snooze_until IS NULL OR ack.snooze_until > now())) AS is_acknowledged
FROM public.v_stock_status vs
JOIN public.spare_parts sp ON sp.id = vs.id
LEFT JOIN public.alert_acknowledgements ack
  ON ack.part_id = vs.id AND ack.severity = vs.stock_status
WHERE vs.stock_status IN ('out','critical','low')
  AND sp.status = 'Active';

COMMENT ON VIEW public.v_active_alerts IS
  'Live, unstored alert rows (out/critical/low only, Active parts only) built on v_stock_status, with acknowledgement/snooze state joined in. SECURITY INVOKER — inherits caller RLS from v_stock_status/spare_parts/alert_acknowledgements.';

-- ─── 3. Counts RPCs — single round trip for tiles + bell ────────
CREATE OR REPLACE FUNCTION public.get_alert_counts()
RETURNS TABLE (severity text, total bigint, unacknowledged bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT stock_status AS severity,
         count(*) AS total,
         count(*) FILTER (WHERE NOT is_acknowledged) AS unacknowledged
  FROM public.v_active_alerts
  GROUP BY stock_status;
$$;

COMMENT ON FUNCTION public.get_alert_counts() IS
  'One aggregate query for out/critical/low counts (total + unacknowledged), read by the Dashboard tiles and header bell so neither runs its own row-returning query.';

CREATE OR REPLACE FUNCTION public.get_unconfigured_count()
RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT count(*) FROM public.v_stock_status vs
  JOIN public.spare_parts sp ON sp.id = vs.id
  WHERE vs.stock_status = 'unset' AND sp.status = 'Active';
$$;

COMMENT ON FUNCTION public.get_unconfigured_count() IS
  'Count of Active parts with no reorder_point/min_stock configured — the Dashboard''s grey "Not Configured" tile.';

-- ─── 4. Grants ───────────────────────────────────────────────────
GRANT SELECT ON public.v_active_alerts TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_alert_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unconfigured_count() TO authenticated;

-- No new indexes needed: cat/mfr/model/disc/status/fg/qty_on_hand
-- indexes already exist on spare_parts (migrations 007/015), and
-- min_stock/reorder_point are only ever compared inline per-row
-- inside the stock_status CASE, not filtered on directly.

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- REVOKE EXECUTE ON FUNCTION public.get_unconfigured_count() FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.get_alert_counts() FROM authenticated;
-- REVOKE SELECT ON public.v_active_alerts FROM authenticated;
-- DROP FUNCTION IF EXISTS public.get_unconfigured_count();
-- DROP FUNCTION IF EXISTS public.get_alert_counts();
-- DROP VIEW IF EXISTS public.v_active_alerts;
-- DROP TABLE IF EXISTS public.alert_acknowledgements;
