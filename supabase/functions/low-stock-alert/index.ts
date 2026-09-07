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
// Deployed with verify_jwt=false since this is invoked by a scheduled
// job with no user session. It only ever reads stock status and sends
// an email — it can't mutate data or leak anything sensitive if
// someone else finds the URL, but that is a deliberate trade-off:
// tighten this (e.g. a shared-secret header check) if that ever changes.

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

Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const alertEmails = (Deno.env.get("ALERT_EMAILS") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    if (!resendKey || alertEmails.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "RESEND_API_KEY or ALERT_EMAILS not configured" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: rows, error } = await supabase
      .from("v_stock_status")
      .select("code,short_desc,qty_on_hand,min_stock,reorder_point,stock_status,is_critical")
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

    const rowsHtml = rows.map((r) => `
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
        <p style="color:#64748b;margin-top:0">${rows.length} part(s) need attention (out of stock, critical, or low).</p>
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
        subject: `⚠️ CarGas Stock Alert — ${rows.length} part(s) need attention`,
        html,
      }),
    });

    const emailResult = await emailRes.json();
    if (!emailRes.ok) throw new Error(`Resend error: ${JSON.stringify(emailResult)}`);

    return new Response(
      JSON.stringify({ sent: true, count: rows.length, emailResult }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
