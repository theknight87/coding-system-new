-- ═══════════════════════════════════════════════════════════════
-- 020_assets.sql  (requested as "005_assets.sql" — renumbered into
-- this repo's real sequence, already at 019; see chat for why)
--
-- Asset registry: physical equipment units (compressors, engines,
-- etc.), their running-hours log, maintenance history, and the spare
-- parts consumed by each maintenance event.
--
-- SCHEMA-ONLY per request — no frontend in this migration. Audit
-- logging (CREATE/UPDATE via the app's audit() helper in db.js) will
-- be added at the frontend layer when asset CRUD functions are built,
-- matching every other table in this app (audit_logs writes are
-- JS-side per insert/update function, not DB triggers).
--
-- NAMING DEVIATIONS FROM THE LITERAL REQUEST (schema doesn't support
-- the literal request — flagged rather than guessed):
--   - No `category_id`/`manufacturer_id`/`model_id` uuid columns.
--     categories/manufacturers/models all use `code text` as their
--     primary key (no uuid id column exists on any of them) — same
--     as spare_parts.cat/mfr/model. assets.cat/mfr/model follow that
--     exact existing convention instead of inventing new uuid FKs.
--   - `model` FKs to `public.models(code)` — there is no
--     `equipment_models` table in this schema.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. assets ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag           text NOT NULL UNIQUE,
  serial_number       text,
  cat                 text NOT NULL REFERENCES public.categories(code),
  mfr                 text NOT NULL REFERENCES public.manufacturers(code),
  model               text NOT NULL REFERENCES public.models(code),
  site                text,
  location            text,
  sub_location        text,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','maintenance','down','standby','decommissioned')),
  commissioned_at     date,
  warranty_until      date,
  running_hours       numeric(12,1) NOT NULL DEFAULT 0,
  pm_interval_hours   integer,
  last_pm_hours       numeric(12,1),
  last_pm_date        date,
  pm_interval_days    integer,
  photo_url           text,
  notes               text,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.assets IS
  'Physical equipment registry. asset_tag format mirrors the part-code discipline: {cat}-{mfr}-{model}-{3-digit sequence}, e.g. CP-GA-G04-014. Generated via next_asset_tag() below — same client-queries-then-inserts convention as the existing part-code generator (CodeGeneratorPage), wrapped in an advisory-lock-protected SQL function since asset tags are physical labels where a collision is more costly than for a part code.';

CREATE INDEX IF NOT EXISTS assets_model_idx    ON public.assets(model)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assets_status_idx   ON public.assets(status)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS assets_location_idx ON public.assets(location) WHERE deleted_at IS NULL;

-- Reasoning: this table starts at 0 rows, so a live EXPLAIN (the
-- standard this project holds itself to — see migration 015) would
-- only show trivial seq scans regardless of indexing and wouldn't be
-- meaningful evidence either way. These three indexes are added
-- pre-emptively because they mirror spare_parts' own indexed filter
-- columns (cat/mfr/model/status/fg, migration 007) for the identical
-- expected access pattern — an Assets page filtered by model/status/
-- location, same shape as the Master Parts Table. Revisit with a real
-- EXPLAIN once there's production data, same as was done for
-- spare_parts_fg_idx/qty_on_hand_idx in 015.

-- Reuses the existing set_updated_at() trigger function from
-- migration 001 rather than defining a duplicate.
DROP TRIGGER IF EXISTS set_updated_at ON public.assets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. Asset tag generator ──────────────────────────────────────
-- Same "read existing, take max, +1" logic as the part-code generator
-- (App.jsx CodeGeneratorPage), but wrapped in a transaction-scoped
-- advisory lock keyed by cat+mfr+model so two techs creating an asset
-- for the same combination at the same moment can't both compute the
-- same next sequence number — worth the extra safety here since an
-- asset_tag collision means a duplicate physical equipment label, a
-- more expensive mistake than a rejected duplicate part code.
CREATE OR REPLACE FUNCTION public.next_asset_tag(p_cat text, p_mfr text, p_model text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cat || '-' || p_mfr || '-' || p_model, 0));
  SELECT COALESCE(MAX(NULLIF(split_part(asset_tag, '-', 4), '')::int), 0) + 1
    INTO v_next
    FROM public.assets
   WHERE cat = p_cat AND mfr = p_mfr AND model = p_model;
  RETURN p_cat || '-' || p_mfr || '-' || p_model || '-' || lpad(v_next::text, 3, '0');
END;
$$;

COMMENT ON FUNCTION public.next_asset_tag(text,text,text) IS
  'Returns the next asset_tag for a cat+mfr+model combination, e.g. CP-GA-G04-014. Call this and INSERT within the same transaction/session to actually reserve the number — the advisory lock only protects the read, not a gap between generating and inserting in separate round trips.';

GRANT EXECUTE ON FUNCTION public.next_asset_tag(text,text,text) TO authenticated;

-- ─── 3. asset_hours_log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_hours_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  reading_hours     numeric(12,1) NOT NULL,
  read_at           timestamptz NOT NULL DEFAULT now(),
  read_by           uuid REFERENCES auth.users(id),
  is_counter_reset  boolean NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_hours_log_asset_idx ON public.asset_hours_log(asset_id, read_at DESC);

COMMENT ON TABLE public.asset_hours_log IS
  'Append-only running-hours meter readings. A trigger below rejects a reading lower than the asset''s previous reading unless is_counter_reset is true (e.g. an hour-meter was physically replaced), and keeps assets.running_hours in sync with the latest accepted reading.';

CREATE OR REPLACE FUNCTION public.apply_asset_hours_reading()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last numeric(12,1);
BEGIN
  SELECT running_hours INTO v_last FROM public.assets WHERE id = NEW.asset_id;
  IF NOT NEW.is_counter_reset AND v_last IS NOT NULL AND NEW.reading_hours < v_last THEN
    RAISE EXCEPTION 'reading_hours (%) is lower than the asset''s current running_hours (%) — set is_counter_reset=true if the meter was actually reset/replaced', NEW.reading_hours, v_last;
  END IF;
  UPDATE public.assets SET running_hours = NEW.reading_hours WHERE id = NEW.asset_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS asset_hours_log_apply ON public.asset_hours_log;
CREATE TRIGGER asset_hours_log_apply AFTER INSERT ON public.asset_hours_log
  FOR EACH ROW EXECUTE FUNCTION public.apply_asset_hours_reading();

-- ─── 4. maintenance_events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.maintenance_events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                  uuid NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  event_type                text NOT NULL
                              CHECK (event_type IN ('installation','preventive','corrective','inspection','overhaul','modification')),
  event_date                date NOT NULL,
  title                     text NOT NULL,
  description               text,
  running_hours_at_event    numeric(12,1),
  downtime_hours            numeric(10,2),
  work_order_no             text,
  performed_by              text,
  status                    text NOT NULL DEFAULT 'completed'
                              CHECK (status IN ('open','completed','cancelled')),
  failure_mode              text,
  root_cause                text,
  deleted_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS maintenance_events_asset_date_idx
  ON public.maintenance_events(asset_id, event_date DESC) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.maintenance_events IS
  'Maintenance/inspection/overhaul history per asset. performed_by is free text (may be an external contractor, not necessarily an app user). ON DELETE RESTRICT on asset_id — an asset with maintenance history can''t be hard-deleted out from under its own records.';

-- ─── 5. maintenance_parts_used ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.maintenance_parts_used (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_event_id    uuid NOT NULL REFERENCES public.maintenance_events(id) ON DELETE CASCADE,
  part_id                 uuid NOT NULL REFERENCES public.spare_parts(id),
  quantity                numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost               numeric(14,4),
  stock_transaction_id    uuid REFERENCES public.stock_transactions(id),
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS maintenance_parts_used_event_idx ON public.maintenance_parts_used(maintenance_event_id);
CREATE INDEX IF NOT EXISTS maintenance_parts_used_part_idx  ON public.maintenance_parts_used(part_id);

COMMENT ON TABLE public.maintenance_parts_used IS
  'Parts consumed by a maintenance event. stock_transaction_id is left nullable here — a future migration will add a trigger that posts a stock_transactions issue row and back-fills this column when a part is logged against a maintenance event.';

-- ─── 6. RLS — mirrors spare_parts / stock_transactions exactly ───
ALTER TABLE public.assets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_hours_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_parts_used  ENABLE ROW LEVEL SECURITY;

-- assets: same shape as spare_parts_select/insert/update/trash_select/hard_delete
DROP POLICY IF EXISTS assets_select ON public.assets;
CREATE POLICY assets_select ON public.assets FOR SELECT USING (deleted_at IS NULL);

DROP POLICY IF EXISTS assets_trash_select ON public.assets;
CREATE POLICY assets_trash_select ON public.assets
  FOR SELECT USING (deleted_at IS NOT NULL AND current_user_role() = 'admin');

DROP POLICY IF EXISTS assets_insert ON public.assets;
CREATE POLICY assets_insert ON public.assets
  FOR INSERT WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS assets_update ON public.assets;
CREATE POLICY assets_update ON public.assets
  FOR UPDATE USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS assets_hard_delete ON public.assets;
CREATE POLICY assets_hard_delete ON public.assets
  FOR DELETE USING (deleted_at IS NOT NULL AND current_user_role() = 'admin');

-- asset_hours_log: append-only, same read-everything/write-by-role
-- shape as stock_transactions — no UPDATE/DELETE policy at all
-- (default-deny), since a meter reading is a historical record, not
-- an editable field; a mistaken reading is corrected by inserting a
-- new one with is_counter_reset if needed.
DROP POLICY IF EXISTS asset_hours_log_select ON public.asset_hours_log;
CREATE POLICY asset_hours_log_select ON public.asset_hours_log FOR SELECT USING (true);

DROP POLICY IF EXISTS asset_hours_log_insert ON public.asset_hours_log;
CREATE POLICY asset_hours_log_insert ON public.asset_hours_log
  FOR INSERT WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

-- maintenance_events: same shape as assets, but delete requires
-- soft-delete first (deleted_at set) then admin hard-delete, matching
-- the Trash pattern used everywhere else in this app.
DROP POLICY IF EXISTS maintenance_events_select ON public.maintenance_events;
CREATE POLICY maintenance_events_select ON public.maintenance_events
  FOR SELECT USING (deleted_at IS NULL);

DROP POLICY IF EXISTS maintenance_events_trash_select ON public.maintenance_events;
CREATE POLICY maintenance_events_trash_select ON public.maintenance_events
  FOR SELECT USING (deleted_at IS NOT NULL AND current_user_role() = 'admin');

DROP POLICY IF EXISTS maintenance_events_insert ON public.maintenance_events;
CREATE POLICY maintenance_events_insert ON public.maintenance_events
  FOR INSERT WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS maintenance_events_update ON public.maintenance_events;
CREATE POLICY maintenance_events_update ON public.maintenance_events
  FOR UPDATE USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS maintenance_events_hard_delete ON public.maintenance_events;
CREATE POLICY maintenance_events_hard_delete ON public.maintenance_events
  FOR DELETE USING (deleted_at IS NOT NULL AND current_user_role() = 'admin');

-- maintenance_parts_used: no deleted_at column per spec — delete is
-- admin-only outright (matches "department_user cannot delete
-- anything" from this project's role model), no soft-delete step.
DROP POLICY IF EXISTS maintenance_parts_used_select ON public.maintenance_parts_used;
CREATE POLICY maintenance_parts_used_select ON public.maintenance_parts_used FOR SELECT USING (true);

DROP POLICY IF EXISTS maintenance_parts_used_insert ON public.maintenance_parts_used;
CREATE POLICY maintenance_parts_used_insert ON public.maintenance_parts_used
  FOR INSERT WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS maintenance_parts_used_update ON public.maintenance_parts_used;
CREATE POLICY maintenance_parts_used_update ON public.maintenance_parts_used
  FOR UPDATE USING (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS maintenance_parts_used_delete ON public.maintenance_parts_used;
CREATE POLICY maintenance_parts_used_delete ON public.maintenance_parts_used
  FOR DELETE USING (current_user_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets, public.maintenance_events, public.maintenance_parts_used TO authenticated;
GRANT SELECT, INSERT ON public.asset_hours_log TO authenticated;

-- ─── 7. Views ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_assets_overview AS
SELECT
  a.id, a.asset_tag, a.serial_number, a.cat, a.mfr, a.model,
  cat.label AS cat_label, mfr.label AS mfr_label, mdl.label AS model_label,
  a.site, a.location, a.sub_location, a.status,
  a.commissioned_at, a.warranty_until,
  a.running_hours, a.pm_interval_hours, a.last_pm_hours, a.last_pm_date, a.pm_interval_days,
  a.photo_url, a.notes,
  ev.event_count, ev.last_event_date,
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
  SELECT count(*) AS event_count, max(event_date) AS last_event_date
  FROM public.maintenance_events me
  WHERE me.asset_id = a.id AND me.deleted_at IS NULL
) ev ON true
WHERE a.deleted_at IS NULL;

COMMENT ON VIEW public.v_assets_overview IS
  'Asset list with joined category/manufacturer/model labels, maintenance event count/last date, and PM-due computation by both hours and calendar days (pm_due = true when within 10% of the interval or already past it, whichever basis is configured).';

CREATE OR REPLACE VIEW public.v_asset_pm_due AS
SELECT * FROM public.v_assets_overview WHERE pm_due = true;

COMMENT ON VIEW public.v_asset_pm_due IS
  'Subset of v_assets_overview where preventive maintenance is due or approaching (within 10% of the configured hours or day interval).';

GRANT SELECT ON public.v_assets_overview, public.v_asset_pm_due TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP VIEW IF EXISTS public.v_asset_pm_due;
-- DROP VIEW IF EXISTS public.v_assets_overview;
-- DROP TABLE IF EXISTS public.maintenance_parts_used;
-- DROP TABLE IF EXISTS public.maintenance_events;
-- DROP TRIGGER IF EXISTS asset_hours_log_apply ON public.asset_hours_log;
-- DROP FUNCTION IF EXISTS public.apply_asset_hours_reading();
-- DROP TABLE IF EXISTS public.asset_hours_log;
-- DROP FUNCTION IF EXISTS public.next_asset_tag(text,text,text);
-- DROP TRIGGER IF EXISTS set_updated_at ON public.assets;
-- DROP TABLE IF EXISTS public.assets;
