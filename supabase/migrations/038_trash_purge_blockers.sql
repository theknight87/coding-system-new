-- ═══════════════════════════════════════════════════════════════
-- 038_trash_purge_blockers.sql
--
-- BUG FIX: "Empty Trash" and per-row "Purge" failed with a raw
-- Postgres error:
--
--   update or delete on table "spare_parts" violates foreign key
--   constraint "stock_transactions_part_id_fkey"
--
-- The database is right to refuse. stock_transactions is an immutable
-- ledger and its part_id is ON DELETE RESTRICT: purging the part would
-- leave movements pointing at nothing, and the balance those rows carry
-- would lose its meaning. The same holds for an asset with maintenance
-- history, and for a category/manufacturer/model still used by any part.
--
-- What was wrong is the UI: it offered an action that cannot succeed,
-- and on Empty Trash it deleted the rows it could and reported
-- "Some deletions failed - see console" for the rest, leaving the user
-- with no idea which row failed or why.
--
-- This view lets the page know before it asks. For every soft-deleted
-- row in a Trash-managed table it reports what still references it, in
-- words, so Purge can be disabled with a reason and Empty Trash can say
-- "deleted N, kept M because they have history".
--
-- Only references that actually block are counted. FKs declared
-- ON DELETE CASCADE (asset_documents, asset_hours_log,
-- alert_acknowledgements, alert_notifications_log) disappear with the
-- parent and are not blockers.
--
-- Soft-deleted children still block: a trashed model referenced only by
-- trashed parts cannot be purged until those parts are purged first.
-- The counts therefore ignore deleted_at on the child, which is what
-- the foreign key does.
--
-- security_invoker so it is read with the caller's own permissions;
-- Trash is an admin-only page and the underlying trash policies already
-- restrict it to admins.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_trash_purge_blockers
WITH (security_invoker = on) AS

-- ─── spare_parts: the ledger, maintenance use, legacy movements ───
SELECT
  'spare_parts'::text AS table_name,
  sp.code             AS record_key,
  (SELECT count(*) FROM public.stock_transactions st     WHERE st.part_id   = sp.id)   AS ledger_rows,
  (SELECT count(*) FROM public.maintenance_parts_used m  WHERE m.part_id    = sp.id)   AS maintenance_rows,
  (SELECT count(*) FROM public.stock_movements sm        WHERE sm.part_code = sp.code) AS legacy_rows,
  0::bigint AS child_rows
FROM public.spare_parts sp
WHERE sp.deleted_at IS NOT NULL

UNION ALL
-- ─── assets: maintenance events and ledger movements ──────────────
SELECT
  'assets', a.id::text,
  (SELECT count(*) FROM public.stock_transactions st  WHERE st.asset_id = a.id),
  (SELECT count(*) FROM public.maintenance_events me  WHERE me.asset_id = a.id),
  0::bigint, 0::bigint
FROM public.assets a
WHERE a.deleted_at IS NOT NULL

UNION ALL
-- ─── categories: parts and assets classified under them ───────────
SELECT
  'categories', c.code, 0::bigint, 0::bigint, 0::bigint,
  (SELECT count(*) FROM public.spare_parts sp WHERE sp.cat = c.code)
  + (SELECT count(*) FROM public.assets a     WHERE a.cat  = c.code)
FROM public.categories c
WHERE c.deleted_at IS NOT NULL

UNION ALL
-- ─── manufacturers: parts, assets and their models ────────────────
SELECT
  'manufacturers', m.code, 0::bigint, 0::bigint, 0::bigint,
  (SELECT count(*) FROM public.spare_parts sp WHERE sp.mfr = m.code)
  + (SELECT count(*) FROM public.assets a     WHERE a.mfr  = m.code)
  + (SELECT count(*) FROM public.models mo    WHERE mo.mfr_code = m.code)
FROM public.manufacturers m
WHERE m.deleted_at IS NOT NULL

UNION ALL
-- ─── models: parts and assets of that model ───────────────────────
SELECT
  'models', mo.code, 0::bigint, 0::bigint, 0::bigint,
  (SELECT count(*) FROM public.spare_parts sp WHERE sp.model = mo.code)
  + (SELECT count(*) FROM public.assets a     WHERE a.model  = mo.code)
FROM public.models mo
WHERE mo.deleted_at IS NOT NULL

UNION ALL
-- ─── functional_groups: parts in the group ────────────────────────
SELECT
  'functional_groups', fg.code, 0::bigint, 0::bigint, 0::bigint,
  (SELECT count(*) FROM public.spare_parts sp WHERE sp.fg = fg.code)
FROM public.functional_groups fg
WHERE fg.deleted_at IS NOT NULL

UNION ALL
-- ─── disciplines / engine_systems: no foreign keys reference them ─
SELECT 'disciplines', d.code, 0::bigint, 0::bigint, 0::bigint, 0::bigint
FROM public.disciplines d WHERE d.deleted_at IS NOT NULL
UNION ALL
SELECT 'engine_systems', e.code, 0::bigint, 0::bigint, 0::bigint, 0::bigint
FROM public.engine_systems e WHERE e.deleted_at IS NOT NULL;

COMMENT ON VIEW public.v_trash_purge_blockers IS
  'For every soft-deleted row in a Trash-managed table, what still references it and would make a permanent delete fail. Lets the Trash page disable Purge with a reason instead of surfacing a foreign-key error (migration 038). Counts only blocking FKs — ON DELETE CASCADE children are not blockers — and counts soft-deleted children too, because the foreign key does.';

GRANT SELECT ON public.v_trash_purge_blockers TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP VIEW IF EXISTS public.v_trash_purge_blockers;
