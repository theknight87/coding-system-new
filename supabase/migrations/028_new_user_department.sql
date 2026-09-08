-- ═══════════════════════════════════════════════════════════════
-- 028_new_user_department.sql
--
-- The User Management "Invite User" form collects Full Name, Role AND
-- Department, and sends all three as sign-up metadata. handle_new_user
-- reads full_name and role from that metadata but ignored department,
-- so an invited user always landed with department NULL.
--
-- Adds department to the columns the trigger copies across. Nothing
-- else about the function changes: role still falls back to
-- 'department_user' when unset, so a self-service sign-up cannot
-- promote itself by sending a role it was not invited with any more
-- than it could before.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role, department)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'department_user'),
    NULLIF(NEW.raw_user_meta_data->>'department', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates the public.user_profiles row for a new auth user, copying full_name, role and department from the sign-up metadata the invite flow sends (migration 028). Role defaults to department_user when absent.';

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out) — restores the version without department
-- ═══════════════════════════════════════════════════════════════
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
-- BEGIN
--   INSERT INTO public.user_profiles (id, email, full_name, role)
--   VALUES (NEW.id, NEW.email,
--     COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
--     COALESCE(NEW.raw_user_meta_data->>'role', 'department_user'))
--   ON CONFLICT (id) DO NOTHING;
--   RETURN NEW;
-- END;
-- $$;
