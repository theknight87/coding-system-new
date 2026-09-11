-- ═══════════════════════════════════════════════════════════════
-- 041_alert_secret_digest_lookup.sql
--
-- Follow-up to 040. The verification function read the plaintext back
-- from vault.decrypted_secrets. That works from a normal SQL session
-- but FAILS when the function is invoked through PostgREST, which is
-- how the Edge Functions call it.
--
-- Measured, after deploying 040:
--   POST /functions/v1/low-stock-alert  no header      -> 401  (correct)
--   POST /functions/v1/low-stock-alert  wrong secret   -> 500  (WRONG)
--
-- The empty-string path returns false before touching Vault, which is
-- why the no-header case looked fine. Any non-empty secret reached the
-- Vault read and threw, and the function's catch turned that into 500.
--
-- Root cause: vault.decrypted_secrets is owned by supabase_admin and
-- its pgsodium decryption succeeds when session_user is postgres (a
-- direct SQL session) but not when PostgREST connects as authenticator
-- and SET LOCAL ROLEs to service_role. SECURITY DEFINER changes
-- current_user, not session_user, so it does not help here.
--
-- A 500 instead of a 401 is not just cosmetic: the function reached its
-- generic error handler, which means the caller check was not actually
-- deciding the outcome. Fixing it properly rather than catching the
-- error, because "the auth check throws" is exactly the kind of thing
-- that later gets "fixed" by treating the error as success.
--
-- Fix: verification no longer needs Vault at all. Only the SHA-256
-- digest of the secret is stored, in an ordinary table, and the
-- comparison is digest-to-digest. Vault keeps the plaintext for the
-- cron job, which runs as postgres and can read it.
--
-- The digest is not a secret — it cannot be reversed into the header
-- value — but the table is service_role-only anyway, on the same
-- pattern as alert_notifications_log (migration 037).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.alert_cron_auth (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),   -- single row
  secret_sha256 bytea   NOT NULL,
  rotated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_cron_auth ENABLE ROW LEVEL SECURITY;
-- No policies, deliberately: only service_role (which bypasses RLS)
-- and the SECURITY DEFINER function below ever touch this.
REVOKE ALL ON TABLE public.alert_cron_auth FROM anon, authenticated;

COMMENT ON TABLE public.alert_cron_auth IS
  'Single row holding the SHA-256 digest of alert_cron_secret, so verify_alert_cron_secret() can compare without reading Vault — which is unavailable to PostgREST-invoked functions (migration 041). RLS on with no policies on purpose.';

-- Seed the digest from the secret 040 already generated. Runs as
-- postgres, where the Vault read works.
INSERT INTO public.alert_cron_auth (id, secret_sha256)
SELECT true, extensions.digest(decrypted_secret, 'sha256')
FROM vault.decrypted_secrets WHERE name = 'alert_cron_secret'
ON CONFLICT (id) DO UPDATE SET secret_sha256 = EXCLUDED.secret_sha256,
                               rotated_at    = now();

CREATE OR REPLACE FUNCTION public.verify_alert_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- NULL/empty can never match: digest() of '' is a real value, but it
  -- is compared against the stored digest like anything else, so there
  -- is no early-exit branch that behaves differently from the rest.
  SELECT EXISTS (
    SELECT 1 FROM public.alert_cron_auth
    WHERE secret_sha256 = extensions.digest(COALESCE(p_secret, ''), 'sha256')
  );
$$;

REVOKE ALL ON FUNCTION public.verify_alert_cron_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_alert_cron_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_alert_cron_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_alert_cron_secret(text) TO service_role;

COMMENT ON FUNCTION public.verify_alert_cron_secret(text) IS
  'True when the supplied string hashes to the digest in alert_cron_auth. Reads no Vault, so it works when invoked through PostgREST by the alert Edge Functions. EXECUTE granted to service_role only — migrations 040, 041.';

-- ─── Assertions ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT public.verify_alert_cron_secret(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='alert_cron_secret')) THEN
    RAISE EXCEPTION '041 failed: the real secret no longer verifies';
  END IF;
  IF public.verify_alert_cron_secret('definitely-not-the-secret')
     OR public.verify_alert_cron_secret('')
     OR public.verify_alert_cron_secret(NULL) THEN
    RAISE EXCEPTION '041 failed: a wrong or empty secret verifies';
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ROTATION — keep Vault and the digest in step:
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name='alert_cron_secret'),
--     encode(extensions.gen_random_bytes(32),'hex'));
--   UPDATE public.alert_cron_auth
--      SET secret_sha256 = (SELECT extensions.digest(decrypted_secret,'sha256')
--                           FROM vault.decrypted_secrets WHERE name='alert_cron_secret'),
--          rotated_at = now();
-- ═══════════════════════════════════════════════════════════════
