/**
 * db.js — All Supabase database query functions.
 * Keeps all SQL/API calls in one place, away from UI components.
 * Every function returns { data, error }.
 */
import { supabase } from './supabase.js';

// ─── AUDIT HELPER ─────────────────────────────────────────────
async function logAudit(action, tableName, recordId, oldValues = null, newValues = null) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('audit_logs').insert({
    action,
    table_name: tableName,
    record_id: String(recordId),
    old_values: oldValues,
    new_values: newValues,
    user_id: user?.id ?? null,
  });
}

// ─── CATEGORIES ───────────────────────────────────────────────
export async function fetchCategories() {
  return supabase.from('categories').select('*').is('deleted_at', null).order('code');
}
export async function insertCategory(row) {
  const { data, error } = await supabase.from('categories').insert(row).select().single();
  if (!error) await logAudit('CREATE', 'categories', data.code, null, data);
  return { data, error };
}
export async function updateCategory(code, updates) {
  const { data, error } = await supabase.from('categories').update(updates).eq('code', code).select().single();
  if (!error) await logAudit('UPDATE', 'categories', code, null, updates);
  return { data, error };
}
export async function softDeleteCategory(code) {
  const { data, error } = await supabase.from('categories').update({ deleted_at: new Date().toISOString() }).eq('code', code).select().single();
  if (!error) await logAudit('DELETE', 'categories', code, data, null);
  return { data, error };
}

// ─── MANUFACTURERS ────────────────────────────────────────────
export async function fetchManufacturers() {
  return supabase.from('manufacturers').select('*').is('deleted_at', null).order('code');
}
export async function insertManufacturer(row) {
  const { data, error } = await supabase.from('manufacturers').insert(row).select().single();
  if (!error) await logAudit('CREATE', 'manufacturers', data.code, null, data);
  return { data, error };
}
export async function updateManufacturer(code, updates) {
  const { data, error } = await supabase.from('manufacturers').update(updates).eq('code', code).select().single();
  if (!error) await logAudit('UPDATE', 'manufacturers', code, null, updates);
  return { data, error };
}
export async function softDeleteManufacturer(code) {
  const { data, error } = await supabase.from('manufacturers').update({ deleted_at: new Date().toISOString() }).eq('code', code).select().single();
  if (!error) await logAudit('DELETE', 'manufacturers', code, data, null);
  return { data, error };
}

// ─── MODELS ───────────────────────────────────────────────────
export async function fetchModels() {
  return supabase.from('models').select('*').is('deleted_at', null).order('mfr_code').order('code');
}
export async function insertModel(row) {
  const { data, error } = await supabase.from('models').insert(row).select().single();
  if (!error) await logAudit('CREATE', 'models', data.code, null, data);
  return { data, error };
}
export async function updateModel(code, updates) {
  const { data, error } = await supabase.from('models').update(updates).eq('code', code).select().single();
  if (!error) await logAudit('UPDATE', 'models', code, null, updates);
  return { data, error };
}
export async function softDeleteModel(code) {
  const { data, error } = await supabase.from('models').update({ deleted_at: new Date().toISOString() }).eq('code', code).select().single();
  if (!error) await logAudit('DELETE', 'models', code, data, null);
  return { data, error };
}

// ─── DISCIPLINES ──────────────────────────────────────────────
export async function fetchDisciplines() {
  return supabase.from('disciplines').select('*').is('deleted_at', null).order('code');
}
export async function insertDiscipline(row) {
  const { data, error } = await supabase.from('disciplines').insert(row).select().single();
  if (!error) await logAudit('CREATE', 'disciplines', data.code, null, data);
  return { data, error };
}
export async function updateDiscipline(code, updates) {
  const { data, error } = await supabase.from('disciplines').update(updates).eq('code', code).select().single();
  if (!error) await logAudit('UPDATE', 'disciplines', code, null, updates);
  return { data, error };
}
export async function softDeleteDiscipline(code) {
  const { data, error } = await supabase.from('disciplines').update({ deleted_at: new Date().toISOString() }).eq('code', code).select().single();
  if (!error) await logAudit('DELETE', 'disciplines', code, data, null);
  return { data, error };
}

// ─── ENGINE SYSTEMS ───────────────────────────────────────────
export async function fetchEngineSystems() {
  return supabase.from('engine_systems').select('*').is('deleted_at', null).order('code');
}
export async function insertEngineSystem(row) {
  const { data, error } = await supabase.from('engine_systems').insert(row).select().single();
  if (!error) await logAudit('CREATE', 'engine_systems', data.code, null, data);
  return { data, error };
}
export async function updateEngineSystem(code, updates) {
  const { data, error } = await supabase.from('engine_systems').update(updates).eq('code', code).select().single();
  if (!error) await logAudit('UPDATE', 'engine_systems', code, null, updates);
  return { data, error };
}
export async function softDeleteEngineSystem(code) {
  const { data, error } = await supabase.from('engine_systems').update({ deleted_at: new Date().toISOString() }).eq('code', code).select().single();
  if (!error) await logAudit('DELETE', 'engine_systems', code, data, null);
  return { data, error };
}

// ─── FUNCTIONAL GROUPS ────────────────────────────────────────
export async function fetchFuncGroups() {
  return supabase.from('functional_groups').select('*').is('deleted_at', null).order('disc').order('code');
}
export async function insertFuncGroup(row) {
  const { data, error } = await supabase.from('functional_groups').insert(row).select().single();
  if (!error) await logAudit('CREATE', 'functional_groups', data.code, null, data);
  return { data, error };
}
export async function updateFuncGroup(code, updates) {
  const { data, error } = await supabase.from('functional_groups').update(updates).eq('code', code).select().single();
  if (!error) await logAudit('UPDATE', 'functional_groups', code, null, updates);
  return { data, error };
}
export async function softDeleteFuncGroup(code) {
  const { data, error } = await supabase.from('functional_groups').update({ deleted_at: new Date().toISOString() }).eq('code', code).select().single();
  if (!error) await logAudit('DELETE', 'functional_groups', code, data, null);
  return { data, error };
}

// ─── SPARE PARTS ──────────────────────────────────────────────
export async function fetchParts(filters = {}) {
  let q = supabase.from('spare_parts').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (filters.cat)    q = q.eq('cat', filters.cat);
  if (filters.disc)   q = q.eq('disc', filters.disc);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.search) {
    q = q.or(`code.ilike.%${filters.search}%,short_desc.ilike.%${filters.search}%,long_desc.ilike.%${filters.search}%,part_no.ilike.%${filters.search}%,oem_part.ilike.%${filters.search}%,location.ilike.%${filters.search}%`);
  }
  return q;
}
export async function insertPart(row) {
  const { data, error } = await supabase.from('spare_parts').insert(row).select().single();
  if (!error) await logAudit('CREATE', 'spare_parts', data.code, null, data);
  return { data, error };
}
export async function updatePart(code, updates) {
  const old = await supabase.from('spare_parts').select('*').eq('code', code).single();
  const { data, error } = await supabase.from('spare_parts').update(updates).eq('code', code).select().single();
  if (!error) await logAudit('UPDATE', 'spare_parts', code, old.data, updates);
  return { data, error };
}
export async function softDeletePart(code) {
  const { data, error } = await supabase.from('spare_parts').update({ deleted_at: new Date().toISOString() }).eq('code', code).select().single();
  if (!error) await logAudit('DELETE', 'spare_parts', code, data, null);
  return { data, error };
}

// ─── STORAGE — IMAGES & DOCUMENTS ─────────────────────────────
export async function uploadFile(bucket, partCode, file) {
  const ext = file.name.split('.').pop();
  const path = `${partCode}/${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
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
export async function fetchAuditLogs({ limit = 100, offset = 0, action, tableName } = {}) {
  let q = supabase.from('audit_logs').select('*, user:user_id(email, full_name)').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (action)    q = q.eq('action', action);
  if (tableName) q = q.eq('table_name', tableName);
  return q;
}

// ─── USER PROFILE ─────────────────────────────────────────────
export async function fetchUserProfile(userId) {
  return supabase.from('user_profiles').select('*').eq('id', userId).single();
}
export async function fetchAllUsers() {
  return supabase.from('user_profiles').select('*').order('full_name');
}
export async function upsertUserProfile(profile) {
  return supabase.from('user_profiles').upsert(profile, { onConflict: 'id' });
}
