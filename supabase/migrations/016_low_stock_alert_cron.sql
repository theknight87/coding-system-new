-- ═══════════════════════════════════════════════════════════════
-- 016_low_stock_alert_cron.sql
--
-- Enables pg_cron + pg_net and schedules a daily job that invokes the
-- `low-stock-alert` Edge Function (supabase/functions/low-stock-alert),
-- which emails a summary of any out/critical/low parts via Resend.
--
-- The function itself no-ops safely (HTTP 200, {skipped:true,...}) if
-- RESEND_API_KEY / ALERT_EMAILS secrets aren't configured yet, or if
-- nothing currently needs attention — so it is safe to schedule this
-- before those secrets are set.
--
-- Schedule: 07:00 UTC daily ('0 7 * * *').
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'low-stock-daily-alert',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuwllmohhqlfcvhoyfgm.supabase.co/functions/v1/low-stock-alert',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- SELECT cron.unschedule('low-stock-daily-alert');
-- DROP EXTENSION IF EXISTS pg_net;
-- DROP EXTENSION IF EXISTS pg_cron;
