# CarGas — Engineering Spare Parts Master Coding System

Production application. Deployed on Cloudflare Pages at
https://coding-system-new.pages.dev — Supabase project `fuwllmohhqlfcvhoyfgm`.

**Do not redesign it. Do not rewrite it. Preserve the current architecture.
Only modify files required for the requested feature.**

Last full review: 2026-09-09 (see *Review status* at the end).

---

# 1. What this system is

A six-segment coding system for engineering spare parts, plus the inventory
and maintenance layers built on top of it.

```
CP - GA - G04 - ME - GSK - 0235
│    │    │     │    │     └── sequential number (4 digits, per prefix)
│    │    │     │    └──────── functional group
│    │    │     └───────────── discipline (or engine system for EN)
│    │    └─────────────────── equipment model
│    └──────────────────────── manufacturer
└───────────────────────────── main category
```

Live scale: **5,867 parts, 5,881 stock transactions, 4 assets,
21 maintenance events, 58,432 audit rows, 3 users.**

Engines (`EN`) use dedicated **engine systems** (BAS, LUB, COL, AIR, FUE,
ELS, OPS, ENC, GEN, SRV) in the 4th segment instead of the standard
disciplines (ME, EL, AC).

---

# 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 5 |
| Hosting | Cloudflare Pages |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| Deps | `@supabase/supabase-js` only — **no router, no CSS framework, no chart library** |

`npm run build` must always succeed. Keep the bundle lean — do not add a
dependency without asking.

---

# 3. Repository layout

```
src/App.jsx          ~8,800 lines — every page and component
src/lib/db.js        ~1,390 lines — all Supabase access
src/lib/supabase.js  client creation
supabase/migrations/ 001 … 042
supabase/functions/  low-stock-alert, send-stock-alerts (Deno edge functions)
supabase/scripts/    seed_demo_dataset.sql, remove_demo_assets.sql (manual)
docs/                دليل-المستخدم.md (Arabic user guide), ADMIN_RUNBOOK.md,
                     SECURITY.md (what enforces what — read before touching auth/RLS)
CHANGELOG.md         what each phase added, and why
```

`App.jsx` is one large file **on purpose**. Do not split it up.

---

# 4. Frontend conventions

- **Routing:** no react-router. A `NAV` array + `pageMap` + `page` state.
  Navigate with `navigateTo(pageId, filter)`; the destination reads the
  one-shot `navFilter` on mount then calls `clearNavFilter()`.
- **Styling:** inline `style={{}}` objects referencing the shared `T`
  design-token object. No CSS files, no utility classes.
- **Charts:** inline SVG (`HoursLogChart`, `BarChart`). Label the axes, max
  6 series, no gradients or 3D. Do not add a charting library.
- **Shared components:** `Card`, `Btn`, `Input`, `Select`, `Pill`, `CodeTag`,
  `Modal`, `Table`, `PageHeader`, `StatCard`, `Toast`.
  ⚠ These take an explicit prop list — they do **not** spread `...props`.
  Three separate bugs came from a component silently dropping a prop
  (`Card` → `onClick`, `Input` → `min/max/step`, `Btn` → `title`). If you
  pass a new prop, add it to the component signature.
- **Tables:** wrap in `TABLE_SCROLL` (full-bleed inside a `Card`). Cells use
  `7px 9px` padding, 13px base font. `STICKY_ACTIONS_TH` / `stickyActionsTd`
  pin an actions column on tables too wide to fit.
- **Sidebar:** auto-collapses on table-heavy pages (`WIDE_PAGES`) and the
  Dashboard; ☰ in the header and `Ctrl/⌘+B` toggle it.
- **i18n:** English/Arabic via `LanguageContext`; add new nav labels to both
  dictionaries.
- **CSV:** shared `csvEsc` / `csvRow` / `downloadCsv` helpers at module scope.

---

# 5. Database — the invariants that matter

## 5.1 The stock ledger is the source of truth

`stock_transactions` is **append-only and immutable**. Rows are never edited
or deleted; corrections are new reversing entries.

```
spare_parts.qty_on_hand = SUM(signed_qty) over ALL rows for that part,
                          voided rows INCLUDED
```

Voided rows stay in the sum because each is cancelled by its own reversing
entry — excluding them as well double-counted the correction (fixed in **024**,
which repaired two live parts). `is_void` is for display only; it changes no
balance.

**Never write `qty_on_hand` directly** — a trigger (034) now rejects it, along
with `stock_source` and `last_counted_at`. Post a transaction instead.

Monthly drift check (returns 0 rows today):

```sql
SELECT sp.code, sp.qty_on_hand AS cached,
       COALESCE(SUM(st.signed_qty),0) AS ledger_sum,
       sp.qty_on_hand - COALESCE(SUM(st.signed_qty),0) AS drift
FROM public.spare_parts sp
LEFT JOIN public.stock_transactions st ON st.part_id = sp.id
WHERE sp.deleted_at IS NULL
GROUP BY sp.id, sp.code, sp.qty_on_hand
HAVING sp.qty_on_hand IS DISTINCT FROM COALESCE(SUM(st.signed_qty),0)
ORDER BY abs(sp.qty_on_hand - COALESCE(SUM(st.signed_qty),0)) DESC;
```

## 5.2 Net vs issued quantities

A part issued to a job and later returned was never consumed.
`v_maintenance_parts_used` (026) exposes `issued_qty`, `returned_qty`,
`net_qty`, `is_cancelled`. **All reporting must use `net_qty`.** A line is
"cancelled" exactly when its linked `stock_transaction.is_void` is true —
there is no separate flag.

## 5.3 Maintenance always moves stock

A BEFORE INSERT trigger on `maintenance_parts_used` posts the `issue` and
links it; a deferred constraint (036) rejects a line with no movement.
`log_maintenance_event()` creates event + lines atomically. Deleting a line,
or removing an event, reverses the stock.

## 5.4 Soft delete only

Every table uses `deleted_at`. **Never hard-delete.** The ledger's foreign
keys will refuse it anyway. A part holding stock cannot be trashed (036).

A trashed record that anything still references can **never** be purged —
`stock_transactions.part_id` is `ON DELETE RESTRICT`, and removing the part
would leave movements pointing at nothing. `v_trash_purge_blockers` (038)
reports what blocks each row so the Trash page can say so up front instead
of surfacing a foreign-key error. Such records stay in Trash indefinitely;
that is correct, not a bug to work around.

---

# 6. Tables and views

**Tables (19):** `alert_acknowledgements`, `alert_notifications_log`,
`asset_documents`, `asset_hours_log`, `assets`, `audit_logs`, `categories`,
`disciplines`, `engine_systems`, `functional_groups`, `maintenance_events`,
`maintenance_parts_used`, `manufacturers`, `models`, `push_subscriptions`,
`spare_parts`, `stock_movements` *(legacy, superseded by
`stock_transactions`)*, `stock_transactions`, `user_profiles`.

**Views (19):** stock — `v_stock_status`, `v_stock_status_summary`,
`v_stock_transactions_detail`, `v_stock_confidence`, `v_negative_stock`,
`v_active_alerts`; assets — `v_assets_overview`, `v_asset_pm_due`,
`v_asset_kpis`, `v_maintenance_parts_used`; reliability (030) —
`v_part_replacements` (base), `v_asset_part_history`, `v_fleet_part_baseline`,
`v_asset_reliability_flags`, `v_asset_cost_summary`,
`v_part_failure_patterns`; plus `v_parts_tree_counts` (035), `v_trash_purge_blockers` (038),
`audit_logs_with_user`.

⚠ Reference tables key on **`code TEXT`**, not uuid. There is no
`equipment_models` table — it is `models`. `spare_parts` has both `code` and
`id`; the ledger joins on `id`.

---

# 7. Authentication and authorization

Supabase Auth. Two roles in `user_profiles.role`: **`admin`** and
**`department_user`**. `handle_new_user()` creates the profile on signup,
copying `full_name`, `role` and `department` from signup metadata.

`current_user_role()` returns **`'anonymous'`** when there is no signed-in
profile — never NULL. This is load-bearing: guards are written as
`IF current_user_role() <> 'admin' THEN RAISE`, and with NULL that IF
evaluates to NULL and never fires (fixed in **032** after an unauthenticated
caller was found able to set any part's stock).

## What the roles can do

| | Admin | Department user |
|---|---|---|
| Create parts, upload images | ✅ | ✅ |
| Post stock movements, count stock | ✅ | ✅ |
| Create assets, log maintenance, update hours | ✅ | ✅ |
| Return parts to store | ✅ | ✅ |
| Void a stock transaction | ✅ | ❌ |
| Cancel a maintenance part line | ✅ | ❌ |
| Trash / restore anything | ✅ | ❌ (037) |
| Edit master data (categories, mfrs, models, …) | ✅ | ❌ |
| Admin, Audit Log, Users, Trash pages | ✅ | ❌ |

> ⚠ **Known gap — not enforced.** The spec says a department user may edit
> *only* Functional Group, Sequential Number and Description on a part. In
> reality the Master Table part form applies **no** field-level role gating,
> and `spare_parts_update` allows a department user to update any column
> except the ledger-derived ones. Closing this needs a UI change plus a
> column-level policy, and would change what storekeepers can do day to day —
> **ask before implementing it.**

## Security rules

- RLS is **enabled on every public table**. Assume it is on; never ship a new
  table without policies.
- Policies use `TO authenticated`. `anon` has no access to anything.
- `SECURITY DEFINER` functions are revoked from `anon`; only the RPCs `db.js`
  actually calls are granted to `authenticated`.
- Never expose secrets. Edge-function secrets live in Supabase Dashboard →
  Edge Functions → Secrets. The VAPID **public** key goes in Cloudflare Pages
  env; the private key never leaves Supabase.
- Never commit credentials to the repo.

---

# 8. Feature map

| Page | Notes |
|---|---|
| Dashboard | KPI tiles, alert tiles |
| Coding Framework / Categories / Disciplines / Manufacturers / Models / Functional Groups | Reference data, admin-write |
| Code Generator | Builds a 6-segment code. Sequence comes from `next_part_sequence()` RPC (036) — server-side, advisory-locked |
| Hierarchy Tree | Counts from `v_parts_tree_counts` (172 rows); leaf parts lazy-load per functional group (035) |
| Master Parts Table | 14 columns, paginated, CSV import/export |
| Stock Ledger / Stock Count / Stock Movements | Append-only ledger, physical counts, void with optional partial quantity |
| Reorder Settings / Stock Alerts | Thresholds, acknowledge/snooze, email (Resend) + Web Push, daily pg_cron |
| Asset Registry / Asset Detail | Assets, PM tracking, hours log, documents, maintenance timeline |
| Reliability Reports | Fleet Overview, Reliability Indicators, Consumption, Cost |
| Administration / Audit Log / User Management / Trash | Admin only |

**Reliability Indicators framing is deliberate and must not drift:** these are
comparisons against fleet peers, never predictions. Every flag shows its
sample size (`fleet_asset_count`), the fleet median, and expands to the events
behind it. Requires ≥3 peer assets, a fleet median > 0, and ≥2 replacements —
below that, rows are omitted rather than shown as weak signals.

---

# 9. Working practices for this repo

1. **Read the actual code before assuming** a file, table or column exists.
2. **Verify, don't claim.** Run the query, take the screenshot. Several bugs
   here were shipped as "done" and were not. The app has an **offline mode**
   (unset `VITE_SUPABASE_URL`, or point it at a placeholder) that renders every
   page with seed data — use it with Playwright to check UI changes.
3. **Test destructive SQL inside a transaction that rolls back**
   (`DO $$ … RAISE EXCEPTION 'results >> % <<' … $$`) before running it live.
4. **One numbered migration per change**, with DDL, indexes, RLS policies,
   triggers, `COMMENT ON`, and a commented-out rollback block at the bottom.
   Next number: **043**.
5. **Frontend edits:** complete replacement files or anchored, asserted
   patches. A careless `str.replace` with an empty needle once ballooned
   `db.js` to 9.4 MB.
6. **Explain every changed file** in the response, and end with
   FILES CREATED / FILES MODIFIED / SQL TO RUN / APPLY ORDER.
7. Don't repeat work already done; don't touch anything outside the request.

---

# 10. Migrations

`001`–`010` predate MCP tracking and were applied by hand — **the repo and the
database can drift.** That is not hypothetical: `003` enables RLS on nine
tables, but eight of them were found with RLS off in production (fixed in
`031`). Check live state before trusting a migration file.

Landmarks: `011` ledger · `015` reorder points · `017`–`019` alerts and push ·
`020`–`022` assets · `023` maintenance↔stock link · `024` void double-count fix ·
`026` partial returns + work-order numbers · `029` privilege-escalation fix ·
`030` reliability views · `031`–`037` review fixes · `038` trash purge blockers ·
`039` sign-up role is not client input · `040`–`041` alert-function caller auth +
email de-duplication · `042` server-derived row attribution.

---

# 11. Review status (security audit 2026-09-11)

All CRITICAL and HIGH findings fixed and verified against the LIVE
database. Full detail, including the attack tests to re-run after
touching auth or policies, is in **`docs/SECURITY.md`** — read that
before changing anything in this section's territory.

- ✅ No public table without RLS (19/19)
- ✅ No permissive write policy, no `WITH CHECK (true)` insert policy
- ✅ No `anon`-callable privileged function
- ✅ No `SECURITY DEFINER` function without a pinned `search_path`
- ✅ Sign-up cannot name its own role (039)
- ✅ Alert Edge Functions reject an unauthenticated caller, and cannot
      send a duplicate email inside 24h (040, 041)
- ✅ Row attribution is forced to `auth.uid()` — 21 triggers (042)
- ✅ No stock drift, no orphan maintenance lines
- ✅ `v_asset_reliability_flags`: 532 ms → 22 ms (index on `reverses_txn_id`)

⚠ **The browser reaches Postgres directly with a key that ships in the
bundle.** RLS is not one control among several — it is the only one.
Anything enforced in React is decoration.

## Open items

1. **Department-user column restriction** — see the gap in §7. Needs your
   decision. (A scope gap, not an escalation.)
1b. **Two dashboard-only settings** — confirm sign-up is disabled, and enable
   leaked-password protection. Neither is reachable via MCP or API; see
   `docs/SECURITY.md` §5. Sign-up being open no longer grants admin (039).
2. **`CP-FN-F30-AC-PRV-0001` is in Trash holding 2 units** (trashed
   2026-09-09 06:16, before the guard existed). Either restore it or write the
   stock off with an adjustment — the ledger still counts those 2. It cannot
   be purged (1 stock movement), and neither can `CP-FN-F03-AC-SOV-0001`
   (4 legacy `stock_movements` rows). Both correctly stay in Trash.
3. **Demo data** — `TEST-G04-002/003/004` and 18 `DEMO` maintenance events
   exist so the Indicators page has something to show. Remove with
   `supabase/scripts/remove_demo_assets.sql` (returns the parts to stock).
4. **Leaked-password protection is disabled** in Supabase Auth — enable it in
   the dashboard (Authentication → Policies).
5. **11 pre-030 views are `SECURITY DEFINER`** and bypass RLS. Converting them
   would blank the User column on Stock Movements for department users
   (`user_profiles` is own-row-or-admin). Left deliberately; see `037`.
