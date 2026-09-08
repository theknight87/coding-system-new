-- ═══════════════════════════════════════════════════════════════
-- 029_fix_self_role_escalation.sql
--
-- SECURITY FIX — privilege escalation.
--
-- profiles_update was declared with USING only:
--
--   USING ((id = auth.uid()) OR (current_user_role() = 'admin'))
--
-- When an UPDATE policy has no WITH CHECK, Postgres reuses the USING
-- expression as the check on the NEW row. "id = auth.uid()" is true
-- for your own row whatever you set on it — including role. So any
-- signed-in department_user could promote themselves to admin with a
-- single call against the public PostgREST endpoint:
--
--   PATCH /rest/v1/user_profiles?id=eq.<their own id>
--   {"role":"admin"}
--
-- The anon key ships in the frontend bundle, so this needed nothing
-- but a browser console and an account. Verified against live data
-- before the fix: a department_user updating their own row to
-- role='admin' affected 1 row.
--
-- FIX — keep who may be updated in USING, and add a WITH CHECK that
-- says what a non-admin may change about themselves: everything
-- except role and is_active, the two columns that grant authority.
--
-- current_user_role() is SECURITY DEFINER, so it reads the caller's
-- role as of the statement snapshot — i.e. the value BEFORE this
-- update. Requiring the new role to equal it is exactly "you may not
-- change your own role", with no recursion into this policy.
--
-- Admins are unaffected: the first branch short-circuits for them.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS profiles_update ON public.user_profiles;

CREATE POLICY profiles_update ON public.user_profiles
  FOR UPDATE
  USING (
    id = auth.uid() OR public.current_user_role() = 'admin'
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (
      id = auth.uid()
      AND role      IS NOT DISTINCT FROM public.current_user_role()
      AND is_active IS TRUE
    )
  );

COMMENT ON POLICY profiles_update ON public.user_profiles IS
  'Admins may update any profile. Everyone else may update only their own, and may not change role or is_active on it — without the WITH CHECK, USING alone let any user set their own role to admin (migration 029).';

-- The same hole in reverse: profiles_insert lets a user create their
-- own row (id = auth.uid()) with any role. handle_new_user() creates
-- that row already, so a self-insert is only reachable if the trigger
-- row is missing — but it should not be able to name its own role.
DROP POLICY IF EXISTS profiles_insert ON public.user_profiles;

CREATE POLICY profiles_insert ON public.user_profiles
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (id = auth.uid() AND role = 'department_user')
  );

COMMENT ON POLICY profiles_insert ON public.user_profiles IS
  'Admins may create any profile. A user may only create their own, and only as department_user — self-insert must not be able to name a privileged role (migration 029).';

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ⚠ Reverting restores the privilege-escalation hole. Do not.
-- ═══════════════════════════════════════════════════════════════
-- DROP POLICY IF EXISTS profiles_update ON public.user_profiles;
-- CREATE POLICY profiles_update ON public.user_profiles FOR UPDATE
--   USING ((id = auth.uid()) OR (public.current_user_role() = 'admin'));
-- DROP POLICY IF EXISTS profiles_insert ON public.user_profiles;
-- CREATE POLICY profiles_insert ON public.user_profiles FOR INSERT
--   WITH CHECK ((public.current_user_role() = 'admin') OR (id = auth.uid()));
