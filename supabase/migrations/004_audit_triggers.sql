-- ═══════════════════════════════════════════════════════════════
-- Migration 004 — Audit Triggers
-- Automatically logs every INSERT, UPDATE, DELETE on core tables
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  old_data JSONB := NULL;
  new_data JSONB := NULL;
  rec_id   TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_data := row_to_json(OLD)::JSONB;
    rec_id   := OLD.code::TEXT;
  ELSIF TG_OP = 'UPDATE' THEN
    old_data := row_to_json(OLD)::JSONB;
    new_data := row_to_json(NEW)::JSONB;
    rec_id   := NEW.code::TEXT;
  ELSE
    new_data := row_to_json(NEW)::JSONB;
    rec_id   := NEW.code::TEXT;
  END IF;

  INSERT INTO public.audit_logs (action, table_name, record_id, old_values, new_values, user_id)
  VALUES (
    TG_OP,
    TG_TABLE_NAME,
    rec_id,
    old_data,
    new_data,
    auth.uid()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Attach audit trigger to all core tables
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'categories','manufacturers','models','disciplines',
    'engine_systems','functional_groups','spare_parts'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_trigger ON public.%I', tbl);
    EXECUTE format(
      'CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn()',
      tbl
    );
  END LOOP;
END;
$$;
