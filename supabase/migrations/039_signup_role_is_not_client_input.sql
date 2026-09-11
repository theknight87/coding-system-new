-- ═══════════════════════════════════════════════════════════════
-- 039_signup_role_is_not_client_input.sql
--
-- CRITICAL SECURITY FIX (security audit finding #1).
--
-- handle_new_user() copied the new profile's role straight out of
-- auth.users.raw_user_meta_data:
--
--     COALESCE(NEW.raw_user_meta_data->>'role', 'department_user')
--
-- That metadata is whatever the CLIENT sent. src/App.jsx:1107 calls
-- supabase.auth.signInWithOtp({ options: { data: { role } } }) from the
-- browser, and signInWithOtp is an UNAUTHENTICATED endpoint reachable
-- with the anon key — which ships in the bundle. So anyone who could
-- read the bundle could request a magic link for their own address
-- carrying role="admin" and land with an admin profile.
--
-- Migration 029 closed the same escalation through the RLS policies on
-- user_profiles, but handle_new_user() is SECURITY DEFINER and runs as
-- the table owner: RLS does not apply to it, so 029 never covered this
-- path.
--
-- Verified before this fix (live):
--   handle_new_user  prosecdef = true, metadata role read present
--   user_profiles    3 rows — no account had escalated via metadata
--                    (the one admin predates the metadata path)
--
-- TWO INDEPENDENT LAYERS, because one CREATE OR REPLACE is one edit
-- away from regressing:
--
--   1. handle_new_user() stops reading the role from metadata at all.
--      Every signup — invited, self-service, dashboard-created — lands
--      as department_user.
--
--   2. A BEFORE INSERT trigger on user_profiles forces the role down to
--      department_user unless the *inserting session* is already an
--      admin. Triggers run even when RLS is bypassed, so this also
--      covers the SECURITY DEFINER path above and any future direct
--      insert.
--
-- Promotion is unchanged and still works: an admin uses the existing
-- Change Role control on the Users page, which goes through
-- db.js updateUserRole() and is gated by the profiles_update policy
-- from migration 029. This migration does not touch that policy.
--
-- NOT a behaviour change for legitimate use: the invite flow still
-- carries full_name and department, and the invited person still gets
-- a working account. Only the role now has to be granted by an admin
-- after the fact rather than asserted by the browser beforehand.
-- ═══════════════════════════════════════════════════════════════

-- ─── Layer 1: the signup trigger ignores client-supplied role ───
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role, department)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    -- Hardcoded, never from metadata. An admin promotes afterwards.
    'department_user',
    NULLIF(NEW.raw_user_meta_data->>'department', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates the public.user_profiles row for a new auth user. full_name and department come from sign-up metadata; role NEVER does — it is always department_user, because sign-up metadata is client input and signInWithOtp is unauthenticated (migration 039). An admin promotes via the Users page afterwards.';

-- ─── Layer 2: no insert may name a privileged role ──────────────
CREATE OR REPLACE FUNCTION public.enforce_profile_role_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER          -- must observe the REAL caller, not the owner
SET search_path = public
AS $$
BEGIN
  -- Only a session that is already an admin may create a profile
  -- holding a role other than department_user. handle_new_user() runs
  -- during sign-up, where there is no session at all, so
  -- current_user_role() returns 'anonymous' there and the role is
  -- forced down — which is the intent.
  IF NEW.role IS DISTINCT FROM 'department_user'
     AND public.current_user_role() <> 'admin' THEN
    NEW.role := 'department_user';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_profile_role_on_insert() IS
  'Defence in depth for migration 039: silently downgrades any newly inserted profile role to department_user unless the inserting session is an admin. SECURITY INVOKER on purpose — a DEFINER function would see the owner as current_user and could never observe the real caller.';

DROP TRIGGER IF EXISTS enforce_profile_role ON public.user_profiles;
CREATE TRIGGER enforce_profile_role
  BEFORE INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_role_on_insert();

-- ─── Assertion: fail loudly if either layer is missing ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
      AND pg_get_functiondef(p.oid) NOT LIKE '%raw_user_meta_data->>''role''%'
  ) THEN
    RAISE EXCEPTION '039 failed: handle_new_user still reads role from sign-up metadata';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'user_profiles' AND t.tgname = 'enforce_profile_role'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '039 failed: enforce_profile_role trigger is missing';
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ⚠ Reverting restores a path to self-service admin. Do not.
-- ═══════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS enforce_profile_role ON public.user_profiles;
-- DROP FUNCTION IF EXISTS public.enforce_profile_role_on_insert();
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   INSERT INTO public.user_profiles (id, email, full_name, role, department)
--   VALUES (NEW.id, NEW.email,
--           COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
--           COALESCE(NEW.raw_user_meta_data->>'role', 'department_user'),
--           NULLIF(NEW.raw_user_meta_data->>'department',''))
--   ON CONFLICT (id) DO NOTHING;
--   RETURN NEW;
-- END; $$;
