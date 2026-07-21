/**
 * db.js — All Supabase database query functions.
 * Uses upsert for all inserts to handle seed data conflicts gracefully.
 *
 * IMPORTANT: every exported function is wrapped so it NEVER throws —
 * it always resolves to { data, error }. Supabase's .single() throws
 * when a query returns zero rows (very common for "does this code
 * already exist?" checks, or when RLS silently blocks the SELECT
 * that follows an INSERT/UPDATE). An uncaught throw inside an async
 * button handler leaves the UI stuck ("saving..." forever, button
 * unresponsive) because the calling code never gets a chance to
 * reset its loading state. safeCall() + .maybeSingle() fix that.
 */
import { supabase } from './supabase.js';

// ─── SAFETY WRAPPER ───────────────────────────────────────────
// Ensures a function always resolves to { data, error } and never
// throws, even if Supabase itself throws (e.g. .single() on 0 rows,
// network failure, RLS rejection).
async function safeCall(fn) {
  try {
    return await fn();
  } catch (e) {
    return { data: null, error: { message: e?.message || String(e) } };
  }
}

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

// Generic "insert or restore-if-soft-deleted" helper used by every
// master-data table. Uses .maybeSingle() (never throws on 0 rows).
async function insertOrRestore(table, row, selectCols) {
  return safeCall(async () => {
    const userId = await uid();
    const { data: existing } = await supabase
      .from(table).select('code,deleted_at').eq('code', row.code).maybeSingle();

    if (existing && !existing.deleted_at) {
      return { data: null, error: { message: `Code "${row.code}" already exists` } };
    }
    if (existing && existing.deleted_at) {
      const { data, error } = await supabase
        .from(table).update({ ...row, deleted_at: null, updated_by: userId })
        .eq('code', row.code).select(selectCols).maybeSingle();
      if (!error && data) await audit('CREATE', table, data.code, null, data);
      return { data, error };
    }
    const { data, error } = await supabase
      .from(table).insert({ ...row, created_by: userId })
      .select(selectCols).maybeSingle();
    if (!error && data) await audit('CREATE', table, data.code, null, data);
    return { data, error };
  });
}

async function updateRow(table, code, updates, selectCols) {
  return safeCall(async () => {
    const userId = await uid();
    const { data, error } = await supabase
      .from(table).update({ ...updates, updated_by: userId })
      .eq('code', code).select(selectCols).maybeSingle();
    if (!error && data) await audit('UPDATE', table, code, null, updates);
    return { data, error };
  });
}

async function softDeleteRow(table, code) {
  return safeCall(async () => {
    const userId = await uid();
    const { data, error } = await supabase
      .from(table).update({ deleted_at: new Date().toISOString(), updated_by: userId })
      .eq('code', code).select().maybeSingle();
    if (!error && data) await audit('DELETE', table, code, data, null);
    return { data, error };
  });
}

// ─── CATEGORIES ───────────────────────────────────────────────
export const fetchCategories = () =>
  supabase.from('categories').select('code,label,icon,color,bg').is('deleted_at', null).order('code');

export const insertCategory = (row) =>
  insertOrRestore('categories', row, 'code,label,icon,color,bg');

export const updateCategory = (code, updates) =>
  updateRow('categories', code, updates, 'code,label,icon,color,bg');

export const softDeleteCategory = (code) =>
  softDeleteRow('categories', code);

// ─── MANUFACTURERS ────────────────────────────────────────────
export const fetchManufacturers = () =>
  supabase.from('manufacturers').select('code,label,cat_codes').is('deleted_at', null).order('code');

export const insertManufacturer = (row) =>
  insertOrRestore('manufacturers', row, 'code,label,cat_codes');

export const updateManufacturer = (code, updates) =>
  updateRow('manufacturers', code, updates, 'code,label,cat_codes');

export const softDeleteManufacturer = (code) =>
  softDeleteRow('manufacturers', code);

// ─── MODELS ───────────────────────────────────────────────────
export const fetchModels = () =>
  supabase.from('models').select('code,label,mfr_code').is('deleted_at', null).order('mfr_code').order('code');

export const insertModel = (row) =>
  insertOrRestore('models', row, 'code,label,mfr_code');

export const updateModel = (code, updates) =>
  updateRow('models', code, updates, 'code,label,mfr_code');

export const softDeleteModel = (code) =>
  softDeleteRow('models', code);

// ─── DISCIPLINES ──────────────────────────────────────────────
export const fetchDisciplines = () =>
  supabase.from('disciplines').select('code,label,description,color,bg').is('deleted_at', null).order('code');

export const insertDiscipline = (row) =>
  insertOrRestore('disciplines', row, 'code,label,description,color,bg');

export const updateDiscipline = (code, updates) =>
  updateRow('disciplines', code, updates, 'code,label,description,color,bg');

export const softDeleteDiscipline = (code) =>
  softDeleteRow('disciplines', code);

// ─── ENGINE SYSTEMS ───────────────────────────────────────────
export const fetchEngineSystems = () =>
  supabase.from('engine_systems').select('code,label,color,bg').is('deleted_at', null).order('code');

export const insertEngineSystem = (row) =>
  insertOrRestore('engine_systems', row, 'code,label,color,bg');

export const updateEngineSystem = (code, updates) =>
  updateRow('engine_systems', code, updates, 'code,label,color,bg');

export const softDeleteEngineSystem = (code) =>
  softDeleteRow('engine_systems', code);

// ─── FUNCTIONAL GROUPS ────────────────────────────────────────
export const fetchFuncGroups = () =>
  supabase.from('functional_groups').select('code,label,disc').is('deleted_at', null).order('disc').order('code');

export const insertFuncGroup = (row) =>
  insertOrRestore('functional_groups', row, 'code,label,disc');

export const updateFuncGroup = (code, updates) =>
  updateRow('functional_groups', code, updates, 'code,label,disc');

export const softDeleteFuncGroup = (code) =>
  softDeleteRow('functional_groups', code);

// ─── SPARE PARTS ──────────────────────────────────────────────
export async function fetchPartsCount(filters = {}) {
  return safeCall(async () => {
    let q = supabase.from('spare_parts').select('*', { count: 'exact', head: true }).is('deleted_at', null);
    if (filters.cat)    q = q.eq('cat', filters.cat);
    if (filters.disc)   q = q.eq('disc', filters.disc);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.mfr)    q = q.eq('mfr', filters.mfr);
    if (filters.model)  q = q.eq('model', filters.model);
    if (filters.search) {
      q = q.or(`code.ilike.%${filters.search}%,short_desc.ilike.%${filters.search}%,part_no.ilike.%${filters.search}%`);
    }
    const { count, error } = await q;
    return { count: count ?? 0, error, data: null };
  });
}

export async function fetchParts(filters = {}, page = 0, pageSize = 100) {
  let q = supabase
    .from('spare_parts')
    .select('code,short_desc,long_desc,cat,mfr,model,disc,fg,part_no,oem_part,qty,unit,location,min_stock,max_stock,remarks,status,image_url,datasheet_url,created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (filters.cat)    q = q.eq('cat', filters.cat);
  if (filters.disc)   q = q.eq('disc', filters.disc);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.mfr)    q = q.eq('mfr', filters.mfr);
  if (filters.model)  q = q.eq('model', filters.model);
  if (filters.search) {
    q = q.or(`code.ilike.%${filters.search}%,short_desc.ilike.%${filters.search}%,part_no.ilike.%${filters.search}%,oem_part.ilike.%${filters.search}%,location.ilike.%${filters.search}%`);
  }
  return q;
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

// Same as fetchTreeParts but also returns the total row count on the first
// call, so the caller can fetch all remaining pages in parallel instead of
// one-by-one — this is what makes the Hierarchy Tree's initial load fast.
export async function fetchTreePartsWithCount(page = 0, pageSize = 1000) {
  return supabase
    .from('spare_parts')
    .select('code,short_desc,cat,mfr,model,disc,fg,image_url,status', { count: 'exact' })
    .is('deleted_at', null)
    .order('code', { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1);
}

export async function insertPart(row) {
  return safeCall(async () => {
    const userId = await uid();
    const { data: existing } = await supabase
      .from('spare_parts').select('code,deleted_at').eq('code', row.code).maybeSingle();

    if (existing && !existing.deleted_at) {
      return { data: null, error: { message: `Part code "${row.code}" already exists` } };
    }
    if (existing && existing.deleted_at) {
      const { data, error } = await supabase
        .from('spare_parts').update({ ...row, deleted_at: null, updated_by: userId })
        .eq('code', row.code).select('*').maybeSingle();
      if (!error && data) await audit('CREATE', 'spare_parts', data.code, null, data);
      return { data, error };
    }
    const { data, error } = await supabase
      .from('spare_parts').insert({ ...row, created_by: userId, updated_by: userId })
      .select('*').maybeSingle();
    if (!error && data) await audit('CREATE', 'spare_parts', data.code, null, data);
    return { data, error };
  });
}

export async function updatePart(code, updates) {
  return safeCall(async () => {
    const userId = await uid();
    const { data: oldData } = await supabase.from('spare_parts').select('*').eq('code', code).maybeSingle();
    const { data, error } = await supabase
      .from('spare_parts').update({ ...updates, updated_by: userId })
      .eq('code', code).select('*').maybeSingle();
    if (!error && data) await audit('UPDATE', 'spare_parts', code, oldData, updates);
    return { data, error };
  });
}

export async function softDeletePart(code) {
  return safeCall(async () => {
    const userId = await uid();
    const { data, error } = await supabase
      .from('spare_parts').update({ deleted_at: new Date().toISOString(), updated_by: userId })
      .eq('code', code).select().maybeSingle();
    if (!error && data) await audit('DELETE', 'spare_parts', code, data, null);
    return { data, error };
  });
}

// ─── STORAGE ──────────────────────────────────────────────────
export async function uploadFile(bucket, partCode, file) {
  return safeCall(async () => {
    const ext  = file.name.split('.').pop();
    const path = `${partCode}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (!error) {
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      await audit('UPLOAD', 'storage', partCode, null, { bucket, path, url: urlData.publicUrl });
      return { url: urlData.publicUrl, path, error: null, data: null };
    }
    return { url: null, path: null, error, data: null };
  });
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
  supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle();

export const fetchAllUsers = () =>
  supabase.from('user_profiles').select('*').order('full_name');

export const upsertUserProfile = (profile) =>
  supabase.from('user_profiles').upsert(profile, { onConflict: 'id' });
