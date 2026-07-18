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
    .select('code,label,icon,color,bg').single();
  if (!error) await audit('CREATE', 'categories', data.code, null, data);
  return { data, error };
}

export async function updateCategory(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('categories').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,icon,color,bg').single();
  if (!error) await audit('UPDATE', 'categories', code, null, updates);
  return { data, error };
}

export async function softDeleteCategory(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('categories').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().single();
  if (!error) await audit('DELETE', 'categories', code, data, null);
  return { data, error };
}

// ─── MANUFACTURERS ────────────────────────────────────────────
export const fetchManufacturers = () =>
  supabase.from('manufacturers').select('code,label,cat_codes').is('deleted_at', null).order('code');

export async function insertManufacturer(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('manufacturers').select('code,deleted_at').eq('code', row.code).single();
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Manufacturer code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('manufacturers').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,cat_codes').single();
    if (!error) await audit('CREATE', 'manufacturers', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('manufacturers').insert({ ...row, created_by: userId })
    .select('code,label,cat_codes').single();
  if (!error) await audit('CREATE', 'manufacturers', data.code, null, data);
  return { data, error };
}

export async function updateManufacturer(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('manufacturers').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,cat_codes').single();
  if (!error) await audit('UPDATE', 'manufacturers', code, null, updates);
  return { data, error };
}

export async function softDeleteManufacturer(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('manufacturers').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().single();
  if (!error) await audit('DELETE', 'manufacturers', code, data, null);
  return { data, error };
}

// ─── MODELS ───────────────────────────────────────────────────
export const fetchModels = () =>
  supabase.from('models').select('code,label,mfr_code').is('deleted_at', null).order('mfr_code').order('code');

export async function insertModel(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('models').select('code,deleted_at').eq('code', row.code).single();
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Model code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('models').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,mfr_code').single();
    if (!error) await audit('CREATE', 'models', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('models').insert({ ...row, created_by: userId })
    .select('code,label,mfr_code').single();
  if (!error) await audit('CREATE', 'models', data.code, null, data);
  return { data, error };
}

export async function updateModel(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('models').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,mfr_code').single();
  if (!error) await audit('UPDATE', 'models', code, null, updates);
  return { data, error };
}

export async function softDeleteModel(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('models').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().single();
  if (!error) await audit('DELETE', 'models', code, data, null);
  return { data, error };
}

// ─── DISCIPLINES ──────────────────────────────────────────────
export const fetchDisciplines = () =>
  supabase.from('disciplines').select('code,label,description,color,bg').is('deleted_at', null).order('code');

export async function insertDiscipline(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('disciplines').select('code,deleted_at').eq('code', row.code).single();
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Discipline code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('disciplines').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,description,color,bg').single();
    if (!error) await audit('CREATE', 'disciplines', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('disciplines').insert({ ...row, created_by: userId })
    .select('code,label,description,color,bg').single();
  if (!error) await audit('CREATE', 'disciplines', data.code, null, data);
  return { data, error };
}

export async function updateDiscipline(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('disciplines').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,description,color,bg').single();
  if (!error) await audit('UPDATE', 'disciplines', code, null, updates);
  return { data, error };
}

export async function softDeleteDiscipline(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('disciplines').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().single();
  if (!error) await audit('DELETE', 'disciplines', code, data, null);
  return { data, error };
}

// ─── ENGINE SYSTEMS ───────────────────────────────────────────
export const fetchEngineSystems = () =>
  supabase.from('engine_systems').select('code,label,color,bg').is('deleted_at', null).order('code');

export async function insertEngineSystem(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('engine_systems').select('code,deleted_at').eq('code', row.code).single();
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Engine system code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('engine_systems').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,color,bg').single();
    if (!error) await audit('CREATE', 'engine_systems', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('engine_systems').insert({ ...row, created_by: userId })
    .select('code,label,color,bg').single();
  if (!error) await audit('CREATE', 'engine_systems', data.code, null, data);
  return { data, error };
}

export async function updateEngineSystem(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('engine_systems').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,color,bg').single();
  if (!error) await audit('UPDATE', 'engine_systems', code, null, updates);
  return { data, error };
}

export async function softDeleteEngineSystem(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('engine_systems').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().single();
  if (!error) await audit('DELETE', 'engine_systems', code, data, null);
  return { data, error };
}

// ─── FUNCTIONAL GROUPS ────────────────────────────────────────
export const fetchFuncGroups = () =>
  supabase.from('functional_groups').select('code,label,disc').is('deleted_at', null).order('disc').order('code');

export async function insertFuncGroup(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('functional_groups').select('code,deleted_at').eq('code', row.code).single();
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Functional group code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('functional_groups').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('code,label,disc').single();
    if (!error) await audit('CREATE', 'functional_groups', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('functional_groups').insert({ ...row, created_by: userId })
    .select('code,label,disc').single();
  if (!error) await audit('CREATE', 'functional_groups', data.code, null, data);
  return { data, error };
}

export async function updateFuncGroup(code, updates) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('functional_groups').update({ ...updates, updated_by: userId })
    .eq('code', code).select('code,label,disc').single();
  if (!error) await audit('UPDATE', 'functional_groups', code, null, updates);
  return { data, error };
}

export async function softDeleteFuncGroup(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('functional_groups').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().single();
  if (!error) await audit('DELETE', 'functional_groups', code, data, null);
  return { data, error };
}

// ─── SPARE PARTS ──────────────────────────────────────────────

// NEW: Fetch only codes for fast statistics and hierarchy building
export const fetchAllPartCodes = () =>
  supabase.from('spare_parts').select('code').is('deleted_at', null);

export async function fetchPartsCount(filters = {}) {
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
  return { count: count ?? 0, error };
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

export async function insertPart(row) {
  const userId = await uid();
  const { data: existing } = await supabase.from('spare_parts').select('code,deleted_at').eq('code', row.code).single();
  if (existing && !existing.deleted_at) {
    return { data: null, error: { message: `Part code "${row.code}" already exists` } };
  }
  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from('spare_parts').update({ ...row, deleted_at: null, updated_by: userId })
      .eq('code', row.code).select('*').single();
    if (!error) await audit('CREATE', 'spare_parts', data.code, null, data);
    return { data, error };
  }
  const { data, error } = await supabase
    .from('spare_parts').insert({ ...row, created_by: userId, updated_by: userId })
    .select('*').single();
  if (!error) await audit('CREATE', 'spare_parts', data.code, null, data);
  return { data, error };
}

export async function updatePart(code, updates) {
  const userId = await uid();
  const { data: oldData } = await supabase.from('spare_parts').select('*').eq('code', code).single();
  const { data, error } = await supabase
    .from('spare_parts').update({ ...updates, updated_by: userId })
    .eq('code', code).select('*').single();
  if (!error) await audit('UPDATE', 'spare_parts', code, oldData, updates);
  return { data, error };
}

export async function softDeletePart(code) {
  const userId = await uid();
  const { data, error } = await supabase
    .from('spare_parts').update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('code', code).select().single();
  if (!error) await audit('DELETE', 'spare_parts', code, data, null);
  return { data, error };
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
  supabase.from('user_profiles').select('*').eq('id', userId).single();

export const fetchAllUsers = () =>
  supabase.from('user_profiles').select('*').order('full_name');

export const upsertUserProfile = (profile) =>
  supabase.from('user_profiles').upsert(profile, { onConflict: 'id' });
