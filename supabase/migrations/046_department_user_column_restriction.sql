-- ═══════════════════════════════════════════════════════════════
-- 046_department_user_column_restriction.sql
--
-- Closes the long-standing scope gap recorded in CLAUDE.md §7 and
-- deliberately deferred by 034 ("that needs a product decision and a
-- matching UI change, so it is left for a follow-up"). This is that
-- follow-up. Approved 2026-09-14.
--
-- THE RULE, stated so a later reader can judge a new column against it:
--   A department user may change what a part is LIKE.
--   Only an admin may change what a part IS.
--
-- MAY EDIT (department_user and admin)
--   fg                     the spec's Functional Group
--   short_desc, long_desc  the spec's Description
--   location, remarks      where it sits, notes about it
--   image_url, datasheet_url, manual_url, drawing_url
--                          the role table already grants "upload images"
--   min_stock, max_stock, reorder_point, lead_time_days,
--   is_critical, preferred_supplier
--                          the Reorder Settings page, which is NOT
--                          admin-only and which bulk_set_reorder_settings
--                          already permits them to use
--
-- ADMIN ONLY
--   code                   the part's identity
--   cat, mfr, model, disc  the code's own segments — changing one
--                          desynchronises the code from its meaning
--   status                 a lifecycle decision (Active / Obsolete)
--   part_no, oem_part, qty_per_assembly, unit
--                          catalogue reference data
--
-- WHY NOT A COLUMN GRANT: GRANT UPDATE (col, …) is per database role,
-- and every signed-in user arrives as the same role, `authenticated`.
-- A column grant would take the columns from admins too. The
-- distinction lives in user_profiles, so the check has to be a trigger
-- — the same reason 043 put its guard inside a view.
--
-- WHY IS DISTINCT FROM AND NOT "column present in the statement":
-- savePart() in src/App.jsx sends the WHOLE row on every save, changed
-- or not. A guard that fired on presence would reject every edit a
-- department user makes. Only a real change is refused.
--
-- WHY SECURITY INVOKER: copied deliberately from 034, where writing it
-- as DEFINER made current_user the function's owner, so the guard could
-- never see 'authenticated' and never fired. As an invoker function it
-- observes the real caller.
--
-- THE SANCTIONED PATHS STILL WORK: post_physical_count(),
-- recalc_part_stock(), bulk_set_reorder_settings() and the rest are
-- SECURITY DEFINER owned by postgres, so inside them current_user is
-- the owner and this guard does not fire. Only writes arriving straight
-- from the REST API as `authenticated` are checked.
--
-- 034 KEEPS ITS OWN JOB: qty_on_hand, stock_source and last_counted_at
-- stay blocked for everyone, admins included. This migration is about
-- who may edit catalogue columns, not about the ledger cache.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.spare_parts_department_user_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE blocked text[] := '{}';
BEGIN
  -- Only direct API callers, and only department users.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.current_user_role() <> 'department_user' THEN
    RETURN NEW;
  END IF;

  IF NEW.code             IS DISTINCT FROM OLD.code             THEN blocked := blocked || 'code'; END IF;
  IF NEW.cat              IS DISTINCT FROM OLD.cat              THEN blocked := blocked || 'cat'; END IF;
  IF NEW.mfr              IS DISTINCT FROM OLD.mfr              THEN blocked := blocked || 'mfr'; END IF;
  IF NEW.model            IS DISTINCT FROM OLD.model            THEN blocked := blocked || 'model'; END IF;
  IF NEW.disc             IS DISTINCT FROM OLD.disc             THEN blocked := blocked || 'disc'; END IF;
  IF NEW.status           IS DISTINCT FROM OLD.status           THEN blocked := blocked || 'status'; END IF;
  IF NEW.part_no          IS DISTINCT FROM OLD.part_no          THEN blocked := blocked || 'part_no'; END IF;
  IF NEW.oem_part         IS DISTINCT FROM OLD.oem_part         THEN blocked := blocked || 'oem_part'; END IF;
  IF NEW.qty_per_assembly IS DISTINCT FROM OLD.qty_per_assembly THEN blocked := blocked || 'qty_per_assembly'; END IF;
  IF NEW.unit             IS DISTINCT FROM OLD.unit             THEN blocked := blocked || 'unit'; END IF;

  IF array_length(blocked, 1) > 0 THEN
    RAISE EXCEPTION
      'A department user may not change % on an existing part. Editable: functional group, descriptions, location, remarks, attachments and reorder settings. Ask an admin to change the rest.',
      array_to_string(blocked, ', ')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.spare_parts_department_user_columns() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.spare_parts_department_user_columns() IS
  'Refuses a department user''s attempt to change a part''s identity or classification: code, cat, mfr, model, disc, status, part_no, oem_part, qty_per_assembly, unit. Compares OLD to NEW, because the part form sends every column on every save. SECURITY INVOKER so it sees the real caller — migration 046.';

DROP TRIGGER IF EXISTS spare_parts_department_user_columns ON public.spare_parts;
CREATE TRIGGER spare_parts_department_user_columns
  BEFORE UPDATE ON public.spare_parts
  FOR EACH ROW EXECUTE FUNCTION public.spare_parts_department_user_columns();

-- ─── Assertions (read-only) ─────────────────────────────────────
-- Structure only. The behavioural test writes to real parts, so it is
-- run separately in a transaction that rolls back, rather than from
-- inside a migration that must not leave probe values behind. Its
-- result is recorded below and in docs/SECURITY_History.md.
DO $$
DECLARE is_invoker boolean; has_trigger boolean;
BEGIN
  SELECT NOT p.prosecdef INTO is_invoker
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'spare_parts_department_user_columns';
  IF is_invoker IS NOT TRUE THEN
    RAISE EXCEPTION '046 failed: the guard must be SECURITY INVOKER or it cannot see the real caller (the mistake 034 made first)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal
       AND t.tgname = 'spare_parts_department_user_columns'
       AND c.relname = 'spare_parts'
  ) INTO has_trigger;
  IF NOT has_trigger THEN
    RAISE EXCEPTION '046 failed: trigger missing on spare_parts';
  END IF;

  RAISE NOTICE '046 structure verified: SECURITY INVOKER guard, trigger present on spare_parts';
END;
$$;

-- Behavioural result, measured 2026-09-14 in a rolled-back transaction:
--   department_user, 9 blocked columns attempted   -> 9 refused
--   department_user, allowed columns in one UPDATE -> written
--     (location, remarks, short_desc, long_desc, fg, reorder_point,
--      min_stock, is_critical)
--   admin, same blocked columns                    -> written
-- Re-run that probe after changing this trigger; the middle line is the
-- one that matters, because a guard that also blocked the allowed
-- columns would take the Reorder Settings page away from the people
-- who use it.

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
--   DROP TRIGGER IF EXISTS spare_parts_department_user_columns ON public.spare_parts;
--   DROP FUNCTION IF EXISTS public.spare_parts_department_user_columns();
-- ⚠ Reverting lets a department user rewrite a part's code and its
--   classification segments, which silently desynchronises the code
--   from what it describes.
-- ═══════════════════════════════════════════════════════════════
