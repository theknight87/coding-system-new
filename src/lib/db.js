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
  const { error } = await supabase
    .from('categories')
    .upsert({ ...row, created_by: userId }, { onConflict: 'code' });
  if (!error) await audit('CREATE', 'categories', row.code, null, row);
  return { data: row, error };
}

export async function updateCategory(code, updates) {
  const userId = await uid();
  const { error } = await supabase
    .from('categories').update({ ...updates, updated_by: userId })
    .eq('code', code);
  if (!error) await audit('UPDATE', 'categories', code, null, updates);
  return { data: updates, error };
}

export async function softDeleteCategory(code) {
  // تم تحويلها لـ Hard Delete
  const { error } = await supabase.from('categories').delete().eq('code', code);
  if (!error) await audit('DELETE', 'categories', code, { deleted: true }, null);
  return { data: null, error };
}

// ─── MANUFACTURERS ────────────────────────────────────────────
export const fetchManufacturers = () =>
  supabase.from('manufacturers').select('code,label,cat_codes').is('deleted_at', null).order('code');

export async function insertManufacturer(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('manufacturers').select('code,deleted_at').eq('code', row.code).maybeSingle();
  if (existing && !existing.deleted_at) return { data: null, error: { message: `Manufacturer code "${row.code}" already exists` } };
  
  if (existing && existing.deleted_at) {
    const { error } = await supabase.from('manufacturers').update({ ...row, deleted_at: null, updated_by: userId }).eq('code', row.code);
    if (!error) await audit('CREATE', 'manufacturers', row.code, null, row);
    return { data: row, error };
  }
  const { error } = await supabase.from('manufacturers').insert({ ...row, created_by: userId });
  if (!error) await audit('CREATE', 'manufacturers', row.code, null, row);
  return { data: row, error };
}

export async function updateManufacturer(code, updates) {
  const userId = await uid();
  const { error } = await supabase.from('manufacturers').update({ ...updates, updated_by: userId }).eq('code', code);
  if (!error) await audit('UPDATE', 'manufacturers', code, null, updates);
  return { data: updates, error };
}

export async function softDeleteManufacturer(code) {
  const { error } = await supabase.from('manufacturers').delete().eq('code', code);
  if (!error) await audit('DELETE', 'manufacturers', code, { deleted: true }, null);
  return { data: null, error };
}

// ─── DISCIPLINES ──────────────────────────────────────────────
export const fetchDisciplines = () =>
  supabase.from('disciplines').select('code,label,description,color,bg').is('deleted_at', null).order('code');

export async function insertDiscipline(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('disciplines').select('code,deleted_at').eq('code', row.code).maybeSingle();
  if (existing && !existing.deleted_at) return { data: null, error: { message: `Discipline code "${row.code}" already exists` } };
  
  if (existing && existing.deleted_at) {
    const { error } = await supabase.from('disciplines').update({ ...row, deleted_at: null, updated_by: userId }).eq('code', row.code);
    if (!error) await audit('CREATE', 'disciplines', row.code, null, row);
    return { data: row, error };
  }
  const { error } = await supabase.from('disciplines').insert({ ...row, created_by: userId });
  if (!error) await audit('CREATE', 'disciplines', row.code, null, row);
  return { data: row, error };
}

export async function updateDiscipline(code, updates) {
  const userId = await uid();
  const { error } = await supabase.from('disciplines').update({ ...updates, updated_by: userId }).eq('code', code);
  if (!error) await audit('UPDATE', 'disciplines', code, null, updates);
  return { data: updates, error };
}

export async function softDeleteDiscipline(code) {
  const { error } = await supabase.from('disciplines').delete().eq('code', code);
  if (!error) await audit('DELETE', 'disciplines', code, { deleted: true }, null);
  return { data: null, error };
}

// ─── ENGINE SYSTEMS ───────────────────────────────────────────
export const fetchEngineSystems = () =>
  supabase.from('engine_systems').select('code,label,color,bg').is('deleted_at', null).order('code');

export async function insertEngineSystem(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('engine_systems').select('code,deleted_at').eq('code', row.code).maybeSingle();
  if (existing && !existing.deleted_at) return { data: null, error: { message: `Engine system code "${row.code}" already exists` } };
  
  if (existing && existing.deleted_at) {
    const { error } = await supabase.from('engine_systems').update({ ...row, deleted_at: null, updated_by: userId }).eq('code', row.code);
    if (!error) await audit('CREATE', 'engine_systems', row.code, null, row);
    return { data: row, error };
  }
  const { error } = await supabase.from('engine_systems').insert({ ...row, created_by: userId });
  if (!error) await audit('CREATE', 'engine_systems', row.code, null, row);
  return { data: row, error };
}

export async function updateEngineSystem(code, updates) {
  const userId = await uid();
  const { error } = await supabase.from('engine_systems').update({ ...updates, updated_by: userId }).eq('code', code);
  if (!error) await audit('UPDATE', 'engine_systems', code, null, updates);
  return { data: updates, error };
}

export async function softDeleteEngineSystem(code) {
  const { error } = await supabase.from('engine_systems').delete().eq('code', code);
  if (!error) await audit('DELETE', 'engine_systems', code, { deleted: true }, null);
  return { data: null, error };
}

// ─── FUNCTIONAL GROUPS ────────────────────────────────────────
export const fetchFuncGroups = () =>
  supabase.from('functional_groups').select('code,label,disc').is('deleted_at', null).order('disc').order('code');

export async function insertFuncGroup(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('functional_groups').select('code,deleted_at').eq('code', row.code).maybeSingle();
  if (existing && !existing.deleted_at) return { data: null, error: { message: `Functional group code "${row.code}" already exists` } };
  
  if (existing && existing.deleted_at) {
    const { error } = await supabase.from('functional_groups').update({ ...row, deleted_at: null, updated_by: userId }).eq('code', row.code);
    if (!error) await audit('CREATE', 'functional_groups', row.code, null, row);
    return { data: row, error };
  }
  const { error } = await supabase.from('functional_groups').insert({ ...row, created_by: userId });
  if (!error) await audit('CREATE', 'functional_groups', row.code, null, row);
  return { data: row, error };
}

export async function updateFuncGroup(code, updates) {
  const userId = await uid();
  const { error } = await supabase.from('functional_groups').update({ ...updates, updated_by: userId }).eq('code', code);
  if (!error) await audit('UPDATE', 'functional_groups', code, null, updates);
  return { data: updates, error };
}

export async function softDeleteFuncGroup(code) {
  const { error } = await supabase.from('functional_groups').delete().eq('code', code);
  if (!error) await audit('DELETE', 'functional_groups', code, { deleted: true }, null);
  return { data: null, error };
}

// ─── SPARE PARTS ──────────────────────────────────────────────
export async function insertPart(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('spare_parts').select('code,deleted_at').eq('code', row.code).maybeSingle();
  if (existing && !existing.deleted_at) return { data: null, error: { message: `Part code "${row.code}" already exists` } };
  
  if (existing && existing.deleted_at) {
    const { error } = await supabase.from('spare_parts').update({ ...row, deleted_at: null, updated_by: userId }).eq('code', row.code);
    if (!error) await audit('CREATE', 'spare_parts', row.code, null, row);
    return { data: row, error };
  }
  const { error } = await supabase.from('spare_parts').insert({ ...row, created_by: userId, updated_by: userId });
  if (!error) await audit('CREATE', 'spare_parts', row.code, null, row);
  return { data: row, error };
}

export async function updatePart(code, updates) {
  const userId = await uid();
  const { error } = await supabase.from('spare_parts').update({ ...updates, updated_by: userId }).eq('code', code);
  if (!error) await audit('UPDATE', 'spare_parts', code, null, updates);
  return { data: updates, error };
}

export async function softDeletePart(code) {
  const { error } = await supabase.from('spare_parts').delete().eq('code', code);
  if (!error) await audit('DELETE', 'spare_parts', code, { deleted: true }, null);
  return { data: null, error };
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
