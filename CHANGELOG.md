# Changelog

Everything added to CarGas beyond the original coding system, in three
phases. Written to explain **why**, not just what.

The original application was a spare-parts **coding** system: the six-segment
code, the reference tables behind it, the code generator, hierarchy tree,
master parts table, audit log, trash and user management. Everything below
was built on top of that.

---

## Phase 1 — Inventory ledger, reorder alerts, asset registry

*Migrations 010–022*

### The stock ledger (`010`–`014`)

Replaced a simple quantity field with an **append-only, immutable ledger**.
`spare_parts.qty_on_hand` became a cache of `SUM(signed_qty)` over
`stock_transactions`.

**Why append-only:** an editable quantity field cannot answer "who changed
this, when, and why". A ledger can, and it is the only structure that
survives an audit. Corrections are posted as new reversing entries, never as
edits.

Direction is derived from the transaction type (`receipt` +, `issue` −,
`transfer_in` +, `transfer_out` −, …), never entered by the user, so a
movement cannot be recorded with the wrong sign.

Also added: physical stock counts (`post_physical_count` posts the
difference as an adjustment), opening balances, and a movements page with a
running balance.

### Reorder points and alerts (`015`–`019`)

Per-part `min_stock`, `reorder_point`, `max_stock`, `lead_time_days` and
`is_critical`, with `v_stock_status` computing `out`/`critical`/`low`/`ok`
**live** on read. Bulk-apply thresholds to a filtered selection.

Alerting on two channels: a daily 07:00 UTC email digest (Resend) and Web
Push every two hours during working hours, both driven by pg_cron. Alerts
can be acknowledged or snoozed, with a dedup log so nobody is notified twice
for the same thing.

### Asset registry (`020`–`022`)

Physical equipment with auto-generated asset tags, running-hours logging
with a counter-reset flag, PM-due calculation, document attachments, and a
maintenance timeline.

**Design note:** `next_asset_tag()` takes an advisory lock, unlike the
part-code generator of the time. A duplicate asset tag means two machines
wearing the same physical label — more expensive than a rejected part code.

---

## Phase 2 — Closing the loop between maintenance and stock

*Migrations 023–030*

### Maintenance moves stock (`023`)

Logging a part on a maintenance job now **issues it from stock
automatically**, via a trigger, in the same transaction. `log_maintenance_event()`
creates the event and its lines atomically — verified live: a call with a
bad second part left zero orphan events.

Before this, the two systems could disagree: you could record consuming a
part without the stock ever moving.

### The void double-count bug (`024`)

**A real bug in production data.** Migration 011 combined two mutually
exclusive correction models: `recalc` excluded voided rows *and*
`void_stock_transaction` posted a reversing entry. So voiding a −3 issue
both stopped subtracting 3 and added 3 back — a +6 swing where +3 was meant.

Found while testing 023. Two live parts were wrong (PST-0133 showed 6,
should have been 3; PST-0142 showed 10, should have been 7). Fixed by
counting **all** rows including voided ones, so an entry and its reversal
cancel to exactly zero.

### Editing and cancelling maintenance (`025`)

Records became correctable without breaking the ledger: descriptive fields
stay editable, but the date and asset lock once stock has posted against
them. Cancelling a part line voids its movement while keeping the line
visible, so the record shows the part was logged **and then cancelled** —
rather than silently vanishing.

### Partial returns and work orders (`026`)

Previously a part issued to a job could only be given back by voiding the
whole movement, and the return was never linked to the job.

`post_stock_reversal()` now reverses any quantity up to what is still
outstanding. Issue 4, return 1, and the maintenance record shows 3 consumed
— which is what the asset actually cost. Every report reads `net_qty`, never
the issued quantity. Maintenance events also got sequential `WO-YYYY-NNNN`
work-order numbers.

### Privilege escalation fix (`029`)

`profiles_update` was declared with `USING` and no `WITH CHECK`, so Postgres
reused `USING` to validate the new row. `id = auth.uid()` is true for your
own row whatever you set on it — **including `role`**. Any signed-in
department user could make themselves an admin with one API call, using the
anon key that ships in the frontend bundle. Verified before the fix; closed
with a `WITH CHECK` that pins `role` and `is_active` for non-admins.

### Reliability analytics (`030`)

Six views turning maintenance history into comparable indicators: per-asset
part history with intervals, a fleet baseline per model and functional
group, outlier flags, cost per running hour, and failure-mode patterns.

**Framing was a deliberate design constraint.** These are comparisons
against fleet peers, never predictions. A flag requires ≥3 peer assets, a
fleet median above zero, and ≥2 replacements — below that the row is omitted
rather than shown as a weak signal. Every flag displays its sample size and
expands to the events that produced it, because a flag nobody can audit is a
flag nobody will trust.

Also in this phase: email/push alerts, Arabic/English UI with RTL, CSV
import/export, and a Reports page with inline-SVG charts (no charting
dependency added).

---

## Phase 3 — Full review, then fixes

*Migrations 031–038*

A systematic review of data integrity, RLS, performance, regressions and UX.
Every finding was verified against the live database; exploits were proven
inside rolled-back transactions.

### 🔴 Critical

**`031` — RLS was off on eight tables.** Production had drifted from
migration 003: the policies existed but RLS was never enabled, making them
inert. Combined with Supabase's default grants, `anon` — no login, using the
public key in the JS bundle — could update all 5,870 parts and delete all
64,286 audit rows. Proven, then fixed by enabling RLS; the policies were
already correct.

**`032` — every function role-guard was bypassable.** Guards written as
`IF current_user_role() <> 'admin' THEN RAISE` never fired for an
unauthenticated caller, because `current_user_role()` returned NULL and
`NULL <> 'admin'` is NULL, not TRUE. Eight such guards existed in
`SECURITY DEFINER` functions that bypass RLS. An anonymous visitor could set
any part's stock to any value (proven: 42 → 999). Fixed at the root —
`current_user_role()` now returns `'anonymous'`, so every existing guard
fires without editing eight function bodies.

**`032` — internal helpers exposed over REST.** `post_stock_reversal()` and
`void_stock_txn_internal()` are deliberately un-gated internals;
`REVOKE … FROM PUBLIC` had not removed Supabase's explicit role grants, so
both were callable at `/rest/v1/rpc/…`, bypassing the admin gate. EXECUTE is
now revoked from every `SECURITY DEFINER` function and re-granted only for
the ten RPCs the app actually calls.

### 🟠 High

**`033` — missing index.** The returns lookup added in 026 had no index on
`reverses_txn_id`, so every maintenance part line triggered a full ledger
scan. `v_asset_reliability_flags` measured **532 ms → 22 ms**, buffers
64,379 → 6,418.

**`034` — `qty_on_hand` was writable through the API.** Documented as
"never write directly" since 011 but never enforced. A trigger now rejects
it. *(The first version was `SECURITY DEFINER`, where `current_user` is the
owner — the guard could never see the caller and silently never fired. The
test caught it; it is `SECURITY INVOKER` now.)*

**`035` — Hierarchy Tree loaded all 5,868 parts** in six sequential
requests to compute counts. Replaced with a 172-row rollup view and
per-branch lazy loading.

**Confirmation before removing a maintenance event.** It reverses stock and
had no dialog. Now lists exactly which parts return and how many, using net
quantities.

### 🟡 Medium and low

- **`036`** — part-code sequence moved server-side. The client took the max
  over 200 rows ordered by `created_at`, which has no relation to sequence
  order; seven prefixes exceed 200 parts (largest 927). Latent, not firing,
  and it failed safe — but one CSV import would have broken it.
- **`036`** — repaired a maintenance line that consumed 2 units without ever
  deducting them (predating the 023 trigger), and added a constraint.
- **`036`** — a part holding stock can no longer be trashed.
- **`037`** — department users can no longer trash or restore anything, in
  the UI *and* the API, matching the documented role model.
- **`037`** — `search_path` pinned on every `SECURITY DEFINER` function.
- **`038`** — Trash explains *why* a record cannot be purged instead of
  surfacing a foreign-key error, and Empty Trash purges only what it can.
- Error states added to loads that previously rendered a failure as "no
  data"; table density and sidebar behaviour reworked so wide tables fit.

### Deliberately not done

- **Converting the 11 pre-030 `SECURITY DEFINER` views to invoker.** It
  would blank the User column on Stock Movements for department users, since
  `user_profiles` is own-row-or-admin. Reasoning recorded in `037`.
- **Restricting which spare-part columns a department user may edit.** The
  spec limits them to Functional Group, Sequential Number and Description,
  but the part form has no field-level gating today, so enforcing it would
  change what storekeepers can do day to day. Flagged in `CLAUDE.md` as a
  known gap pending a decision.

---

## Documentation and tooling

| File | For |
|---|---|
| `CLAUDE.md` | The system as built — conventions, invariants, security model |
| `docs/دليل-المستخدم.md` | Storekeeper and technician guide, Egyptian Arabic |
| `docs/ADMIN_RUNBOOK.md` | Drift checks, recalc, cron, discontinued parts, rollback, data dictionary |
| `supabase/scripts/seed_demo_dataset.sql` | Training dataset — fails closed, never runs without an explicit token |
| `supabase/scripts/remove_demo_assets.sql` | Removes the earlier ad-hoc demo assets |
