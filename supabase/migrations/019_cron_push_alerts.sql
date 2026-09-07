-- ═══════════════════════════════════════════════════════════════
-- 019_cron_push_alerts.sql
--
-- Schedules the send-stock-alerts Edge Function every 2 hours during
-- working hours (07:00-19:00 Africa/Cairo = 05:00-17:00 UTC), so an
-- out-of-stock/critical part someone hits mid-morning doesn't wait
-- until the next calendar day to push (unlike the once-daily email
-- alert in migration 016). The function's own 24h de-dup log means
-- running it more often costs nothing extra once an alert has already
-- been pushed.
--
-- pg_cron/pg_net are already enabled (migration 016) — the
-- CREATE EXTENSION IF NOT EXISTS calls are repeated here only so this
-- file is runnable standalone against a fresh database.
--
-- ⚠ No Authorization header is sent, matching low-stock-alert's cron
-- job in migration 016: the function is deployed with verify_jwt=false
-- specifically so no secret needs to be embedded in this committed
-- SQL file. See send-stock-alerts/index.ts header comment for the
-- full reasoning.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'stock-push-alerts',
  '0 5-17/2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fuwllmohhqlfcvhoyfgm.supabase.co/functions/v1/send-stock-alerts',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- SELECT cron.unschedule('stock-push-alerts');
