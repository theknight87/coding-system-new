// low-stock-alert — Supabase Edge Function
//
// Queries v_stock_status for any part that is out/critical/low and,
// if any exist, emails a summary via Resend. Designed to be invoked
// on a schedule by pg_cron (see supabase/migrations/016_low_stock_alert_cron.sql).
//
// Required secrets (Project Settings -> Edge Functions -> Secrets, or
// `supabase secrets set NAME=value`):
//   RESEND_API_KEY   - from resend.com
//   ALERT_EMAILS     - comma-separated recipient list, e.g. "a@x.com,b@x.com"
// Optional:
//   ALERT_FROM_EMAIL - defaults to Resend's shared test sender if unset.
//                      Use a verified domain address once you have one.
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically
// by the Edge Functions runtime — nothing to configure for those.
//
// Deployed with verify_jwt=false because the caller is pg_cron, which
// has no user session. That used to mean ANYONE who found the URL could
// invoke it, and every invocation sent a Resend email — unmetered paid
// mail behind a guessable address (security audit finding #2).
//
// Two controls now (migration 040):
//   1. x-alert-cron-secret header, verified by
//      verify_alert_cron_secret() which compares inside Postgres and
//      returns only a boolean, so the secret never leaves the database.
//      Missing or wrong -> 401 before any query or send.
//   2. 24h de-duplication per (part_id, severity) on the 'email'
//      channel of alert_notifications_log — the same mechanism
//      send-stock-alerts already used for push. This is what actually
//      caps cost: it holds even if the secret ever leaks.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STATUS_LABEL: Record<string, string> = {
  out: "OUT OF STOCK",
  critical: "CRITICAL",
  low: "LOW",
};
const STATUS_COLOR: Record<string, string> = {
  out: "#dc2626",
  critical: "#dc2626",
  low: "#b45309",
};

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Control 1: is this our cron job? ───────────────────────────
    // Checked first, before reading any stock data, so an unauthorised
    // caller learns nothing and costs nothing.
    const { data: authorised, error: authErr } = await supabase.rpc(
      "verify_alert_cron_secret",
      { p_secret: req.headers.get("x-alert-cron-secret") ?? "" },
    );
    if (authErr) throw authErr;
    if (authorised !== true) {
      return new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const alertEmails = (Deno.env.get("ALERT_EMAILS") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    if (!resendKey || alertEmails.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "RESEND_API_KEY or ALERT_EMAILS not configured" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    const { data: rows, error } = await supabase
      .from("v_stock_status")
      .select("id,code,short_desc,qty_on_hand,min_stock,reorder_point,stock_status,is_critical")
      .in("stock_status", ["out", "critical", "low"])
      .order("severity_rank", { ascending: true })
      .limit(200);

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no parts currently need attention" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Control 2: 24h de-duplication ──────────────────────────────
    // Same mechanism send-stock-alerts uses for push, on its own
    // channel so the two windows stay independent. This is the control
    // that caps cost: however many times this function is invoked, a
    // given (part, severity) can only appear in one email per day.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentLog, error: logErr } = await supabase
      .from("alert_notifications_log")
      .select("part_id,severity")
      .eq("channel", "email")
      .gte("notified_at", cutoff);
    if (logErr) throw logErr;

    const recentSet = new Set((recentLog || []).map((r) => `${r.part_id}:${r.severity}`));
    const freshRows = rows.filter((r) => !recentSet.has(`${r.id}:${r.stock_status}`));

    if (freshRows.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "all current alerts already emailed within 24h" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const rowsHtml = freshRows.map((r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace">${r.code}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${r.short_desc ?? ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${r.qty_on_hand}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:bold;color:${STATUS_COLOR[r.stock_status] ?? "#374151"}">
          ${STATUS_LABEL[r.stock_status] ?? r.stock_status}${r.is_critical ? " ⚠" : ""}
        </td>
      </tr>`).join("");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#0f172a">
        <h2 style="margin-bottom:4px">CarGas Coding System — Stock Alert</h2>
        <p style="color:#64748b;margin-top:0">${freshRows.length} part(s) need attention (out of stock, critical, or low).</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead>
            <tr style="background:#0f172a;color:#fff">
              <th style="padding:6px 10px;text-align:left">Code</th>
              <th style="padding:6px 10px;text-align:left">Description</th>
              <th style="padding:6px 10px">On Hand</th>
              <th style="padding:6px 10px">Status</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="color:#94a3b8;font-size:11px;margin-top:16px">Sent automatically by the CarGas Coding System's daily stock check.</p>
      </div>`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("ALERT_FROM_EMAIL") || "CarGas Alerts <onboarding@resend.dev>",
        to: alertEmails,
        subject: `⚠️ CarGas Stock Alert — ${freshRows.length} part(s) need attention`,
        html,
      }),
    });

    const emailResult = await emailRes.json();
    if (!emailRes.ok) throw new Error(`Resend error: ${JSON.stringify(emailResult)}`);

    // Written only after Resend accepted it, so a failed send does not
    // suppress the next attempt.
    await supabase.from("alert_notifications_log").insert(
      freshRows.map((r) => ({ part_id: r.id, severity: r.stock_status, channel: "email" })),
    );

    return new Response(
      JSON.stringify({ sent: true, count: freshRows.length, emailResult }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
