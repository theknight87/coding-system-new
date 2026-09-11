/**
 * db.js — All Supabase database query functions.
 * Uses upsert for all inserts to handle seed data conflicts gracefully.
 */
import { supabase } from './supabase.js';

// ─── AUTH HELPERS ─────────────────────────────────────────────
// NOTE (migration 042): the created_by / updated_by / user_id values
// this module sends are no longer authoritative. BEFORE triggers in the
// database overwrite them with auth.uid() on insert and update, because
// anything the browser sends is forgeable — audit_logs in particular had
// WITH CHECK (true), so any signed-in user could write an entry
// attributed to anyone. The calls below still pass the value for
// readability and for the offline/local path; the database decides.
// Do not add a new call site that relies on being able to choose it.
async function uid() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch { return null; }
}

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

// ─── CATEGORIES ───────────────────────────────────────────────
export const fetchCategories = () =>
  supabase.from('categories').select('code,label,icon,color,bg').is('deleted_at', null).order('code');

export async function insertCategory(row) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('categories')
    .upsert({ ...row, created_by: userId }, { onConflict: 'code' })
    .select('code,label,icon,color,bg').maybeSingle()
  if (!error) await audit('CREATE', 'categories', data.code, null, data);
  return { data, error };
}

export async function updateCategory(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('categories').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,icon,color,bg').maybeSingle()
  if (!error) await audit('UPDATE', 'categories', code, null, updates);
  return { data, error };
}

export async function softDeleteCategory(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('categories').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().maybeSingle()
  if (!error) await audit('DELETE', 'categories', code, data, null);
  return { data, error };
}

// ─── MANUFACTURERS ────────────────────────────────────────────
export const fetchManufacturers = () =>
  supabase.from('manufacturers').select('code,label,cat_codes').is('deleted_at', null).order('code');

export async function insertManufacturer(row) {
  const userId = await uid();
  // Check for existing (including soft-deleted) to give clear error
  const { data: existing } = await supabase.from('manufacturers').select('code,deleted_at').eq('code', row.code).maybeSingle()
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Manufacturer code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    // Restore soft-deleted record
    const { data, error } = await supabase
      .from('manufacturers').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,cat_codes').maybeSingle()
    if (!error) await audit('CREATE', 'manufacturers', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('manufacturers').insert({ ...row, created_by: userId })
    .select('code,label,cat_codes').maybeSingle()
  if (!error) await audit('CREATE', 'manufacturers', data.code, null, data);
  return { data, error };
}

export async function updateManufacturer(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('manufacturers').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,cat_codes').maybeSingle()
  if (!error) await audit('UPDATE', 'manufacturers', code, null, updates);
  return { data, error };
}

export async function softDeleteManufacturer(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('manufacturers').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().maybeSingle()
  if (!error) await audit('DELETE', 'manufacturers', code, data, null);
  return { data, error };
}

// ─── MODELS ───────────────────────────────────────────────────
export const fetchModels = () =>
  supabase.from('models').select('code,label,mfr_code').is('deleted_at', null).order('mfr_code').order('code');

export async function insertModel(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('models').select('code,deleted_at').eq('code', row.code).maybeSingle();
  
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Model code "${row.code}" already exists` } };
  }
  
  if (existing && existing.deleted_at) {
    const { error } = await supabase
      .from('models').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code);
    if (!error) await audit('CREATE', 'models', row.code, null, row);
    return { data: row, error };
  }
  
  const { error } = await supabase
    .from('models').insert({ ...row, created_by: userId });
    
  if (!error) await audit('CREATE', 'models', row.code, null, row);
  return { data: row, error };
}

export async function updateModel(code, updates) {
  const userId = await uid();
  const { error } = await supabase
    .from('models').update({ ...updates, updated_by: userId })
    .eq('code', code);
    
  if (!error) await audit('UPDATE', 'models', code, null, updates);
  return { data: updates, error };
}

export async function softDeleteModel(code) {
  const userId = await uid();
  const { error } = await supabase
    .from('models').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code);
    
  if (!error) await audit('DELETE', 'models', code, { deleted: true }, null);
  return { data: null, error };
}
// ─── DISCIPLINES ──────────────────────────────────────────────
export const fetchDisciplines = () =>
  supabase.from('disciplines').select('code,label,description,color,bg').is('deleted_at', null).order('code');

export async function insertDiscipline(row) {
  // row must have: { code, label, description, color, bg }
  const userId = await uid();
  const { data: existing } = await supabase.from('disciplines').select('code,deleted_at').eq('code', row.code).maybeSingle()
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Discipline code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('disciplines').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,description,color,bg').maybeSingle()
    if (!error) await audit('CREATE', 'disciplines', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('disciplines').insert({ ...row, created_by: userId })
    .select('code,label,description,color,bg').maybeSingle()
  if (!error) await audit('CREATE', 'disciplines', data.code, null, data);
  return { data, error };
}

export async function updateDiscipline(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('disciplines').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,description,color,bg').maybeSingle()
  if (!error) await audit('UPDATE', 'disciplines', code, null, updates);
  return { data, error };
}

export async function softDeleteDiscipline(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('disciplines').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().maybeSingle()
  if (!error) await audit('DELETE', 'disciplines', code, data, null);
  return { data, error };
}

// ─── ENGINE SYSTEMS ───────────────────────────────────────────
export const fetchEngineSystems = () =>
  supabase.from('engine_systems').select('code,label,color,bg').is('deleted_at', null).order('code');

export async function insertEngineSystem(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('engine_systems').select('code,deleted_at').eq('code', row.code).maybeSingle()
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Engine system code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('engine_systems').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,color,bg').maybeSingle()
    if (!error) await audit('CREATE', 'engine_systems', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('engine_systems').insert({ ...row, created_by: userId })
    .select('code,label,color,bg').maybeSingle()
  if (!error) await audit('CREATE', 'engine_systems', data.code, null, data);
  return { data, error };
}

export async function updateEngineSystem(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('engine_systems').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,color,bg').maybeSingle()
  if (!error) await audit('UPDATE', 'engine_systems', code, null, updates);
  return { data, error };
}

export async function softDeleteEngineSystem(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('engine_systems').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().maybeSingle()
  if (!error) await audit('DELETE', 'engine_systems', code, data, null);
  return { data, error };
}

// ─── FUNCTIONAL GROUPS ────────────────────────────────────────
export const fetchFuncGroups = () =>
  supabase.from('functional_groups').select('code,label,disc').is('deleted_at', null).order('disc').order('code');

export async function insertFuncGroup(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('functional_groups').select('code,deleted_at').eq('code', row.code).maybeSingle()
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Functional group code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('functional_groups').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,disc').maybeSingle()
    if (!error) await audit('CREATE', 'functional_groups', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('functional_groups').insert({ ...row, created_by: userId })
    .select('code,label,disc').maybeSingle()
  if (!error) await audit('CREATE', 'functional_groups', data.code, null, data);
  return { data, error };
}

export async function updateFuncGroup(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('functional_groups').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,disc').maybeSingle()
  if (!error) await audit('UPDATE', 'functional_groups', code, null, updates);
  return { data, error };
}

export async function softDeleteFuncGroup(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('functional_groups').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().maybeSingle()
  if (!error) await audit('DELETE', 'functional_groups', code, data, null);
  return { data, error };
}

// ─── SPARE PARTS ──────────────────────────────────────────────
export async function fetchPartsCount(filters = {}) {
  let q = supabase.from('spare_parts').select('*', { count: 'exact', head: true }).is('deleted_at', null);
  if (filters.cat)         q = q.eq('cat', filters.cat);
  if (filters.disc)        q = q.eq('disc', filters.disc);
  if (filters.status)      q = q.eq('status', filters.status);
  if (filters.mfr)         q = q.eq('mfr', filters.mfr);
  if (filters.model)       q = q.eq('model', filters.model);
  if (filters.fg)          q = q.eq('fg', filters.fg);
  if (filters.location)    q = q.eq('location', filters.location);
  if (filters.stockSource) q = q.eq('stock_source', filters.stockSource);
  if (filters.inStock === 'in')  q = q.gt('qty_on_hand', 0);
  if (filters.inStock === 'out') q = q.eq('qty_on_hand', 0);
  if (filters.search) {
    q = q.or(`code.ilike.%${filters.search}%,short_desc.ilike.%${filters.search}%,part_no.ilike.%${filters.search}%`);
  }
  const { count, error } = await q;
  return { count: count ?? 0, error };
}

export async function fetchParts(filters = {}, page = 0, pageSize = 100) {
  let q = supabase
    .from('spare_parts')
    .select('id,code,short_desc,long_desc,cat,mfr,model,disc,fg,part_no,oem_part,qty_per_assembly,qty_on_hand,stock_source,last_counted_at,unit,location,min_stock,max_stock,remarks,status,image_url,datasheet_url,created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (filters.cat)         q = q.eq('cat', filters.cat);
  if (filters.disc)        q = q.eq('disc', filters.disc);
  if (filters.status)      q = q.eq('status', filters.status);
  if (filters.mfr)         q = q.eq('mfr', filters.mfr);
  if (filters.model)       q = q.eq('model', filters.model);
  if (filters.fg)          q = q.eq('fg', filters.fg);
  if (filters.location)    q = q.eq('location', filters.location);
  if (filters.stockSource) q = q.eq('stock_source', filters.stockSource);
  if (filters.inStock === 'in')  q = q.gt('qty_on_hand', 0);
  if (filters.inStock === 'out') q = q.eq('qty_on_hand', 0);
  if (filters.search) {
    q = q.or(`code.ilike.%${filters.search}%,short_desc.ilike.%${filters.search}%,part_no.ilike.%${filters.search}%,oem_part.ilike.%${filters.search}%,location.ilike.%${filters.search}%`);
  }
  return q;
}

// Look up a batch of parts by their code — used by the Stock Count
// page's CSV bulk-import preview to match uploaded rows in one query.
export async function fetchPartsByCodes(codes) {
  if (!codes || codes.length === 0) return { data: [], error: null };
  return supabase
    .from('spare_parts')
    .select('id,code,short_desc,qty_on_hand,unit,location,stock_source')
    .in('code', codes)
    .is('deleted_at', null);
}

// ─── HIERARCHY TREE ───────────────────────────────────────────────
// The tree only ever needed counts per branch. v_parts_tree_counts
// (migration 035) returns one row per populated
// (cat, mfr, model, disc, fg) — 172 rows against the current 5,868
// parts — so the page makes one small request instead of six 1,000-row
// pages and no longer holds the whole catalogue in memory.
// Next sequence number for a part-code prefix. Computed server-side
// over every matching part under an advisory lock (migration 036) —
// the old client-side max over 200 rows ordered by created_at could
// hand out a number that was already taken.
export async function nextPartSequence({ cat, mfr, model, disc, fg }) {
  const { data, error } = await supabase.rpc('next_part_sequence', {
    p_cat: cat, p_mfr: mfr, p_model: model, p_disc: disc, p_fg: fg,
  });
  return { data, error };
}

export const fetchTreeCounts = () =>
  supabase.from('v_parts_tree_counts').select('*');

// The parts under one functional group, fetched only when that node is
// actually expanded. The cap matches what the tree renders; the node
// tells the user to use the Master Table when a branch exceeds it.
export function fetchBranchParts({ cat, mfr, model, disc, fg }, limit = 100) {
  return supabase
    .from('spare_parts')
    .select('code,short_desc,cat,mfr,model,disc,fg,image_url,status')
    .is('deleted_at', null)
    .eq('cat', cat).eq('mfr', mfr).eq('model', model)
    .eq('disc', disc).eq('fg', fg)
    .order('code', { ascending: true })
    .limit(limit);
}

export async function insertPart(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('spare_parts').select('code,deleted_at').eq('code', row.code).maybeSingle()
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Part code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    // Restore + update
    const { data, error } = await supabase
      .from('spare_parts').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('*').maybeSingle()
    if (!error) await audit('CREATE', 'spare_parts', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('spare_parts').insert({ ...row, created_by: userId, updated_by: userId })
    .select('*').maybeSingle()
  if (!error) await audit('CREATE', 'spare_parts', data.code, null, data);
  return { data, error };
}

export async function updatePart(code, updates) {
  const userId = await uid();
  const { data: oldData } = await supabase.from('spare_parts').select('*').eq('code', code).maybeSingle()
  const { data, error } = await supabase
    .from('spare_parts').update({ ...updates, updated_by: userId })
    .eq('code', code).select('*').maybeSingle()
  if (!error) await audit('UPDATE', 'spare_parts', code, oldData, updates);
  return { data, error };
}

export async function softDeletePart(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('spare_parts').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().maybeSingle()
  if (!error) await audit('DELETE', 'spare_parts', code, data, null);
  return { data, error };
}

// Soft-delete every spare_parts row matching a filter (e.g. { model: 'X' }
// or { cat: 'Y' } or { mfr: 'Z' }). Used to cascade-delete a parent record's
// spare parts when the parent (category/manufacturer/model/discipline/
// functional group) itself is deleted, so nothing is left orphaned.
export async function deletePartsByFilter(filters = {}) {
  const userId = await uid();
  let q = supabase.from('spare_parts')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .is('deleted_at', null);
  if (filters.cat)   q = q.eq('cat', filters.cat);
  if (filters.mfr)   q = q.eq('mfr', filters.mfr);
  if (filters.model) q = q.eq('model', filters.model);
  if (filters.disc)  q = q.eq('disc', filters.disc);
  if (filters.fg)    q = q.eq('fg', filters.fg);
  const { data, error } = await q.select('code');
  if (!error && data?.length) {
    for (const row of data) {
      await audit('DELETE', 'spare_parts', row.code, null, { cascaded_from: filters });
    }
  }
  return { data, error };
}

// ─── STOCK MOVEMENTS (LEGACY LEDGER) ────────────────────────────
// Superseded by stock_transactions / post_physical_count() (see
// migrations 001_stock_transactions.sql and 002_opening_balances.sql).
// Kept for historical reads only — its DB trigger no longer updates
// any spare_parts column, so posting here no longer changes anything.
export const STOCK_TRANSACTION_TYPES = ['RECEIPT', 'ISSUE', 'CONSUMPTION', 'RETURN', 'TRANSFER'];

export async function fetchStockMovementsCount(filters = {}) {
  let q = supabase.from('stock_movements').select('*', { count: 'exact', head: true });
  if (filters.partCode)        q = q.eq('part_code', filters.partCode);
  if (filters.transactionType) q = q.eq('transaction_type', filters.transactionType);
  const { count, error } = await q;
  return { count: count ?? 0, error };
}

export async function fetchStockMovements(filters = {}, page = 0, pageSize = 50) {
  let q = supabase
    .from('stock_movements')
    .select('id,part_code,transaction_type,quantity,reference,notes,asset_id,created_at,created_by,user_profiles(email,full_name)')
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (filters.partCode)        q = q.eq('part_code', filters.partCode);
  if (filters.transactionType) q = q.eq('transaction_type', filters.transactionType);
  return q;
}

export async function insertStockMovement(row) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('stock_movements')
    .insert({
      part_code: row.partCode,
      transaction_type: row.transactionType,
      quantity: row.quantity,
      reference: row.reference || '',
      notes: row.notes || '',
      asset_id: row.assetId || null,
      created_by: userId,
    })
    .select('*').maybeSingle();
  if (!error) await audit('CREATE', 'stock_movements', data.id, null, data);
  return { data, error };
}

// ─── STOCK CONFIDENCE / PHYSICAL COUNTS ────────────────────────
// Backed by migration 002_opening_balances.sql: spare_parts.qty_on_hand
// is either 'estimated' (seeded from the catalogue, not counted) or
// 'counted' (confirmed on the floor). post_physical_count() and
// reset_estimated_balances() are SECURITY DEFINER RPCs that enforce
// their own role checks server-side — see that migration for the
// exact rules. Both RPCs' own INSERT/UPDATE on stock_transactions is
// already audited by that table's own DB trigger, so no app-level
// audit() call is needed here (unlike the plain CRUD functions above).
export async function fetchStockConfidence() {
  return supabase.from('v_stock_confidence').select('cat,stock_source,part_count');
}

export async function postPhysicalCount(partId, countedQty, location, notes) {
  const { data, error } = await supabase.rpc('post_physical_count', {
    p_part_id: partId, p_counted_qty: countedQty, p_location: location || null, p_notes: notes || null,
  });
  return { data, error };
}

export async function resetEstimatedBalances(categoryCode) {
  const { data, error } = await supabase.rpc('reset_estimated_balances', {
    p_category_code: categoryCode || null,
  });
  return { data, error };
}

// ─── STOCK TRANSACTIONS (LEDGER) ────────────────────────────────
// The real ledger (migrations 011/012/014). Reads go through
// v_stock_transactions_detail (adds balance_after + joined part/user
// display fields); writes go straight to the base table — the DB
// triggers from migration 011 handle recalculating qty_on_hand and
// writing the audit_logs row automatically, so no app-level audit()
// call is needed here.
// "Everyday" types a normal user posts vs. the corrective ones — mirrors
// the segmented control grouping in the Record Movement modal.
export const TXN_TYPES_EVERYDAY   = ['receipt', 'issue', 'return_to_store', 'transfer_in', 'transfer_out'];
export const TXN_TYPES_CORRECTIVE = ['adjustment_in', 'adjustment_out', 'scrap'];
// Every value of the stock_txn_type enum, for filter dropdowns.
export const ALL_TXN_TYPES = ['opening_balance', ...TXN_TYPES_EVERYDAY, ...TXN_TYPES_CORRECTIVE];
// Inbound (+) vs outbound (−) — drives the colored pill on the ledger.
export const TXN_TYPES_INBOUND  = ['opening_balance', 'receipt', 'return_to_store', 'transfer_in', 'adjustment_in'];
export const TXN_TYPES_OUTBOUND = ['issue', 'scrap', 'transfer_out', 'adjustment_out'];

function applyStockTxnFilters(q, filters = {}) {
  if (filters.partId)   q = q.eq('part_id', filters.partId);
  if (filters.txnType)  q = q.eq('txn_type', filters.txnType);
  if (filters.cat)      q = q.eq('cat', filters.cat);
  if (filters.mfr)      q = q.eq('mfr', filters.mfr);
  if (filters.userId)   q = q.eq('created_by', filters.userId);
  if (filters.assetId)  q = q.eq('asset_id', filters.assetId);
  if (filters.dateFrom) q = q.gte('occurred_at', filters.dateFrom);
  if (filters.dateTo)   q = q.lte('occurred_at', filters.dateTo);
  if (filters.location) q = q.or(`location_from.eq.${filters.location},location_to.eq.${filters.location}`);
  if (filters.search)   q = q.or(`part_code.ilike.%${filters.search}%,reference_no.ilike.%${filters.search}%`);
  return q;
}

export async function fetchStockTransactionsCount(filters = {}) {
  let q = supabase.from('v_stock_transactions_detail').select('id', { count: 'exact', head: true });
  q = applyStockTxnFilters(q, filters);
  const { count, error } = await q;
  return { count: count ?? 0, error };
}

export async function fetchStockTransactions(filters = {}, page = 0, pageSize = 50) {
  let q = supabase
    .from('v_stock_transactions_detail')
    .select('*')
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  q = applyStockTxnFilters(q, filters);
  return q;
}

// Summary tiles (total received / issued / net / count) for the
// current filter set. Fetches the raw signed_qty column rather than
// using a server-side aggregate, capped generously — fine for this
// dataset's size, but a filter matching more than 10,000 transactions
// will undercount until this is moved to a real aggregate/RPC.
export async function fetchStockTransactionsSummary(filters = {}) {
  let q = supabase.from('v_stock_transactions_detail').select('signed_qty,is_void').limit(10000);
  q = applyStockTxnFilters(q, filters);
  const { data, error } = await q;
  if (error) return { data: null, error };
  // Voided rows are counted, not skipped: each is cancelled by its own
  // reversing entry, so skipping it here would double-count the
  // correction — the same bug fixed in the database in migration 024.
  let received = 0, issued = 0, count = 0;
  for (const row of data || []) {
    count++;
    const n = Number(row.signed_qty) || 0;
    if (n > 0) received += n; else issued += -n;
  }
  return { data: { received, issued, net: received - issued, count }, error: null };
}

export async function insertStockTransaction(row) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('stock_transactions')
    .insert({
      part_id: row.partId,
      txn_type: row.txnType,
      quantity: row.quantity,
      location_from: row.locationFrom || null,
      location_to: row.locationTo || null,
      reference_no: row.referenceNo || null,
      unit_cost: row.unitCost === '' || row.unitCost == null ? null : Number(row.unitCost),
      currency: row.currency || 'EGP',
      notes: row.notes || null,
      occurred_at: row.occurredAt || new Date().toISOString(),
      created_by: userId,
    })
    .select('*').maybeSingle();
  return { data, error };
}

// quantity is optional: omitted (or null) reverses whatever is left
// un-reversed on the transaction and marks it void; a smaller number
// posts a partial counter-entry and leaves the row live so the rest
// can still be reversed later (migration 026).
export async function voidStockTransaction(txnId, reason, quantity) {
  return supabase.rpc('void_stock_transaction', {
    p_txn_id: txnId,
    p_reason: reason || null,
    p_quantity: quantity === '' || quantity == null ? null : Number(quantity),
  });
}

// Looks up the reversing entries for a batch of voided transactions
// (by their id, matched against reverses_txn_id) regardless of which
// page of the ledger they landed on — used to render a voided row's
// reversal nested directly beneath it.
export async function fetchReversalsFor(txnIds) {
  if (!txnIds || txnIds.length === 0) return { data: [], error: null };
  return supabase.from('v_stock_transactions_detail').select('*').in('reverses_txn_id', txnIds);
}

// ─── REORDER SETTINGS / STOCK STATUS ────────────────────────────
// Backed by migration 015_reorder_points.sql: v_stock_status computes
// stock_status/suggested_order_qty/severity_rank per part from
// min_stock/reorder_point/max_stock. Reads go through the view;
// writes go straight to spare_parts (RLS-covered, same as every other
// spare_parts column) or through bulk_set_reorder_settings() for the
// "apply to filtered selection" bulk action.
export const STOCK_STATUSES = ['out', 'critical', 'low', 'ok', 'unset'];

function applyStockStatusFilters(q, filters = {}) {
  if (filters.cat)    q = q.eq('cat', filters.cat);
  if (filters.mfr)    q = q.eq('mfr', filters.mfr);
  if (filters.model)  q = q.eq('model', filters.model);
  if (filters.fg)     q = q.eq('fg', filters.fg);
  if (filters.status) q = q.eq('stock_status', filters.status);
  if (filters.search) q = q.ilike('code', `%${filters.search}%`);
  return q;
}

export async function fetchStockStatusCount(filters = {}) {
  let q = supabase.from('v_stock_status').select('id', { count: 'exact', head: true });
  q = applyStockStatusFilters(q, filters);
  const { count, error } = await q;
  return { count: count ?? 0, error };
}

export async function fetchStockStatus(filters = {}, page = 0, pageSize = 50) {
  let q = supabase
    .from('v_stock_status')
    .select('*')
    .order('severity_rank', { ascending: true })
    .order('code', { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  q = applyStockStatusFilters(q, filters);
  return q;
}

export async function fetchStockStatusSummary() {
  return supabase.from('v_stock_status_summary').select('stock_status,part_count');
}

// Look up reorder-setting fields for a batch of codes — used by the
// CSV import preview (same pattern as fetchPartsByCodes).
export async function fetchReorderSettingsByCodes(codes) {
  if (!codes || codes.length === 0) return { data: [], error: null };
  return supabase
    .from('spare_parts')
    .select('id,code,short_desc,min_stock,reorder_point,max_stock,lead_time_days,is_critical,preferred_supplier')
    .in('code', codes)
    .is('deleted_at', null);
}

export async function updateReorderSettings(code, updates) {
  const userId = await uid();
  const payload = {};
  if (updates.minStock !== undefined)      payload.min_stock = updates.minStock;
  if (updates.reorderPoint !== undefined)  payload.reorder_point = updates.reorderPoint;
  if (updates.maxStock !== undefined)      payload.max_stock = updates.maxStock;
  if (updates.leadTimeDays !== undefined)  payload.lead_time_days = updates.leadTimeDays;
  if (updates.isCritical !== undefined)    payload.is_critical = updates.isCritical;
  if (updates.preferredSupplier !== undefined) payload.preferred_supplier = updates.preferredSupplier;
  payload.updated_by = userId;
  const { data, error } = await supabase.from('spare_parts').update(payload).eq('code', code).select('*').maybeSingle();
  return { data, error };
}

// Applies the same reorder-setting values to every part matching the
// filters, in one server-side statement (see migration 015 for why
// this is an RPC rather than an .in([...ids]) update — thousands of
// UUIDs would blow past URL length limits). Only fields present in
// `values` are changed; omit a field to leave it untouched. maxStock
// is nullable and NULL is itself meaningful ("unset"), so pass
// `maxStock: null` explicitly to clear it — it's distinguished from
// "don't touch max_stock" via a separate flag sent to the RPC.
export async function bulkSetReorderSettings(filters = {}, values = {}) {
  const params = {
    p_cat: filters.cat || null, p_mfr: filters.mfr || null, p_model: filters.model || null,
    p_fg: filters.fg || null, p_status: filters.status || null,
    p_min_stock: values.minStock ?? null,
    p_reorder_point: values.reorderPoint ?? null,
    p_max_stock: values.maxStockSet ? values.maxStock : null,
    p_max_stock_set: !!values.maxStockSet,
    p_lead_time_days: values.leadTimeDays ?? null,
    p_is_critical: values.isCritical ?? null,
    p_preferred_supplier: values.preferredSupplier ?? null,
  };
  return supabase.rpc('bulk_set_reorder_settings', params);
}

// ─── STOCK ALERTS ───────────────────────────────────────────────
// Reads from v_active_alerts / get_alert_counts() / get_unconfigured_count()
// (migration 017) — built on top of the existing v_stock_status rather
// than duplicating its severity logic. See that migration's header
// comment for why.

// One aggregate round trip for the Dashboard tiles + header bell.
export async function fetchAlertCounts() {
  return supabase.rpc('get_alert_counts');
}

export async function fetchUnconfiguredCount() {
  return supabase.rpc('get_unconfigured_count');
}

function applyAlertFilters(q, filters = {}) {
  if (filters.severity && filters.severity.length) q = q.in('stock_status', filters.severity);
  if (filters.cat)    q = q.eq('cat', filters.cat);
  if (filters.mfr)    q = q.eq('mfr', filters.mfr);
  if (filters.disc)   q = q.eq('disc', filters.disc);
  if (filters.hideAcknowledged) q = q.eq('is_acknowledged', false);
  if (filters.search) {
    q = q.or(`code.ilike.%${filters.search}%,short_desc.ilike.%${filters.search}%`);
  }
  return q;
}

export async function fetchActiveAlertsCount(filters = {}) {
  let q = supabase.from('v_active_alerts').select('part_id', { count: 'exact', head: true });
  q = applyAlertFilters(q, filters);
  const { count, error } = await q;
  return { count: count ?? 0, error };
}

export async function fetchActiveAlerts(filters = {}, page = 0, pageSize = 50) {
  let q = supabase
    .from('v_active_alerts')
    .select('*')
    .order('severity_rank', { ascending: true })
    .order('shortage_qty', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  q = applyAlertFilters(q, filters);
  return q;
}

// Batched fetch for CSV export — pulls the full filtered set in pages
// of 1000 via .range(), same batching approach used by the Master
// Table export, so the whole result set is never requested in one
// unbounded query.
export async function fetchAllActiveAlerts(filters = {}, maxRows = 20000) {
  const batchSize = 1000;
  let all = [];
  for (let offset = 0; offset < maxRows; offset += batchSize) {
    let q = supabase.from('v_active_alerts').select('*')
      .order('severity_rank', { ascending: true })
      .order('shortage_qty', { ascending: false })
      .range(offset, offset + batchSize - 1);
    q = applyAlertFilters(q, filters);
    const { data, error } = await q;
    if (error) return { data: all, error };
    all = all.concat(data || []);
    if (!data || data.length < batchSize) break;
  }
  return { data: all, error: null };
}

export async function acknowledgeAlert(partId, severity, note = null) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('alert_acknowledgements')
    .upsert({
      part_id: partId, severity, acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(), snooze_until: null, note,
    }, { onConflict: 'part_id,severity' })
    .select('*').maybeSingle();
  if (!error) await audit('UPDATE', 'alert_acknowledgements', partId, null, { severity, action: 'acknowledge' });
  return { data, error };
}

export async function snoozeAlert(partId, severity, snoozeUntil) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('alert_acknowledgements')
    .upsert({
      part_id: partId, severity, acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(), snooze_until: snoozeUntil,
    }, { onConflict: 'part_id,severity' })
    .select('*').maybeSingle();
  if (!error) await audit('UPDATE', 'alert_acknowledgements', partId, null, { severity, action: 'snooze', snoozeUntil });
  return { data, error };
}

// ─── PUSH SUBSCRIPTIONS ─────────────────────────────────────────
export async function fetchMyPushSubscriptions() {
  const userId = await uid();
  if (!userId) return { data: [], error: null };
  return supabase.from('push_subscriptions').select('*').eq('user_id', userId);
}

export async function savePushSubscription(sub) {
  const userId = await uid();
  const json = sub.toJSON();
  return supabase.from('push_subscriptions').upsert({
    user_id: userId, endpoint: json.endpoint,
    p256dh: json.keys.p256dh, auth: json.keys.auth,
    user_agent: navigator.userAgent, last_used_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
}

export async function deletePushSubscriptionByEndpoint(endpoint) {
  return supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// ─── TRASH / RECYCLE BIN ──────────────────────────────────────
// Every soft-deletable table, with the columns needed to show a
// meaningful row in the Trash page and the label used in the UI.
// ─── ASSET REGISTRY ─────────────────────────────────────────────
export const ASSET_STATUSES = ['active', 'maintenance', 'down', 'standby', 'decommissioned'];

function applyAssetFilters(q, filters = {}) {
  if (filters.cat)      q = q.eq('cat', filters.cat);
  if (filters.mfr)      q = q.eq('mfr', filters.mfr);
  if (filters.model)    q = q.eq('model', filters.model);
  if (filters.location) q = q.eq('location', filters.location);
  if (filters.status)   q = q.eq('status', filters.status);
  if (filters.search) {
    q = q.or(`asset_tag.ilike.%${filters.search}%,serial_number.ilike.%${filters.search}%,model_label.ilike.%${filters.search}%`);
  }
  return q;
}

export async function fetchAssetsCount(filters = {}) {
  let q = supabase.from('v_assets_overview').select('id', { count: 'exact', head: true });
  q = applyAssetFilters(q, filters);
  const { count, error } = await q;
  return { count: count ?? 0, error };
}

export async function fetchAssets(filters = {}, page = 0, pageSize = 50) {
  let q = supabase
    .from('v_assets_overview')
    .select('*')
    .order('asset_tag', { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  q = applyAssetFilters(q, filters);
  return q;
}

export async function fetchAllAssets(filters = {}, maxRows = 20000) {
  const batchSize = 1000;
  let all = [];
  for (let offset = 0; offset < maxRows; offset += batchSize) {
    let q = supabase.from('v_assets_overview').select('*')
      .order('asset_tag', { ascending: true })
      .range(offset, offset + batchSize - 1);
    q = applyAssetFilters(q, filters);
    const { data, error } = await q;
    if (error) return { data: all, error };
    all = all.concat(data || []);
    if (!data || data.length < batchSize) break;
  }
  return { data: all, error: null };
}

export async function fetchAssetKpis() {
  return supabase.from('v_asset_kpis').select('*').maybeSingle();
}

// Reserves the next asset_tag for a cat+mfr+model combination via the
// advisory-lock-protected SQL function (migration 020), then inserts.
// Not perfectly atomic across the two round trips (see that function's
// own comment), but matches the same soft-race tolerance the existing
// part-code generator already accepts at this app's scale.
export async function insertAsset(row) {
  const userId = await uid();
  const { data: tag, error: tagErr } = await supabase.rpc('next_asset_tag', {
    p_cat: row.cat, p_mfr: row.mfr, p_model: row.model,
  });
  if (tagErr) return { data: null, error: tagErr };
  const dbRow = {
    asset_tag: tag, serial_number: row.serialNumber || null,
    cat: row.cat, mfr: row.mfr, model: row.model,
    site: row.site || null, location: row.location || null, sub_location: row.subLocation || null,
    status: row.status || 'active',
    commissioned_at: row.commissionedAt || null, warranty_until: row.warrantyUntil || null,
    pm_interval_hours: row.pmIntervalHours || null, last_pm_hours: row.lastPmHours || null,
    last_pm_date: row.lastPmDate || null, pm_interval_days: row.pmIntervalDays || null,
    photo_url: row.photoUrl || null, notes: row.notes || null,
    created_by: userId, updated_by: userId,
  };
  const { data, error } = await supabase.from('assets').insert(dbRow).select('*').maybeSingle();
  if (!error) await audit('CREATE', 'assets', data.id, null, data);
  return { data, error };
}

export async function updateAsset(id, row) {
  const userId = await uid();
  const { data: oldData } = await supabase.from('assets').select('*').eq('id', id).maybeSingle();
  const dbRow = {
    serial_number: row.serialNumber || null,
    site: row.site || null, location: row.location || null, sub_location: row.subLocation || null,
    status: row.status,
    commissioned_at: row.commissionedAt || null, warranty_until: row.warrantyUntil || null,
    pm_interval_hours: row.pmIntervalHours || null, last_pm_hours: row.lastPmHours || null,
    last_pm_date: row.lastPmDate || null, pm_interval_days: row.pmIntervalDays || null,
    photo_url: row.photoUrl || null, notes: row.notes || null,
    updated_by: userId,
  };
  const { data, error } = await supabase.from('assets').update(dbRow).eq('id', id).select('*').maybeSingle();
  if (!error) await audit('UPDATE', 'assets', id, oldData, data);
  return { data, error };
}

export async function softDeleteAsset(id) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('assets').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', id).select().maybeSingle();
  if (!error) await audit('DELETE', 'assets', id, data, null);
  return { data, error };
}

export async function fetchAssetById(id) {
  return supabase.from('v_assets_overview').select('*').eq('id', id).maybeSingle();
}

// ─── ASSET HOURS LOG ──────────────────────────────────────────────
export async function fetchAssetHoursLog(assetId) {
  return supabase.from('asset_hours_log').select('*').eq('asset_id', assetId).order('read_at', { ascending: true });
}

// Insert-only — the AFTER INSERT trigger (migration 020) validates
// the reading and updates assets.running_hours; nothing to do here
// beyond the insert itself.
export async function insertAssetHoursReading(assetId, readingHours, { notes, isCounterReset } = {}) {
  const userId = await uid();
  const { data, error } = await supabase.from('asset_hours_log').insert({
    asset_id: assetId, reading_hours: readingHours, read_by: userId,
    notes: notes || null, is_counter_reset: !!isCounterReset,
  }).select().maybeSingle();
  if (!error) await audit('CREATE', 'asset_hours_log', assetId, null, data);
  return { data, error };
}

// ─── MAINTENANCE EVENTS ───────────────────────────────────────────
export async function fetchMaintenanceEvents(assetId) {
  return supabase.from('maintenance_events').select('*')
    .eq('asset_id', assetId).is('deleted_at', null)
    .order('event_date', { ascending: false });
}

// Distinct previously-used failure_mode/root_cause values across all
// assets, for the corrective-event datalist — lets the vocabulary
// converge organically instead of forcing a fixed taxonomy.
export async function fetchMaintenanceVocabulary() {
  const { data, error } = await supabase.from('maintenance_events')
    .select('failure_mode,root_cause').eq('event_type', 'corrective').is('deleted_at', null).limit(500);
  if (error) return { failureModes: [], rootCauses: [], error };
  const failureModes = [...new Set((data||[]).map(r=>r.failure_mode).filter(Boolean))];
  const rootCauses   = [...new Set((data||[]).map(r=>r.root_cause).filter(Boolean))];
  return { failureModes, rootCauses, error: null };
}

// Lightweight id+tag list for the Stock Movements asset filter.
export async function fetchAssetOptions() {
  return supabase.from('assets').select('id,asset_tag')
    .is('deleted_at', null).order('asset_tag', { ascending: true }).limit(1000);
}

// Atomic event + parts insert (migration 023's RPC). Doing this as two
// separate calls from the browser could leave an event with only some
// of its parts — and only some of its stock movements — if the second
// call failed. The function body is one transaction.
export async function logMaintenanceEvent(row, parts = []) {
  const { data, error } = await supabase.rpc('log_maintenance_event', {
    p_asset_id: row.assetId,
    p_event_type: row.eventType,
    p_event_date: row.eventDate,
    p_title: row.title,
    p_description: row.description || null,
    p_running_hours: row.runningHoursAtEvent === '' || row.runningHoursAtEvent == null ? null : Number(row.runningHoursAtEvent),
    p_downtime_hours: row.downtimeHours === '' || row.downtimeHours == null ? null : Number(row.downtimeHours),
    p_work_order_no: row.workOrderNo || null,
    p_performed_by: row.performedBy || null,
    p_status: row.status || 'completed',
    p_failure_mode: row.failureMode || null,
    p_root_cause: row.rootCause || null,
    p_parts: parts.map(p => ({
      part_id: p.partId,
      quantity: Number(p.quantity),
      unit_cost: p.unitCost === '' || p.unitCost == null ? null : Number(p.unitCost),
      notes: p.notes || null,
    })),
  });
  if (!error) await audit('CREATE', 'maintenance_events', data?.id, null, data);
  return { data, error };
}

export async function insertMaintenanceEvent(row) {
  const userId = await uid();
  const dbRow = {
    asset_id: row.assetId, event_type: row.eventType, event_date: row.eventDate,
    title: row.title, description: row.description || null,
    running_hours_at_event: row.runningHoursAtEvent===''||row.runningHoursAtEvent==null ? null : Number(row.runningHoursAtEvent),
    downtime_hours: row.downtimeHours===''||row.downtimeHours==null ? null : Number(row.downtimeHours),
    work_order_no: row.workOrderNo || null, performed_by: row.performedBy || null,
    status: row.status || 'completed',
    failure_mode: row.failureMode || null, root_cause: row.rootCause || null,
    created_by: userId,
  };
  const { data, error } = await supabase.from('maintenance_events').insert(dbRow).select('*').maybeSingle();
  if (!error) await audit('CREATE', 'maintenance_events', data.id, null, data);
  return { data, error };
}

// ─── MAINTENANCE PARTS USED ───────────────────────────────────────
// Fetches every parts-used row for a given set of maintenance event
// ids (joined to spare_parts for code/description/fg) — used by both
// the Timeline (grouped per event) and the Parts Used tab (aggregated
// across all of an asset's events). Callers first fetch the asset's
// maintenance_events and pass their ids in; a single asset's full
// history is always a small result set, safe to aggregate client-side
// rather than needing a dedicated SQL aggregate view.
export async function fetchMaintenancePartsUsedByEvents(eventIds) {
  if (!eventIds || eventIds.length === 0) return { data: [], error: null };
  // v_maintenance_parts_used (migration 026) adds the returned/net
  // quantities and is_cancelled, which cannot be expressed as a plain
  // PostgREST embed. Rows are reshaped to the nested `part` shape the
  // rest of the UI already reads, with `quantity` kept as the issued
  // amount so nothing that only cares about the original line breaks.
  const { data, error } = await supabase
    .from('v_maintenance_parts_used')
    .select('*')
    .in('maintenance_event_id', eventIds);
  if (error) return { data: null, error };
  return {
    data: (data || []).map(r => ({
      ...r,
      quantity: Number(r.issued_qty),
      issued_qty: Number(r.issued_qty),
      returned_qty: Number(r.returned_qty),
      net_qty: Number(r.net_qty),
      part: { id: r.part_id, code: r.part_code, short_desc: r.part_short_desc, fg: r.part_fg },
    })),
    error: null,
  };
}

// Returns some or all of a part issued against a maintenance event:
// posts a linked return_to_store movement and shrinks the line's net
// quantity, so the maintenance record stops counting what came back
// (migration 026). Returning the full outstanding amount cancels the
// line outright.
export async function returnMaintenancePart(lineId, quantity, reason) {
  const { data, error } = await supabase.rpc('return_maintenance_part', {
    p_line_id: lineId,
    p_quantity: Number(quantity),
    p_reason: reason || null,
  });
  if (!error) await audit('UPDATE', 'maintenance_parts_used', lineId, null, { returned: Number(quantity), reason });
  return { data, error };
}

// Cancels a logged part: voids its stock movement but keeps the line
// on the maintenance record, marked cancelled (migration 025).
export async function cancelMaintenancePart(lineId, reason) {
  const { error } = await supabase.rpc('cancel_maintenance_part', { p_line_id: lineId, p_reason: reason || null });
  if (!error) await audit('VOID', 'maintenance_parts_used', lineId, null, { reason });
  return { error };
}

export async function updateMaintenanceEvent(id, row) {
  const { data: oldData } = await supabase.from('maintenance_events').select('*').eq('id', id).maybeSingle();
  const payload = {
    title: row.title, description: row.description || null,
    event_type: row.eventType, status: row.status,
    running_hours_at_event: row.runningHoursAtEvent === '' || row.runningHoursAtEvent == null ? null : Number(row.runningHoursAtEvent),
    downtime_hours: row.downtimeHours === '' || row.downtimeHours == null ? null : Number(row.downtimeHours),
    work_order_no: row.workOrderNo || null, performed_by: row.performedBy || null,
    failure_mode: row.failureMode || null, root_cause: row.rootCause || null,
  };
  // event_date / asset_id are deliberately not sent: the database
  // blocks changing them once stock has posted (migration 025).
  const { data, error } = await supabase.from('maintenance_events').update(payload).eq('id', id).select('*').maybeSingle();
  if (!error) await audit('UPDATE', 'maintenance_events', id, oldData, data);
  return { data, error };
}

export async function softDeleteMaintenanceEvent(id) {
  const { data, error } = await supabase.from('maintenance_events')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id).select().maybeSingle();
  if (!error) await audit('DELETE', 'maintenance_events', id, data, null);
  return { data, error };
}


// ─── ASSET DOCUMENTS ───────────────────────────────────────────────
export async function fetchAssetDocuments(assetId) {
  return supabase.from('asset_documents').select('*').eq('asset_id', assetId).order('uploaded_at', { ascending: false });
}

export async function insertAssetDocument(assetId, label, url, path) {
  const userId = await uid();
  const { data, error } = await supabase.from('asset_documents')
    .insert({ asset_id: assetId, label, url, path, uploaded_by: userId }).select().maybeSingle();
  if (!error) await audit('CREATE', 'asset_documents', assetId, null, data);
  return { data, error };
}

export async function deleteAssetDocument(id, path) {
  const { error } = await supabase.from('asset_documents').delete().eq('id', id);
  if (!error) { await deleteFile('asset-documents', path); await audit('DELETE', 'asset_documents', id, null, null); }
  return { error };
}

// idCol defaults to 'code' when omitted — every table below except
// `assets` uses a text `code` natural key. `assets` has no `code`
// column (its natural key is `asset_tag`, PK is a uuid `id`), so it
// declares idCol explicitly; restore/hardDelete/emptyTrash all read
// this per-table override via keyColFor() instead of assuming 'code'.
export const TRASH_TABLES = [
  { table: 'categories',         label: 'Main Categories',   selectCols: 'code,label,icon,color,bg,deleted_at' },
  { table: 'manufacturers',      label: 'Manufacturers',     selectCols: 'code,label,cat_codes,deleted_at' },
  { table: 'models',             label: 'Equipment Models',  selectCols: 'code,label,mfr_code,deleted_at' },
  { table: 'disciplines',        label: 'Disciplines',       selectCols: 'code,label,description,color,bg,deleted_at' },
  { table: 'engine_systems',     label: 'Engine Systems',    selectCols: 'code,label,color,bg,deleted_at' },
  { table: 'functional_groups',  label: 'Functional Groups', selectCols: 'code,label,disc,deleted_at' },
  { table: 'spare_parts',        label: 'Spare Parts',       selectCols: 'code,short_desc,cat,mfr,model,disc,fg,deleted_at' },
  { table: 'assets',             label: 'Assets',            selectCols: 'id,asset_tag,serial_number,model,status,deleted_at', idCol: 'id' },
];

function keyColFor(table) {
  return TRASH_TABLES.find(t => t.table === table)?.idCol || 'code';
}

// Fetch every soft-deleted row from a single table (admin only — enforced
// by the trash_select RLS policy from migration 009).
export async function fetchTrash(table, limit = 200) {
  const meta = TRASH_TABLES.find(t => t.table === table);
  const cols = meta ? meta.selectCols : '*';
  return supabase
    .from(table)
    .select(cols)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(limit);
}

// Fetch soft-deleted rows from every table at once, for the Trash overview.
export async function fetchAllTrash(limitPerTable = 100) {
  const results = await Promise.all(
    TRASH_TABLES.map(({ table }) => fetchTrash(table, limitPerTable))
  );
  return TRASH_TABLES.map(({ table, label }, i) => ({
    table, label,
    data: results[i].data ?? [],
    error: results[i].error ?? null,
  }));
}

// Restore a soft-deleted row (set deleted_at back to NULL).
export async function restoreRecord(table, key) {
  const userId = await uid();
  const { data, error } = await supabase
    .from(table)
    .update({ deleted_at: null, updated_by: userId })
    .eq(keyColFor(table), key)
    .select()
    .maybeSingle();
  if (!error && data) await audit('RESTORE', table, key, null, data);
  return { data, error };
}

// Permanently delete a soft-deleted row. Requires the row to already
// have deleted_at set — enforced by the hard_delete RLS policy from
// migration 009, so this can never accidentally purge a live record.
export async function hardDeleteRecord(table, key) {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq(keyColFor(table), key)
    .not('deleted_at', 'is', null)
    .select()
    .maybeSingle();
  if (!error) await audit('PURGE', table, key, data, null);
  return { data, error };
}

// Permanently empty the trash for one table (or all tables if omitted).
// What still references each trashed row and would make a permanent
// delete fail (migration 038). The Trash page uses this to disable
// Purge with a reason instead of letting the foreign key raise.
export async function fetchTrashBlockers() {
  const { data, error } = await supabase.from('v_trash_purge_blockers').select('*');
  if (error) return { data: {}, error };
  const map = {};
  (data || []).forEach(r => {
    const reasons = [];
    if (r.ledger_rows > 0)      reasons.push(`${r.ledger_rows} stock movement${r.ledger_rows>1?'s':''}`);
    if (r.maintenance_rows > 0) reasons.push(`${r.maintenance_rows} maintenance record${r.maintenance_rows>1?'s':''}`);
    if (r.legacy_rows > 0)      reasons.push(`${r.legacy_rows} legacy movement${r.legacy_rows>1?'s':''}`);
    if (r.child_rows > 0)       reasons.push(`${r.child_rows} part${r.child_rows>1?'s':''}/asset${r.child_rows>1?'s':''} still using it`);
    map[`${r.table_name}|${r.record_key}`] = { canPurge: reasons.length === 0, reasons };
  });
  return { data: map, error: null };
}

// Purges only the rows that can actually be purged, and says what it
// skipped. Previously it deleted what it could and returned a bare
// error list, so the user saw "some deletions failed" with no idea
// which row or why.
export async function emptyTrash(table = null, purgeableKeys = null) {
  const tables = table ? [table] : TRASH_TABLES.map(t => t.table);
  let totalDeleted = 0;
  const errors = [];
  for (const t of tables) {
    const keyCol = keyColFor(t);
    let q = supabase.from(t).delete().not('deleted_at', 'is', null);
    if (purgeableKeys) {
      const keys = purgeableKeys[t] || [];
      if (keys.length === 0) continue;          // nothing purgeable in this table
      q = q.in(keyCol, keys);
    }
    const { data, error } = await q.select(keyCol);
    if (error) errors.push({ table: t, message: error.message });
    else totalDeleted += (data?.length ?? 0);
  }
  if (totalDeleted > 0) await audit('PURGE_ALL', table ?? 'all_tables', 'bulk', null, { count: totalDeleted });
  return { count: totalDeleted, errors: errors.length ? errors : null };
}

// ─── STORAGE ──────────────────────────────────────────────────
export async function uploadFile(bucket, partCode, file) {
  const ext  = file.name.split('.').pop();
  const path = `${partCode}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (!error) {
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    await audit('UPLOAD', 'storage', partCode, null, { bucket, path, url: urlData.publicUrl });
    return { url: urlData.publicUrl, path, error: null };
  }
  return { url: null, path: null, error };
}

export const deleteFile = (bucket, path) =>
  supabase.storage.from(bucket).remove([path]);

// Non-public buckets (asset-documents, part-datasheets, part-manuals,
// part-drawings) CANNOT be read through getPublicUrl() — Supabase's
// /object/public/ route checks the bucket's public flag and returns
// "Bucket not found" (NoSuchBucket) before RLS is ever consulted. A
// short-lived signed URL is the only way to open a file in one of
// those buckets, so anything opening a stored doc URL must go through
// here rather than using the stored public URL directly.
export async function createSignedUrl(bucket, path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  return { url: data?.signedUrl ?? null, error };
}

// Buckets created with public:false. Files in these can only be opened
// through createSignedUrl() — see its comment above.
export const PRIVATE_BUCKETS = ['asset-documents', 'part-datasheets', 'part-manuals', 'part-drawings'];

// Recovers the storage path from a stored getPublicUrl() link, for the
// tables that only persist the URL (spare_parts.datasheet_url etc.)
// and not the path. Returns null for anything that isn't a public
// storage URL for this bucket.
export function pathFromPublicUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}

// ─── AUDIT LOGS ───────────────────────────────────────────────
export async function fetchAuditLogs({ limit = 200, offset = 0, action, tableName } = {}) {
  let q = supabase
    .from('audit_logs')
    .select('id,action,table_name,record_id,old_values,new_values,user_id,created_at,user_profiles(email,full_name)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (action)    q = q.eq('action', action);
  if (tableName) q = q.eq('table_name', tableName);
  return q;
}

// ─── USER PROFILES ────────────────────────────────────────────
export const fetchUserProfile = (userId) =>
  supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle()

export const fetchAllUsers = () =>
  supabase.from('user_profiles').select('*').order('full_name');

// A plain UPDATE, not an upsert. upsert() sends an INSERT ... ON
// CONFLICT, and the proposed row is checked against NOT NULL before
// the conflict is resolved — so upserting {id, role} always failed
// with 23502 on the email column, and the role never changed.
export async function updateUserRole(userId, role) {
  const { data: before } = await supabase.from('user_profiles')
    .select('id,email,role').eq('id', userId).maybeSingle();
  const { data, error } = await supabase.from('user_profiles')
    .update({ role })
    .eq('id', userId)
    .select('id,email,full_name,role,department')
    .maybeSingle();
  // RLS rejects a non-admin silently: no error, but no row either.
  if (!error && !data) {
    return { data: null, error: { message: 'Nothing was updated — only an admin can change a role.' } };
  }
  if (!error) await audit('UPDATE', 'user_profiles', userId, before, data);
  return { data, error };
}

// updated_at is maintained by the set_updated_at trigger.
export async function updateUserProfile(userId, fields) {
  const { data: before } = await supabase.from('user_profiles')
    .select('*').eq('id', userId).maybeSingle();
  const { data, error } = await supabase.from('user_profiles')
    .update(fields).eq('id', userId).select('*').maybeSingle();
  if (!error && !data) {
    return { data: null, error: { message: 'Nothing was updated — only an admin can edit another user.' } };
  }
  if (!error) await audit('UPDATE', 'user_profiles', userId, before, data);
  return { data, error };
}

// ═══════════════════════════════════════════════════════════════
// RELIABILITY ANALYTICS (migration 030_reliability_views.sql)
//
// Every one of these reads a view that already nets returns off
// issued quantities, drops cancelled lines and excludes soft-deleted
// assets and events — see the migration header. Nothing here should
// re-derive those rules.
// ═══════════════════════════════════════════════════════════════

// ─── Fleet overview ───────────────────────────────────────────────
export async function fetchAssetsByStatus() {
  const { data, error } = await supabase
    .from('assets').select('status').is('deleted_at', null);
  if (error) return { data: null, error };
  const counts = {};
  (data || []).forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
  return { data: counts, error: null };
}

export const fetchPmDueList = () =>
  supabase.from('v_asset_pm_due').select('*');

// "Top by consumption" and "top by downtime" both come out of the
// cost summary, which is already per asset per year.
export async function fetchAssetYearTotals(year) {
  let q = supabase.from('v_asset_cost_summary')
    .select('asset_id,asset_tag,asset_model,status,year,parts_cost,parts_qty,distinct_parts,event_count,downtime_hours,hours_run,cost_per_running_hour');
  if (year) q = q.eq('year', year);
  return q;
}

// ─── Reliability flags ────────────────────────────────────────────
export function fetchReliabilityFlags({ severity, model } = {}) {
  let q = supabase.from('v_asset_reliability_flags').select('*');
  if (severity) q = q.eq('severity', severity);
  if (model)    q = q.eq('asset_model', model);
  return q.order('severity_rank', { ascending: false })
          .order('ratio_to_fleet_median', { ascending: false });
}

// The evidence behind one flag: every replacement of that functional
// group on that asset. A flag nobody can audit is a flag nobody
// trusts, so the UI always has this available.
export function fetchFlagEvidence(assetId, fg) {
  return supabase.from('v_part_replacements')
    .select('maintenance_event_id,event_date,event_type,event_title,work_order_no,part_code,part_short_desc,net_qty,unit_cost,line_cost,failure_mode,root_cause')
    .eq('asset_id', assetId).eq('fg', fg)
    .order('event_date', { ascending: false });
}

export function fetchAssetPartHistory(assetId) {
  return supabase.from('v_asset_part_history').select('*')
    .eq('asset_id', assetId)
    .order('times_replaced', { ascending: false });
}

export const fetchFleetBaseline = () =>
  supabase.from('v_fleet_part_baseline').select('*').order('asset_model');

// ─── Consumption ──────────────────────────────────────────────────
// Rolled up in the browser rather than in SQL because the grouping
// key is a user choice and the row count is bounded by the date
// range. CONSUMPTION_ROW_CAP guards the fetch; the page warns when it
// is reached rather than silently charting a partial period.
export const CONSUMPTION_ROW_CAP = 5000;

export function fetchConsumption({ from, to, model, cat, fg } = {}) {
  let q = supabase.from('v_part_replacements')
    .select('asset_id,asset_tag,asset_model,part_id,part_code,part_short_desc,fg,part_cat,part_mfr,event_date,net_qty,line_cost');
  if (from)  q = q.gte('event_date', from);
  if (to)    q = q.lte('event_date', to);
  if (model) q = q.eq('asset_model', model);
  if (cat)   q = q.eq('part_cat', cat);
  if (fg)    q = q.eq('fg', fg);
  return q.order('event_date', { ascending: false }).limit(CONSUMPTION_ROW_CAP);
}

// ─── Failure patterns ─────────────────────────────────────────────
export function fetchFailurePatterns({ model, fg } = {}) {
  let q = supabase.from('v_part_failure_patterns').select('*');
  if (model) q = q.eq('asset_model', model);
  if (fg)    q = q.eq('fg', fg);
  return q.order('occurrences', { ascending: false });
}
