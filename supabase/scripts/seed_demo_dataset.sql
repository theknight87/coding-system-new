-- ═══════════════════════════════════════════════════════════════
-- seed_demo_dataset.sql — TRAINING DATA. NEVER RUN ON PRODUCTION.
--
-- Builds a realistic 18-month history for training and demos:
--   • 8 assets across 3 equipment models
--   • opening balances and reorder points on the parts they consume
--   • ~18 months of preventive and corrective maintenance
--   • parts consumption that matches those jobs
--   • ONE deliberately problematic unit that makes the Reliability
--     Indicators page actually fire
--
-- ─── SAFETY: THIS SCRIPT FAILS CLOSED ───────────────────────────
-- It will not run unless you explicitly declare, in the same session,
-- that this database is a demo project:
--
--   SELECT set_config('app.demo_seed', 'YES_THIS_IS_A_DEMO_PROJECT', false);
--
-- Run that line FIRST, in the same SQL editor tab, then run this file.
-- Without it the script aborts and changes nothing. A heuristic check
-- runs as a second line of defence, but the token is the real gate —
-- a heuristic alone would happily pass on a small production database,
-- which is exactly the mistake this design avoids.
--
-- ─── IDEMPOTENT ──────────────────────────────────────────────────
-- Every object it creates is tagged DEMO. Re-running deletes the
-- previous demo data first (via the same path the app uses, so stock
-- is returned), then rebuilds it. Running it twice leaves exactly one
-- copy, not two.
--
-- ─── PREREQUISITES ───────────────────────────────────────────────
-- Migrations 001-038 applied, and the reference data seeded
-- (categories, manufacturers, models, disciplines, functional_groups)
-- — i.e. a project that has had 002_seed_data.sql run.
--
-- Parts are taken from whatever spare_parts rows already exist for the
-- chosen models, so this works on any project with a parts catalogue.
--
-- ─── TO REMOVE ───────────────────────────────────────────────────
--   SELECT public.demo_teardown();
-- ═══════════════════════════════════════════════════════════════

-- ─── 0. Fail closed unless explicitly told this is a demo project ─
DO $$
DECLARE
  v_token       text := current_setting('app.demo_seed', true);
  v_real_events int;
  v_real_assets int;
BEGIN
  IF v_token IS DISTINCT FROM 'YES_THIS_IS_A_DEMO_PROJECT' THEN
    RAISE EXCEPTION
      'REFUSING TO RUN. This script loads training data and must never touch production. If this really is a demo project, run this first in the same session:  SELECT set_config(''app.demo_seed'', ''YES_THIS_IS_A_DEMO_PROJECT'', false);';
  END IF;

  SELECT count(*) INTO v_real_events
  FROM public.maintenance_events
  WHERE deleted_at IS NULL AND COALESCE(title,'') NOT LIKE 'DEMO%';

  SELECT count(*) INTO v_real_assets
  FROM public.assets
  WHERE deleted_at IS NULL AND asset_tag NOT LIKE 'DEMO-%';

  IF v_real_events > 200 OR v_real_assets > 40 THEN
    RAISE EXCEPTION
      'REFUSING TO RUN: % non-demo maintenance events and % non-demo assets found. That is too much real history for a demo project — check you are connected to the right database.',
      v_real_events, v_real_assets;
  END IF;

  RAISE NOTICE 'Guard passed (token present; % non-demo events, % non-demo assets).',
    v_real_events, v_real_assets;
END $$;

-- ─── 1. Teardown helper (also used to re-run cleanly) ────────────
CREATE OR REPLACE FUNCTION public.demo_teardown()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts int; v_events int; v_assets int;
BEGIN
  -- Deleting the part lines is what returns the stock: the AFTER
  -- DELETE trigger from migration 023 posts the reversing entries.
  WITH d AS (
    DELETE FROM public.maintenance_parts_used mpu
    USING public.maintenance_events me
    WHERE me.id = mpu.maintenance_event_id AND me.title LIKE 'DEMO%'
    RETURNING mpu.id)
  SELECT count(*) INTO v_parts FROM d;

  -- Events and assets are soft-deleted: the ledger's foreign keys
  -- refuse a hard delete, and soft delete is this project's rule.
  WITH d AS (
    UPDATE public.maintenance_events SET deleted_at = now()
    WHERE title LIKE 'DEMO%' AND deleted_at IS NULL RETURNING id)
  SELECT count(*) INTO v_events FROM d;

  WITH d AS (
    UPDATE public.assets SET deleted_at = now()
    WHERE asset_tag LIKE 'DEMO-%' AND deleted_at IS NULL RETURNING id)
  SELECT count(*) INTO v_assets FROM d;

  DELETE FROM public.asset_hours_log
   WHERE asset_id IN (SELECT id FROM public.assets WHERE asset_tag LIKE 'DEMO-%');

  RETURN format('Demo removed: %s part lines (stock returned), %s events, %s assets.',
                v_parts, v_events, v_assets);
END $$;

COMMENT ON FUNCTION public.demo_teardown() IS
  'Removes everything seed_demo_dataset.sql created. Deleting the part lines returns their stock via the migration 023 trigger; events and assets are soft-deleted because the ledger FKs refuse a hard delete.';

SELECT public.demo_teardown() AS teardown_before_reseed;

-- ─── 2. Build the demo ───────────────────────────────────────────
DO $$
DECLARE
  -- 8 assets over 3 models. DEMO-C1..C4 are compressors (model A),
  -- DEMO-C5..C6 a second compressor model, DEMO-E1..E2 engines.
  -- DEMO-C3 is the problem unit: it replaces seals far more often
  -- than its sisters, which is what makes the flags fire.
  v_model_a text; v_model_b text; v_model_c text;
  v_cat_a   text; v_mfr_a   text;
  v_cat_b   text; v_mfr_b   text;
  v_cat_c   text; v_mfr_c   text;
  v_asset   uuid; v_event uuid;
  v_tag     text;
  v_fg      text;
  v_part    uuid;
  v_date    date;
  v_hours   numeric;
  i int; j int; k int;
  v_made_assets int := 0; v_made_events int := 0; v_made_lines int := 0;
  rec record;
  v_pm_interval int;
  v_seal_extra  int;
BEGIN
  -- Pick three models that actually have parts, largest first.
  SELECT model INTO v_model_a FROM public.spare_parts
   WHERE deleted_at IS NULL GROUP BY model ORDER BY count(*) DESC LIMIT 1;
  SELECT model INTO v_model_b FROM public.spare_parts
   WHERE deleted_at IS NULL AND model <> v_model_a
   GROUP BY model ORDER BY count(*) DESC LIMIT 1;
  SELECT model INTO v_model_c FROM public.spare_parts
   WHERE deleted_at IS NULL AND model NOT IN (v_model_a, v_model_b)
   GROUP BY model ORDER BY count(*) DESC LIMIT 1;

  IF v_model_a IS NULL OR v_model_b IS NULL OR v_model_c IS NULL THEN
    RAISE EXCEPTION 'Need at least 3 equipment models with parts in spare_parts. Seed the catalogue first (002_seed_data.sql).';
  END IF;

  SELECT cat, mfr INTO v_cat_a, v_mfr_a FROM public.spare_parts WHERE model=v_model_a AND deleted_at IS NULL LIMIT 1;
  SELECT cat, mfr INTO v_cat_b, v_mfr_b FROM public.spare_parts WHERE model=v_model_b AND deleted_at IS NULL LIMIT 1;
  SELECT cat, mfr INTO v_cat_c, v_mfr_c FROM public.spare_parts WHERE model=v_model_c AND deleted_at IS NULL LIMIT 1;

  RAISE NOTICE 'Using models: % / % / %', v_model_a, v_model_b, v_model_c;

  -- ─── 2a. Opening balances and reorder points ──────────────────
  -- Give every part of the three demo models a starting balance and
  -- sensible thresholds, so the Alerts page has something to say.
  -- Opening balances are posted as ledger rows, never written to
  -- qty_on_hand directly (migration 034 forbids that anyway).
  FOR rec IN
    SELECT id, code FROM public.spare_parts
     WHERE deleted_at IS NULL AND model IN (v_model_a, v_model_b, v_model_c)
       AND NOT EXISTS (SELECT 1 FROM public.stock_transactions st WHERE st.part_id = spare_parts.id)
     LIMIT 400
  LOOP
    INSERT INTO public.stock_transactions
      (part_id, txn_type, quantity, occurred_at, location_to, notes)
    VALUES
      (rec.id, 'opening_balance',
       (12 + (abs(hashtext(rec.code)) % 40))::numeric,   -- 12..51, stable per code
       (CURRENT_DATE - 550), 'WH-MAIN',
       'DEMO opening balance');

    UPDATE public.spare_parts
       SET min_stock      = 4,
           reorder_point  = 8,
           max_stock      = 60,
           lead_time_days = 14 + (abs(hashtext(rec.code)) % 30),
           is_critical    = (abs(hashtext(rec.code)) % 7 = 0)
     WHERE id = rec.id;
  END LOOP;

  -- ─── 2b. The 8 assets ─────────────────────────────────────────
  FOR i IN 1..8 LOOP
    v_tag := 'DEMO-' || CASE WHEN i <= 6 THEN 'C' ELSE 'E' END
                     || CASE WHEN i <= 6 THEN i ELSE i - 6 END;

    INSERT INTO public.assets
      (asset_tag, cat, mfr, model, status, site, location, sub_location,
       commissioned_at, running_hours, pm_interval_hours, last_pm_hours,
       last_pm_date, notes)
    VALUES (
      v_tag,
      CASE WHEN i <= 4 THEN v_cat_a WHEN i <= 6 THEN v_cat_b ELSE v_cat_c END,
      CASE WHEN i <= 4 THEN v_mfr_a WHEN i <= 6 THEN v_mfr_b ELSE v_mfr_c END,
      CASE WHEN i <= 4 THEN v_model_a WHEN i <= 6 THEN v_model_b ELSE v_model_c END,
      CASE WHEN i = 5 THEN 'maintenance' WHEN i = 8 THEN 'standby' ELSE 'active' END,
      'Demo Station', 'Hall ' || ((i - 1) / 3 + 1), 'Bay ' || i,
      CURRENT_DATE - 900 - (i * 40),
      -- Start at the OLDEST reading, not the newest: the hours-log
      -- trigger refuses a reading below the asset's current hours, and
      -- it advances running_hours itself as each reading is accepted.
      -- The 18 monthly readings below walk this up to 18000 + i*1450.
      18000 + (i * 1450) - (18 * 320),
      5000, 18000 + (i * 1450) - (18 * 320), CURRENT_DATE - 60,
      'DEMO DATA — training dataset. Safe to delete with SELECT public.demo_teardown();'
    ) RETURNING id INTO v_asset;
    v_made_assets := v_made_assets + 1;

    -- Hours readings, monthly for 18 months, so cost-per-hour works.
    FOR j IN REVERSE 18..0 LOOP
      INSERT INTO public.asset_hours_log (asset_id, reading_hours, read_at, notes)
      VALUES (v_asset,
              18000 + (i * 1450) - (j * 320),
              (CURRENT_DATE - (j * 30))::timestamptz,
              'DEMO reading');
    END LOOP;

    -- ─── 2c. 18 months of maintenance ───────────────────────────
    -- Preventive every ~90 days for everyone. The problem unit
    -- (DEMO-C3) additionally keeps failing on one functional group.
    v_pm_interval := 90;
    v_seal_extra  := CASE WHEN v_tag = 'DEMO-C3' THEN 5 ELSE 0 END;

    -- Preventive services
    FOR j IN 0..5 LOOP
      v_date  := CURRENT_DATE - (j * v_pm_interval) - 10;
      v_hours := 18000 + (i * 1450) - (j * 900);

      INSERT INTO public.maintenance_events
        (asset_id, event_type, event_date, title, description, status,
         running_hours_at_event, downtime_hours, performed_by)
      VALUES (v_asset, 'preventive', v_date,
              'DEMO PM ' || (j * 5000 + 5000) || ' hrs',
              'Scheduled preventive service (demo data).',
              'completed', v_hours, 4 + (j % 3), 'Demo Technician')
      RETURNING id INTO v_event;
      v_made_events := v_made_events + 1;

      -- 2 or 3 parts per PM, taken from that model's catalogue.
      FOR rec IN
        SELECT sp.id FROM public.spare_parts sp
         WHERE sp.deleted_at IS NULL
           AND sp.model = (SELECT model FROM public.assets WHERE id = v_asset)
           AND sp.qty_on_hand > 3
         ORDER BY md5(sp.code || v_event::text)
         LIMIT 2 + (j % 2)
      LOOP
        INSERT INTO public.maintenance_parts_used
          (maintenance_event_id, part_id, quantity, unit_cost, notes)
        VALUES (v_event, rec.id, 1 + (j % 2), 35 + (j * 12), 'DEMO');
        v_made_lines := v_made_lines + 1;
      END LOOP;
    END LOOP;

    -- Corrective jobs: everyone gets 1, the problem unit gets 6 more
    -- on the SAME functional group, which is what the flags compare.
    SELECT fg INTO v_fg FROM public.spare_parts
     WHERE deleted_at IS NULL
       AND model = (SELECT model FROM public.assets WHERE id = v_asset)
       AND qty_on_hand > 8
     GROUP BY fg ORDER BY count(*) DESC LIMIT 1;

    FOR j IN 0..(0 + v_seal_extra) LOOP
      v_date := CURRENT_DATE - (j * 55) - 20;

      INSERT INTO public.maintenance_events
        (asset_id, event_type, event_date, title, description, status,
         running_hours_at_event, downtime_hours, failure_mode, root_cause, performed_by)
      VALUES (v_asset, 'corrective', v_date,
              'DEMO corrective repair',
              'Unplanned repair (demo data).', 'completed',
              18000 + (i * 1450) - (j * 400), 6 + (j % 4),
              CASE (j % 3) WHEN 0 THEN 'Seal wear' WHEN 1 THEN 'Vibration' ELSE 'Overheating' END,
              CASE WHEN v_tag = 'DEMO-C3' THEN 'Suspected misalignment — investigate'
                   ELSE 'Normal wear' END,
              'Demo Technician')
      RETURNING id INTO v_event;
      v_made_events := v_made_events + 1;

      SELECT sp.id INTO v_part FROM public.spare_parts sp
       WHERE sp.deleted_at IS NULL
         AND sp.model = (SELECT model FROM public.assets WHERE id = v_asset)
         AND sp.fg = v_fg AND sp.qty_on_hand > 3
       ORDER BY md5(sp.code || v_event::text) LIMIT 1;

      IF v_part IS NOT NULL THEN
        INSERT INTO public.maintenance_parts_used
          (maintenance_event_id, part_id, quantity, unit_cost, notes)
        VALUES (v_event, v_part, 1, 120 + (j * 15), 'DEMO');
        v_made_lines := v_made_lines + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- ─── 2d. One partial return, so the net-vs-issued distinction
  -- is visible on the Asset Detail page during training.
  SELECT mpu.id INTO v_part
  FROM public.maintenance_parts_used mpu
  JOIN public.maintenance_events me ON me.id = mpu.maintenance_event_id
  WHERE me.title LIKE 'DEMO%' AND mpu.quantity > 1
  ORDER BY me.event_date DESC LIMIT 1;

  IF v_part IS NOT NULL THEN
    PERFORM public.return_maintenance_part(v_part, 1, 'DEMO: not needed after strip-down');
  END IF;

  -- ─── 2e. Push a few parts under their reorder point, so the
  -- Alerts page and the red rows have something to show.
  FOR rec IN
    SELECT sp.id, sp.qty_on_hand, sp.reorder_point
    FROM public.spare_parts sp
    WHERE sp.deleted_at IS NULL AND sp.model = v_model_a
      AND sp.qty_on_hand > 10
    ORDER BY md5(sp.code) LIMIT 6
  LOOP
    INSERT INTO public.stock_transactions
      (part_id, txn_type, quantity, occurred_at, location_from, notes)
    VALUES (rec.id, 'issue',
            rec.qty_on_hand - (CASE WHEN random() < 0.34 THEN 0 ELSE 3 END),
            CURRENT_DATE - 5, 'WH-MAIN',
            'DEMO: drawn down to trigger a reorder alert');
  END LOOP;

  RAISE NOTICE 'DEMO BUILT: % assets, % maintenance events, % part lines.',
    v_made_assets, v_made_events, v_made_lines;
END $$;

-- ─── 3. What the trainee should see ──────────────────────────────
SELECT 'assets'        AS what, count(*)::text AS n FROM public.assets            WHERE asset_tag LIKE 'DEMO-%' AND deleted_at IS NULL
UNION ALL
SELECT 'events',       count(*)::text FROM public.maintenance_events WHERE title LIKE 'DEMO%' AND deleted_at IS NULL
UNION ALL
SELECT 'part lines',   count(*)::text FROM public.maintenance_parts_used mpu
  JOIN public.maintenance_events me ON me.id=mpu.maintenance_event_id WHERE me.title LIKE 'DEMO%'
UNION ALL
SELECT 'reliability flags', count(*)::text FROM public.v_asset_reliability_flags
UNION ALL
SELECT 'active alerts', count(*)::text FROM public.v_stock_status WHERE stock_status IN ('out','critical','low');
