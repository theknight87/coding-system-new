-- ═══════════════════════════════════════════════════════════════
-- 022_asset_documents.sql
--
-- Storage + tracking table for the Asset Detail page's Documents tab
-- (manuals, test reports, extra photos — anything beyond the single
-- assets.photo_url cover image). Mirrors the part-manuals/datasheets
-- bucket pattern: bucket marked non-public, with a permissive SELECT
-- policy on storage.objects.
--
-- ⚠ A non-public bucket CANNOT be read via getPublicUrl(). Supabase's
-- /object/public/ route rejects it with "Bucket not found"
-- (NoSuchBucket) before RLS is ever consulted — the SELECT policy
-- below does NOT make the public URL work. Files here must be opened
-- through a signed URL (db.js createSignedUrl), which is what the
-- Documents tab does. The same caveat applies to the pre-existing
-- part-datasheets / part-manuals / part-drawings buckets, whose
-- stored public URLs have the same limitation.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-documents', 'asset-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_asset_docs_select ON storage.objects;
CREATE POLICY storage_asset_docs_select ON storage.objects
  FOR SELECT USING (bucket_id = 'asset-documents');

DROP POLICY IF EXISTS storage_asset_docs_insert ON storage.objects;
CREATE POLICY storage_asset_docs_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'asset-documents');

DROP POLICY IF EXISTS storage_asset_docs_delete ON storage.objects;
CREATE POLICY storage_asset_docs_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'asset-documents' AND current_user_role() = 'admin');

CREATE TABLE IF NOT EXISTS public.asset_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  label        text NOT NULL,
  url          text NOT NULL,
  path         text NOT NULL,
  uploaded_by  uuid REFERENCES auth.users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_documents_asset_idx ON public.asset_documents(asset_id);

COMMENT ON TABLE public.asset_documents IS
  'Arbitrary files attached to an asset (manuals, test reports, extra photos) — distinct from assets.photo_url, which is the single cover image.';

ALTER TABLE public.asset_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_documents_select ON public.asset_documents;
CREATE POLICY asset_documents_select ON public.asset_documents FOR SELECT USING (true);

DROP POLICY IF EXISTS asset_documents_insert ON public.asset_documents;
CREATE POLICY asset_documents_insert ON public.asset_documents
  FOR INSERT WITH CHECK (current_user_role() = ANY (ARRAY['admin','department_user']));

DROP POLICY IF EXISTS asset_documents_delete ON public.asset_documents;
CREATE POLICY asset_documents_delete ON public.asset_documents
  FOR DELETE USING (current_user_role() = 'admin');

GRANT SELECT, INSERT, DELETE ON public.asset_documents TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS public.asset_documents;
-- DROP POLICY IF EXISTS storage_asset_docs_delete ON storage.objects;
-- DROP POLICY IF EXISTS storage_asset_docs_insert ON storage.objects;
-- DROP POLICY IF EXISTS storage_asset_docs_select ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'asset-documents';
