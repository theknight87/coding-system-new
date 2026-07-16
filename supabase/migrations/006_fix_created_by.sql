-- ═══════════════════════════════════════════════════════════════
-- Migration 006 — Fix created_by / updated_by and audit log join
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Fix audit_logs to allow join with user_profiles for name display
-- The audit_logs.user_id references auth.users(id)
-- We need a view or function to get display name

-- Option 1: Create a view that joins audit_logs with user_profiles
CREATE OR REPLACE VIEW public.audit_logs_with_user AS
SELECT
  al.id,
  al.action,
  al.table_name,
  al.record_id,
  al.old_values,
  al.new_values,
  al.user_id,
  al.created_at,
  up.email,
  up.full_name
FROM public.audit_logs al
LEFT JOIN public.user_profiles up ON up.id = al.user_id;

-- Grant access to authenticated users (admins only via RLS)
GRANT SELECT ON public.audit_logs_with_user TO authenticated;

-- Fix: ensure spare_parts has updated_by column (not just created_by)
ALTER TABLE public.spare_parts
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Fix: ensure all master tables have updated_by
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['categories','manufacturers','models','disciplines','engine_systems','functional_groups']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id)', tbl);
  END LOOP;
END;
$$;

-- Verify columns exist
SELECT table_name, column_name
FROM information_schema.columns
WHERE column_name IN ('created_by','updated_by')
  AND table_schema = 'public'
ORDER BY table_name, column_name;
