-- ═══════════════════════════════════════════════════════════════
-- 018_push_subscriptions.sql
--
-- Web Push infrastructure: where each user's browser subscription is
-- stored, and a de-duplication log so the same part/severity isn't
-- re-notified within 24 hours. Consumed by the send-stock-alerts
-- Edge Function (see supabase/functions/send-stock-alerts/index.ts)
-- and scheduled by migration 019.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_push_sub_user ON public.push_subscriptions(user_id);

COMMENT ON TABLE public.push_subscriptions IS
  'One row per browser/device a user has subscribed to Web Push on. endpoint is unique across all users (a given browser subscription belongs to exactly one push service endpoint).';

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Each user manages only their own subscriptions — no admin override
-- needed here (unlike spare_parts/alert_acknowledgements), since a
-- push subscription is inherently per-device/per-person, not shared
-- team data.
DROP POLICY IF EXISTS push_sub_select ON public.push_subscriptions;
CREATE POLICY push_sub_select ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_sub_insert ON public.push_subscriptions;
CREATE POLICY push_sub_insert ON public.push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_sub_delete ON public.push_subscriptions;
CREATE POLICY push_sub_delete ON public.push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

-- ─── De-duplication log ─────────────────────────────────────────
-- send-stock-alerts checks this before sending: a (part_id, severity)
-- pair notified within the last 24h is skipped, so a part sitting at
-- "critical" all day doesn't push-spam every time the cron job runs.
CREATE TABLE IF NOT EXISTS public.alert_notifications_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.spare_parts(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('low','critical','out')),
  notified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_notif_log_lookup ON public.alert_notifications_log(part_id, severity, notified_at);

COMMENT ON TABLE public.alert_notifications_log IS
  'Write-only from the send-stock-alerts Edge Function (service role). Records when a part/severity pair was last pushed, so the same alert is not re-sent within 24 hours.';

ALTER TABLE public.alert_notifications_log ENABLE ROW LEVEL SECURITY;

-- Only the service role (used by the Edge Function) reads/writes this
-- table — no policy grants access to authenticated/anon, matching the
-- "admin-only internal bookkeeping" pattern; RLS with no permissive
-- policy denies all non-service-role access by default.

GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS public.alert_notifications_log;
-- DROP TABLE IF EXISTS public.push_subscriptions;
