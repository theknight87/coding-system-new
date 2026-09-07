# CarGas Codebase Reference

*Prepared by reading the live repository (`theknight87/coding-system-new`, branch `claude/cargas-coding-system-context-2w8wti`) and querying the live Supabase project (`fuwllmohhqlfcvhoyfgm` / `sp-coding-system`) directly. Where a claim is based on live data rather than code, it's marked **[LIVE DB]**.*

---

## 1. SPARE PARTS SCHEMA

Table: **`public.spare_parts`** (defined `supabase/migrations/001_initial_schema.sql:116-151`, extended by `005_fix_column_names.sql` and `006_fix_created_by.sql`). Every column below is actually read or written somewhere in `src/App.jsx` or `src/lib/db.js`:

| Column | Type | Purpose (as used in code) |
|---|---|---|
| `code` | `TEXT PRIMARY KEY` | The 6-segment human-readable code (e.g. `CP-GA-G04-ME-PST-0133`); no surrogate id exists. Written by `db.js:321` (`insertPart`), read everywhere via `mapPart` (`App.jsx:217`). |
| `cat` | `TEXT NOT NULL REFERENCES categories(code)` | Main category segment (AA). |
| `mfr` | `TEXT NOT NULL REFERENCES manufacturers(code)` | Manufacturer segment (BB). |
| `model` | `TEXT NOT NULL REFERENCES models(code)` | Equipment model segment (CC). |
| `disc` | `TEXT NOT NULL` | Discipline or engine-system segment (DD) — **not** a real FK (see §3). |
| `fg` | `TEXT NOT NULL REFERENCES functional_groups(code)` | Functional group segment (EE). |
| `short_desc` | `TEXT DEFAULT ''` | Display name (`mapPart` → `shortDesc`, `App.jsx:218`). |
| `long_desc` | `TEXT DEFAULT ''` | Extended description. |
| `part_no` | `TEXT DEFAULT ''` | Internal part number. |
| `oem_part` | `TEXT DEFAULT ''` | OEM/manufacturer part number. |
| `qty` | `INTEGER DEFAULT 0 CHECK (qty>=0)` | **See §2 — this is the contested column.** |
| `unit` | `TEXT DEFAULT 'EA'` | Unit of measure (`EA`, `KIT`, `L`, `SET`…). |
| `location` | `TEXT DEFAULT ''` | Free-text warehouse location, e.g. `WH-A1`. |
| `min_stock` / `max_stock` | `INTEGER DEFAULT 0` | Reorder-point bounds — read/written but never enforced anywhere in the UI. |
| `status` | `TEXT CHECK IN ('Active','Inactive','Obsolete')` | Lifecycle flag. |
| `remarks` | `TEXT DEFAULT ''` | Free notes. |
| `image_url` / `datasheet_url` | `TEXT` | Supabase Storage public URLs. |
| `manual_url` / `drawing_url` | `TEXT` | Declared in the DDL (`001:143-144`) but **never read or written anywhere in App.jsx or db.js** — dead columns. |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | Auto-managed (`set_updated_at` trigger, `001:182-196`). |
| `deleted_at` | `TIMESTAMPTZ` | Soft-delete marker (see §4e). |
| `created_by` / `updated_by` | `UUID REFERENCES auth.users(id)` | Set from `db.js:8-13` `uid()` on every write. |

`mapPart` (`App.jsx:217-224`) is the single place that converts every one of these (except `manual_url`/`drawing_url`) from snake_case DB rows into the camelCase shape the rest of the app uses.

---

## 2. THE `qty` COLUMN

### a) Every write site

| File:Line | What happens |
|---|---|
| `supabase/migrations/001_initial_schema.sql:132` | Column definition, `DEFAULT 0`. |
| `src/lib/db.js:321-340` (`insertPart`) | Whatever `qty` is in the row object gets inserted as-is (pre-ledger behavior — a plain typed field, no validation beyond the DB's `qty>=0` check). |
| `src/lib/db.js:342-350` (`updatePart`) | Same — an unconditional `UPDATE ... SET qty = <whatever was passed>`. |
| `src/App.jsx:3302` (`PartDetailModal.handleSave`, dead code) | Builds a `dbRow` object including `qty:Number(form.qty)||0`, but this object is **never actually sent** — the real call two lines later (`ops.savePart({ ...form, imageUrl:imgUrl }, part.code)`) passes `form` directly, not `dbRow`. This is orphaned code from before the ledger work. |
| `src/App.jsx:511-524` (`useDb.saveStockMovement`, local/offline-mode branch only) | Applies a +/- delta to the in-memory `qty` when there's no live DB — mirrors the DB trigger for the demo fallback path. |
| `supabase/migrations/010_stock_movements.sql` (`apply_stock_movement()` trigger) | **As of this session's PR**, this is now the only path that changes `qty` in the live database — `AFTER INSERT ON stock_movements`, does `UPDATE spare_parts SET qty = qty ± NEW.quantity`. |

**Important:** the write-site list above spans two eras. Before the ledger PR, `qty` was a plain editable field sent straight through `insertPart`/`updatePart` from a form input. That form input has been removed (see below) as of the current branch, but `insertPart`/`updatePart` themselves place **no restriction** on the DB side — nothing stops a future caller from passing `qty` again and silently fighting the trigger. That's a real risk, flagged in §6.

### b) Every read site

| File:Line | Context |
|---|---|
| `src/App.jsx:220` | `mapPart`: `qty:r.qty??0` |
| `src/App.jsx:3399` | `PartDetailModal` view mode — read-only display `{partView.qty??0} {partView.unit}` |
| `src/App.jsx:3472` | `PartDetailModal` edit mode — now a read-only div (post-ledger), not an `<Input>` |
| `src/App.jsx:3921` | `MasterTablePage` row — `<td>{r.qty}</td>` |
| `src/App.jsx:1184-1204` | `INIT_PARTS` demo/local-mode seed constants (8 hand-written rows used only when Supabase isn't configured) |
| Dashboard stat tiles (`App.jsx`, `Dashboard` component) | Aggregates `qty` for low-stock/total-stock KPI tiles |

### c) Where the values came from

Not manual entry, and not the app's own forms in bulk. Evidence:

- **[LIVE DB]** `SELECT date_trunc('minute', created_at), count(*) FROM spare_parts GROUP BY 1 ORDER BY 2 DESC` shows rows landing in bursts of 200–600 per *single minute*, on exactly two dates (`2026-07-18` and `2026-07-19`). No human enters 600 parts through a web form in one minute — this is a scripted bulk `INSERT`/`upsert`, consistent with the "extracted from manufacturer PDF parts catalogues" origin you described, run outside this app entirely (there's no import/CSV-upload feature anywhere in `App.jsx` or `db.js` — the only insert paths are `CodeGeneratorPage`'s one-at-a-time form and `db.insertPart`, neither of which is scriptable for bulk loads without direct DB access).
- The 8 rows in `INIT_PARTS` (`App.jsx:1184-1204`) are the only ones that look hand-authored — realistic min/max/location/remarks. They correspond exactly to the 8 outlier rows found live (see below), meaning the demo seed data got inserted into the real database at some point, sitting alongside the real import.

### d) What `qty` actually represents — the direct answer

**Conclusion: (ii) — quantity used per assembly/unit, carried over from the parts manual's bill-of-materials, not warehouse stock on hand.** Not "somewhere in between," not a hedge — the live data rules out (i) on three independent counts:

**[LIVE DB] Evidence 1 — `qty` distribution** (`SELECT qty, count(*) FROM spare_parts GROUP BY qty`):
```
qty=1 → 4322 rows (73.6%)
qty=2 →  664   qty=4 → 263   qty=3 → 180   qty=6 → 131
qty=8 →   86   qty=12 → 59   qty=5 →  32   qty=7 →  17
qty=10→   15   qty=9  → 12   qty=24→  12   qty=16 → 11
qty=20→   11   qty=0  →   6  ...
```
This is a classic **bill-of-materials quantity curve** — small integers (1, 2, 3, 4, 6, 8, 12, 24) that mirror how many of a given fastener/seal/bearing appear *per assembly* in an engineering drawing (1 gasket per head, 8 bolts per flange, 12 valve springs per bank, 24 studs per manifold). Real warehouse stock-on-hand for 5,870 independent spare parts would show far more variance and a heavy population of **zero** (parts that are out of stock) — here only **6 of 5,870 rows (0.1%)** are `qty=0`. A live inventory of nearly six thousand SKUs where 99.9% show "in stock" and three-quarters show exactly "1 in stock" is not a plausible warehouse snapshot; it's what you get when a "quantity per unit" column from a parts manual gets copied into a column labeled `qty`.

**[LIVE DB] Evidence 2 — `location`, `min_stock`, `max_stock` are blank for the same 5,862 rows**:
```sql
SELECT min_stock, max_stock, count(*) FROM spare_parts GROUP BY 1,2 ORDER BY 3 DESC;
→ (0, 0) → 5862 rows        -- everything except 8 rows
SELECT location, count(*) FROM spare_parts GROUP BY 1 ORDER BY 2 DESC;
→ ''      → 5862 rows       -- same 8-row exception
```
The exact same 8 rows that have non-zero `min_stock`/`max_stock` and a non-empty `location` are the 8 hand-written `INIT_PARTS` demo rows (`App.jsx:1184-1204` — `WH-A1`, `WH-A2`, `WH-B1`, `WH-C1`, `WH-C2`, `WH-C3`, `WH-D1`, `WH-D2`, `WH-F1` all trace back 1:1 to that constant). **Every genuinely-imported row has zero inventory metadata of any kind.** Whoever ran the bulk import populated `qty` from the catalogue but never touched a single warehouse field — because there was no warehouse data to put there. If this were real stock-on-hand, someone would have had to count physical inventory to produce those numbers, and the same person would almost certainly have also recorded *where* it was and *what to reorder at* — they didn't, because the number didn't come from a stock count.

**[LIVE DB] Evidence 3 — `unit` is uniform**: `SELECT unit, count(*) ...` → `EA: 5868`, and only the 2 demo rows show `L`/`KIT`. A real inventory of lubricants, kits, and sets (which this catalogue clearly includes — categories `LC`, functional groups like `SEA`/`GSK`) would show mixed units for on-hand stock. Everything defaulting to `EA` is consistent with a bulk script that never captured per-part unit-of-measure from the catalogue and just used the column default.

**Practical implication for your ledger**: you cannot treat existing `qty` values as a trustworthy opening balance. If you seed `stock_movements` with an initial `RECEIPT` per part equal to current `qty`, you will be asserting "we have exactly 1 of nearly everything in the warehouse today," which is very likely false. You should treat the current `qty` column as **contaminated BOM data**, not as day-zero inventory, and decide explicitly (with the business) whether to zero it out and start the ledger from true 0, or do a real cycle count before going live.

---

## 3. FULL TABLE MAP

```
auth.users (Supabase-managed)
 └─< user_profiles            PK id (uuid, = auth.users.id)
       role TEXT CHECK IN ('admin','department_user')

categories                    PK code (text, len=2)
 └─< manufacturers             PK code (text, len 2-3)   [cat_codes TEXT[] — NOT a real FK, just an array of category codes a manufacturer belongs to]
       └─< models              PK code (text, len 2-5)   FK mfr_code → manufacturers(code)

disciplines                   PK code (text, len 2-3)    [standalone — used when spare_parts.cat != 'EN']
engine_systems                PK code (text, len 2-4)    [standalone — used when spare_parts.cat == 'EN'; functionally a parallel/substitute for disciplines]

functional_groups             PK code (text, len 2-4)
       disc TEXT              -- NOT a real FK; a plain text column meant to reference
                               -- either disciplines.code or engine_systems.code depending
                               -- on which "world" the part belongs to

spare_parts                   PK code (text, the 6-segment code itself)
       cat   → categories(code)         [real FK]
       mfr   → manufacturers(code)      [real FK]
       model → models(code)             [real FK]
       disc  -- NOT a real FK (see above)
       fg    → functional_groups(code)  [real FK]
       created_by / updated_by → auth.users(id)

stock_movements                PK id (bigserial)          [added in migration 010, this session]
       part_code → spare_parts(code)    [real FK]
       asset_id  UUID                   -- reserved, no FK yet (future Asset Registry)
       created_by → auth.users(id)

audit_logs                     PK id (bigserial)
       user_id → auth.users(id)
       table_name / record_id  -- plain text, NOT real FKs (polymorphic reference by convention only)
```

Notable non-obvious facts:
- `spare_parts.disc` and `functional_groups.disc` are both **plain TEXT with no FK constraint** — the "hierarchy" between discipline/engine-system and functional group is entirely convention-enforced in the frontend (`App.jsx` filters `funcGroups` by `f.disc === step.disc`), not the database.
- `manufacturers.cat_codes` is a `TEXT[]`, not a join table — a many-to-many between categories and manufacturers implemented as an array column, not normalized.
- `audit_logs.table_name`/`record_id` are a polymorphic reference pattern (works for any table), enforced by nothing but the trigger/app code writing consistent values.

---

## 4. PATTERNS YOU MUST REUSE

### a) Paginated Supabase select with filters (`MasterTablePage`, `App.jsx:3782-3812`)
```js
const filters = useMemo(()=>({
  search: search||undefined, cat: fCat||undefined, mfr: fMfr||undefined,
  model: fModel||undefined, disc: fDisc||undefined, status: fStatus||undefined,
}),[search, fCat, fMfr, fModel, fDisc, fStatus]);

useEffect(()=>{ setPage(0); },[filters]);          // reset page on filter change

useEffect(()=>{
  if (!dbReady) { setRows(data.parts || []); setTotal((data.parts||[]).length); return; }
  setLoading(true);
  Promise.all([
    db.fetchPartsCount(filters),
    db.fetchParts(filters, page, PAGE_SIZE),
  ]).then(([countRes, dataRes]) => {
    setTotal(countRes.count ?? 0);
    setRows((dataRes.data ?? []).map(mapPart));
  }).finally(()=>setLoading(false));
},[filters, page, dbReady]);
```
Underlying query builder (`db.js:291-307`):
```js
export async function fetchParts(filters = {}, page = 0, pageSize = 100) {
  let q = supabase.from('spare_parts')
    .select('code,short_desc,long_desc,cat,mfr,model,disc,fg,part_no,oem_part,qty,unit,location,min_stock,max_stock,remarks,status,image_url,datasheet_url,created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (filters.cat) q = q.eq('cat', filters.cat);
  // ...one .eq()/.or() per filter key, only applied when the filter value is set
  return q;
}
```

### b) Insert / update with error handling (`db.js:321-350`)
```js
export async function insertPart(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('spare_parts').select('code,deleted_at').eq('code', row.code).maybeSingle()
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Part code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase.from('spare_parts').update({ ...row, deleted_at: null, updated_by: userId }).eq('code', row.code).select('*').maybeSingle()
    if (!error) await audit('CREATE', 'spare_parts', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase.from('spare_parts').insert({ ...row, created_by: userId, updated_by: userId }).select('*').maybeSingle()
  if (!error) await audit('CREATE', 'spare_parts', data.code, null, data);
  return { data, error };
}

export async function updatePart(code, updates) {
  const userId = await uid();
  const { data: oldData } = await supabase.from('spare_parts').select('*').eq('code', code).maybeSingle()
  const { data, error } = await supabase.from('spare_parts').update({ ...updates, updated_by: userId }).eq('code', code).select('*').maybeSingle()
  if (!error) await audit('UPDATE', 'spare_parts', code, oldData, updates);
  return { data, error };
}
```
Caller side always destructures `{ error }` and shows it via the shared `Toast`/`flash()` pattern (never throws).

### c) Permission / role check before a write (`App.jsx:125-127`, consumed via `useAuth()`)
```js
const isAdmin    = profile?.role === 'admin';
const isDeptUser = profile?.role === 'department_user';
const canEdit    = isAdmin || isDeptUser;
```
**Caveat you must know:** `isDeptUser` is defined but referenced nowhere else in the 4,000+ line file. There is currently **no code path anywhere that gates a specific field or button by role** beyond `NAV`'s page-level `adminOnly` flag (`App.jsx:4038-4054`, checked at `4090`/`4093`). The RLS comment at `003_rls_policies.sql:94-97` claims "Department user column restriction is enforced at the application layer" — that is **false in the current code**. If you need real role-gated field editing, you're building it from scratch, not reusing an existing pattern.

### d) Audit log write (`db.js:15-24`, called after every mutation)
```js
async function audit(action, table, recordId, oldVal, newVal) {
  try {
    const userId = await uid();
    await supabase.from('audit_logs').insert({
      action, table_name: table, record_id: String(recordId),
      old_values: oldVal ?? null, new_values: newVal ?? null,
      user_id: userId,
    });
  } catch (e) { console.warn('audit non-fatal:', e.message); }
}
```
Note this is **app-code driven**, called explicitly after each `db.js` mutation succeeds — separately, `004_audit_triggers.sql` also attaches a generic DB-level trigger to `categories/manufacturers/models/disciplines/engine_systems/functional_groups/spare_parts` that logs CREATE/UPDATE/DELETE automatically. Both fire independently for those tables, so audit entries are effectively doubled for spare-part edits. The DB trigger hardcodes `rec_id := NEW.code::TEXT` (`004_audit_triggers.sql:19,22`), so it only works on tables whose PK column is literally named `code` — it will error if attached to a table with a different PK name (this is why `stock_movements`, PK `id`, uses only the app-code `audit()` call, not the trigger).

### e) Soft-delete / Trash pattern (`db.js:352-359`, `430-482`)
```js
export async function softDeletePart(code) {
  const userId = await uid();
  const { data, error } = await supabase.from('spare_parts')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().maybeSingle()
  if (!error) await audit('DELETE', 'spare_parts', code, data, null);
  return { data, error };
}
```
Exclusion from normal queries: **every** read function does `.is('deleted_at', null)` (e.g. `fetchParts`, `db.js:295`); Trash does the inverse, `.not('deleted_at', 'is', null)` (`fetchTrash`, `db.js:442-448`). `TRASH_TABLES` (`db.js:430-438`) is a registry of every soft-deletable table + its display columns, driving a generic Trash UI. Restore just nulls `deleted_at` back out (`restoreRecord`, `db.js:466-475`); hard delete (`hardDeleteRecord`, `db.js:481-488`) is a real `DELETE` gated by RLS to rows that already have `deleted_at IS NOT NULL` (`009_trash_support.sql:36-39`), so a live row can never be hard-deleted by accident.

### f) Modal, Toast, confirm-dialog components
```js
// Toast — App.jsx:1328
const Toast = ({ msg }) => msg ? (
  <div style={{ position:"fixed", top:20, right:24, zIndex:9999,
    background: msg.type==="ok"?T.successBg:T.dangerBg, color: msg.type==="ok"?T.success:T.danger,
    border:`1px solid ${msg.type==="ok"?"#86efac":"#fca5a5"}`, borderRadius:8, padding:"12px 20px",
    fontWeight:700, fontSize:14, boxShadow:"0 4px 20px rgba(0,0,0,0.15)" }}>
    {msg.type==="ok"?"✅":"⚠️"} {msg.text}
  </div>
) : null;
// used everywhere as: const flash = (text,type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

// Modal — App.jsx:1352
const Modal = ({ title, onClose, children }) => (
  <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center" }}>
    <div style={{ background:T.card,borderRadius:10,padding:28,minWidth:420,maxWidth:560,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <h3 style={{ margin:0,fontSize:16,fontWeight:700,color:T.text }}>{title}</h3>
        <button onClick={onClose} style={{ background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.muted }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);
```
Confirm-delete is **not a separate reusable component** — every entity page (`App.jsx:1450`, `1973`, `2175`, `2382`, `2869`) hand-rolls its own inline confirm state (`deleteTarget`/`confirmPurge` + a conditional block or the same `Modal` with a danger `Btn`). `PartDetailModal` uses a third variant: an in-modal `mode` state machine (`'view'|'edit'|'confirm-delete'`, `App.jsx:3225`) rather than a separate modal. Pick whichever of these three shapes matches your new feature's UX, but don't expect one canonical `<ConfirmDialog>` to import — there isn't one.

### g) Supabase client init (`src/lib/supabase.js`, whole file)
```js
import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
export const supabase = createClient(url, key);
```
Imported as `import { supabase } from './lib/supabase.js'` (db.js) or `import { supabase } from './lib/supabase.js'` + `import * as db from './lib/db.js'` (App.jsx) — there is exactly one client instance for the whole app.

---

## 5. CONVENTIONS

- **Database naming**: `snake_case` throughout (`short_desc`, `part_no`, `created_by`). Every reference/master-data table uses `code TEXT PRIMARY KEY` as a natural key — `spare_parts`, `audit_logs`, `stock_movements`, and `user_profiles` are the only tables with a surrogate/foreign key as PK (`bigserial`/`uuid`).
- **React naming**: `camelCase` for all JS state and object fields (`shortDesc`, `partNo`, `minStock`); PascalCase components, one giant file (`App.jsx`, ~4,100 lines) plus `src/lib/db.js` and `src/lib/supabase.js` — there is no `components/` or `pages/` directory at all. Mapper functions named `map<Entity>` (`mapPart`, `mapCat`, `mapMfr`, `mapMovement`) are the single conversion point between DB rows and frontend objects.
- **Folder structure**:
  ```
  src/
    App.jsx        -- everything: contexts, all pages, all shared UI primitives
    lib/db.js       -- every Supabase query function
    lib/supabase.js -- client init
  supabase/migrations/001..010_*.sql  -- sequential, hand-numbered, never edited after merge
  ```
- **Routing**: no react-router. `AppShell` (`App.jsx`) holds `const [page, setPage] = useState("dashboard")`; a flat `NAV` array (`4038-4054`) drives the sidebar, and a `pageMap` object literal (`4095-4109`) maps `page` id → JSX element rendered via `{pageMap[effectivePage]}`.
- **Adding a page to the sidebar** (3 required edits, no more):
  1. Add one entry to `NAV`: `{ id, label, icon, group, adminOnly }`.
  2. Add `<YourPage data={data} />` to `pageMap` under the matching key.
  3. Write the component itself, following whichever existing page (`AuditLogPage`, `MasterTablePage`) is closest in shape.
  No registration file, no route config, no import list to update elsewhere.

---

## 6. RISKS — now that `qty` is (or will be) computed, not typed

1. **`insertPart`/`updatePart` still accept `qty` silently.** Nothing in `db.js:321-350` rejects a `qty` key in the payload — if any future code path (a bulk-edit feature, a CSV import, a copy-paste of the old `PartDetailModal` form) sends `qty` again, it will overwrite the trigger-computed balance with no warning, and the ledger and `spare_parts.qty` will silently diverge. You should add a DB-level guard (e.g. a `BEFORE UPDATE` trigger that raises if `qty` changed via a non-`stock_movements`-triggered update — hard to do generically — or, more simply, a `REVOKE UPDATE (qty) ON spare_parts FROM authenticated` and let the `SECURITY DEFINER` trigger function be the only thing able to touch it).
2. **The current `qty` value is not a trustworthy starting balance** (see §2d) — if you seed `stock_movements` from existing `qty`, you're encoding "quantity per assembly" as "units on hand," which is wrong for ~4,300 rows that show `qty=1` for what's actually a BOM count, not a stock count.
3. **`min_stock`/`max_stock` are `0` for 5,862 of 5,870 rows [LIVE DB]** — any low-stock alert feature (item #2 on your roadmap) built naively on "qty < min_stock" will be silent for effectively the entire catalogue until reorder points are populated, which nobody has done yet.
4. **`location` is blank for the same 5,862 rows** — a per-location ledger (if you ever change your mind from "single running balance") has no real location data to key off; it would need to be collected from scratch.
5. **`PartDetailModal`'s dead `dbRow` object at `App.jsx:3299-3306` still computes a `qty` field that is discarded** — harmless today, but a future refactor that "cleans up" `handleSave` by wiring `dbRow` back in would reintroduce direct `qty` writes without anyone noticing, because it looks like intentional, already-tested code.
6. **No role gating exists for who can post which transaction type** (see §4c) — Department User and Admin currently have identical `spare_parts_insert`/`spare_parts_update` RLS rights (`003_rls_policies.sql:80-92`), and the `stock_movements_insert` policy added in migration 010 mirrors that (`admin` and `department_user` both allowed to post any of the 5 transaction types). If the business wants e.g. only Admin able to post `TRANSFER` or reverse a `CONSUMPTION`, that's unbuilt.
7. **`TRANSFER` movements are logged but intentionally don't change `qty`** (single running-balance design, migration 010's `apply_stock_movement()`) — if you ever move to per-location tracking, every historical `TRANSFER` row is already unusable for that purpose (no "from location"/"to location" columns exist, only `reference`/`notes` free text), so a future migration would need a schema change, not just a read of existing data.
8. **`audit_logs.action` CHECK constraint** (`009_trash_support.sql:19-21`) does **not** include `RECEIPT`/`ISSUE`/`CONSUMPTION`/`RETURN`/`TRANSFER` — the ledger's audit entries are logged as generic `'CREATE'` on `table_name='stock_movements'` (`db.js:409-424`) specifically to avoid touching this constraint. If you later want per-type audit filtering in the Audit Log page's `filterAction` dropdown, you'll need another migration to widen the CHECK, plus a UI change.
