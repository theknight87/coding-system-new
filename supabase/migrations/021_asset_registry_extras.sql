-- ═══════════════════════════════════════════════════════════════
-- 021_asset_registry_extras.sql
--
-- Small additive follow-up to 020_assets.sql, needed for the Asset
-- Registry frontend:
--   1. asset-photos Storage bucket + policies, mirroring the existing
--      part-images pattern exactly (public bucket, insert by any
--      authenticated user, delete admin-only).
--   2. v_assets_overview gains open_events_count (status='open' only,
--      distinct from the existing event_count which is all non-
--      deleted events) — needed for the registry table's "Open
--      items" column. Safe to amend with CREATE OR REPLACE VIEW:
--      the table has 0 rows and no other code references this view
--      yet (020 was schema-only, no frontend shipped).
--   3. v_asset_kpis — one-row aggregate for the registry page's KPI
--      tiles, so the frontend never counts rows client-side.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-photos', 'asset-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_asset_photos_select ON storage.objects;
CREATE POLICY storage_asset_photos_select ON storage.objects
  FOR SELECT USING (bucket_id = 'asset-photos');

DROP POLICY IF EXISTS storage_asset_photos_insert ON storage.objects;
CREATE POLICY storage_asset_photos_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'asset-photos');

DROP POLICY IF EXISTS storage_asset_photos_delete ON storage.objects;
CREATE POLICY storage_asset_photos_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'asset-photos' AND current_user_role() = 'admin');

-- v_assets_overview's column order changes (open_event_count inserted
-- mid-list) — CREATE OR REPLACE VIEW can add trailing columns but not
-- reorder/insert them, and v_asset_pm_due depends on this view, so
-- both must be dropped and recreated rather than replaced in place.
DROP VIEW IF EXISTS public.v_asset_pm_due;
DROP VIEW IF EXISTS public.v_assets_overview;

CREATE VIEW public.v_assets_overview AS
SELECT
  a.id, a.asset_tag, a.serial_number, a.cat, a.mfr, a.model,
  cat.label AS cat_label, mfr.label AS mfr_label, mdl.label AS model_label,
  a.site, a.location, a.sub_location, a.status,
  a.commissioned_at, a.warranty_until,
  a.running_hours, a.pm_interval_hours, a.last_pm_hours, a.last_pm_date, a.pm_interval_days,
  a.photo_url, a.notes,
  ev.event_count, ev.open_event_count, ev.last_event_date,
  CASE WHEN a.pm_interval_hours IS NOT NULL
       THEN a.pm_interval_hours - (a.running_hours - COALESCE(a.last_pm_hours, 0))
       ELSE NULL END AS hours_until_pm,
  CASE WHEN a.pm_interval_days IS NOT NULL AND a.last_pm_date IS NOT NULL
       THEN (a.last_pm_date + (a.pm_interval_days || ' days')::interval)::date - CURRENT_DATE
       ELSE NULL END AS days_until_pm,
  (
    (a.pm_interval_hours IS NOT NULL
      AND (a.pm_interval_hours - (a.running_hours - COALESCE(a.last_pm_hours, 0))) <= a.pm_interval_hours * 0.1)
    OR
    (a.pm_interval_days IS NOT NULL AND a.last_pm_date IS NOT NULL
      AND ((a.last_pm_date + (a.pm_interval_days || ' days')::interval)::date - CURRENT_DATE) <= a.pm_interval_days * 0.1)
  ) AS pm_due
FROM public.assets a
JOIN public.categories cat ON cat.code = a.cat
JOIN public.manufacturers mfr ON mfr.code = a.mfr
JOIN public.models mdl ON mdl.code = a.model
LEFT JOIN LATERAL (
  SELECT count(*) AS event_count,
         count(*) FILTER (WHERE me.status = 'open') AS open_event_count,
         max(event_date) AS last_event_date
  FROM public.maintenance_events me
  WHERE me.asset_id = a.id AND me.deleted_at IS NULL
) ev ON true
WHERE a.deleted_at IS NULL;

COMMENT ON VIEW public.v_assets_overview IS
  'Asset list with joined labels, total/open maintenance event counts, last event date, and PM-due computation by both hours and calendar days.';

CREATE VIEW public.v_asset_pm_due AS
SELECT * FROM public.v_assets_overview WHERE pm_due = true;

GRANT SELECT ON public.v_assets_overview, public.v_asset_pm_due TO authenticated;

-- One-row KPI aggregate for the Asset Registry page's stat tiles.
-- "Due within 30 days" is broader than the view's own pm_due flag
-- (which fires at 10% of the interval remaining, whichever basis is
-- configured): it also counts calendar-based assets whose next PM
-- date falls within 30 days even if that's more than 10% of a long
-- interval away. Hour-based intervals have no reliable way to convert
-- remaining hours into a day estimate without a usage-rate figure
-- this schema doesn't track, so hour-based assets only count via the
-- existing pm_due (10%-of-interval) flag, not a synthetic day count.
CREATE OR REPLACE VIEW public.v_asset_kpis AS
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE status = 'active') AS active,
  count(*) FILTER (WHERE status = 'maintenance') AS in_maintenance,
  count(*) FILTER (WHERE status = 'down') AS down,
  count(*) FILTER (WHERE pm_due OR (days_until_pm IS NOT NULL AND days_until_pm <= 30)) AS due_30
FROM public.v_assets_overview;

COMMENT ON VIEW public.v_asset_kpis IS
  'Single-row KPI aggregate for the Asset Registry page stat tiles — total/active/maintenance/down/due-within-30-days, computed server-side so the frontend never counts rows client-side.';

GRANT SELECT ON public.v_asset_kpis TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP VIEW IF EXISTS public.v_asset_kpis;
-- (v_assets_overview/v_asset_pm_due: revert to the 020 definition, or
--  DROP VIEW IF EXISTS public.v_asset_pm_due; DROP VIEW IF EXISTS public.v_assets_overview; per 020's rollback)
-- DROP POLICY IF EXISTS storage_asset_photos_delete ON storage.objects;
-- DROP POLICY IF EXISTS storage_asset_photos_insert ON storage.objects;
-- DROP POLICY IF EXISTS storage_asset_photos_select ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'asset-photos';
