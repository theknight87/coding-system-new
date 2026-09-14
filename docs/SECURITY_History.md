# Security model — CarGas Coding System

Last audited and hardened: **11 September 2026** (migrations 039–042).

This document records what actually enforces security in this system,
what was found broken, and how to verify it is still working. Every
claim here was measured against the live database, not inferred from
the migration files — the two have drifted before (see `031`).

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

### Roles

Two, in `user_profiles.role`: `admin` and `department_user`.
`current_user_role()` returns **`'anonymous'`** when unauthenticated —
never NULL. This is load-bearing: guards are written
`IF current_user_role() <> 'admin' THEN RAISE`, and with NULL that IF
evaluates to NULL and never fires (`032`).

---

## 3. Findings closed in the September 2026 audit

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

## 4. Verification — run this after any schema change

```sql
-- Expect: 0, 0, 0, 0, false, 21, 2, 0
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
  FROM public.maintenance_parts_used WHERE stock_transaction_id IS NULL;
```

Result on 11 Sep 2026: `0, 0, 0, 0, false, 21, 2, 0`.

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
