-- ═══════════════════════════════════════════════════════════════
-- Migration 005 — Fix column names & constraints
-- Run this in Supabase SQL Editor if you get column errors
-- ═══════════════════════════════════════════════════════════════

-- Fix 1: rename 'desc' → 'description' in disciplines table
-- ('desc' is a reserved word in some PostgreSQL contexts)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='disciplines' AND column_name='desc'
  ) THEN
    ALTER TABLE public.disciplines RENAME COLUMN "desc" TO description;
    RAISE NOTICE 'Renamed desc → description in disciplines';
  ELSE
    RAISE NOTICE 'Column already named description — skipping';
  END IF;
END $$;

-- Fix 2: ensure categories allows upsert (no duplicate seed conflict)
-- Categories already have code as PK, upsert with ON CONFLICT DO UPDATE
-- No schema change needed — handled in application layer via .upsert()

-- Fix 3: add description column default if missing
ALTER TABLE public.disciplines
  ALTER COLUMN description SET DEFAULT '';

-- Fix 4: verify image_url and datasheet_url columns exist on spare_parts
ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS datasheet_url TEXT,
  ADD COLUMN IF NOT EXISTS manual_url TEXT,
  ADD COLUMN IF NOT EXISTS drawing_url TEXT;

-- Confirmation
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('disciplines','spare_parts')
  AND column_name IN ('description','desc','image_url','datasheet_url')
ORDER BY table_name, column_name;
