-- ═══════════════════════════════════════════════════════════════
-- Migration 003 — Row Level Security (RLS) Policies
-- ═══════════════════════════════════════════════════════════════

-- Helper: get current user's role from user_profiles
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid()
$$;

-- ─── Enable RLS on all tables ─────────────────────────────────
ALTER TABLE public.user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disciplines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_systems     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.functional_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_parts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs         ENABLE ROW LEVEL SECURITY;

-- ─── USER PROFILES ────────────────────────────────────────────
-- Users can read their own profile; admins can read all
CREATE POLICY "profiles_select" ON public.user_profiles FOR SELECT
  USING (id = auth.uid() OR public.current_user_role() = 'admin');

-- Users can update their own profile; admins can update any
CREATE POLICY "profiles_update" ON public.user_profiles FOR UPDATE
  USING (id = auth.uid() OR public.current_user_role() = 'admin');

-- Only system (trigger) can insert; admin can also insert
CREATE POLICY "profiles_insert" ON public.user_profiles FOR INSERT
  WITH CHECK (public.current_user_role() = 'admin' OR id = auth.uid());

-- ─── MASTER DATA — READ (all authenticated users) ─────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['categories','manufacturers','models','disciplines','engine_systems','functional_groups']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_select" ON public.%I FOR SELECT TO authenticated USING (deleted_at IS NULL)',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ─── MASTER DATA — WRITE (admin only) ────────────────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['categories','manufacturers','models','disciplines','engine_systems','functional_groups']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = ''admin'')',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY "%s_update" ON public.%I FOR UPDATE TO authenticated USING (public.current_user_role() = ''admin'')',
      tbl, tbl
    );
    -- Hard DELETE blocked — use soft delete (update deleted_at) instead
    -- No DELETE policy means hard deletes are forbidden for all roles
  END LOOP;
END;
$$;

-- ─── SPARE PARTS — READ (all authenticated users) ─────────────
CREATE POLICY "spare_parts_select" ON public.spare_parts FOR SELECT
  TO authenticated USING (deleted_at IS NULL);

-- ─── SPARE PARTS — INSERT ─────────────────────────────────────
-- Admin: full insert
-- Department User: can insert (create new coded parts)
CREATE POLICY "spare_parts_insert" ON public.spare_parts FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('admin', 'department_user')
  );

-- ─── SPARE PARTS — UPDATE ────────────────────────────────────
-- Admin: can update all fields
-- Department User: can only update allowed fields
--   (Enforced in app layer; RLS allows the row-level access)
CREATE POLICY "spare_parts_update" ON public.spare_parts FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('admin', 'department_user')
  );

-- Department user column restriction is enforced at the application layer.
-- Fields department_user can edit: fg, short_desc, long_desc, remarks, qty,
--   unit, location, min_stock, max_stock, status, image_url, datasheet_url
-- Fields locked to admin only: code, cat, mfr, model, disc (core code segments)

-- ─── SPARE PARTS — SOFT DELETE ────────────────────────────────
-- Only admin can soft-delete (set deleted_at)
-- This policy is the UPDATE policy above — app layer sets deleted_at only for admin

-- ─── AUDIT LOGS ───────────────────────────────────────────────
-- All authenticated users can insert audit events
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT
  TO authenticated WITH CHECK (TRUE);

-- Only admins can read audit logs
CREATE POLICY "audit_select" ON public.audit_logs FOR SELECT
  TO authenticated USING (public.current_user_role() = 'admin');

-- No update or delete on audit logs — immutable record

-- ─── STORAGE POLICIES ─────────────────────────────────────────
-- Run these after creating buckets in Supabase Dashboard > Storage
-- Or run via SQL:

-- Bucket: part-images
INSERT INTO storage.buckets (id, name, public)
  VALUES ('part-images', 'part-images', true)
  ON CONFLICT (id) DO NOTHING;

-- Bucket: part-datasheets
INSERT INTO storage.buckets (id, name, public)
  VALUES ('part-datasheets', 'part-datasheets', false)
  ON CONFLICT (id) DO NOTHING;

-- Bucket: part-manuals
INSERT INTO storage.buckets (id, name, public)
  VALUES ('part-manuals', 'part-manuals', false)
  ON CONFLICT (id) DO NOTHING;

-- Bucket: part-drawings
INSERT INTO storage.buckets (id, name, public)
  VALUES ('part-drawings', 'part-drawings', false)
  ON CONFLICT (id) DO NOTHING;

-- Storage: allow authenticated users to upload images and docs
CREATE POLICY "storage_images_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'part-images');

CREATE POLICY "storage_images_select" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'part-images');

CREATE POLICY "storage_images_delete" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'part-images' AND public.current_user_role() = 'admin');

CREATE POLICY "storage_docs_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id IN ('part-datasheets','part-manuals','part-drawings'));

CREATE POLICY "storage_docs_select" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id IN ('part-datasheets','part-manuals','part-drawings'));

CREATE POLICY "storage_docs_delete" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id IN ('part-datasheets','part-manuals','part-drawings')
    AND public.current_user_role() = 'admin'
  );
