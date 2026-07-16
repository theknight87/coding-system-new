/**
 * db.js — All Supabase database query functions.
 * Every function returns { data, error }.
 */
import { supabase } from './supabase.js';

// ─── AUDIT HELPER ─────────────────────────────────────────────
// Gets current user id safely
async function getCurrentUserId() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch { return null; }
}

async function logAudit(action, tableName, recordId, oldValues = null, newValues = null) {
  try {
    const userId = await getCurrentUserId();
    await supabase.from('audit_logs').insert({
      action,
      table_name: tableName,
      record_id:  String(recordId),
      old_values: oldValues,
      new_values: newValues,
      user_id:    userId,
    });
  } catch (e) {
    console.warn('Audit log failed (non-fatal):', e.message);
  }
}

// Helper: add created_by / updated_by to a row
async function withCreatedBy(row) {
  const userId = await getCurrentUserId();
  return { ...row, created_by: userId };
}
async function withUpdatedBy(row) {
  const userId = await getCurrentUserId();
  return { ...row, updated_by: userId };
}

// ─── CATEGORIES ───────────────────────────────────────────────
export async function fetchCategories() {
  return supabase
    .from('categories')
    .select('code,label,icon,color,bg')
    .is('deleted_at', null)
    .order('code');
}
export async function insertCategory(row) {
  const fullRow = await withCreatedBy(row);
  // Use upsert so seeded data doesn't block — update on conflict
  const { data, error } = await supabase
    .from('categories')
    .upsert(fullRow, { onConflict: 'code' })
    .select('code,label,icon,color,bg')
    .single();
  if (!error) await logAudit('CREATE', 'categories', data.code, null, data);
  return { data, error };
}
export async function updateCategory(code, updates) {
  const fullRow = await withUpdatedBy(updates);
  const { data, error } = await supabase
    .from('categories')
    .update(fullRow)
    .eq('code', code)
    .select('code,label,icon,color,bg')
    .single();
  if (!error) await logAudit('UPDATE', 'categories', code, null, updates);
  return { data, error };
}
export async function softDeleteCategory(code) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('categories')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code)
    .select()
    .single();
  if (!error) await logAudit('DELETE', 'categories', code, data, null);
  return { data, error };
}

// ─── MANUFACTURERS ────────────────────────────────────────────
export async function fetchManufacturers() {
  return supabase
    .from('manufacturers')
    .select('code,label,cat_codes')
    .is('deleted_at', null)
    .order('code');
}
export async function insertManufacturer(row) {
  const fullRow = await withCreatedBy(row);
  const { data, error } = await supabase
    .from('manufacturers')
    .insert(fullRow)
    .select('code,label,cat_codes')
    .single();
  if (!error) await logAudit('CREATE', 'manufacturers', data.code, null, data);
  return { data, error };
}
export async function updateManufacturer(code, updates) {
  const fullRow = await withUpdatedBy(updates);
  const { data, error } = await supabase
    .from('manufacturers')
    .update(fullRow)
    .eq('code', code)
    .select('code,label,cat_codes')
    .single();
  if (!error) await logAudit('UPDATE', 'manufacturers', code, null, updates);
  return { data, error };
}
export async function softDeleteManufacturer(code) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('manufacturers')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code)
    .select()
    .single();
  if (!error) await logAudit('DELETE', 'manufacturers', code, data, null);
  return { data, error };
}

// ─── MODELS ───────────────────────────────────────────────────
export async function fetchModels() {
  return supabase
    .from('models')
    .select('code,label,mfr_code')
    .is('deleted_at', null)
    .order('mfr_code')
    .order('code');
}
export async function insertModel(row) {
  const fullRow = await withCreatedBy(row);
  const { data, error } = await supabase
    .from('models')
    .insert(fullRow)
    .select('code,label,mfr_code')
    .single();
  if (!error) await logAudit('CREATE', 'models', data.code, null, data);
  return { data, error };
}
export async function updateModel(code, updates) {
  const fullRow = await withUpdatedBy(updates);
  const { data, error } = await supabase
    .from('models')
    .update(fullRow)
    .eq('code', code)
    .select('code,label,mfr_code')
    .single();
  if (!error) await logAudit('UPDATE', 'models', code, null, updates);
  return { data, error };
}
export async function softDeleteModel(code) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('models')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code)
    .select()
    .single();
  if (!error) await logAudit('DELETE', 'models', code, data, null);
  return { data, error };
}

// ─── DISCIPLINES ──────────────────────────────────────────────
export async function fetchDisciplines() {
  return supabase
    .from('disciplines')
    .select('code,label,description,color,bg')
    .is('deleted_at', null)
    .order('code');
}
export async function insertDiscipline(row) {
  // row has { code, label, description, color, bg }
  const fullRow = await withCreatedBy(row);
  const { data, error } = await supabase
    .from('disciplines')
    .insert(fullRow)
    .select('code,label,description,color,bg')
    .single();
  if (!error) await logAudit('CREATE', 'disciplines', data.code, null, data);
  return { data, error };
}
export async function updateDiscipline(code, updates) {
  const fullRow = await withUpdatedBy(updates);
  const { data, error } = await supabase
    .from('disciplines')
    .update(fullRow)
    .eq('code', code)
    .select('code,label,description,color,bg')
    .single();
  if (!error) await logAudit('UPDATE', 'disciplines', code, null, updates);
  return { data, error };
}
export async function softDeleteDiscipline(code) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('disciplines')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code)
    .select()
    .single();
  if (!error) await logAudit('DELETE', 'disciplines', code, data, null);
  return { data, error };
}

// ─── ENGINE SYSTEMS ───────────────────────────────────────────
export async function fetchEngineSystems() {
  return supabase
    .from('engine_systems')
    .select('code,label,color,bg')
    .is('deleted_at', null)
    .order('code');
}
export async function insertEngineSystem(row) {
  const fullRow = await withCreatedBy(row);
  const { data, error } = await supabase
    .from('engine_systems')
    .insert(fullRow)
    .select('code,label,color,bg')
    .single();
  if (!error) await logAudit('CREATE', 'engine_systems', data.code, null, data);
  return { data, error };
}
export async function updateEngineSystem(code, updates) {
  const fullRow = await withUpdatedBy(updates);
  const { data, error } = await supabase
    .from('engine_systems')
    .update(fullRow)
    .eq('code', code)
    .select('code,label,color,bg')
    .single();
  if (!error) await logAudit('UPDATE', 'engine_systems', code, null, updates);
  return { data, error };
}
export async function softDeleteEngineSystem(code) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('engine_systems')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code)
    .select()
    .single();
  if (!error) await logAudit('DELETE', 'engine_systems', code, data, null);
  return { data, error };
}

// ─── FUNCTIONAL GROUPS ────────────────────────────────────────
export async function fetchFuncGroups() {
  return supabase
    .from('functional_groups')
    .select('code,label,disc')
    .is('deleted_at', null)
    .order('disc')
    .order('code');
}
export async function insertFuncGroup(row) {
  const fullRow = await withCreatedBy(row);
  const { data, error } = await supabase
    .from('functional_groups')
    .insert(fullRow)
    .select('code,label,disc')
    .single();
  if (!error) await logAudit('CREATE', 'functional_groups', data.code, null, data);
  return { data, error };
}
export async function updateFuncGroup(code, updates) {
  const fullRow = await withUpdatedBy(updates);
  const { data, error } = await supabase
    .from('functional_groups')
    .update(fullRow)
    .eq('code', code)
    .select('code,label,disc')
    .single();
  if (!error) await logAudit('UPDATE', 'functional_groups', code, null, updates);
  return { data, error };
}
export async function softDeleteFuncGroup(code) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('functional_groups')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code)
    .select()
    .single();
  if (!error) await logAudit('DELETE', 'functional_groups', code, data, null);
  return { data, error };
}

// ─── SPARE PARTS ──────────────────────────────────────────────
export async function fetchParts(filters = {}) {
  let q = supabase
    .from('spare_parts')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (filters.cat)    q = q.eq('cat', filters.cat);
  if (filters.disc)   q = q.eq('disc', filters.disc);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.search) {
    q = q.or(
      `code.ilike.%${filters.search}%,short_desc.ilike.%${filters.search}%,` +
      `long_desc.ilike.%${filters.search}%,part_no.ilike.%${filters.search}%,` +
      `oem_part.ilike.%${filters.search}%,location.ilike.%${filters.search}%`
    );
  }
  return q;
}
export async function insertPart(row) {
  const userId = await getCurrentUserId();
  const fullRow = { ...row, created_by: userId, updated_by: userId };
  const { data, error } = await supabase
    .from('spare_parts')
    .insert(fullRow)
    .select('*')
    .single();
  if (!error) await logAudit('CREATE', 'spare_parts', data.code, null, data);
  return { data, error };
}
export async function updatePart(code, updates) {
  const userId = await getCurrentUserId();
  const fullRow = { ...updates, updated_by: userId };
  const { data: oldData } = await supabase.from('spare_parts').select('*').eq('code', code).single();
  const { data, error } = await supabase
    .from('spare_parts')
    .update(fullRow)
    .eq('code', code)
    .select('*')
    .single();
  if (!error) await logAudit('UPDATE', 'spare_parts', code, oldData, updates);
  return { data, error };
}
export async function softDeletePart(code) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('spare_parts')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code)
    .select()
    .single();
  if (!error) await logAudit('DELETE', 'spare_parts', code, data, null);
  return { data, error };
}

// ─── STORAGE ──────────────────────────────────────────────────
export async function uploadFile(bucket, partCode, file) {
  const ext   = file.name.split('.').pop();
  const path  = `${partCode}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (!error) {
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    await logAudit('UPLOAD', 'storage', partCode, null, { bucket, path, url: urlData.publicUrl });
    return { url: urlData.publicUrl, path, error: null };
  }
  return { url: null, path: null, error };
}
export async function deleteFile(bucket, path) {
  return supabase.storage.from(bucket).remove([path]);
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
export async function fetchUserProfile(userId) {
  return supabase.from('user_profiles').select('*').eq('id', userId).single();
}
export async function fetchAllUsers() {
  return supabase.from('user_profiles').select('*').order('full_name');
}
export async function upsertUserProfile(profile) {
  return supabase.from('user_profiles').upsert(profile, { onConflict: 'id' });
}
