-- ═══════════════════════════════════════════════════════════════
-- Migration 008 — Verify row counts (Max Rows fix is done via Dashboard, not SQL)
-- Fixes: "only ~1000 rows imported", "count shows too few pages",
-- "hierarchy tree missing data" for datasets larger than 1000 rows.
--
-- Supabase's PostgREST API layer has a project-level "Max Rows" setting
-- that caps how many rows ANY request can return, regardless of how the
-- client paginates with .range()/.limit(). This setting is NOT part of
-- PostgreSQL itself, so it cannot be read or changed via SQL — it must
-- be changed in the Supabase Dashboard (see instructions below).
-- ═══════════════════════════════════════════════════════════════

-- Verify actual row count in the table (ground truth)
SELECT COUNT(*) AS total_active_parts
FROM public.spare_parts
WHERE deleted_at IS NULL;

SELECT model, COUNT(*) AS part_count
FROM public.spare_parts
WHERE deleted_at IS NULL
GROUP BY model
ORDER BY model;

-- ═══════════════════════════════════════════════════════════════
-- REQUIRED MANUAL STEP (cannot be done via SQL):
--
-- Go to: Supabase Dashboard → Project Settings → API
-- Find:  "Max Rows" (under API Settings, sometimes called "db-max-rows")
-- Change from 1000 → 10000 (or higher, based on your dataset size)
-- Click Save.
--
-- This is the setting that caused:
--   • Import stopping at exactly 1000 rows
--   • Master Table count showing far fewer pages than expected
--   • Any single request silently truncating at 1000 rows
-- ═══════════════════════════════════════════════════════════════
