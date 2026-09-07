// send-stock-alerts — Supabase Edge Function
//
// Sends ONE aggregated Web Push notification per subscribed browser
// when there are unacknowledged out-of-stock or critical parts that
// haven't already been pushed in the last 24 hours. Designed to be
// invoked on a schedule by pg_cron (see
// supabase/migrations/019_cron_push_alerts.sql).
//
// Required secrets (Supabase Dashboard -> Project Settings -> Edge
// Functions -> Secrets, or `supabase secrets set NAME=value`):
//   VAPID_PUBLIC_KEY  - paired with VITE_VAPID_PUBLIC_KEY in Cloudflare Pages
//   VAPID_PRIVATE_KEY - never exposed to the client, never committed
//   VAPID_SUBJECT     - a "mailto:someone@example.com" URI, required by the
//                       Web Push protocol so push services can contact you
//                       if something's wrong with your usage.
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Deployed with verify_jwt=false, same trade-off as low-stock-alert:
// invoked by a scheduled job with no user session, only ever reads
// alert state and pushes notifications — it can't mutate spare_parts
// or leak anything beyond "some parts are low," so the cron job in
// migration 019 calls it with no Authorization header at all rather
// than embedding the service role key in a committed SQL file.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT");

    if (!vapidPublic || !vapidPrivate || !vapidSubject) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not configured" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const supabase = createClient(supabaseUrl, serviceKey);

    // Unacknowledged out/critical alerts only (low is excluded from
    // push, same "needs action now" scoping as the header bell badge).
    const { data: alerts, error: alertsErr } = await supabase
      .from("v_active_alerts")
      .select("part_id,code,stock_status,is_acknowledged")
      .in("stock_status", ["out", "critical"])
      .eq("is_acknowledged", false);
    if (alertsErr) throw alertsErr;

    if (!alerts || alerts.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no unacknowledged out/critical alerts" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // De-duplicate: drop (part_id, severity) pairs already notified in
    // the last 24 hours.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentLog, error: logErr } = await supabase
      .from("alert_notifications_log")
      .select("part_id,severity")
      .gte("notified_at", cutoff);
    if (logErr) throw logErr;

    const recentSet = new Set((recentLog || []).map((r) => `${r.part_id}:${r.severity}`));
    const freshAlerts = alerts.filter((a) => !recentSet.has(`${a.part_id}:${a.stock_status}`));

    if (freshAlerts.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "all current alerts already notified within 24h" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const outCount = freshAlerts.filter((a) => a.stock_status === "out").length;
    const criticalCount = freshAlerts.filter((a) => a.stock_status === "critical").length;
    const parts = [];
    if (outCount) parts.push(`${outCount} item${outCount === 1 ? "" : "s"} out of stock`);
    if (criticalCount) parts.push(`${criticalCount} below minimum`);
    const body = `${parts.join(", ")} — tap to review`;

    const { data: subs, error: subsErr } = await supabase
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth");
    if (subsErr) throw subsErr;

    let sent = 0;
    const staleIds: string[] = [];
    const payload = JSON.stringify({ title: "⚠️ CarGas Stock Alert", body, url: "/" });

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) staleIds.push(sub.id);
        // any other error (network blip, etc.) is left alone — not our
        // subscription to delete on a transient failure
      }
    }

    if (staleIds.length) {
      await supabase.from("push_subscriptions").delete().in("id", staleIds);
    }

    await supabase.from("alert_notifications_log").insert(
      freshAlerts.map((a) => ({ part_id: a.part_id, severity: a.stock_status })),
    );

    return new Response(
      JSON.stringify({ sent, subscriptions: (subs || []).length, staleRemoved: staleIds.length, alertsNotified: freshAlerts.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
