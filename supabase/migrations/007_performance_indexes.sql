-- ═══════════════════════════════════════════════════════════════
-- Migration 007 — Performance indexes for large spare_parts tables
-- Critical once you have thousands of rows (e.g. after importing
-- full parts manuals). Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- Composite index for the exact filter combo used by the Hierarchy Tree
-- (cat + mfr + model + disc + fg) — makes drill-down counts instant
CREATE INDEX IF NOT EXISTS spare_parts_hierarchy_idx
  ON public.spare_parts (cat, mfr, model, disc, fg)
  WHERE deleted_at IS NULL;

-- Composite index for Master Table common filter combos
CREATE INDEX IF NOT EXISTS spare_parts_cat_disc_idx
  ON public.spare_parts (cat, disc)
  WHERE deleted_at IS NULL;

-- Text search index for search box (code, short_desc, part_no)
CREATE INDEX IF NOT EXISTS spare_parts_search_idx
  ON public.spare_parts USING gin (
    (code || ' ' || short_desc || ' ' || part_no) gin_trgm_ops
  );

-- Requires pg_trgm extension for fast ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Verify indexes
SELECT indexname, tablename FROM pg_indexes
WHERE tablename = 'spare_parts' AND schemaname = 'public'
ORDER BY indexname;
