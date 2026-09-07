/**
 * db.js — All Supabase database query functions.
 * Uses upsert for all inserts to handle seed data conflicts gracefully.
 */
import { supabase } from './supabase.js';

// ─── AUTH HELPERS ─────────────────────────────────────────────
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

// Lightweight fetch for the Hierarchy Tree — only the columns needed to
// group/count parts client-side. Avoids pulling long_desc, remarks, dates,
// etc. for potentially thousands of rows.
export async function fetchTreeParts(page = 0, pageSize = 1000) {
  return supabase
    .from('spare_parts')
    .select('code,short_desc,cat,mfr,model,disc,fg,image_url,status')
    .is('deleted_at', null)
    .order('code', { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1);
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
  let received = 0, issued = 0, count = 0;
  for (const row of data || []) {
    count++;
    if (row.is_void) continue;
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

export async function voidStockTransaction(txnId, reason) {
  return supabase.rpc('void_stock_transaction', { p_txn_id: txnId, p_reason: reason || null });
}

// Looks up the reversing entries for a batch of voided transactions
// (by their id, matched against reverses_txn_id) regardless of which
// page of the ledger they landed on — used to render a voided row's
// reversal nested directly beneath it.
export async function fetchReversalsFor(txnIds) {
  if (!txnIds || txnIds.length === 0) return { data: [], error: null };
  return supabase.from('v_stock_transactions_detail').select('*').in('reverses_txn_id', txnIds);
}

// ─── TRASH / RECYCLE BIN ──────────────────────────────────────
// Every soft-deletable table, with the columns needed to show a
// meaningful row in the Trash page and the label used in the UI.
export const TRASH_TABLES = [
  { table: 'categories',         label: 'Main Categories',   selectCols: 'code,label,icon,color,bg,deleted_at' },
  { table: 'manufacturers',      label: 'Manufacturers',     selectCols: 'code,label,cat_codes,deleted_at' },
  { table: 'models',             label: 'Equipment Models',  selectCols: 'code,label,mfr_code,deleted_at' },
  { table: 'disciplines',        label: 'Disciplines',       selectCols: 'code,label,description,color,bg,deleted_at' },
  { table: 'engine_systems',     label: 'Engine Systems',    selectCols: 'code,label,color,bg,deleted_at' },
  { table: 'functional_groups',  label: 'Functional Groups', selectCols: 'code,label,disc,deleted_at' },
  { table: 'spare_parts',        label: 'Spare Parts',       selectCols: 'code,short_desc,cat,mfr,model,disc,fg,deleted_at' },
];

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
export async function restoreRecord(table, code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from(table)
    .update({ deleted_at: null, updated_by: userId })
    .eq('code', code)
    .select()
    .maybeSingle();
  if (!error && data) await audit('RESTORE', table, code, null, data);
  return { data, error };
}

// Permanently delete a soft-deleted row. Requires the row to already
// have deleted_at set — enforced by the hard_delete RLS policy from
// migration 009, so this can never accidentally purge a live record.
export async function hardDeleteRecord(table, code) {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq('code', code)
    .not('deleted_at', 'is', null)
    .select()
    .maybeSingle();
  if (!error) await audit('PURGE', table, code, data, null);
  return { data, error };
}

// Permanently empty the trash for one table (or all tables if omitted).
export async function emptyTrash(table = null) {
  const tables = table ? [table] : TRASH_TABLES.map(t => t.table);
  let totalDeleted = 0;
  const errors = [];
  for (const t of tables) {
    const { data, error } = await supabase
      .from(t)
      .delete()
      .not('deleted_at', 'is', null)
      .select('code');
    if (error) errors.push({ table: t, error });
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

export const upsertUserProfile = (profile) =>
  supabase.from('user_profiles').upsert(profile, { onConflict: 'id' });
