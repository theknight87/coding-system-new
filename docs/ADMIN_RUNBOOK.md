# CarGas — Administrator Runbook

Operational procedures for the person who owns the database.
Supabase project `fuwllmohhqlfcvhoyfgm`. Companion to `CLAUDE.md`.

---

## 1. Monthly stock-drift check

`spare_parts.qty_on_hand` is a cache of the ledger. It should always equal
`SUM(signed_qty)` over **all** rows for that part — voided rows included,
because each is cancelled by its own reversing entry.

Run this on the first of the month:

```sql
SELECT sp.code,
       sp.qty_on_hand                                   AS cached,
       COALESCE(SUM(st.signed_qty), 0)                  AS ledger_sum,
       sp.qty_on_hand - COALESCE(SUM(st.signed_qty), 0) AS drift
FROM public.spare_parts sp
LEFT JOIN public.stock_transactions st ON st.part_id = sp.id
WHERE sp.deleted_at IS NULL
GROUP BY sp.id, sp.code, sp.qty_on_hand
HAVING sp.qty_on_hand IS DISTINCT FROM COALESCE(SUM(st.signed_qty), 0)
ORDER BY abs(sp.qty_on_hand - COALESCE(SUM(st.signed_qty), 0)) DESC;
```

**Expected result: zero rows.**

### If it returns rows

Drift means something wrote `qty_on_hand` outside the ledger. Since
migration 034 a trigger blocks that from the API, so the realistic causes
are a direct `psql`/SQL-editor `UPDATE`, or a restore from a backup taken
mid-transaction.

1. **Do not "fix" the number by hand.** That hides the cause.
2. Find out when it happened:
   ```sql
   SELECT * FROM public.audit_logs
   WHERE table_name = 'spare_parts' AND record_id = 'THE-PART-CODE'
   ORDER BY created_at DESC LIMIT 20;
   ```
3. Decide which is right. **The ledger is the source of truth** — it has
   dated, attributed entries; the cache does not.
4. Recompute the cache from the ledger (section 2). This is safe: it only
   rewrites the cache to match the ledger.
5. If the ledger itself is wrong (a movement was never recorded), post the
   missing movement — do not edit history.

---

## 2. Running `recalc_all_stock()` safely

Recomputes `qty_on_hand` for every part from the ledger.

```sql
-- 1. See what would change, BEFORE changing anything
SELECT sp.code, sp.qty_on_hand AS now, COALESCE(SUM(st.signed_qty),0) AS will_become
FROM public.spare_parts sp
LEFT JOIN public.stock_transactions st ON st.part_id = sp.id
WHERE sp.deleted_at IS NULL
GROUP BY sp.id, sp.code, sp.qty_on_hand
HAVING sp.qty_on_hand IS DISTINCT FROM COALESCE(SUM(st.signed_qty),0);

-- 2. Apply
SELECT public.recalc_all_stock();

-- 3. Confirm the drift query now returns nothing
```

**Notes**

- It is **idempotent** — running it twice changes nothing the second time.
- It writes every `spare_parts` row, so the `audit_trigger` fires for each.
  On ~5,900 parts expect a burst of audit rows; that is normal.
- It takes a few seconds at this scale. It is not disruptive, but prefer a
  quiet period.
- It **cannot invent stock**: if the ledger is missing a receipt, recalc
  will faithfully produce the wrong number. Fix the ledger first.
- Single part: `SELECT public.recalc_part_stock('<uuid>');`

---

## 3. Scheduling with pg_cron

> ⚠️ **`refresh_reorder_suggestions()` does not exist in this database, and
> nothing needs it.** Reorder status is computed **live** by the
> `v_stock_status` view every time it is read — there is no materialized
> table to refresh. I checked before writing this section: the only
> reorder-related function is `bulk_set_reorder_settings()`, which applies
> thresholds to a filtered set of parts and is called from the Reorder
> Settings page, not on a schedule.

### What is actually scheduled

```sql
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
```

| Job | Schedule | Purpose |
|---|---|---|
| `low-stock-daily-alert` | `0 7 * * *` | Daily 07:00 UTC email digest via the `low-stock-alert` edge function |
| `stock-push-alerts` | `0 5-17/2 * * *` | Web-push alerts every 2h, 05:00–17:00 UTC |

### If you ever do want a cached snapshot

Only worth it if `v_stock_status` becomes slow (it is not today — it reads
`spare_parts` directly with indexes on `qty_on_hand` and `reorder_point`).
The pattern would be:

```sql
CREATE MATERIALIZED VIEW public.mv_stock_status AS SELECT * FROM public.v_stock_status;
CREATE UNIQUE INDEX ON public.mv_stock_status (id);

SELECT cron.schedule('refresh-stock-status', '*/30 * * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_stock_status $$);
```

**Do not do this without a measured reason.** It introduces staleness into
the alerting path — a part could go out of stock and not alert for 30
minutes.

### Managing jobs

```sql
SELECT cron.unschedule('job-name');
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;  -- did it run?
```

---

## 4. A part is discontinued and replaced by a new part number

**Never edit the old part's code.** It appears in the ledger, in maintenance
history, and probably on physical shelf labels.

1. **Create the new part** normally (Code Generator or Master Table). Give
   it its own code; the sequence generator handles numbering.
2. **Move the remaining stock across** so the value is not lost:
   - On the old part: **📦 Move → ± Adjust →** `Adjustment −` for the full
     remaining quantity. Reason: `Superseded by NEW-CODE`.
   - On the new part: **+ Receive** the same quantity. Reference:
     `Superseded from OLD-CODE`.

   > Use adjustment/receipt rather than a transfer: transfers mean "same
   > part, different place". This is a different part number.
3. **Record the link** in the old part's `remarks`:
   `DISCONTINUED — superseded by NEW-CODE (2026-09-09)`.
4. **Set the old part's status to `Inactive`** so it drops out of pickers
   but stays searchable.
5. **Zero its thresholds** (`reorder_point = 0`, `min_stock = 0`) so it stops
   generating alerts.
6. **Optionally move it to Trash.** It will keep the 🔒 *Has history* marker
   and can never be purged — that is correct, and it keeps the old history
   readable.

**What NOT to do:** do not delete the old part, do not reuse its code for
the new one, and do not rename it. Every one of those breaks the audit
trail.

---

## 5. Backup and rollback

### Before any migration

```bash
# Supabase Dashboard → Database → Backups → "Create backup" (point-in-time)
# Or, for a schema-only snapshot you can diff later:
supabase db dump --schema public --file backup_$(date +%Y%m%d).sql
```

Paid Supabase plans keep daily automatic backups with PITR. **Confirm your
plan actually has PITR before relying on it** — on the free tier you only
get daily logical backups.

### Rolling back a migration

Every migration in `supabase/migrations/` ends with a commented-out
**ROLLBACK** block. To revert one, uncomment and run that block.

| Migration | Safe to roll back? | Notes |
|---|---|---|
| 031 RLS enable | ❌ **Never** | Re-exposes the whole catalogue to the public internet |
| 032 role-guard fix | ❌ **Never** | Restores an unauthenticated write path into the ledger |
| 033 index | ✅ Yes | Pure performance; only makes queries slower |
| 034 qty_on_hand guard | ⚠️ Only to debug | Re-opens the drift path |
| 035 tree counts | ✅ Yes | Revert the frontend at the same time |
| 036 sequence + integrity | ⚠️ Partial | The data repair it performed is **not** reversible — it posted a real ledger entry. Only the functions/triggers can be dropped |
| 037 role model | ✅ Yes | Restores department-user delete rights |
| 038 trash blockers | ✅ Yes | View only |

**Rule:** a migration that only adds functions, views, indexes or triggers
rolls back cleanly. A migration that **wrote data** (like 036's backfill, or
027's repair) does not — its ledger entries are permanent by design. Roll
back the code, then post a compensating entry if you truly need to undo the
data.

### After any rollback

```sql
SELECT public.recalc_all_stock();  -- if anything touching stock changed
```
Then run the drift query and the security checks in section 7.

---

## 6. Data dictionary — tables and views added by this work

### Tables

| Table | What it holds |
|---|---|
| `stock_transactions` | **The ledger.** Append-only, immutable. One row per stock movement. `signed_qty` is generated from `txn_type`; `is_void` marks a cancelled row but never changes a balance |
| `alert_acknowledgements` | Who acknowledged or snoozed which stock alert, and until when |
| `alert_notifications_log` | Send-dedup ledger for the alert edge functions. RLS on, **no policies** — service_role only, deliberately |
| `push_subscriptions` | Browser Web-Push endpoints per user |
| `assets` | Physical equipment. `asset_tag` generated by `next_asset_tag()` |
| `asset_hours_log` | Append-only running-hours readings. A trigger rejects a reading below the previous one unless `is_counter_reset` |
| `asset_documents` | Manuals/drawings attached to an asset (Supabase Storage URLs) |
| `maintenance_events` | Maintenance jobs. `work_order_no` auto-assigned as `WO-YYYY-NNNN` |
| `maintenance_parts_used` | Parts consumed on a job. A trigger posts the `issue` and links `stock_transaction_id` |

### Views

| View | What it answers |
|---|---|
| `v_stock_status` | Per part: status (`out`/`critical`/`low`/`ok`/`unset`), shortage, suggested order qty. **Computed live** |
| `v_stock_status_summary` | Counts per status, for the dashboard tiles |
| `v_stock_transactions_detail` | Ledger rows joined to part/asset/user, with a running `balance_after` |
| `v_stock_confidence` | How trustworthy each balance is (counted vs estimated) |
| `v_negative_stock` | Parts whose balance has gone below zero — investigate every row |
| `v_active_alerts` | Current alerts minus anything acknowledged or snoozed |
| `v_assets_overview` | Assets plus event counts, last event, PM-due calculation |
| `v_asset_pm_due` | Just the assets where `pm_due = true` |
| `v_asset_kpis` | Fleet counters for the Asset Registry header |
| `v_maintenance_parts_used` | Part lines with `issued_qty`, `returned_qty`, `net_qty`, `is_cancelled`. **Use `net_qty` for all reporting** |
| `v_part_replacements` | Base view for reliability: one row per part genuinely consumed, returns netted off, soft-deleted rows excluded |
| `v_asset_part_history` | Per asset+part: count, cost, mean interval, projected next date (NULL below 2 replacements) |
| `v_fleet_part_baseline` | Per model+functional group: mean and median replacements per asset, incl. assets with zero |
| `v_asset_reliability_flags` | Assets replacing a group ≥2× their fleet median over the same 12 months. Needs ≥3 peers, median > 0, ≥2 replacements |
| `v_asset_cost_summary` | Per asset per year: parts cost, events, downtime, cost per running hour (NULL when no hours logged) |
| `v_part_failure_patterns` | `failure_mode` aggregated by part and model |
| `v_parts_tree_counts` | Part counts per `(cat, mfr, model, disc, fg)` branch, for the Hierarchy Tree |
| `v_trash_purge_blockers` | Per trashed row, what still references it and blocks a permanent delete |

### Key functions

| Function | Purpose |
|---|---|
| `recalc_part_stock(uuid)` / `recalc_all_stock()` | Rebuild the cached balance from the ledger |
| `post_physical_count(...)` | Post a stock count as an adjustment for the difference |
| `void_stock_transaction(txn, reason, qty)` | Admin-only. Reverse all or part of a movement |
| `post_stock_reversal(...)` | The un-gated engine behind voids and returns. **Internal** — revoked from anon/authenticated |
| `return_maintenance_part(line, qty, reason)` | Return some/all of an issued part, linked to its job |
| `log_maintenance_event(...)` | Create an event and its part lines atomically |
| `next_asset_tag(cat, mfr, model)` | Next asset tag under an advisory lock |
| `next_part_sequence(cat, mfr, model, disc, fg)` | Next part sequence, computed over the whole prefix |
| `current_user_role()` | Caller's role, `'anonymous'` when not signed in. **Never returns NULL** — the guards depend on that |
| `demo_teardown()` | Removes the training dataset (demo projects only) |

---

## 7. Health checks

Run after any migration, and monthly:

```sql
-- Every public table must have RLS on
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity = false;
-- expected: 0 rows

-- No privileged function callable without signing in
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND p.proname <> 'current_user_role';
-- expected: 0 rows

-- Maintenance lines must all have posted stock
SELECT count(*) FROM public.maintenance_parts_used WHERE stock_transaction_id IS NULL;
-- expected: 0

-- Negative balances
SELECT * FROM public.v_negative_stock;
-- expected: 0 rows
```

Also run Supabase's own linter: **Dashboard → Advisors → Security**.

---

## 8. Loading the training dataset

`supabase/scripts/seed_demo_dataset.sql` builds 8 assets, 18 months of
maintenance, matching consumption, opening balances and reorder points, and
one deliberately problematic unit so the reliability flags fire.

**It fails closed.** In the same SQL editor session, run first:

```sql
SELECT set_config('app.demo_seed', 'YES_THIS_IS_A_DEMO_PROJECT', false);
```

then run the file. Without that token it aborts and changes nothing.

Verified output on a copy of production (inside a rolled-back transaction):
**8 assets, 61 maintenance events, 133 part lines, 6 reliability flags,
16 stock alerts, 0 drift.**

To remove: `SELECT public.demo_teardown();` — deletes the part lines (which
returns their stock through the migration-023 trigger) and soft-deletes the
events and assets.

**Never run it on production.**
