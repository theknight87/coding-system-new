-- ═══════════════════════════════════════════════════════════════
-- 030_reliability_views.sql   (requested as 007_reliability_views;
-- renumbered to follow this repo's sequence, which is at 029)
--
-- The reliability analytics layer: read-only views over the
-- maintenance history that turn "what was replaced, when" into
-- comparable indicators.
--
-- THREE RULES THESE VIEWS FOLLOW THROUGHOUT
--
--   1. NET quantities only. A part issued to a job and later returned
--      was never consumed. Every view is built on
--      v_maintenance_parts_used (migration 026), which nets returns
--      off the issued quantity, and skips cancelled lines entirely.
--      Counting issued quantities would overstate consumption on any
--      job where something came back.
--
--   2. Soft-deleted rows are excluded. assets and maintenance_events
--      both carry deleted_at, and admins can still SELECT trashed rows
--      through their trash policies — analytics must not see them.
--
--   3. No extrapolation from one data point. An interval needs two
--      replacements to exist; a fleet comparison needs peers. Where
--      the evidence is not there, the column is NULL and the row is
--      omitted rather than guessed.
--
-- All views are security_invoker so they read with the caller's own
-- permissions rather than the owner's.
-- ═══════════════════════════════════════════════════════════════

-- ─── 0. Shared base: one row per part actually consumed on a job ──
-- Every view below builds on this, so the net/cancelled/soft-delete
-- rules are defined once instead of repeated five times.
DROP VIEW IF EXISTS public.v_part_failure_patterns   CASCADE;
DROP VIEW IF EXISTS public.v_asset_cost_summary      CASCADE;
DROP VIEW IF EXISTS public.v_asset_reliability_flags CASCADE;
DROP VIEW IF EXISTS public.v_fleet_part_baseline     CASCADE;
DROP VIEW IF EXISTS public.v_asset_part_history      CASCADE;
DROP VIEW IF EXISTS public.v_part_replacements       CASCADE;

CREATE VIEW public.v_part_replacements
WITH (security_invoker = on) AS
SELECT
  me.asset_id,
  a.asset_tag,
  a.model                       AS asset_model,
  a.mfr                         AS asset_mfr,
  a.location                    AS asset_location,
  vmp.part_id,
  vmp.part_code,
  vmp.part_short_desc,
  vmp.part_fg                   AS fg,
  sp.cat                        AS part_cat,
  sp.mfr                        AS part_mfr,
  me.id                         AS maintenance_event_id,
  me.event_date,
  me.event_type,
  me.title                      AS event_title,
  me.work_order_no,
  me.failure_mode,
  me.root_cause,
  me.downtime_hours,
  vmp.net_qty,
  vmp.unit_cost,
  vmp.net_qty * COALESCE(vmp.unit_cost, 0) AS line_cost
FROM public.v_maintenance_parts_used vmp
JOIN public.maintenance_events me ON me.id = vmp.maintenance_event_id AND me.deleted_at IS NULL
JOIN public.assets           a  ON a.id  = me.asset_id               AND a.deleted_at  IS NULL
JOIN public.spare_parts      sp ON sp.id = vmp.part_id
WHERE vmp.is_cancelled = false
  AND vmp.net_qty > 0;

COMMENT ON VIEW public.v_part_replacements IS
  'Base view for the reliability layer: one row per part genuinely consumed on a maintenance job, with returns netted off, cancelled lines dropped, and soft-deleted assets/events excluded. Every other reliability view is built on this one.';

-- ─── 1. Per asset + part: how often, how much, how far apart ──────
CREATE VIEW public.v_asset_part_history
WITH (security_invoker = on) AS
SELECT
  r.asset_id, r.asset_tag, r.asset_model,
  r.part_id,  r.part_code, r.part_short_desc, r.fg,
  COUNT(DISTINCT r.maintenance_event_id)                        AS times_replaced,
  SUM(r.net_qty)                                                AS total_qty,
  ROUND(SUM(r.line_cost), 2)                                    AS total_cost,
  MIN(r.event_date)                                             AS first_replaced_at,
  MAX(r.event_date)                                             AS last_replaced_at,
  -- Mean gap between consecutive replacements: the span divided by
  -- the number of gaps, which is one fewer than the replacements.
  -- NULL below two, where there is no gap to measure.
  CASE WHEN COUNT(DISTINCT r.maintenance_event_id) >= 2
    THEN ROUND(
      (MAX(r.event_date) - MIN(r.event_date))::numeric
      / (COUNT(DISTINCT r.maintenance_event_id) - 1), 1)
  END                                                           AS avg_days_between_replacements,
  (CURRENT_DATE - MAX(r.event_date))                            AS days_since_last_replacement,
  -- Last replacement plus one average interval. Deliberately NULL on
  -- a single replacement: one point is a date, not a rate.
  CASE WHEN COUNT(DISTINCT r.maintenance_event_id) >= 2
    THEN MAX(r.event_date) + ROUND(
      (MAX(r.event_date) - MIN(r.event_date))::numeric
      / (COUNT(DISTINCT r.maintenance_event_id) - 1))::int
  END                                                           AS estimated_next_replacement_date
FROM public.v_part_replacements r
GROUP BY r.asset_id, r.asset_tag, r.asset_model,
         r.part_id, r.part_code, r.part_short_desc, r.fg;

COMMENT ON VIEW public.v_asset_part_history IS
  'Per asset and part: replacement count, quantity, cost, first/last dates, mean interval and a projected next date. Interval and projection are NULL below two replacements — a single event carries no rate.';

-- ─── 2. Fleet baseline per model + functional group ───────────────
-- Averaged over EVERY asset of the model, including those that never
-- replaced anything in that group. Averaging only over assets that did
-- would compare a machine against the unlucky ones and make a normal
-- unit look good.
CREATE VIEW public.v_fleet_part_baseline
WITH (security_invoker = on) AS
WITH model_fg AS (
  SELECT DISTINCT asset_model, fg FROM public.v_part_replacements
),
per_asset AS (
  SELECT
    mf.asset_model, mf.fg, a.id AS asset_id,
    COUNT(DISTINCT r.maintenance_event_id) AS times_replaced
  FROM model_fg mf
  JOIN public.assets a
    ON a.model = mf.asset_model AND a.deleted_at IS NULL
  LEFT JOIN public.v_part_replacements r
    ON r.asset_id = a.id AND r.fg = mf.fg
  GROUP BY mf.asset_model, mf.fg, a.id
)
SELECT
  asset_model, fg,
  COUNT(*)                                                          AS asset_count,
  SUM(times_replaced)                                               AS total_replacements,
  ROUND(AVG(times_replaced), 2)                                     AS avg_times_replaced_per_asset,
  ROUND(
    (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY times_replaced))::numeric, 2)
                                                                    AS median_times_replaced_per_asset,
  MAX(times_replaced)                                               AS max_times_replaced_per_asset
FROM per_asset
GROUP BY asset_model, fg;

COMMENT ON VIEW public.v_fleet_part_baseline IS
  'Per equipment model and functional group: how many replacements a typical asset of that model has had. Averages and the median include assets with zero replacements, so a single unit can be compared against its peers fairly. asset_count is the peer group size.';

-- ─── 3. Reliability flags ─────────────────────────────────────────
-- Both sides of the comparison use the SAME rolling 12 months: an
-- asset's recent year measured against an all-time fleet median would
-- compare different spans and flag healthy machines.
--
-- Three guards against noise, each one excluding rows rather than
-- reporting a weak signal:
--   * at least 3 assets of the model — below that there is no fleet
--     to be an outlier of;
--   * fleet median above zero — when the typical asset replaces
--     nothing, "twice the median" is zero and every asset qualifies;
--   * at least 2 replacements on this asset — one is an incident,
--     not a pattern.
CREATE VIEW public.v_asset_reliability_flags
WITH (security_invoker = on) AS
WITH model_fg AS (
  SELECT DISTINCT asset_model, fg FROM public.v_part_replacements
),
per_asset_12m AS (
  SELECT
    mf.asset_model, mf.fg, a.id AS asset_id, a.asset_tag,
    COUNT(DISTINCT r.maintenance_event_id) AS replacements_12m
  FROM model_fg mf
  JOIN public.assets a
    ON a.model = mf.asset_model AND a.deleted_at IS NULL
  LEFT JOIN public.v_part_replacements r
    ON r.asset_id = a.id
   AND r.fg = mf.fg
   AND r.event_date >= (CURRENT_DATE - INTERVAL '12 months')::date
  GROUP BY mf.asset_model, mf.fg, a.id, a.asset_tag
),
fleet_12m AS (
  SELECT
    asset_model, fg,
    COUNT(*) AS asset_count,
    (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY replacements_12m))::numeric AS fleet_median_12m,
    ROUND(AVG(replacements_12m), 2) AS fleet_avg_12m
  FROM per_asset_12m
  GROUP BY asset_model, fg
)
SELECT
  p.asset_id, p.asset_tag, p.asset_model, p.fg,
  fg_ref.label                                        AS fg_label,
  p.replacements_12m                                  AS asset_replacements_12m,
  ROUND(f.fleet_median_12m, 2)                        AS fleet_median_12m,
  f.fleet_avg_12m,
  f.asset_count                                       AS fleet_asset_count,
  ROUND(p.replacements_12m / f.fleet_median_12m, 2)   AS ratio_to_fleet_median,
  CASE
    WHEN p.replacements_12m >= 5 * f.fleet_median_12m THEN 'critical'
    WHEN p.replacements_12m >= 3 * f.fleet_median_12m THEN 'investigate'
    ELSE 'watch'
  END                                                 AS severity,
  CASE
    WHEN p.replacements_12m >= 5 * f.fleet_median_12m THEN 3
    WHEN p.replacements_12m >= 3 * f.fleet_median_12m THEN 2
    ELSE 1
  END                                                 AS severity_rank
FROM per_asset_12m p
JOIN fleet_12m f USING (asset_model, fg)
LEFT JOIN public.functional_groups fg_ref
       ON fg_ref.code = p.fg AND fg_ref.deleted_at IS NULL
WHERE f.asset_count      >= 3
  AND f.fleet_median_12m  > 0
  AND p.replacements_12m >= 2
  AND p.replacements_12m >= 2 * f.fleet_median_12m;

COMMENT ON VIEW public.v_asset_reliability_flags IS
  'Assets replacing a functional group at least twice as often as their fleet peers over the same rolling 12 months. Requires 3+ assets of the model, a fleet median above zero, and 2+ replacements on the asset — each guard drops rows that would otherwise be statistically meaningless. These are indicators to investigate, not conclusions: fleet_asset_count and fleet_median_12m are the sample behind every row.';

-- ─── 4. Cost per asset per year ───────────────────────────────────
CREATE VIEW public.v_asset_cost_summary
WITH (security_invoker = on) AS
WITH events AS (
  SELECT
    me.asset_id,
    EXTRACT(YEAR FROM me.event_date)::int      AS year,
    COUNT(*)                                    AS event_count,
    SUM(COALESCE(me.downtime_hours, 0))         AS downtime_hours
  FROM public.maintenance_events me
  JOIN public.assets a ON a.id = me.asset_id AND a.deleted_at IS NULL
  WHERE me.deleted_at IS NULL
  GROUP BY me.asset_id, EXTRACT(YEAR FROM me.event_date)
),
parts AS (
  SELECT
    asset_id,
    EXTRACT(YEAR FROM event_date)::int          AS year,
    ROUND(SUM(line_cost), 2)                    AS parts_cost,
    SUM(net_qty)                                AS parts_qty,
    COUNT(DISTINCT part_id)                     AS distinct_parts
  FROM public.v_part_replacements
  GROUP BY asset_id, EXTRACT(YEAR FROM event_date)
),
-- Hours actually run in the year, summed from consecutive readings.
-- A counter reset (or any backwards reading) would make max-minus-min
-- nonsense, so only forward deltas on non-reset rows are counted.
readings AS (
  SELECT
    asset_id, read_at, reading_hours, is_counter_reset,
    LAG(reading_hours) OVER (PARTITION BY asset_id ORDER BY read_at, id) AS prev_hours
  FROM public.asset_hours_log
),
hours AS (
  SELECT
    asset_id,
    EXTRACT(YEAR FROM read_at)::int             AS year,
    SUM(GREATEST(reading_hours - prev_hours, 0))
      FILTER (WHERE prev_hours IS NOT NULL AND is_counter_reset IS NOT TRUE) AS hours_run
  FROM readings
  GROUP BY asset_id, EXTRACT(YEAR FROM read_at)
)
SELECT
  a.id                                          AS asset_id,
  a.asset_tag, a.model AS asset_model, a.mfr AS asset_mfr, a.status,
  y.year,
  COALESCE(p.parts_cost, 0)                     AS parts_cost,
  COALESCE(p.parts_qty, 0)                      AS parts_qty,
  COALESCE(p.distinct_parts, 0)                 AS distinct_parts,
  COALESCE(e.event_count, 0)                    AS event_count,
  COALESCE(e.downtime_hours, 0)                 AS downtime_hours,
  h.hours_run,
  -- NULL, not zero, when the hours log cannot support the division —
  -- an unknown rate must not read as a free machine.
  ROUND(COALESCE(p.parts_cost, 0) / NULLIF(h.hours_run, 0), 3) AS cost_per_running_hour
FROM public.assets a
JOIN (
  SELECT asset_id, year FROM events
  UNION
  SELECT asset_id, year FROM parts
) y ON y.asset_id = a.id
LEFT JOIN events e ON e.asset_id = a.id AND e.year = y.year
LEFT JOIN parts  p ON p.asset_id = a.id AND p.year = y.year
LEFT JOIN hours  h ON h.asset_id = a.id AND h.year = y.year
WHERE a.deleted_at IS NULL;

COMMENT ON VIEW public.v_asset_cost_summary IS
  'Per asset per calendar year: parts cost (net of returns), event count, downtime and cost per running hour. hours_run is summed from forward deltas in asset_hours_log, ignoring counter resets; cost_per_running_hour is NULL rather than 0 when no hours were logged that year.';

-- ─── 5. Failure patterns per part ─────────────────────────────────
CREATE VIEW public.v_part_failure_patterns
WITH (security_invoker = on) AS
SELECT
  r.part_id, r.part_code, r.part_short_desc, r.fg,
  r.asset_model,
  btrim(r.failure_mode)                          AS failure_mode,
  COUNT(DISTINCT r.maintenance_event_id)         AS occurrences,
  COUNT(DISTINCT r.asset_id)                     AS assets_affected,
  SUM(r.net_qty)                                 AS total_qty,
  ROUND(SUM(r.line_cost), 2)                     AS total_cost,
  MIN(r.event_date)                              AS first_seen,
  MAX(r.event_date)                              AS last_seen
FROM public.v_part_replacements r
WHERE r.failure_mode IS NOT NULL
  AND btrim(r.failure_mode) <> ''
GROUP BY r.part_id, r.part_code, r.part_short_desc, r.fg,
         r.asset_model, btrim(r.failure_mode);

COMMENT ON VIEW public.v_part_failure_patterns IS
  'Which failure modes are recorded against which part, on which model, and how often — the free-text failure_mode field aggregated into something countable. Only corrective events carry a failure mode, so parts fitted during planned work do not appear.';

-- ─── Grants ───────────────────────────────────────────────────────
GRANT SELECT ON public.v_part_replacements       TO authenticated;
GRANT SELECT ON public.v_asset_part_history      TO authenticated;
GRANT SELECT ON public.v_fleet_part_baseline     TO authenticated;
GRANT SELECT ON public.v_asset_reliability_flags TO authenticated;
GRANT SELECT ON public.v_asset_cost_summary      TO authenticated;
GRANT SELECT ON public.v_part_failure_patterns   TO authenticated;

-- ─── Indexes supporting these views ───────────────────────────────
-- The joins all funnel through event -> asset and event -> parts.
CREATE INDEX IF NOT EXISTS maintenance_events_asset_date_idx
  ON public.maintenance_events (asset_id, event_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS maintenance_parts_used_part_idx
  ON public.maintenance_parts_used (part_id);
CREATE INDEX IF NOT EXISTS assets_model_idx
  ON public.assets (model) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS asset_hours_log_asset_read_idx
  ON public.asset_hours_log (asset_id, read_at);

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP VIEW IF EXISTS public.v_part_failure_patterns;
-- DROP VIEW IF EXISTS public.v_asset_cost_summary;
-- DROP VIEW IF EXISTS public.v_asset_reliability_flags;
-- DROP VIEW IF EXISTS public.v_fleet_part_baseline;
-- DROP VIEW IF EXISTS public.v_asset_part_history;
-- DROP VIEW IF EXISTS public.v_part_replacements;
-- DROP INDEX IF EXISTS public.maintenance_events_asset_date_idx;
-- DROP INDEX IF EXISTS public.maintenance_parts_used_part_idx;
-- DROP INDEX IF EXISTS public.assets_model_idx;
-- DROP INDEX IF EXISTS public.asset_hours_log_asset_read_idx;
