-- ═══════════════════════════════════════════════════════════════
-- 040_alert_function_caller_auth.sql
--
-- SECURITY FIX (security audit finding #2) — unauthenticated,
-- unmetered, paid-email endpoint.
--
-- Verified live before this fix, via MCP:
--   low-stock-alert    verify_jwt = false   (ACTIVE, v8)
--   send-stock-alerts  verify_jwt = false   (ACTIVE, v4)
--   cron job 1 'low-stock-daily-alert'  '0 7 * * *'      no auth header
--   cron job 2 'stock-push-alerts'      '0 5-17/2 * * *' no auth header
--
-- low-stock-alert sends one Resend email to ALERT_EMAILS on EVERY
-- invocation. It has no caller check and — unlike its sibling — no
-- de-duplication. The URL is derivable from the project ref, which is
-- committed in migration 016. Anyone could loop it and send unlimited
-- mail, burning the Resend quota and the sending domain's reputation.
--
-- WHY NOT verify_jwt = true: the caller is pg_cron, which has no user
-- session. Turning it on would force the service-role key into the
-- cron command text stored in cron.job — the exact trade migration 016
-- deliberately avoided. This uses a purpose-scoped shared secret
-- instead, which grants nothing except the right to trigger one alert
-- run.
--
-- WHY THE SECRET NEVER LEAVES THE DATABASE: it lives in Supabase Vault.
-- The cron job reads it at call time to set a header. The Edge Function
-- does NOT read it back — it passes the header it received to
-- verify_alert_cron_secret(), which compares inside Postgres and
-- returns only a boolean. Nothing ever returns the secret itself.
--
-- Two independent controls, same as finding #1:
--   1. Caller authentication — a wrong or missing header is rejected
--      before any query or send.
--   2. De-duplication — even an authorised caller cannot produce a
--      second email for the same (part, severity) within 24h. This is
--      the control that actually caps cost, because it holds even if
--      the secret ever leaks.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Per-channel de-duplication ──────────────────────────────
-- alert_notifications_log already backs the push function's 24h dedup.
-- severity carries a CHECK limited to low/critical/out, so the email
-- channel cannot be namespaced into that column — it gets its own.
-- Existing rows are all push, which the default preserves.
ALTER TABLE public.alert_notifications_log
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'push';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.alert_notifications_log'::regclass
      AND conname = 'alert_notifications_log_channel_check'
  ) THEN
    ALTER TABLE public.alert_notifications_log
      ADD CONSTRAINT alert_notifications_log_channel_check
      CHECK (channel IN ('push','email'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS alert_notifications_log_dedup_idx
  ON public.alert_notifications_log (channel, part_id, severity, notified_at DESC);

COMMENT ON COLUMN public.alert_notifications_log.channel IS
  'Which alert transport already notified this (part, severity): push (send-stock-alerts) or email (low-stock-alert). Keeps the two 24h dedup windows independent — migration 040.';

-- ─── 2. The shared secret, generated in-database ────────────────
-- Generated here so it is never typed, never printed, and never
-- committed. Created once; re-running this migration will not rotate
-- it (rotation is a deliberate act — see the note at the bottom).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'alert_cron_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'alert_cron_secret',
      'Shared secret proving an alert Edge Function was invoked by this project''s pg_cron job rather than by the public internet (migration 040).'
    );
  END IF;
END;
$$;

-- ─── 3. Comparison happens in the database, not in the function ──
CREATE OR REPLACE FUNCTION public.verify_alert_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_expected text;
BEGIN
  IF p_secret IS NULL OR length(p_secret) = 0 THEN
    RETURN false;
  END IF;
  SELECT decrypted_secret INTO v_expected
  FROM vault.decrypted_secrets WHERE name = 'alert_cron_secret';
  IF v_expected IS NULL THEN
    RETURN false;                      -- fail closed, never open
  END IF;
  -- Compare digests rather than the raw strings: equal-length inputs
  -- remove the early-exit timing signal of a plain text comparison.
  RETURN extensions.digest(p_secret, 'sha256') = extensions.digest(v_expected, 'sha256');
END;
$$;

-- Only the Edge Functions (service_role) may call this. Without these
-- revokes it would be a public oracle for guessing the secret.
REVOKE ALL ON FUNCTION public.verify_alert_cron_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_alert_cron_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_alert_cron_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_alert_cron_secret(text) TO service_role;

COMMENT ON FUNCTION public.verify_alert_cron_secret(text) IS
  'Returns true when the supplied string matches the alert_cron_secret held in Vault. Compares inside the database so the secret itself is never returned to a caller. EXECUTE granted to service_role only — migration 040.';

-- ─── 4. Both cron jobs now present the secret ───────────────────
-- cron.schedule() on an existing jobname updates it in place.
SELECT cron.schedule(
  'low-stock-daily-alert',
  '0 7 * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://fuwllmohhqlfcvhoyfgm.supabase.co/functions/v1/low-stock-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alert-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'alert_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $CRON$
);

SELECT cron.schedule(
  'stock-push-alerts',
  '0 5-17/2 * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://fuwllmohhqlfcvhoyfgm.supabase.co/functions/v1/send-stock-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alert-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'alert_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $CRON$
);

-- ─── 5. Assertions ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'alert_cron_secret') THEN
    RAISE EXCEPTION '040 failed: alert_cron_secret missing from Vault';
  END IF;
  IF NOT public.verify_alert_cron_secret(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='alert_cron_secret')) THEN
    RAISE EXCEPTION '040 failed: verify_alert_cron_secret rejects the real secret';
  END IF;
  IF public.verify_alert_cron_secret('definitely-not-the-secret') THEN
    RAISE EXCEPTION '040 failed: verify_alert_cron_secret accepts a wrong secret';
  END IF;
  IF public.verify_alert_cron_secret(NULL) OR public.verify_alert_cron_secret('') THEN
    RAISE EXCEPTION '040 failed: verify_alert_cron_secret accepts empty input';
  END IF;
  IF (SELECT COUNT(*) FROM cron.job
      WHERE jobname IN ('low-stock-daily-alert','stock-push-alerts')
        AND command LIKE '%alert_cron_secret%') <> 2 THEN
    RAISE EXCEPTION '040 failed: a cron job is not sending the secret header';
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ROTATION (not rollback) — if the secret is ever suspected leaked:
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name='alert_cron_secret'),
--     encode(extensions.gen_random_bytes(32),'hex'));
-- The cron jobs read it at call time, so nothing else needs changing.
--
-- ROLLBACK (commented out)
-- ⚠ Reverting re-opens an unauthenticated endpoint that sends paid
--   email on every call. Do not.
-- ═══════════════════════════════════════════════════════════════
