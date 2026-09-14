# Security history — CarGas Coding System

Last change: **14 September 2026** (migrations 043–044).
Audits so far: 11 Sep 2026 (039–042) · 14 Sep 2026 (043–044).

This is the running log of everything security-related in this system:
what enforces what today, every finding ever closed and how, and how to
verify it is still working.

**Append to it; do not rewrite it.** Each finding keeps its own dated
entry with the migration that closed it, so a later reader can see not
just the current state but what was once wrong and why the fix looks
the way it does. Update §2, §5 and §6 in place when the picture
changes, and add a new subsection under §3 for each new finding.

Every claim here was measured against the live database, not inferred
from the migration files — the two have drifted before (see `031`).

---

## 1. The one fact that shapes everything

**The browser talks to PostgreSQL directly, using a key that ships in
the JavaScript bundle.**

There is no API layer. `src/` runs entirely in the browser; the only
server-side code in this repository is the two Supabase Edge Functions.
Verified by building with marker values:

| Value | Occurrences in `dist/assets/*.js` |
|---|---|
| `VITE_SUPABASE_URL` | 3 |
| `VITE_SUPABASE_ANON_KEY` | 1 |
| `VITE_VAPID_PUBLIC_KEY` | 1 |

All three are **public by design**. The consequence is the important
part:

> **PostgreSQL RLS is not *a* control here. It is *the* control.**
> Anything enforced only in React is decoration. A hidden menu item, a
> disabled button and a client-side validator stop nobody.

Secrets that must never reach the browser — `SUPABASE_SERVICE_ROLE_KEY`,
`RESEND_API_KEY`, `VAPID_PRIVATE_KEY` — exist only as Edge Function
secrets read through `Deno.env.get`. No credential is committed, and
`git log --diff-filter=A` over env/key patterns returns nothing.

---

## 2. What enforces what

| Concern | Enforced by | Where |
|---|---|---|
| Who may read/write each table | RLS policies on all 19 public tables | `003`, `031`, `037` |
| Who may change a role | `profiles_update` WITH CHECK | `029` |
| What role a new user gets | `handle_new_user()` + `enforce_profile_role` trigger | `039` |
| Who a row is attributed to | `force_created_by` / `force_updated_by` / `force_user_id` triggers | `042` |
| Direction of a stock movement | `signed_qty` GENERATED ALWAYS | `011` |
| `qty_on_hand` cannot be typed | `SECURITY INVOKER` trigger | `034` |
| Who may invoke the alert functions | `x-alert-cron-secret` + `verify_alert_cron_secret()` | `040`, `041` |
| Alert email volume | 24h dedup per (part, severity, channel) | `040` |
| Who may see stock alerts | role guard inside `v_active_alerts` | `043` |
| `anon` reading anything in `public` | no grants, and none by default | `044` |

### Roles

Two, in `user_profiles.role`: `admin` and `department_user`.
`current_user_role()` returns **`'anonymous'`** when unauthenticated —
never NULL. This is load-bearing: guards are written
`IF current_user_role() <> 'admin' THEN RAISE`, and with NULL that IF
evaluates to NULL and never fires (`032`).

Since `043`, stock alerts are **admin-only**. A grant cannot express
that: every signed-in user reaches PostgREST as the same Postgres role,
`authenticated`, so revoking SELECT would lock out admins too. The role
lives in `user_profiles`, which only `current_user_role()` reads, so the
guard sits inside the view.

---

## 3. Findings closed on 11 September 2026

### #1 — Sign-up role was client input · migration 039

`handle_new_user()` copied the new profile's role out of
`raw_user_meta_data`. The app called `signInWithOtp({ data: { role } })`
from the browser, and **`signInWithOtp` is unauthenticated** and
reachable with the bundled anon key. Anyone could request a magic link
for their own address carrying `role: "admin"`.

Migration `029` had closed the same escalation through RLS, but
`handle_new_user()` is `SECURITY DEFINER` and runs as the table owner,
so **RLS never applied to it**.

Fixed in two layers: the trigger no longer reads the metadata role at
all, and a `BEFORE INSERT` trigger on `user_profiles` downgrades any
non-`department_user` role unless the inserting session is already an
admin. Triggers run even when RLS is bypassed, which is what makes the
second layer cover the first layer's blind spot.

Forensics: no account had ever escalated this way. The one admin
predates the metadata path.

**Promotion path is unchanged** — an admin uses Change Role on the
Users page, gated by `profiles_update`.

### #2 — Unauthenticated, unmetered paid email · migrations 040, 041

`low-stock-alert` sent a Resend email on **every** invocation, had no
caller check, and — unlike its sibling — no de-duplication. Both
functions are deployed `verify_jwt = false` (confirmed live), and both
cron jobs called them with no auth header.

`verify_jwt = true` was rejected deliberately: the caller is pg_cron
with no user session, so enabling it forces the **service-role key into
the cron command text** stored in `cron.job`. A purpose-scoped shared
secret grants nothing but the right to trigger one alert run.

Two controls:
1. **`x-alert-cron-secret`**, generated in-database so it is never
   typed, printed or committed. Vault holds it; cron reads it at call
   time; the functions never see it — they pass the received header to
   `verify_alert_cron_secret()`, which compares and returns a boolean.
2. **24h de-duplication** per `(part_id, severity)` on the `email`
   channel. This is the control that actually caps cost, because it
   holds even if the secret leaks.

> **Why migration 041 exists.** `040` had verification read the
> plaintext back from Vault. That works from a SQL session but **throws
> under PostgREST**: `vault.decrypted_secrets` is owned by
> `supabase_admin` and its pgsodium decryption depends on `session_user`
> — `postgres` directly, `authenticator` via PostgREST. `SECURITY
> DEFINER` changes `current_user`, not `session_user`. A wrong secret
> was returning **500 from the generic catch instead of 401**, meaning
> the caller check was not deciding the outcome. `041` stores only the
> SHA-256 digest in an ordinary table, so verification needs no Vault.

### #3 — Forgeable attribution · migration 042

Every "who did this" column was sent by the browser and checked by
nobody: **12 tables, 22 columns**, `column_default` NULL on all of
them, and no INSERT policy mentioned the column. `audit_logs` was worst
— `WITH CHECK (true)`, so any signed-in user could write an audit entry
attributed to anyone.

No **balance** was ever forgeable — `signed_qty` is GENERATED ALWAYS
from `txn_type`. What was forgeable is the record of *who*, which is
precisely what the audit log exists to establish.

Fixed by **forcing, not rejecting**: `BEFORE` triggers overwrite the
column with `auth.uid()`. Rejecting would have broken every existing
call site; forcing leaves them working and simply makes the value true.
`auth.uid() IS NULL` is left untouched — that is a `SECURITY DEFINER`
maintenance path or a service_role job that set the column itself.

---

## 3b. Findings closed on 14 September 2026

Found while implementing a product change (making alerts admin-only),
not during a scheduled audit — which is itself the lesson: the grant
listing was never checked, only the policies.

### #4 — `anon` could read most of the database · migration 044

**Severity: critical.** §7 of `CLAUDE.md` had claimed for months that
"anon has no access to anything". Measured with `SET ROLE anon` — the
role behind the publishable key that ships in the bundle, with no
sign-in at all:

| Object | Rows readable by `anon` |
|---|---|
| `audit_logs_with_user` | **58,472** — the whole audit log, with user names |
| `v_stock_status` | 5,867 |
| `v_stock_transactions_detail` | 5,886 |
| `v_active_alerts` | 38 |
| `v_maintenance_parts_used` | 26 |
| `v_stock_confidence` | 6 |
| `v_stock_status_summary` | 5 |
| `v_assets_overview`, `v_asset_cost_summary` | 4 each |
| `v_asset_kpis`, `v_asset_pm_due` | 1 each |

**Why the tables were safe and the views were not.** RLS is on for all
19 tables and every policy is `TO authenticated`, so `anon` selects
nothing from them. But the 11 pre-030 views are `SECURITY DEFINER`
(§6 — left that way deliberately by `037`, for an unrelated reason). A
`SECURITY DEFINER` view runs as its owner and does **not** apply the
caller's RLS. `anon` held SELECT on every one of them, so reading the
view read straight past the policies.

This is the gap between "RLS is enabled" and "the data is protected".
Both were true statements about this database; only the first was ever
checked.

**Fix.** `044` revokes every `anon` grant on every table and view in
`public`, and removes `anon` from the schema's **default privileges** —
without that second half, the next `CREATE TABLE` silently re-grants it
and re-opens the hole. Verified by creating a table through the
migration path inside a transaction that rolled back: owner `postgres`,
granted to `authenticated` and `service_role` only.

The `supabase_admin` default ACL could not be altered from the
migration role; the migration emits a NOTICE saying so rather than
pretending it succeeded. Objects created by `supabase_admin` (e.g. via
some dashboard paths) would still be granted — re-run the check query
at the bottom of `044` after any such object.

**Not converted to `security_invoker`.** That is the change `037`
declined to make and it would blank the User column on Stock Movements
for department users. Revoking `anon` closes the exposure without
altering what any signed-in user sees.

**Left alone deliberately:** `anon` still holds EXECUTE on 14 public
functions. Each was checked — thirteen are `SECURITY INVOKER` and RLS
still stops them, and `current_user_role()` is `SECURITY DEFINER` but
returns `'anonymous'` to an `anon` caller, which is its whole purpose.
No leak, so the migration was not widened into it.

### #5 — Alerts leaked to every signed-in user · migration 043

Not a vulnerability so much as a missing restriction: stock alerts were
visible to department users, and the product decision was that they
should not be. Recorded here because the *enforcement* is the
interesting part.

The guard is a row filter inside `v_active_alerts`:

```sql
AND (current_user = 'service_role' OR public.current_user_role() = 'admin')
```

`service_role` is admitted explicitly because both alert Edge Functions
read this view. Forgetting that would have stopped the daily email with
no error anywhere — a failure nobody notices until the mail stops
arriving.

`current_user` rather than `auth.role()`: the latter reads
`request.jwt.claims`, which is unset outside a PostgREST request, so it
cannot be tested from a SQL session. `current_user` reflects the role
PostgREST `SET ROLE`s into and was measured returning `service_role`
and `authenticated` correctly from inside a view.

Verified live, all four callers:

| Caller | Rows | Bell badge |
|---|---|---|
| `anon` | denied | — |
| admin | 38 | 29 |
| department_user | **0** | **0** |
| `service_role` | 38 | — |

`get_alert_counts()` needed no change: it is `SECURITY INVOKER` over the
same view, so the header bell zeroes itself.

---

## 3c. Full review, 14 September 2026 (second pass)

A complete re-audit, requested after 043/044. No CRITICAL or HIGH
finding is currently exploitable. One MEDIUM and three LOW are recorded
below, plus a correction to what §3b claimed.

### Correction to finding #4 — the pre-044 exposure was wider than reported

§3b listed eleven **views** as readable by `anon`. That list was
incomplete, and the reason matters: the probe that produced it looped
over `relkind='v'` only. It never tested a single table.

Re-tested by restoring the pre-044 grants inside a transaction that
rolled back. As `anon`, five **tables** were also readable:

| Table | Rows |
|---|---|
| `maintenance_parts_used` | 26 |
| `maintenance_events` | 21 |
| `alert_acknowledgements` | 11 |
| `assets` | 4 |
| `asset_documents` | 3 |

Writes were never possible — every write policy on these tables tests
`current_user_role()`, which returns `'anonymous'`. `044` closed the
read path with the grants, and the 044 assertion did cover both kinds
(`relkind IN ('r','v')`), so the fix was complete even though the
finding's description was not.

**Lesson, now in the audit skill:** a probe that enumerates one object
kind gives false assurance about the other. Enumerate tables *and*
views, and say which you enumerated.

### #6 — Policies are `TO PUBLIC`, and four are `USING (true)` · CLOSED by `045`

**Severity: medium.** Not currently exploitable; it removes the second
layer of defence.

§7 of `CLAUDE.md` said "Policies use `TO authenticated`". Measured: **27
policies across 8 tables are `TO PUBLIC`**, which includes `anon`. Four
of them read `USING (true)`:

```
alert_acknowledgements.alert_ack_select        USING (true)
asset_documents.asset_documents_select         USING (true)
asset_hours_log.asset_hours_log_select         USING (true)
maintenance_parts_used.maintenance_parts_used_select  USING (true)
```

and two more carry no role test at all:

```
assets.assets_select                USING (deleted_at IS NULL)
maintenance_events.maintenance_events_select  USING (deleted_at IS NULL)
```

This is exactly the exposure proven in the correction above. Today the
only thing preventing it is the absence of an `anon` grant — one layer,
and the layer that was wrong until `044`. Re-grant `anon` by accident,
or create a table through a path that still inherits the platform
default ACL, and these policies hand the rows over.

**Remediation — migration `045`, applied 2026-09-14.** All 27 policies
re-declared `TO authenticated`, and the six SELECT rules above given a
role test instead of `true`. Written out policy by policy rather than
regenerated in a loop: a policy rebuilt from the catalogue is
unreviewable in a diff.

Dry-run first, inside a transaction that rolled back, then applied.
Verified live afterwards:

| Check | Result |
|---|---|
| Policies addressed to `PUBLIC` | **0** |
| Objects readable as `anon` (tables + views) | **0** |
| admin vs department_user on assets / events / lines | 4 / 21 / 26, identical |
| `v_maintenance_parts_used` admin vs dept | 26 / 26 |
| `service_role` on `v_active_alerts` | 38 |

Nothing changed for real users, which was the point: both application
roles pass the new test, so every read that worked before still works.

`service_role` was never at risk — it carries `BYPASSRLS` (measured
true), so the alert Edge Functions do not evaluate these policies at
all. Signup was not at risk either: `handle_new_user()` is
`SECURITY DEFINER` owned by `postgres`, which also bypasses RLS, so
`profiles_insert` is not evaluated during account creation. Both were
checked before the migration was written, not after it broke something.

**Two `USING (true)` SELECT policies remain, deliberately:**
`stock_movements_select` and `stock_transactions_select`. Both are
`TO authenticated`, so `anon` is already excluded, and the ledger is
meant to be readable by every signed-in user — both roles have the
Stock Ledger and Stock Movements pages. Adding a role test there would
exclude only an authenticated user with no profile row, of which there
are currently none (checked: 0 auth users without a profile). Recorded
as checked and accepted rather than missed.

### #7 — Eight functions have a mutable `search_path` · LOW

The Supabase advisor flags `set_updated_at`, `get_alert_counts`,
`get_unconfigured_count`, `next_work_order_no`, `maintenance_event_set_wo`,
`maintenance_parts_require_txn`, `maintenance_parts_block_desync` and
`spare_parts_block_delete_with_stock`.

**Not exploitable here**, and the reason is worth recording because it
is what makes this LOW rather than HIGH: an attacker would have to plant
an object that shadows an unqualified name, and neither `anon` nor
`authenticated` holds `CREATE` on `public` — measured, both `false`.
Every `SECURITY DEFINER` function already pins its path; these eight are
`SECURITY INVOKER`. Worth fixing as hygiene, since the protection is a
schema privilege someone could grant away.

### #8 — `current_user_role()` is executable by `anon` · LOW, accepted

Advisor `0028`. It is `SECURITY DEFINER`, so the advisor flags it, but
it returns `'anonymous'` to an `anon` caller — that is its entire job,
and the value is what `032` made load-bearing. Revoking `EXECUTE` from
`anon` was considered and **not** done: the signup path evaluates
`enforce_profile_role` (`039`), and breaking account creation to silence
an advisory would be a bad trade. Recorded as accepted, not missed.

### #9 — Six dev-dependency advisories · LOW

`npm audit`: 6 (2 moderate, 4 high) — `esbuild`, `postcss`, `nanoid`,
`browserslist`, `baseline-browser-mapping`, all transitive through
`vite`. `npm audit --omit=dev` reports **0**: none reaches the deployed
bundle. The `esbuild` advisory concerns the local dev server only.
Fix by bumping `vite` when convenient.

### What was re-verified and passed

| Check | Result |
|---|---|
| RLS enabled | 20/20 tables |
| Permissive write policies / open inserts | 0 / 0 |
| `SECURITY DEFINER` functions with unpinned `search_path` | 0 |
| Privileged RPCs missing a role guard | 0 of 6 |
| `anon` grants in `public` | 0 |
| `anon` objects readable (tables **and** views) | 0 |
| Attack tests as department_user | 6/6 blocked |
| Attack tests as `anon` | 3/3 blocked |
| Stock drift · orphan lines · negative stock | 0 · 0 · 0 |
| Profiles ↔ auth.users mismatch | 0 both ways |
| Cron jobs active and sending the secret | 2/2 |
| Secrets committed to the repo | none |
| Production dependency vulnerabilities | 0 |
| Page timings (admin) | audit log 4.2 ms · stock 1.8 ms · reliability 38.5 ms |

The six department_user attack tests were: void a transaction, edit
master data, trash a part, self-promote to admin, write `qty_on_hand`
directly, read another user's profile. All blocked; profile visibility
returned 1 row, its own.

**Still open by decision, not oversight:** the department-user column
restriction (§6) — re-confirmed live, a department user can still write
`location` and `reorder_point`, outside the three columns the spec
allows.

---

## 4. Verification — run this after any schema change

```sql
-- Expect: 0, 0, 0, 0, false, 21, 2, 0, 0, 0
SELECT 'stock_drift_rows', COUNT(*)::text FROM (
  SELECT sp.id FROM public.spare_parts sp
  LEFT JOIN public.stock_transactions st ON st.part_id = sp.id
  WHERE sp.deleted_at IS NULL
  GROUP BY sp.id, sp.qty_on_hand
  HAVING sp.qty_on_hand IS DISTINCT FROM COALESCE(SUM(st.signed_qty),0)) d
UNION ALL SELECT 'tables_without_rls', COUNT(*)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
UNION ALL SELECT 'permissive_write_policies', COUNT(*)::text FROM pg_policy p
  WHERE pg_get_expr(p.polqual,p.polrelid)='true' AND p.polcmd <> 'r'
UNION ALL SELECT 'insert_policies_with_check_true', COUNT(*)::text FROM pg_policy p
  WHERE p.polcmd='a' AND pg_get_expr(p.polwithcheck,p.polrelid)='true'
UNION ALL SELECT 'handle_new_user_reads_metadata_role',
  (EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='handle_new_user'
     AND pg_get_functiondef(p.oid) LIKE '%raw_user_meta_data->>''role''%'))::text
UNION ALL SELECT 'attribution_triggers', COUNT(*)::text FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgname IN ('force_created_by','force_updated_by','force_user_id')
UNION ALL SELECT 'cron_jobs_sending_secret', COUNT(*)::text
  FROM cron.job WHERE command LIKE '%alert_cron_secret%'
UNION ALL SELECT 'orphan_maintenance_lines', COUNT(*)::text
  FROM public.maintenance_parts_used WHERE stock_transaction_id IS NULL
-- Added after finding #4. RLS on the tables says nothing about a
-- SECURITY DEFINER view, so check the grants themselves, and check that
-- the defaults will not hand them back out to the next new object.
UNION ALL SELECT 'anon_grants_in_public', COUNT(*)::text
  FROM information_schema.role_table_grants g
  JOIN pg_class c ON c.relname=g.table_name
  JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
  WHERE g.grantee='anon' AND g.table_schema='public'
UNION ALL SELECT 'default_acls_granting_anon', COUNT(*)::text
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid=d.defaclnamespace AND n.nspname='public'
  WHERE d.defaclobjtype='r'
    AND pg_get_userbyid(d.defaclrole)='postgres'
    AND array_to_string(d.defaclacl,' ') LIKE '%anon=%'
-- Added after finding #6. A policy with no TO clause applies to PUBLIC,
-- which includes anon; the expression being correct says nothing about
-- who the policy is addressed to.
UNION ALL SELECT 'policies_addressed_to_public', COUNT(*)::text
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
  WHERE p.polroles = '{0}'::oid[];
```

Result on 11 Sep 2026: `0, 0, 0, 0, false, 21, 2, 0` (first eight).
Result on 14 Sep 2026, before `045`: `0, 0, 0, 0, false, 21, 2, 0, 0, 0`
plus `policies_addressed_to_public = 27`.
Result on 14 Sep 2026, after `045`: `0, 0, 0, 0, false, 21, 2, 0, 0, 0, 0`.

`default_acls_granting_anon` deliberately counts only the `postgres`
default ACL. The `supabase_admin` one still lists `anon` and cannot be
changed from the migration role — see finding #4.

### Testing pattern

Destructive SQL goes inside a `DO $$ … RAISE EXCEPTION 'RESULTS >> % <<' … $$`
block, which rolls everything back while still reporting what happened.
Two traps this codebase has hit:

- `INSERT ... RETURNING` also applies the **SELECT** policy. A
  department user's RETURNING on `audit_logs` fails because
  `audit_select` is admin-only — that is not the insert being rejected.
- `SET LOCAL ROLE authenticated` changes `current_user` but **not**
  `session_user`. Some Supabase internals (Vault/pgsodium) behave
  differently under PostgREST as a result, so a passing SQL test does
  not guarantee a passing PostgREST test. Test through the real path.

### Attack tests

Re-run these after touching auth, roles or policies. All must fail.

| Attack | Expected |
|---|---|
| Sign up with `raw_user_meta_data.role = 'admin'` | profile is `department_user` |
| Insert a profile naming `role='admin'` without an admin session | forced to `department_user` |
| Department user sets own role to `admin` | `42501` |
| Department user promotes someone else | 0 rows |
| `POST /functions/v1/low-stock-alert` with no/wrong secret | `401` |
| Repeated authorised alert calls | `200 skipped`, no second email |
| Insert `stock_transactions` with someone else's `created_by` | forced to caller |
| Insert `audit_logs` with someone else's `user_id` | forced to caller |

---

## 5. Still open — both dashboard-only

Neither is reachable through the Supabase MCP or the API, and my
sandbox blocks outbound `supabase.co`, so these need one manual action
each.

1. **Confirm sign-up is disabled.**
   Authentication → Sign In / Providers → "Allow new users to sign up"
   should be **off** for an internal tool.
   *This no longer gates privilege escalation* — migration 039 removed
   that dependency deliberately — but an open sign-up on an internal
   system still lets strangers create accounts.

2. **Enable leaked-password protection.**
   Authentication → Policies. Checks passwords against
   HaveIBeenPwned. Flagged by the Supabase security advisor.

## 6. Known and accepted

- **11 pre-030 views are `SECURITY DEFINER`.** Converting them would
  blank the User column on Stock Movements for department users, since
  `user_profiles` is own-row-or-admin. Left deliberately; see `037`.
  ⚠ Accepting this costs something, and `044` is the bill: such a view
  bypasses the caller's RLS entirely, so **its grants are the only thing
  standing between it and an unauthenticated reader**. Any new view here
  needs its grants checked explicitly — RLS on the tables underneath
  proves nothing about it.
- **`alert_notifications_log` and `alert_cron_auth` have RLS on with no
  policies.** Deliberate: service_role only. The advisor reports this
  as INFO; do not "fix" it by adding a policy.
- **Department-user column restriction is not enforced.** The spec says
  a department user may edit only Functional Group, Sequential Number
  and Description on a part; in reality the form applies no field-level
  gating. This is a *scope* gap, not an escalation — it needs a product
  decision. See `CLAUDE.md` §7.
- **No rate limiting on login, sign-up or OTP** beyond Supabase's
  built-in auth limits, which are not configured in this repo.
