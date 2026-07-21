import { useState, useMemo, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { supabase } from './lib/supabase.js';
import * as db from './lib/db.js';

// ═══════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════

const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s ?? null);
      if (s) loadProfile(s.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
      if (s) loadProfile(s.user.id);
      else setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    const { data } = await db.fetchUserProfile(userId);
    setProfile(data);
  };

  const signIn = async (email, password) => {
    const res = await supabase.auth.signInWithPassword({ email, password });
    if (!res.error) {
      await supabase.from('audit_logs').insert({
        action: 'LOGIN', table_name: 'auth', record_id: res.data.user.id,
        new_values: { email }, user_id: res.data.user.id,
      }).then(() => {});
    }
    return res;
  };

  const signOut = async () => {
    if (session) {
      await supabase.from('audit_logs').insert({
        action: 'LOGOUT', table_name: 'auth', record_id: session.user.id, user_id: session.user.id,
      }).then(() => {});
    }
    await supabase.auth.signOut();
  };

  const isAdmin    = profile?.role === 'admin';
  const isDeptUser = profile?.role === 'department_user';
  const canEdit    = isAdmin || isDeptUser;

  return (
    <AuthContext.Provider value={{ session, profile, isAdmin, isDeptUser, canEdit, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════
// LOGIN PAGE
// ═══════════════════════════════════════════════════════════════

function LoginPage() {
  const { signIn } = useAuth();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Enter email and password.'); return; }
    setLoading(true); setError('');
    const { error: err } = await signIn(email, password);
    if (err) setError(err.message);
    setLoading(false);
  };

  return (
    <div style={{
      minHeight:'100vh', background:'#0c1526', display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:"'Inter','Segoe UI',system-ui,sans-serif", position:'relative', overflow:'hidden',
    }}>
      {/* Background logo watermark */}
      <img
        src="/logo.png"
        alt=""
        style={{
          position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          width:'640px', maxWidth:'80vw', opacity:0.06, filter:'grayscale(1) brightness(2)',
          pointerEvents:'none', userSelect:'none',
        }}
      />
      <div style={{ background:'#0f172a', border:'1px solid #1e2d45', borderRadius:12, padding:40, width:380, boxShadow:'0 20px 60px rgba(0,0,0,0.5)', position:'relative', zIndex:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:32 }}>
          <img src="/logo.png" alt="CarGas" style={{ width:40, height:40, objectFit:'contain', flexShrink:0 }}/>
          <div>
            <div style={{ color:'#f1f5f9', fontWeight:800, fontSize:14 }}>CarGas Coding System</div>
            <div style={{ color:'#475569', fontSize:11 }}>Engineering Master Data</div>
          </div>
        </div>
        <div style={{ color:'#94a3b8', fontSize:13, marginBottom:24 }}>Sign in to your account</div>
        {error && (
          <div style={{ background:'#fee2e2', color:'#dc2626', border:'1px solid #fca5a5', borderRadius:6, padding:'10px 14px', fontSize:13, marginBottom:16, fontWeight:600 }}>
            ⚠️ {error}
          </div>
        )}
        <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', marginBottom:6, textTransform:'uppercase', letterSpacing:0.8 }}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email"
              style={{ width:'100%', padding:'10px 14px', borderRadius:6, border:'1px solid #1e2d45', fontSize:14, color:'#f1f5f9', background:'#0c1526', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}/>
          </div>
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#64748b', marginBottom:6, textTransform:'uppercase', letterSpacing:0.8 }}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password"
              style={{ width:'100%', padding:'10px 14px', borderRadius:6, border:'1px solid #1e2d45', fontSize:14, color:'#f1f5f9', background:'#0c1526', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}/>
          </div>
          <button type="submit" disabled={loading}
            style={{ padding:'11px', background:'#2563eb', color:'#fff', border:'none', borderRadius:6, fontWeight:700, fontSize:14, cursor:loading?'not-allowed':'pointer', opacity:loading?0.7:1, marginTop:6, fontFamily:'inherit' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DATA MAPPERS — convert Supabase row → app shape
// ═══════════════════════════════════════════════════════════════

const mapCat   = r => ({ code:r.code, label:r.label, icon:r.icon, color:r.color, bg:r.bg });
const mapMfr   = r => ({ code:r.code, label:r.label, catCodes:r.cat_codes??[] });
const mapModel = r => ({ code:r.code, label:r.label, mfrCode:r.mfr_code });
const mapDisc  = r => ({ code:r.code, label:r.label, desc:r.description??r.desc??'', color:r.color, bg:r.bg });
const mapEng   = r => ({ code:r.code, label:r.label, color:r.color, bg:r.bg });
const mapFg    = r => ({ code:r.code, label:r.label, disc:r.disc });
const mapPart  = r => ({
  code:r.code, shortDesc:r.short_desc, longDesc:r.long_desc,
  cat:r.cat, mfr:r.mfr, model:r.model, disc:r.disc, fg:r.fg,
  partNo:r.part_no??'', oemPart:r.oem_part??'', qty:r.qty??0, unit:r.unit??'EA',
  loc:r.location??'', minStock:r.min_stock??0, maxStock:r.max_stock??0,
  remarks:r.remarks??'', status:r.status??'Active',
  imageUrl:r.image_url??null, datasheetUrl:r.datasheet_url??null,
});

// ═══════════════════════════════════════════════════════════════
// useDb — loads all master data from Supabase on mount.
// Falls back gracefully to INIT_* constants when not configured.
// All mutating operations write to Supabase first, then refresh
// the relevant slice from the DB so state always matches reality.
// ═══════════════════════════════════════════════════════════════

function useDb(initData) {
  const [state,   setState]   = useState(initData);
  const [loading, setLoading] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const dbReadyRef = useRef(false);

  // ── initial load ──────────────────────────────────────────────
  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('your-project')) { dbReadyRef.current = false; setDbReady(false); return; }
    dbReadyRef.current = true;
    setDbReady(true);
    setLoading(true);
    // Load only master data — parts loaded on-demand with pagination in MasterTablePage
    Promise.all([
      db.fetchCategories(), db.fetchManufacturers(), db.fetchModels(),
      db.fetchDisciplines(), db.fetchEngineSystems(), db.fetchFuncGroups(),
    ]).then(([cats, mfrs, mdls, discs, engs, fgs]) => {
      setState(prev => ({
        ...prev,
        categories:    cats.data?.map(mapCat)   ?? prev.categories,
        manufacturers: mfrs.data?.map(mapMfr)   ?? prev.manufacturers,
        models:        mdls.data?.map(mapModel)  ?? prev.models,
        disciplines:   discs.data?.map(mapDisc)  ?? prev.disciplines,
        engineSystems: engs.data?.map(mapEng)    ?? prev.engineSystems,
        funcGroups:    fgs.data?.map(mapFg)      ?? prev.funcGroups,
        parts:         [],  // empty — MasterTablePage fetches its own pages
      }));
    }).finally(() => setLoading(false));
  }, []);

  // ── helpers: reload a single slice from DB ────────────────────
  const reload = useCallback(async (key, fetchFn, mapFn) => {
    if (!dbReadyRef.current) return;
    const { data } = await fetchFn();
    if (data) setState(prev => ({ ...prev, [key]: data.map(mapFn) }));
  }, []);

  // ── Supabase-aware setters ────────────────────────────────────
  // Each setter:
  //   • In DB mode  → writes to Supabase, then reloads slice from DB
  //   • In local mode → updates React state only (no Supabase)
  const makeEntitySetters = useCallback(() => ({

    // CATEGORIES
    saveCategory: async (row, editingCode) => {
      if (!dbReadyRef.current) {
        setState(prev => {
          const list = editingCode
            ? prev.categories.map(c => c.code === editingCode ? {...row} : c)
            : [...prev.categories, row];
          return { ...prev, categories: list };
        });
        return { error: null };
      }
      const dbRow = { code:row.code, label:row.label, icon:row.icon, color:row.color, bg:row.bg };
      const res = editingCode
        ? await db.updateCategory(editingCode, dbRow)
        : await db.insertCategory(dbRow);
      if (!res.error) await reload('categories', db.fetchCategories, mapCat);
      return res;
    },
    deleteCategory: async (code) => {
      if (!dbReadyRef.current) {
        setState(prev => ({ ...prev, categories: prev.categories.filter(c => c.code !== code) }));
        return { error: null };
      }
      const res = await db.softDeleteCategory(code);
      if (!res.error) await reload('categories', db.fetchCategories, mapCat);
      return res;
    },

    // MANUFACTURERS
    saveManufacturer: async (row, editingCode) => {
      if (!dbReadyRef.current) {
        setState(prev => {
          const list = editingCode
            ? prev.manufacturers.map(m => m.code === editingCode ? {...row} : m)
            : [...prev.manufacturers, row];
          return { ...prev, manufacturers: list };
        });
        return { error: null };
      }
      const dbRow = { code:row.code, label:row.label, cat_codes:row.catCodes??[] };
      const res = editingCode
        ? await db.updateManufacturer(editingCode, dbRow)
        : await db.insertManufacturer(dbRow);
      if (!res.error) await reload('manufacturers', db.fetchManufacturers, mapMfr);
      return res;
    },
    deleteManufacturer: async (code) => {
      if (!dbReadyRef.current) {
        setState(prev => ({ ...prev, manufacturers: prev.manufacturers.filter(m => m.code !== code) }));
        return { error: null };
      }
      const res = await db.softDeleteManufacturer(code);
      if (!res.error) await reload('manufacturers', db.fetchManufacturers, mapMfr);
      return res;
    },

    // MODELS
    saveModel: async (row, editingCode) => {
      if (!dbReadyRef.current) {
        setState(prev => {
          const list = editingCode
            ? prev.models.map(m => m.code === editingCode ? {...row} : m)
            : [...prev.models, row];
          return { ...prev, models: list };
        });
        return { error: null };
      }
      const dbRow = { code:row.code, label:row.label, mfr_code:row.mfrCode };
      const res = editingCode
        ? await db.updateModel(editingCode, dbRow)
        : await db.insertModel(dbRow);
      if (!res.error) await reload('models', db.fetchModels, mapModel);
      return res;
    },
    deleteModel: async (code) => {
      if (!dbReadyRef.current) {
        setState(prev => ({ ...prev, models: prev.models.filter(m => m.code !== code) }));
        return { error: null };
      }
      const res = await db.softDeleteModel(code);
      if (!res.error) await reload('models', db.fetchModels, mapModel);
      return res;
    },

    // DISCIPLINES
    saveDiscipline: async (row, editingCode) => {
      if (!dbReadyRef.current) {
        setState(prev => {
          const list = editingCode
            ? prev.disciplines.map(d => d.code === editingCode ? {...row} : d)
            : [...prev.disciplines, row];
          return { ...prev, disciplines: list };
        });
        return { error: null };
      }
      const dbRow = { code:row.code, label:row.label, description:row.desc??'', color:row.color, bg:row.bg };
      const res = editingCode
        ? await db.updateDiscipline(editingCode, dbRow)
        : await db.insertDiscipline(dbRow);
      if (!res.error) await reload('disciplines', db.fetchDisciplines, mapDisc);
      return res;
    },
    deleteDiscipline: async (code) => {
      if (!dbReadyRef.current) {
        setState(prev => ({ ...prev, disciplines: prev.disciplines.filter(d => d.code !== code) }));
        return { error: null };
      }
      const res = await db.softDeleteDiscipline(code);
      if (!res.error) await reload('disciplines', db.fetchDisciplines, mapDisc);
      return res;
    },

    // ENGINE SYSTEMS
    saveEngineSystem: async (row, editingCode) => {
      if (!dbReadyRef.current) {
        setState(prev => {
          const list = editingCode
            ? prev.engineSystems.map(s => s.code === editingCode ? {...row} : s)
            : [...prev.engineSystems, row];
          return { ...prev, engineSystems: list };
        });
        return { error: null };
      }
      const dbRow = { code:row.code, label:row.label, color:row.color, bg:row.bg };
      const res = editingCode
        ? await db.updateEngineSystem(editingCode, dbRow)
        : await db.insertEngineSystem(dbRow);
      if (!res.error) await reload('engineSystems', db.fetchEngineSystems, mapEng);
      return res;
    },
    deleteEngineSystem: async (code) => {
      if (!dbReadyRef.current) {
        setState(prev => ({ ...prev, engineSystems: prev.engineSystems.filter(s => s.code !== code) }));
        return { error: null };
      }
      const res = await db.softDeleteEngineSystem(code);
      if (!res.error) await reload('engineSystems', db.fetchEngineSystems, mapEng);
      return res;
    },

    // FUNCTIONAL GROUPS
    saveFuncGroup: async (row, editingCode) => {
      if (!dbReadyRef.current) {
        setState(prev => {
          const list = editingCode
            ? prev.funcGroups.map(f => f.code === editingCode ? {...row} : f)
            : [...prev.funcGroups, row];
          return { ...prev, funcGroups: list };
        });
        return { error: null };
      }
      const dbRow = { code:row.code, label:row.label, disc:row.disc };
      const res = editingCode
        ? await db.updateFuncGroup(editingCode, dbRow)
        : await db.insertFuncGroup(dbRow);
      if (!res.error) await reload('funcGroups', db.fetchFuncGroups, mapFg);
      return res;
    },
    deleteFuncGroup: async (code) => {
      if (!dbReadyRef.current) {
        setState(prev => ({ ...prev, funcGroups: prev.funcGroups.filter(f => f.code !== code) }));
        return { error: null };
      }
      const res = await db.softDeleteFuncGroup(code);
      if (!res.error) await reload('funcGroups', db.fetchFuncGroups, mapFg);
      return res;
    },

    // SPARE PARTS
    // NOTE: parts are NOT kept in global state when dbReady (too many rows).
    // MasterTablePage and CodeGeneratorPage fetch/paginate directly via db.js.
    savePart: async (row, editingCode) => {
      if (!dbReadyRef.current) {
        setState(prev => {
          const list = editingCode
            ? prev.parts.map(p => p.code === editingCode ? {...row} : p)
            : [...prev.parts, row];
          return { ...prev, parts: list };
        });
        return { error: null };
      }
      const dbRow = {
        code:row.code, short_desc:row.shortDesc, long_desc:row.longDesc,
        cat:row.cat, mfr:row.mfr, model:row.model, disc:row.disc, fg:row.fg,
        part_no:row.partNo, oem_part:row.oemPart, qty:row.qty, unit:row.unit,
        location:row.loc, min_stock:row.minStock, max_stock:row.maxStock,
        remarks:row.remarks, status:row.status,
        image_url:row.imageUrl??null, datasheet_url:row.datasheetUrl??null,
      };
      const res = editingCode
        ? await db.updatePart(editingCode, dbRow)
        : await db.insertPart(dbRow);
      // No global reload — caller (MasterTablePage) refreshes its own page
      return res;
    },
    deletePart: async (code) => {
      if (!dbReadyRef.current) {
        setState(prev => ({ ...prev, parts: prev.parts.filter(p => p.code !== code) }));
        return { error: null };
      }
      const res = await db.softDeletePart(code);
      // No global reload — caller removes the row from its own local list
      return res;
    },

  }), [reload]);

  const ops = useMemo(() => makeEntitySetters(), [makeEntitySetters]);

  return { state, setState, loading, dbReady, ops };
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG PAGE (admin only)
// ═══════════════════════════════════════════════════════════════

function AuditLogPage() {
  const [logs,         setLogs]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [filterTable,  setFilterTable]  = useState('');

  useEffect(() => {
    setLoading(true);
    db.fetchAuditLogs({ limit:200, action:filterAction||undefined, tableName:filterTable||undefined })
      .then(({ data }) => { setLogs(data ?? []); setLoading(false); });
  }, [filterAction, filterTable]);

  const AC = { CREATE:'#047857', UPDATE:'#b45309', DELETE:'#dc2626', LOGIN:'#1d4ed8', LOGOUT:'#6d28d9', UPLOAD:'#0e7490', EXPORT:'#374151' };
  const AB = { CREATE:'#d1fae5', UPDATE:'#fef3c7', DELETE:'#fee2e2', LOGIN:'#dbeafe', LOGOUT:'#f5f3ff', UPLOAD:'#cffafe', EXPORT:'#f3f4f6' };

  return (
    <div>
      <PageHeader title="Audit Log" sub="Complete record of every system action — admin only"/>
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
          <Select value={filterAction} onChange={e=>setFilterAction(e.target.value)} style={{ width:'auto', minWidth:160 }}>
            <option value="">All Actions</option>
            {['CREATE','UPDATE','DELETE','LOGIN','LOGOUT','UPLOAD','EXPORT'].map(a=><option key={a}>{a}</option>)}
          </Select>
          <Select value={filterTable} onChange={e=>setFilterTable(e.target.value)} style={{ width:'auto', minWidth:180 }}>
            <option value="">All Tables</option>
            {['spare_parts','categories','manufacturers','models','disciplines','engine_systems','functional_groups','auth','storage'].map(t=><option key={t}>{t}</option>)}
          </Select>
          <span style={{ fontSize:13, color:T.muted }}>{logs.length} entries</span>
        </div>
      </Card>
      <Card>
        {loading
          ? <div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading audit log…</div>
          : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:T.header }}>
                  {['Timestamp','User','Action','Table','Record','Details'].map(h=>(
                    <th key={h} style={{ padding:'9px 12px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:10, letterSpacing:0.8, whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0
                  ? <tr><td colSpan={6} style={{ textAlign:'center', padding:36, color:T.muted }}>No audit entries yet.</td></tr>
                  : logs.map((log, i) => (
                  <tr key={log.id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                    <td style={{ padding:'8px 12px', color:T.muted, whiteSpace:'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                    <td style={{ padding:'8px 12px', color:T.text, fontSize:12 }}>{log.user?.email ?? log.user_id?.slice(0,8) ?? '—'}</td>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ background:AB[log.action]??T.subtle, color:AC[log.action]??T.muted, fontWeight:700, fontSize:11, padding:'2px 8px', borderRadius:4 }}>{log.action}</span>
                    </td>
                    <td style={{ padding:'8px 12px', fontFamily:'monospace', color:T.muted, fontSize:11 }}>{log.table_name}</td>
                    <td style={{ padding:'8px 12px', fontFamily:'monospace', fontWeight:700, color:T.text, fontSize:12 }}>{log.record_id}</td>
                    <td style={{ padding:'8px 12px', color:T.muted, maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11 }}>
                      {log.new_values ? JSON.stringify(log.new_values).slice(0,80) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USERS PAGE (admin only)
// ═══════════════════════════════════════════════════════════════

function UsersPage() {
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form,      setForm]      = useState({ email:'', full_name:'', role:'department_user', department:'' });
  const [toast,     setToast]     = useState(null);

  const flash = (t, type='ok') => { setToast({text:t,type}); setTimeout(()=>setToast(null),3200); };
  const reload = () => db.fetchAllUsers().then(({ data }) => setUsers(data??[]));

  useEffect(() => { reload().finally(()=>setLoading(false)); }, []);

  const handleInvite = async () => {
    if (!form.email || !form.full_name) return flash('Email and name required','err');
    const { error } = await supabase.auth.signInWithOtp({ email: form.email, options: { emailRedirectTo: window.location.origin } });
    if (error) return flash(error.message,'err');
    await db.upsertUserProfile({ email:form.email, full_name:form.full_name, role:form.role, department:form.department });
    flash(`Invitation sent to ${form.email}`);
    setShowModal(false);
    reload();
  };

  const handleRoleChange = async (userId, newRole) => {
    await db.upsertUserProfile({ id:userId, role:newRole });
    flash(`Role updated to ${newRole}`);
    reload();
  };

  const RC = { admin:'#1d4ed8', department_user:'#047857' };
  const RB = { admin:'#dbeafe', department_user:'#d1fae5' };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="User Management" sub="Manage system users and role assignments — admin only"/>
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <Btn onClick={()=>setShowModal(true)}>＋ Invite User</Btn>
        </div>
      </Card>
      <Card>
        {loading ? <div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading users…</div> : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:T.header }}>
                {['Name','Email','Role','Department','Change Role'].map(h=>(
                  <th key={h} style={{ padding:'9px 12px', textAlign:'left', fontWeight:700, color:'#94a3b8', fontSize:10, textTransform:'uppercase', letterSpacing:0.8 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length===0
                ? <tr><td colSpan={5} style={{ textAlign:'center', padding:36, color:T.muted }}>No users yet.</td></tr>
                : users.map((u,i)=>(
                <tr key={u.id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                  <td style={{ padding:'8px 12px', fontWeight:600, color:T.text }}>{u.full_name||'—'}</td>
                  <td style={{ padding:'8px 12px', color:T.muted }}>{u.email}</td>
                  <td style={{ padding:'8px 12px' }}>
                    <span style={{ background:RB[u.role]??T.subtle, color:RC[u.role]??T.muted, fontWeight:700, fontSize:11, padding:'2px 8px', borderRadius:4 }}>{u.role}</span>
                  </td>
                  <td style={{ padding:'8px 12px', color:T.muted }}>{u.department||'—'}</td>
                  <td style={{ padding:'8px 12px' }}>
                    <select value={u.role||'department_user'} onChange={e=>handleRoleChange(u.id, e.target.value)}
                      style={{ padding:'4px 8px', borderRadius:4, border:`1px solid ${T.border}`, fontSize:12, fontFamily:'inherit', color:T.text }}>
                      <option value="admin">Admin</option>
                      <option value="department_user">Department User</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {showModal && (
        <Modal title="Invite New User" onClose={()=>setShowModal(false)}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {[{key:'full_name',label:'Full Name',ph:'e.g. Ahmed Hassan'},{key:'email',label:'Email',ph:'user@company.com'},{key:'department',label:'Department',ph:'e.g. Maintenance'}].map(f=>(
              <div key={f.key}>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:T.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:0.8 }}>{f.label}</label>
                <Input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph}/>
              </div>
            ))}
            <div>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:T.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:0.8 }}>Role</label>
              <Select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
                <option value="department_user">Department User</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            <div style={{ background:'#fffbeb', borderRadius:6, padding:10, fontSize:12, color:'#b45309' }}>📧 A magic-link invitation email will be sent.</div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <Btn variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Btn>
              <Btn onClick={handleInvite}>Send Invitation</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FILE UPLOAD COMPONENT
// ═══════════════════════════════════════════════════════════════

function FileUpload({ partCode, bucket, label, currentUrl, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [err,       setErr]       = useState('');

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setErr('File too large — max 10 MB'); return; }
    setErr(''); setUploading(true);
    const { url, error } = await db.uploadFile(bucket, partCode, file);
    setUploading(false);
    if (error) { setErr(error.message); return; }
    onUploaded(url);
  };

  return (
    <div>
      <label style={{ display:'block', fontSize:11, fontWeight:700, color:T.muted, marginBottom:6, textTransform:'uppercase', letterSpacing:0.8 }}>{label}</label>
      {currentUrl && (
        <div style={{ marginBottom:8 }}>
          {bucket==='part-images'
            ? <img src={currentUrl} alt="part" style={{ height:56, borderRadius:5, border:`1px solid ${T.border}`, objectFit:'cover' }}/>
            : <a href={currentUrl} target="_blank" rel="noreferrer" style={{ color:T.accent, fontSize:12 }}>📎 View file</a>
          }
        </div>
      )}
      <input type="file" onChange={handleFile} disabled={uploading}
        accept={bucket==='part-images' ? 'image/jpeg,image/png,image/webp' : 'application/pdf'}
        style={{ fontSize:12, color:T.muted }}/>
      {uploading && <div style={{ fontSize:12, color:T.accent, marginTop:4 }}>⏳ Uploading…</div>}
      {err       && <div style={{ fontSize:12, color:T.danger, marginTop:4 }}>⚠️ {err}</div>}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════

const INIT_CATEGORIES = [
  { code: "CP", label: "Compressors",        icon: "⚙️",  color: "#1d4ed8", bg: "#dbeafe" },
  { code: "EN", label: "Engines",             icon: "🔧", color: "#b45309", bg: "#fef3c7" },
  { code: "ST", label: "Storage",             icon: "🗄️", color: "#047857", bg: "#d1fae5" },
  { code: "DI", label: "Dispensers",          icon: "⛽", color: "#7c3aed", bg: "#ede9fe" },
  { code: "IN", label: "Instrumentation",     icon: "📡", color: "#be123c", bg: "#ffe4e6" },
  { code: "LC", label: "Lubricants & Coolants",icon: "🛢️",color: "#0e7490", bg: "#cffafe" },
  { code: "TL", label: "Tools",               icon: "🔩", color: "#6d28d9", bg: "#f5f3ff" },
  { code: "OT", label: "Others",              icon: "📦", color: "#374151", bg: "#f3f4f6" },
];

const INIT_MANUFACTURERS = [
  { code: "GA", label: "Galileo",     catCodes: ["CP"] },
  { code: "CU", label: "Cubogas",     catCodes: ["CP"] },
  { code: "KW", label: "Kwangshin",   catCodes: ["CP"] },
  { code: "IM", label: "IMW",         catCodes: ["CP"] },
  { code: "FN", label: "Fornovo",     catCodes: ["CP"] },
  { code: "AN", label: "ANGI",        catCodes: ["CP"] },
  { code: "SF", label: "SAFE",        catCodes: ["CP"] },
  { code: "CA", label: "Caterpillar", catCodes: ["EN"] },
  { code: "WK", label: "Waukesha",    catCodes: ["EN"] },
];

const INIT_MODELS = [
  // ANGI Compressors
  { code: "A34", label: "Model 3406",     mfrCode: "AN" },
  { code: "A38", label: "Model 3408",     mfrCode: "AN" },
  { code: "A33", label: "Model 3306",     mfrCode: "AN" },
  // Fornovo Compressors
  { code: "F03", label: "3 Bar Suction",  mfrCode: "FN" },
  { code: "F30", label: "30 Bar Suction", mfrCode: "FN" },
  // Galileo Compressors
  { code: "G01", label: "Model G01",      mfrCode: "GA" },
  { code: "G02", label: "Model G02",      mfrCode: "GA" },
  { code: "G03", label: "Model G03",      mfrCode: "GA" },
  // Kwangshin Compressors
  { code: "K01", label: "HG-5",           mfrCode: "KW" },
  { code: "K02", label: "HG-7",           mfrCode: "KW" },
  // Caterpillar Engines
  { code: "CA01", label: "3306 NA",             mfrCode: "CA" },
  { code: "CA02", label: "3306 TA",             mfrCode: "CA" },
  { code: "CA03", label: "3406 NA",             mfrCode: "CA" },
  { code: "CA04", label: "3406 TA",             mfrCode: "CA" },
  { code: "CA05", label: "3406 N90 (Standard)", mfrCode: "CA" },
  { code: "CA06", label: "3408",                mfrCode: "CA" },
  // Waukesha Engines
  { code: "W01", label: "VHP F18",  mfrCode: "WK" },
  { code: "W02", label: "VHP L36",  mfrCode: "WK" },
  { code: "W03", label: "VHP F35",  mfrCode: "WK" },
  { code: "W04", label: "AT25GL",   mfrCode: "WK" },
  { code: "W05", label: "AT27GL",   mfrCode: "WK" },
];

// Engine-specific system sections (DD level for Engines only)
// These replace the standard ME/EL/AC disciplines for the EN category
const ENGINE_SYSTEMS = [
  { code: "BAS", label: "Basic Engine",                   color: "#1d4ed8", bg: "#dbeafe" },
  { code: "LUB", label: "Lubrication System",             color: "#b45309", bg: "#fef3c7" },
  { code: "COL", label: "Cooling System",                 color: "#047857", bg: "#d1fae5" },
  { code: "AIR", label: "Air Inlet and Exhaust System",   color: "#7c3aed", bg: "#ede9fe" },
  { code: "FUE", label: "Fuel System",                    color: "#be123c", bg: "#ffe4e6" },
  { code: "ELS", label: "Electrical and Starting System", color: "#0e7490", bg: "#cffafe" },
  { code: "OPS", label: "Operator Station",               color: "#374151", bg: "#f3f4f6" },
  { code: "ENC", label: "Enclosures, Guards and Bases",   color: "#6d28d9", bg: "#f5f3ff" },
  { code: "GEN", label: "Generators",                     color: "#15803d", bg: "#dcfce7" },
  { code: "SRV", label: "Service Equipment and Supplies", color: "#9f1239", bg: "#ffe4e6" },
];

const INIT_DISCIPLINES = [
  { code: "ME", label: "Mechanical",        desc: "Rotating & static mechanical components",         color: "#1d4ed8", bg: "#dbeafe" },
  { code: "EL", label: "Electrical",        desc: "Electrical & electronic components",               color: "#b45309", bg: "#fef3c7" },
  { code: "AC", label: "Auxiliary Circuits",desc: "P&ID, instrumentation, fluid & auxiliary systems", color: "#047857", bg: "#d1fae5" },
];

const INIT_FUNC_GROUPS = [
  // Mechanical
  { code: "BRG", label: "Bearing",         disc: "ME" },
  { code: "SEA", label: "Seal",            disc: "ME" },
  { code: "GSK", label: "Gasket",          disc: "ME" },
  { code: "FIL", label: "Filter",          disc: "ME" },
  { code: "VAL", label: "Valve",           disc: "ME" },
  { code: "PST", label: "Piston",          disc: "ME" },
  { code: "RNG", label: "Ring",            disc: "ME" },
  { code: "CPL", label: "Coupling",        disc: "ME" },
  { code: "SHA", label: "Shaft",           disc: "ME" },
  { code: "CYL", label: "Cylinder",        disc: "ME" },
  { code: "BLK", label: "Block",           disc: "ME" },
  { code: "FAN", label: "Fan",             disc: "ME" },
  { code: "PUL", label: "Pulley",          disc: "ME" },
  { code: "ROD", label: "Connecting Rod",  disc: "ME" },
  { code: "CRK", label: "Crankshaft",      disc: "ME" },
  // Electrical
  { code: "STR", label: "Starter",              disc: "EL" },
  { code: "ALT", label: "Alternator",           disc: "EL" },
  { code: "MOT", label: "Motor",                disc: "EL" },
  { code: "PCB", label: "PCB",                  disc: "EL" },
  { code: "SEN", label: "Sensor",               disc: "EL" },
  { code: "SWI", label: "Switch",               disc: "EL" },
  { code: "REL", label: "Relay",                disc: "EL" },
  { code: "SOL", label: "Solenoid",             disc: "EL" },
  { code: "CAB", label: "Cable",                disc: "EL" },
  { code: "BAT", label: "Battery",              disc: "EL" },
  { code: "ECU", label: "ECU",                  disc: "EL" },
  { code: "VFD", label: "Variable Frequency Drive", disc: "EL" },
  { code: "PSU", label: "Power Supply",         disc: "EL" },
  // Auxiliary Circuits
  { code: "PGA", label: "Pressure Gauge",       disc: "AC" },
  { code: "PTS", label: "Pressure Switch",      disc: "AC" },
  { code: "PTT", label: "Pressure Transmitter", disc: "AC" },
  { code: "TGA", label: "Temperature Gauge",    disc: "AC" },
  { code: "TTS", label: "Temperature Switch",   disc: "AC" },
  { code: "TTT", label: "Temperature Transmitter", disc: "AC" },
  { code: "LGA", label: "Level Gauge",          disc: "AC" },
  { code: "FLM", label: "Flow Meter",           disc: "AC" },
  { code: "PRV", label: "Pressure Relief Valve",disc: "AC" },
  { code: "SOV", label: "Solenoid Valve",       disc: "AC" },
  { code: "HOS", label: "Hose",                 disc: "AC" },
  { code: "FIT", label: "Fitting",              disc: "AC" },
  { code: "OIL", label: "Lubricant",            disc: "AC" },
  { code: "COL", label: "Coolant",              disc: "AC" },
  { code: "SEP", label: "Separator",            disc: "AC" },
  { code: "DRY", label: "Dryer",                disc: "AC" },
  { code: "FLT", label: "Filter Element",       disc: "AC" },
];

const INIT_PARTS = [
  { code:"CP-AN-A34-ME-BRG-0001", shortDesc:"ANGI 3406 Bearing",         longDesc:"Bearing for ANGI Compressor Model 3406",                    cat:"CP",mfr:"AN",model:"A34",disc:"ME",fg:"BRG",partNo:"AN-BRG-001",oemPart:"1234567",qty:4, unit:"EA",loc:"WH-A1",minStock:2,maxStock:10,remarks:"Critical",       status:"Active" },
  { code:"CP-AN-A34-ME-SEA-0001", shortDesc:"ANGI 3406 Seal Kit",         longDesc:"Shaft Seal Kit for ANGI Compressor Model 3406",             cat:"CP",mfr:"AN",model:"A34",disc:"ME",fg:"SEA",partNo:"AN-SK-020",oemPart:"2345678",qty:6, unit:"KIT",loc:"WH-A1",minStock:2,maxStock:8, remarks:"",              status:"Active" },
  { code:"CP-AN-A34-ME-GSK-0001", shortDesc:"ANGI 3406 Head Gasket",      longDesc:"Cylinder Head Gasket for ANGI Model 3406",                  cat:"CP",mfr:"AN",model:"A34",disc:"ME",fg:"GSK",partNo:"AN-HG-034",oemPart:"3456789",qty:3, unit:"EA",loc:"WH-A1",minStock:1,maxStock:6, remarks:"",              status:"Active" },
  { code:"CP-AN-A34-ME-FIL-0001", shortDesc:"ANGI 3406 Oil Filter",       longDesc:"Lube Oil Filter for ANGI Compressor Model 3406",            cat:"CP",mfr:"AN",model:"A34",disc:"ME",fg:"FIL",partNo:"AN-OF-100",oemPart:"4567890",qty:12,unit:"EA",loc:"WH-B1",minStock:4,maxStock:20,remarks:"500hr interval", status:"Active" },
  { code:"CP-AN-A34-EL-STR-0001", shortDesc:"ANGI 3406 Starter",          longDesc:"Electric Starter Motor for ANGI Model 3406",               cat:"CP",mfr:"AN",model:"A34",disc:"EL",fg:"STR",partNo:"AN-ST-001",oemPart:"5678901",qty:1, unit:"EA",loc:"WH-C1",minStock:1,maxStock:2, remarks:"24V DC",         status:"Active" },
  { code:"CP-AN-A34-AC-PGA-0001", shortDesc:"ANGI 3406 Pressure Gauge",   longDesc:"Discharge Pressure Gauge for ANGI Model 3406 0-400bar",    cat:"CP",mfr:"AN",model:"A34",disc:"AC",fg:"PGA",partNo:"AN-PG-400",oemPart:"6789012",qty:3, unit:"EA",loc:"WH-D1",minStock:1,maxStock:6, remarks:"0-400 bar",      status:"Active" },
  { code:"CP-GA-G01-ME-BRG-0001", shortDesc:"Galileo G01 Bearing",        longDesc:"Main Shaft Bearing for Galileo Compressor G01",            cat:"CP",mfr:"GA",model:"G01",disc:"ME",fg:"BRG",partNo:"GA-BRG-210",oemPart:"7890123",qty:4, unit:"EA",loc:"WH-A2",minStock:2,maxStock:8, remarks:"",              status:"Active" },
  { code:"CP-GA-G01-ME-SEA-0001", shortDesc:"Galileo G01 Seal",           longDesc:"Piston Seal for Galileo G01 Compressor",                   cat:"CP",mfr:"GA",model:"G01",disc:"ME",fg:"SEA",partNo:"GA-PS-011",oemPart:"8901234",qty:8, unit:"EA",loc:"WH-A2",minStock:2,maxStock:12,remarks:"",              status:"Active" },
  { code:"CP-FN-F30-AC-PRV-0001", shortDesc:"Fornovo 30bar Relief Valve", longDesc:"Safety Relief Valve for Fornovo 30 Bar Suction",           cat:"CP",mfr:"FN",model:"F30",disc:"AC",fg:"PRV",partNo:"FN-SRV-030",oemPart:"9012345",qty:2, unit:"EA",loc:"WH-D2",minStock:1,maxStock:4, remarks:"Annual cal",    status:"Active" },
  { code:"EN-CA-CA03-BAS-BRG-0001", shortDesc:"CAT 3406 NA Main Bearing",      longDesc:"Main Crankshaft Bearing for Caterpillar 3406 NA",          cat:"EN",mfr:"CA",model:"CA03",disc:"BAS",fg:"BRG",partNo:"CAT-BRG-3406",oemPart:"0123456",qty:4, unit:"EA",loc:"WH-A3",minStock:2,maxStock:8, remarks:"Critical",    status:"Active" },
  { code:"EN-CA-CA03-BAS-GSK-0001", shortDesc:"CAT 3406 NA Head Gasket",        longDesc:"Cylinder Head Gasket for Caterpillar 3406 NA",             cat:"EN",mfr:"CA",model:"CA03",disc:"BAS",fg:"GSK",partNo:"CAT-HG-3406",oemPart:"1234560",qty:2, unit:"EA",loc:"WH-A3",minStock:1,maxStock:4, remarks:"",            status:"Active" },
  { code:"EN-CA-CA03-LUB-FIL-0001", shortDesc:"CAT 3406 NA Oil Filter",         longDesc:"Engine Lube Oil Filter for Caterpillar 3406 NA",           cat:"EN",mfr:"CA",model:"CA03",disc:"LUB",fg:"FIL",partNo:"CAT-OF-3406",oemPart:"2345601",qty:10,unit:"EA",loc:"WH-B3",minStock:4,maxStock:20,remarks:"250hr change", status:"Active" },
  { code:"EN-CA-CA03-ELS-ALT-0001", shortDesc:"CAT 3406 NA Alternator",         longDesc:"24V Alternator Assembly for Caterpillar 3406 NA",          cat:"EN",mfr:"CA",model:"CA03",disc:"ELS",fg:"ALT",partNo:"CAT-AL-3406",oemPart:"3456012",qty:1, unit:"EA",loc:"WH-C2",minStock:1,maxStock:2, remarks:"24V",         status:"Active" },
  { code:"EN-CA-CA03-FUE-FIL-0001", shortDesc:"CAT 3406 NA Fuel Filter",        longDesc:"Primary Fuel Filter for Caterpillar 3406 NA",              cat:"EN",mfr:"CA",model:"CA03",disc:"FUE",fg:"FIL",partNo:"CAT-FF-3406",oemPart:"4560123",qty:8, unit:"EA",loc:"WH-B3",minStock:4,maxStock:16,remarks:"",            status:"Active" },
  { code:"EN-CA-CA05-BAS-BRG-0001", shortDesc:"CAT 3406 N90 Main Bearing",      longDesc:"Main Bearing Set for Caterpillar 3406 N90 Standard",       cat:"EN",mfr:"CA",model:"CA05",disc:"BAS",fg:"BRG",partNo:"CAT-BRG-N90",oemPart:"5601234",qty:4, unit:"EA",loc:"WH-A3",minStock:2,maxStock:8, remarks:"Critical",    status:"Active" },
  { code:"EN-WK-W01-BAS-BRG-0001",  shortDesc:"Waukesha VHP F18 Bearing",       longDesc:"Main Bearing Set for Waukesha VHP F18 Engine",             cat:"EN",mfr:"WK",model:"W01",disc:"BAS",fg:"BRG",partNo:"WK-BRG-F18",oemPart:"6012345",qty:3, unit:"SET",loc:"WH-A4",minStock:1,maxStock:6, remarks:"Critical",    status:"Active" },
  { code:"EN-WK-W01-LUB-GSK-0001",  shortDesc:"Waukesha F18 Oil Pan Gasket",    longDesc:"Oil Pan Gasket for Waukesha VHP F18 Lubrication System",   cat:"EN",mfr:"WK",model:"W01",disc:"LUB",fg:"GSK",partNo:"WK-GSK-F18",oemPart:"7012345",qty:2, unit:"EA",loc:"WH-A4",minStock:1,maxStock:4, remarks:"",            status:"Active" },
  { code:"EN-WK-W01-ELS-ECU-0001",  shortDesc:"Waukesha F18 ECU",               longDesc:"Engine Control Unit for Waukesha VHP F18",                 cat:"EN",mfr:"WK",model:"W01",disc:"ELS",fg:"ECU",partNo:"WK-ECU-F18",oemPart:"8012345",qty:1, unit:"EA",loc:"WH-C3",minStock:1,maxStock:2, remarks:"Critical",    status:"Active" },
  { code:"EN-WK-W01-FUE-FIL-0001",  shortDesc:"Waukesha F18 Fuel Filter",       longDesc:"Fuel Filter Element for Waukesha VHP F18 Fuel System",     cat:"EN",mfr:"WK",model:"W01",disc:"FUE",fg:"FIL",partNo:"WK-FF-F18",oemPart:"9012346",qty:6, unit:"EA",loc:"WH-B4",minStock:2,maxStock:12,remarks:"",            status:"Active" },
  { code:"LC-GA-G01-AC-OIL-0001", shortDesc:"Galileo Compressor Oil",     longDesc:"Synthetic Compressor Lubricant for Galileo Units 5L",       cat:"LC",mfr:"GA",model:"G01",disc:"AC",fg:"OIL",partNo:"GA-OIL-CMP",oemPart:"8012345",qty:50,unit:"L", loc:"WH-F1",minStock:20,maxStock:100,remarks:"ISO VG 100",  status:"Active" },
  { code:"CP-KW-K01-AC-PTT-0001", shortDesc:"Kwangshin HG-5 Pressure Tx", longDesc:"Discharge Pressure Transmitter for Kwangshin HG-5 4-20mA",cat:"CP",mfr:"KW",model:"K01",disc:"AC",fg:"PTT",partNo:"KW-PT-100",oemPart:"9012346",qty:2, unit:"EA",loc:"WH-D5",minStock:1,maxStock:4, remarks:"4-20mA",         status:"Active" },
];

// ═══════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════

const T = {
  sidebar: "#0c1526",
  sidebarBorder: "#1e2d45",
  sidebarActive: "#1a3460",
  sidebarHover: "#132039",
  accent: "#2563eb",
  accentLight: "#dbeafe",
  header: "#0f172a",
  border: "#e2e8f0",
  bg: "#f0f4f8",
  card: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  subtle: "#f8fafc",
  success: "#15803d",
  successBg: "#dcfce7",
  warn: "#b45309",
  warnBg: "#fef3c7",
  danger: "#dc2626",
  dangerBg: "#fee2e2",
  disc: { ME: { c:"#1d4ed8", b:"#dbeafe" }, EL: { c:"#b45309", b:"#fef3c7" }, AC: { c:"#047857", b:"#d1fae5" } },
};

// ═══════════════════════════════════════════════════════════════
// PRIMITIVE UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

const Pill = ({ children, color = T.accent, bg = T.accentLight, mono = true, size = 12 }) => (
  <span style={{ background: bg, color, fontWeight: 700, fontSize: size, padding: "2px 8px", borderRadius: 4, fontFamily: mono ? "monospace" : "inherit", letterSpacing: mono ? 0.8 : 0, whiteSpace: "nowrap" }}>
    {children}
  </span>
);

const CodeTag = ({ code }) => (
  <span style={{ background: T.header, color: "#38bdf8", fontWeight: 800, fontSize: 13, padding: "3px 10px", borderRadius: 5, fontFamily: "monospace", letterSpacing: 1.5, whiteSpace: "nowrap" }}>
    {code}
  </span>
);

const Card = ({ children, style, pad = 20 }) => (
  <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: pad, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", ...style }}>
    {children}
  </div>
);

const SectionHeader = ({ children, accent = T.accent }) => (
  <div style={{ borderLeft: `4px solid ${accent}`, paddingLeft: 12, marginBottom: 18 }}>
    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>{children}</h2>
  </div>
);

const PageHeader = ({ title, sub }) => (
  <div style={{ marginBottom: 24 }}>
    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: -0.5 }}>{title}</h1>
    {sub && <p style={{ margin: "4px 0 0", color: T.muted, fontSize: 13 }}>{sub}</p>}
  </div>
);

const Btn = ({ children, onClick, variant = "primary", small = false, style: s = {} }) => {
  const base = { border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontFamily: "inherit", transition: "opacity .15s", ...s };
  const size = small ? { padding: "5px 12px", fontSize: 12 } : { padding: "9px 18px", fontSize: 14 };
  const vars = {
    primary:  { background: T.accent,   color: "#fff" },
    secondary:{ background: T.subtle,   color: T.text, border: `1px solid ${T.border}` },
    danger:   { background: T.dangerBg, color: T.danger, border: `1px solid #fca5a5` },
    success:  { background: T.successBg,color: T.success },
    ghost:    { background: "transparent", color: T.muted },
  };
  return <button onClick={onClick} style={{ ...base, ...size, ...vars[variant] }}>{children}</button>;
};

const Input = ({ value, onChange, placeholder, style: s = {}, type = "text", maxLength }) => (
  <input type={type} value={value} onChange={onChange} placeholder={placeholder} maxLength={maxLength}
    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, background: "#fff", outline: "none", boxSizing: "border-box", fontFamily: "inherit", ...s }} />
);

const Select = ({ value, onChange, children, style: s = {} }) => (
  <select value={value} onChange={onChange}
    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, background: "#fff", outline: "none", boxSizing: "border-box", fontFamily: "inherit", ...s }}>
    {children}
  </select>
);

const Table = ({ cols, rows, emptyMsg = "No records found." }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: T.header }}>
          {cols.map(c => (
            <th key={c.key} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.8, whiteSpace: "nowrap" }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0
          ? <tr><td colSpan={cols.length} style={{ textAlign: "center", padding: 36, color: T.muted }}>{emptyMsg}</td></tr>
          : rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.border}`, background: i % 2 ? T.subtle : T.card }}>
              {cols.map(c => (
                <td key={c.key} style={{ padding: "8px 12px", ...c.style }}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))
        }
      </tbody>
    </table>
  </div>
);

const StatCard = ({ label, value, color = T.accent, icon }) => (
  <Card style={{ borderTop: `3px solid ${color}`, textAlign: "center" }}>
    <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
    <div style={{ fontSize: 30, fontWeight: 800, color }}>{value}</div>
    <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{label}</div>
  </Card>
);

const Toast = ({ msg }) => msg ? (
  <div style={{ position: "fixed", top: 20, right: 24, zIndex: 9999, background: msg.type === "ok" ? T.successBg : T.dangerBg, color: msg.type === "ok" ? T.success : T.danger, border: `1px solid ${msg.type === "ok" ? "#86efac" : "#fca5a5"}`, borderRadius: 8, padding: "12px 20px", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
    {msg.type === "ok" ? "✅" : "⚠️"} {msg.text}
  </div>
) : null;

const CodeLegend = ({ items }) => (
  <div style={{ marginTop: 32, background: "#f8fafc", border: `1px solid ${T.border}`, borderRadius: 8, padding: 16 }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>📖 Code Legend</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px" }}>
      {items.map(({ code, label }) => (
        <div key={code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700, color: T.accent, minWidth: 36 }}>{code}</span>
          <span style={{ color: T.muted }}>{label}</span>
        </div>
      ))}
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// CRUD MODAL
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// CRUD PAGE FACTORY
// ═══════════════════════════════════════════════════════════════

function CrudPage({ title, sub, items, setItems, fields, renderRow, emptyMsg, legendItems, newItemDefaults, validateFn }) {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(newItemDefaults);
  const [toast, setToast] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const flash = (text, type = "ok") => { setToast({ text, type }); setTimeout(() => setToast(null), 3000); };

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i => Object.values(i).some(v => String(v).toLowerCase().includes(q)));
  }, [items, search]);

  const openAdd = () => { setForm(newItemDefaults); setEditing(null); setShowModal(true); };
  const openEdit = (item) => { setForm({ ...item }); setEditing(item.code); setShowModal(true); };

  const handleSave = () => {
    const err = validateFn ? validateFn(form, items, editing) : null;
    if (err) return flash(err, "err");
    if (editing) {
      setItems(prev => prev.map(i => i.code === editing ? { ...form, code: form.code.toUpperCase() } : i));
      flash("Record updated successfully");
    } else {
      if (items.find(i => i.code === form.code.toUpperCase())) return flash("Code already exists", "err");
      setItems(prev => [...prev, { ...form, code: form.code.toUpperCase() }]);
      flash("Record added successfully");
    }
    setShowModal(false);
  };

  const handleDelete = (code) => {
    setItems(prev => prev.filter(i => i.code !== code));
    setDeleteId(null);
    flash("Record deleted");
  };

  return (
    <div>
      <Toast msg={toast} />
      <PageHeader title={title} sub={sub} />

      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search…" style={{ maxWidth: 300, width: "auto" }} />
          <span style={{ color: T.muted, fontSize: 13 }}>{filtered.length} records</span>
          <div style={{ marginLeft: "auto" }}>
            <Btn onClick={openAdd}>+ Add New</Btn>
          </div>
        </div>
      </Card>

      <Card>
        {renderRow(filtered, openEdit, setDeleteId)}
      </Card>

      {showModal && (
        <Modal title={editing ? "Edit Record" : "Add New Record"} onClose={() => setShowModal(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {fields.map(f => (
              <div key={f.key}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.8 }}>{f.label}</label>
                {f.type === "select"
                  ? <Select value={form[f.key] || ""} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}>
                      <option value="">— Select —</option>
                      {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  : <Input value={form[f.key] || ""} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} maxLength={f.maxLength} />
                }
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 8, justifyContent: "flex-end" }}>
              <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
              <Btn onClick={handleSave}>{editing ? "Save Changes" : "Add Record"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Confirm Delete" onClose={() => setDeleteId(null)}>
          <p style={{ color: T.text, marginBottom: 20 }}>Are you sure you want to delete <strong>{deleteId}</strong>? This action cannot be undone.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={() => handleDelete(deleteId)}>Delete</Btn>
          </div>
        </Modal>
      )}

      {legendItems && <CodeLegend items={legendItems} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════

function Dashboard({ data }) {
  const { categories, manufacturers, models, disciplines, funcGroups, dbReady } = data;

  const [totalParts,   setTotalParts]   = useState(0);
  const [catCounts,    setCatCounts]    = useState(categories.map(c=>({...c,count:0})));
  const [recentParts,  setRecentParts]  = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    if (!dbReady) {
      // local mode — derive from in-memory INIT_PARTS
      const parts = data.parts || [];
      setTotalParts(parts.length);
      setCatCounts(categories.map(c => ({ ...c, count: parts.filter(p=>p.cat===c.code).length })));
      setRecentParts([...parts].slice(-6).reverse());
      return;
    }
    setLoadingStats(true);
    Promise.all([
      db.fetchPartsCount({}),
      ...categories.map(c => db.fetchPartsCount({ cat: c.code })),
      db.fetchParts({}, 0, 6),
    ]).then(([totalRes, ...rest]) => {
      const catResults = rest.slice(0, categories.length);
      const recentRes  = rest[categories.length];
      setTotalParts(totalRes.count || 0);
      setCatCounts(categories.map((c,i) => ({ ...c, count: catResults[i]?.count || 0 })));
      setRecentParts((recentRes.data || []).map(mapPart));
    }).finally(()=>setLoadingStats(false));
  }, [dbReady, categories]);

  return (
    <div>
      <PageHeader title="Dashboard" sub="CarGas Coding System — Overview" />

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Parts" value={loadingStats?"…":totalParts.toLocaleString()} color={T.accent} icon="🔩" />
        <StatCard label="Categories" value={categories.length} color="#047857" icon="📦" />
        <StatCard label="Manufacturers" value={manufacturers.length} color="#b45309" icon="🏭" />
        <StatCard label="Models" value={models.length} color="#7c3aed" icon="📐" />
        <StatCard label="Functional Groups" value={funcGroups.length} color="#be123c" icon="⚙️" />
        <StatCard label="Disciplines" value={disciplines.length} color="#0e7490" icon="🔬" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Hierarchy */}
        <Card>
          <SectionHeader>Equipment Hierarchy</SectionHeader>
          <div style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 2.2 }}>
            <div style={{ fontWeight: 800, color: T.accent }}>📦 Engineering Spare Parts</div>
            {categories.map((c, i) => (
              <div key={c.code} style={{ marginLeft: 20, color: T.text }}>
                {i < categories.length - 1 ? "├──" : "└──"} {c.icon} {c.label} <span style={{ color: "#94a3b8" }}>({c.code})</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Category bars */}
        <Card>
          <SectionHeader>Parts by Category</SectionHeader>
          {catCounts.map(c => (
            <div key={c.code} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c.icon} {c.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: c.color }}>{loadingStats?"…":c.count}</span>
              </div>
              <div style={{ background: "#e2e8f0", borderRadius: 4, height: 6 }}>
                <div style={{ background: c.color, height: 6, borderRadius: 4, width: `${totalParts ? (c.count / totalParts) * 100 : 0}%`, transition: "width .5s" }} />
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Code format reminder */}
      <Card style={{ marginBottom: 24, background: T.header, border: "none" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>Mandatory Code Format — 6 Segments</div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {[
              { seg: "AA", name: "Category",   c: "#60a5fa" },
              { seg: "BB", name: "Manufacturer",c: "#fbbf24" },
              { seg: "CC", name: "Model",       c: "#34d399" },
              { seg: "DD", name: "Discipline",  c: "#f87171" },
              { seg: "EE", name: "Func. Group", c: "#a78bfa" },
              { seg: "0001",name:"Sequence",    c: "#94a3b8" },
            ].map((s, i, arr) => (
              <span key={s.seg}>
                <span style={{ fontFamily:"monospace",fontWeight:800,fontSize:18,color:s.c }}>
                  {s.seg}
                </span>
                {i < arr.length - 1 && <span style={{ color:"#475569",margin:"0 2px" }}>–</span>}
              </span>
            ))}
          </div>
          <div style={{ display:"flex",justifyContent:"center",gap:4,flexWrap:"wrap",marginTop:6 }}>
            {["Category","Manufacturer","Model","Discipline","Func. Group","Sequence"].map((n,i,arr)=>(
              <span key={n}>
                <span style={{ fontSize:11,color:"#64748b" }}>{n}</span>
                {i<arr.length-1&&<span style={{ color:"#334155",margin:"0 6px",fontSize:11 }}>·</span>}
              </span>
            ))}
          </div>
        </div>
      </Card>

      {/* Recent Codes */}
      <Card>
        <SectionHeader>Recent Spare Parts</SectionHeader>
        {loadingStats ? (
          <div style={{ textAlign:"center", padding:24, color:T.muted }}>Loading…</div>
        ) : (
          <Table
            cols={[
              { key:"code", label:"Code", render: r => <CodeTag code={r.code} /> },
              { key:"shortDesc", label:"Short Description", style:{fontWeight:600,color:T.text} },
              { key:"cat", label:"Category", render: r => { const c = categories.find(x=>x.code===r.cat); return <Pill color={c?.color} bg={c?.bg}>{r.cat}</Pill>; } },
              { key:"disc", label:"Discipline", render: r => { const d = T.disc[r.disc]||{c:T.muted,b:T.subtle}; return <Pill color={d.c} bg={d.b}>{r.disc}</Pill>; } },
              { key:"status", label:"Status", render: r => <Pill color={T.success} bg={T.successBg} mono={false}>{r.status}</Pill> },
            ]}
            rows={recentParts}
          />
        )}
      </Card>

      <CodeLegend items={[
        { code:"AA", label:"Main Category" },
        { code:"BB", label:"Manufacturer / Equipment Type" },
        { code:"CC", label:"Equipment Model" },
        { code:"DD", label:"Discipline (ME/EL/AC)" },
        { code:"EE", label:"Functional Group" },
        { code:"NNNN", label:"4-digit Sequence Number" },
      ]} />
    </div>
  );
}

// ─── CODING FRAMEWORK ─────────────────────────────────────────
function CodingFrameworkPage({ data }) {
  const segs = [
    { pos:"AA", name:"Main Category",           ex:"CP",   exLabel:"Compressors",     color:"#1d4ed8", bg:"#dbeafe" },
    { pos:"BB", name:"Manufacturer",             ex:"AN",   exLabel:"ANGI",            color:"#b45309", bg:"#fef3c7" },
    { pos:"CC", name:"Equipment Model",          ex:"A34",  exLabel:"Model 3406",      color:"#047857", bg:"#d1fae5" },
    { pos:"DD", name:"Discipline",               ex:"ME",   exLabel:"Mechanical",      color:"#7c3aed", bg:"#ede9fe" },
    { pos:"EE", name:"Functional Group",         ex:"BRG",  exLabel:"Bearing",         color:"#be123c", bg:"#ffe4e6" },
    { pos:"0001",name:"Sequential Number",       ex:"0001", exLabel:"Item #1",         color:"#475569", bg:"#f1f5f9" },
  ];
  const examples = [
    { code:"CP-AN-A34-ME-BRG-0001", labels:["Compressors","ANGI","Model 3406","Mechanical","Bearing","Item #1"] },
    { code:"EN-CM-C01-EL-ALT-0001", labels:["Engines","Cummins","QSB6.7","Electrical","Alternator","Item #1"] },
    { code:"CP-FN-F30-AC-PRV-0001", labels:["Compressors","Fornovo","30 Bar Suction","Aux. Circuits","Pressure Relief Valve","Item #1"] },
  ];

  return (
    <div>
      <PageHeader title="Coding Framework" sub="New 6-segment mandatory code structure — AA-BB-CC-DD-EE-0001" />

      <Card style={{ marginBottom: 24, textAlign:"center" }}>
        <div style={{ fontSize:12,color:T.muted,marginBottom:14,fontWeight:700,textTransform:"uppercase",letterSpacing:1 }}>Master Code Format</div>
        <div style={{ display:"flex",justifyContent:"center",alignItems:"center",gap:4,flexWrap:"wrap" }}>
          {segs.map((s,i) => (
            <span key={s.pos}>
              <span style={{ background:s.bg,color:s.color,fontFamily:"monospace",fontWeight:800,fontSize:22,padding:"8px 16px",borderRadius:6,border:`2px solid ${s.color}`,display:"inline-block" }}>{s.pos}</span>
              {i < segs.length-1 && <span style={{ fontSize:22,fontWeight:300,color:"#94a3b8",margin:"0 2px" }}>–</span>}
            </span>
          ))}
        </div>
      </Card>

      <SectionHeader>Segment Definitions</SectionHeader>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginBottom:28 }}>
        {segs.map((s,i) => (
          <Card key={s.pos} style={{ borderTop:`3px solid ${s.color}` }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
              <Pill color={s.color} bg={s.bg}>{s.pos}</Pill>
              <span style={{ fontSize:11,color:"#94a3b8",fontWeight:700 }}>Pos. {i+1}</span>
            </div>
            <div style={{ fontWeight:700,color:T.text,fontSize:14,marginBottom:4 }}>{s.name}</div>
            <div style={{ fontSize:12,color:T.muted }}>e.g. <span style={{ fontFamily:"monospace",fontWeight:700,color:s.color }}>{s.ex}</span> = {s.exLabel}</div>
          </Card>
        ))}
      </div>

      <SectionHeader>Live Code Examples</SectionHeader>
      <div style={{ display:"flex",flexDirection:"column",gap:16,marginBottom:28 }}>
        {examples.map(ex => (
          <Card key={ex.code}>
            <div style={{ marginBottom:12 }}><CodeTag code={ex.code} /></div>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
              {ex.code.split("-").map((part,i) => (
                <div key={i} style={{ textAlign:"center" }}>
                  <div style={{ background:segs[i].bg,color:segs[i].color,fontFamily:"monospace",fontWeight:800,padding:"4px 10px",borderRadius:4,fontSize:14,marginBottom:4 }}>{part}</div>
                  <div style={{ fontSize:11,color:T.muted,maxWidth:100 }}>{ex.labels[i]}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <CodeLegend items={[
        {code:"AA",label:"Main Category (2 chars)"},{code:"BB",label:"Manufacturer (2 chars)"},
        {code:"CC",label:"Model (3 chars)"},{code:"DD",label:"Discipline (2-3 chars)"},
        {code:"EE",label:"Functional Group (3 chars)"},{code:"NNNN",label:"4-digit sequence (auto)"},
      ]} />
    </div>
  );
}

// ─── CATEGORIES ADMIN ─────────────────────────────────────────
const COLOR_PRESETS = [
  { color:"#1d4ed8", bg:"#dbeafe", name:"Blue"   },
  { color:"#b45309", bg:"#fef3c7", name:"Amber"  },
  { color:"#047857", bg:"#d1fae5", name:"Green"  },
  { color:"#7c3aed", bg:"#ede9fe", name:"Violet" },
  { color:"#be123c", bg:"#ffe4e6", name:"Rose"   },
  { color:"#0e7490", bg:"#cffafe", name:"Cyan"   },
  { color:"#6d28d9", bg:"#f5f3ff", name:"Purple" },
  { color:"#374151", bg:"#f3f4f6", name:"Gray"   },
  { color:"#9a3412", bg:"#ffedd5", name:"Orange" },
  { color:"#155e75", bg:"#ecfeff", name:"Teal"   },
  { color:"#166534", bg:"#f0fdf4", name:"Emerald"},
  { color:"#831843", bg:"#fdf2f8", name:"Pink"   },
];

const ICON_PRESETS = ["⚙️","🔧","🗄️","⛽","📡","🛢️","🔩","📦","🏭","🔬","⚡","🛠️","🔑","📋","💡","🧰","🔄","⚗️"];

function CategoriesPage({ data }) {
  const { categories, parts, ops } = data;

  const EMPTY = { code:"", label:"", icon:"📦", color:"#1d4ed8", bg:"#dbeafe" };
  const [form,        setForm]        = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm,    setShowForm]    = useState(false);
  const [deleteTarget,setDeleteTarget]= useState(null);
  const [toast,       setToast]       = useState(null);
  const [search,      setSearch]      = useState("");
  const [saving,      setSaving]      = useState(false);

  const flash = (text, type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const filtered = useMemo(()=>{
    if(!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories.filter(c=> c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q));
  },[categories, search]);

  const openAdd  = () => { setForm(EMPTY); setEditingCode(null); setShowForm(true); };
  const openEdit = (cat) => { setForm({...cat}); setEditingCode(cat.code); setShowForm(true); };
  const closeForm= () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if (!code || !form.label.trim()) return flash("Code and Name are required","err");
    if (code.length !== 2) return flash("Category code must be exactly 2 characters","err");
    if (editingCode === null && categories.find(c => c.code === code)) return flash(`Code "${code}" already exists`,"err");
    if (editingCode !== null && code !== editingCode && categories.find(c => c.code === code)) return flash(`Code "${code}" already exists`,"err");
    setSaving(true);
    const { error } = await ops.saveCategory({ ...form, code }, editingCode);
    setSaving(false);
    if (error) return flash(`Error: ${error.message}`,"err");
    flash(editingCode ? `Category "${code}" updated` : `Category "${code}" added`);
    closeForm();
  };

  const handleDelete = async (cat) => {
    const usedCount = parts.filter(p => p.cat === cat.code).length;
    if (usedCount > 0) return flash(`Cannot delete "${cat.code}" — ${usedCount} part(s) use it.`,"err");
    const { error } = await ops.deleteCategory(cat.code);
    if (error) return flash(`Error: ${error.message}`,"err");
    setDeleteTarget(null);
    flash(`Category "${cat.code}" deleted`);
  };

  const setColor = (preset) => setForm(f=>({...f, color: preset.color, bg: preset.bg}));
  const fStyle = { display:"flex",flexDirection:"column",gap:4 };
  const lStyle = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8 };

  return (
    <div>
      <Toast msg={toast} />
      <PageHeader title="Main Categories (AA)" sub="Add, edit, or remove top-level equipment categories — first segment of every code" />

      {/* Toolbar */}
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:"flex",gap:12,alignItems:"center",flexWrap:"wrap" }}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search categories…" style={{ maxWidth:260,width:"auto" }} />
          <span style={{ fontSize:13,color:T.muted }}>{filtered.length} of {categories.length}</span>
          <div style={{ marginLeft:"auto" }}>
            <Btn onClick={openAdd}>＋ Add Category</Btn>
          </div>
        </div>
      </Card>

      {/* Cards grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14, marginBottom:28 }}>
        {filtered.map(cat => {
          const partCount = parts.filter(p=>p.cat===cat.code).length;
          return (
            <Card key={cat.code} style={{ borderLeft:`5px solid ${cat.color}`, position:"relative" }}>
              <div style={{ display:"flex",alignItems:"flex-start",gap:14 }}>
                {/* Icon */}
                <div style={{ width:48,height:48,borderRadius:10,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0 }}>
                  {cat.icon}
                </div>
                {/* Info */}
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                    <span style={{ fontFamily:"monospace",fontWeight:800,fontSize:15,color:cat.color,background:cat.bg,padding:"2px 8px",borderRadius:4 }}>{cat.code}</span>
                    <span style={{ fontSize:12,color:T.muted,background:T.subtle,padding:"2px 8px",borderRadius:4,fontWeight:600 }}>
                      {partCount} part{partCount!==1?"s":""}
                    </span>
                  </div>
                  <div style={{ fontWeight:700,fontSize:15,color:T.text,marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{cat.label}</div>
                  <div style={{ fontFamily:"monospace",fontSize:11,color:T.muted }}>{cat.code}-BB-CC-DD-EE-0001</div>
                </div>
              </div>
              {/* Actions */}
              <div style={{ display:"flex",gap:8,marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}` }}>
                <Btn small variant="secondary" onClick={()=>openEdit(cat)} style={{ flex:1 }}>✏️ Edit</Btn>
                <Btn small variant="danger" onClick={()=>setDeleteTarget(cat)} style={{ flex:1 }}>🗑 Delete</Btn>
              </div>
            </Card>
          );
        })}

        {/* Add-new card */}
        <div
          onClick={openAdd}
          style={{ border:`2px dashed ${T.border}`,borderRadius:8,padding:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",minHeight:140,color:T.muted,transition:"border-color .15s,background .15s" }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.background="#f0f9ff";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="transparent";}}
        >
          <span style={{ fontSize:32 }}>＋</span>
          <span style={{ fontSize:13,fontWeight:700 }}>Add New Category</span>
        </div>
      </div>

      {/* Table view */}
      <Card style={{ marginBottom:24 }}>
        <SectionHeader>All Categories — Quick Reference</SectionHeader>
        <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
          <thead>
            <tr style={{ background:T.header }}>
              {["Code","Category","Icon","Parts Coded","Code Format","Actions"].map(h=>(
                <th key={h} style={{ padding:"9px 12px",textAlign:"left",fontWeight:700,color:"#94a3b8",fontSize:10,textTransform:"uppercase",letterSpacing:0.8,whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((cat,i)=>{
              const pc = parts.filter(p=>p.cat===cat.code).length;
              return (
                <tr key={cat.code} style={{ borderBottom:`1px solid ${T.border}`,background:i%2?T.subtle:T.card }}>
                  <td style={{ padding:"8px 12px" }}><Pill color={cat.color} bg={cat.bg}>{cat.code}</Pill></td>
                  <td style={{ padding:"8px 12px",fontWeight:700,color:T.text }}>{cat.label}</td>
                  <td style={{ padding:"8px 12px",fontSize:18 }}>{cat.icon}</td>
                  <td style={{ padding:"8px 12px" }}>
                    <span style={{ fontWeight:700,color:pc>0?T.accent:T.muted }}>{pc}</span>
                  </td>
                  <td style={{ padding:"8px 12px",fontFamily:"monospace",fontSize:11,color:T.muted }}>
                    <span style={{ color:cat.color,fontWeight:700 }}>{cat.code}</span>-BB-CC-DD-EE-0001
                  </td>
                  <td style={{ padding:"8px 12px" }}>
                    <div style={{ display:"flex",gap:6 }}>
                      <Btn small variant="secondary" onClick={()=>openEdit(cat)}>✏️ Edit</Btn>
                      <Btn small variant="danger" onClick={()=>setDeleteTarget(cat)}>🗑 Delete</Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* ── ADD / EDIT MODAL ── */}
      {showForm && (
        <Modal title={editingCode ? `Edit Category — ${editingCode}` : "Add New Category"} onClose={closeForm}>
          <div style={{ display:"flex",flexDirection:"column",gap:16 }}>

            {/* Code + Icon row */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
              <div style={fStyle}>
                <label style={lStyle}>Code (exactly 2 chars) *</label>
                <Input
                  value={form.code}
                  onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))}
                  placeholder="e.g. CP"
                  maxLength={2}
                  style={{ fontFamily:"monospace",fontWeight:800,fontSize:16,letterSpacing:2,textTransform:"uppercase" }}
                />
              </div>
              <div style={fStyle}>
                <label style={lStyle}>Icon Emoji</label>
                <Input value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))} placeholder="e.g. ⚙️" />
              </div>
            </div>

            {/* Name */}
            <div style={fStyle}>
              <label style={lStyle}>Category Name *</label>
              <Input value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Compressors" />
            </div>

            {/* Icon quick-pick */}
            <div style={fStyle}>
              <label style={lStyle}>Quick Icon Pick</label>
              <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                {ICON_PRESETS.map(ic=>(
                  <button key={ic} onClick={()=>setForm(f=>({...f,icon:ic}))}
                    style={{ fontSize:20,background:form.icon===ic?T.accentLight:"#f1f5f9",border:`2px solid ${form.icon===ic?T.accent:"transparent"}`,borderRadius:6,padding:"4px 8px",cursor:"pointer" }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>

            {/* Color preset */}
            <div style={fStyle}>
              <label style={lStyle}>Color Theme</label>
              <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
                {COLOR_PRESETS.map(p=>(
                  <button key={p.color} onClick={()=>setColor(p)} title={p.name}
                    style={{ width:32,height:32,borderRadius:6,background:p.bg,border:`3px solid ${form.color===p.color?p.color:"transparent"}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>
                    <span style={{ width:14,height:14,borderRadius:3,background:p.color,display:"block" }}/>
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview */}
            <div style={{ background:T.subtle,borderRadius:8,padding:14,border:`1px solid ${T.border}` }}>
              <div style={{ fontSize:11,fontWeight:700,color:T.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:0.8 }}>Preview</div>
              <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                <div style={{ width:44,height:44,borderRadius:8,background:form.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,border:`2px solid ${form.color}22` }}>
                  {form.icon||"📦"}
                </div>
                <div>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:3 }}>
                    <span style={{ fontFamily:"monospace",fontWeight:800,fontSize:14,color:form.color,background:form.bg,padding:"2px 8px",borderRadius:4 }}>
                      {form.code||"XX"}
                    </span>
                    <span style={{ fontWeight:700,fontSize:14,color:T.text }}>{form.label||"Category Name"}</span>
                  </div>
                  <span style={{ fontFamily:"monospace",fontSize:11,color:T.muted }}>
                    <span style={{ color:form.color,fontWeight:700 }}>{form.code||"XX"}</span>-BB-CC-DD-EE-0001
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display:"flex",gap:10,justifyContent:"flex-end",paddingTop:4 }}>
              <Btn variant="secondary" onClick={closeForm}>Cancel</Btn>
              <Btn onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editingCode ? "💾 Save Changes" : "＋ Add Category"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── DELETE CONFIRM MODAL ── */}
      {deleteTarget && (
        <Modal title="Delete Category" onClose={()=>setDeleteTarget(null)}>
          <div style={{ marginBottom:20 }}>
            <div style={{ display:"flex",alignItems:"center",gap:12,padding:14,background:T.dangerBg,borderRadius:8,marginBottom:14 }}>
              <span style={{ fontSize:28 }}>{deleteTarget.icon}</span>
              <div>
                <div style={{ fontWeight:800,fontSize:15,color:T.danger }}>{deleteTarget.code} — {deleteTarget.label}</div>
                <div style={{ fontSize:12,color:T.muted,marginTop:2 }}>{parts.filter(p=>p.cat===deleteTarget.code).length} parts use this category</div>
              </div>
            </div>
            <p style={{ fontSize:13,color:T.text,lineHeight:1.6 }}>
              Are you sure you want to permanently delete this category?{" "}
              {parts.filter(p=>p.cat===deleteTarget.code).length > 0
                ? <strong style={{ color:T.danger }}>This category still has coded parts — you must remove those first.</strong>
                : "This action cannot be undone."
              }
            </p>
          </div>
          <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)}>🗑 Delete Category</Btn>
          </div>
        </Modal>
      )}

      <CodeLegend items={categories.map(c=>({code:c.code,label:c.label}))} />
    </div>
  );
}

// ─── MANUFACTURERS ADMIN ──────────────────────────────────────
function ManufacturersPage({ data }) {
  const { manufacturers, categories, parts, ops } = data;
  const EMPTY = { code:"", label:"", catCodes:[], catCode:"" };
  const [form, setForm] = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const flash = (text, type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };
  const filtered = useMemo(()=>{
    const q = search.toLowerCase();
    return !q ? manufacturers : manufacturers.filter(m=> m.code.toLowerCase().includes(q)||m.label.toLowerCase().includes(q));
  },[manufacturers,search]);

  const openAdd  = (catCode="") => { setForm({...EMPTY,catCode}); setEditingCode(null); setShowForm(true); };
  const openEdit = (m)  => { setForm({...m, catCode:(m.catCodes||[])[0]||""}); setEditingCode(m.code); setShowForm(true); };
  const closeForm= () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if(!code||!form.label.trim()) return flash("Code and Name are required","err");
    if(code.length!==2) return flash("Manufacturer code must be exactly 2 characters","err");
    if(!form.catCode) return flash("Please select an equipment type","err");
    if(editingCode===null && manufacturers.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
    setSaving(true);
    const record = { code, label: form.label.trim(), catCodes: [form.catCode] };
    const { error } = await ops.saveManufacturer(record, editingCode);
    setSaving(false);
    if(error) return flash(`Error: ${error.message}`,"err");
    flash(editingCode ? `Manufacturer "${code}" updated` : `Manufacturer "${code}" added`);
    closeForm();
  };

  const handleDelete = async (mfr) => {
    const used = parts.filter(p=>p.mfr===mfr.code).length;
    if(used>0) return flash(`Cannot delete "${mfr.code}" — ${used} part(s) use it. Remove those parts first.`,"err");
    const { error } = await ops.deleteManufacturer(mfr.code);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDeleteTarget(null);
    flash(`Manufacturer "${mfr.code}" deleted`);
  };

  const fStyle = { display:"flex",flexDirection:"column",gap:4 };
  const lStyle = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8 };

  // Group by category for display
  const groups = categories.map(cat=>({
    ...cat,
    items: filtered.filter(m=>(m.catCodes||[]).includes(cat.code))
  })).filter(g=>g.items.length>0 || filtered.some(m=>!(m.catCodes||[]).length));

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Manufacturers (BB)" sub="Add, edit, or remove equipment manufacturers — second segment of every code"/>

      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search manufacturers…" style={{maxWidth:260,width:"auto"}}/>
          <span style={{fontSize:13,color:T.muted}}>{filtered.length} of {manufacturers.length}</span>
          <div style={{marginLeft:"auto"}}><Btn onClick={openAdd}>＋ Add Manufacturer</Btn></div>
        </div>
      </Card>

      {/* Cards grouped by category */}
      {categories.map(cat=>{
        const catItems = filtered.filter(m=>(m.catCodes||[]).includes(cat.code));
        if(catItems.length===0&&search) return null;
        return (
          <div key={cat.code} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <span style={{fontSize:18}}>{cat.icon}</span>
              <span style={{fontWeight:800,fontSize:15,color:T.text}}>{cat.label}</span>
              <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:cat.color,background:cat.bg,padding:"2px 8px",borderRadius:4}}>{cat.code}</span>
              <span style={{fontSize:12,color:T.muted}}>({catItems.length} manufacturer{catItems.length!==1?"s":""})</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12,marginBottom:8}}>
              {catItems.map(mfr=>{
                const pc = parts.filter(p=>p.mfr===mfr.code).length;
                return (
                  <Card key={mfr.code} style={{borderLeft:`4px solid ${cat.color}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:15,color:cat.color,background:cat.bg,padding:"2px 8px",borderRadius:4}}>{mfr.code}</span>
                      <span style={{fontSize:12,color:T.muted,background:T.subtle,padding:"2px 8px",borderRadius:4,fontWeight:600}}>{pc} part{pc!==1?"s":""}</span>
                    </div>
                    <div style={{fontWeight:700,fontSize:15,color:T.text,marginBottom:4}}>{mfr.label}</div>
                    <div style={{fontFamily:"monospace",fontSize:11,color:T.muted,marginBottom:12}}>{cat.code}-{mfr.code}-CC-DD-EE-0001</div>
                    <div style={{display:"flex",gap:8,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
                      <Btn small variant="secondary" onClick={()=>openEdit(mfr)} style={{flex:1}}>✏️ Edit</Btn>
                      <Btn small variant="danger" onClick={()=>setDeleteTarget(mfr)} style={{flex:1}}>🗑 Delete</Btn>
                    </div>
                  </Card>
                );
              })}
              {/* Add card */}
              <div onClick={()=>{setForm({...EMPTY,catCode:cat.code});setEditingCode(null);setShowForm(true);}}
                style={{border:`2px dashed ${T.border}`,borderRadius:8,padding:16,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",minHeight:120,color:T.muted,transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=cat.color;e.currentTarget.style.background=cat.bg+"44";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:26}}>＋</span>
                <span style={{fontSize:12,fontWeight:700}}>Add to {cat.label}</span>
              </div>
            </div>
          </div>
        );
      })}

      {/* ADD / EDIT MODAL */}
      {showForm && (
        <Modal title={editingCode?`Edit Manufacturer — ${editingCode}`:"Add New Manufacturer"} onClose={closeForm}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={fStyle}>
                <label style={lStyle}>Code (exactly 2 chars) *</label>
                <Input value={form.code||""} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="e.g. GA" maxLength={2}
                  style={{fontFamily:"monospace",fontWeight:800,fontSize:16,letterSpacing:2}}/>
              </div>
              <div style={fStyle}>
                <label style={lStyle}>Equipment Type *</label>
                <Select value={form.catCode||form.catCodes?.[0]||""} onChange={e=>setForm(f=>({...f,catCode:e.target.value}))}>
                  <option value="">Select category…</option>
                  {categories.map(c=><option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                </Select>
              </div>
            </div>
            <div style={fStyle}>
              <label style={lStyle}>Manufacturer Name *</label>
              <Input value={form.label||""} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Galileo"/>
            </div>
            {/* Preview */}
            <div style={{background:T.subtle,borderRadius:8,padding:12,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6,textTransform:"uppercase"}}>Preview</div>
              {(()=>{const cat=categories.find(c=>c.code===(form.catCode||form.catCodes?.[0]));return(
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:cat?.color||T.muted,background:cat?.bg||T.subtle,padding:"3px 10px",borderRadius:4}}>{form.code||"XX"}</span>
                  <span style={{fontWeight:700,color:T.text}}>{form.label||"Manufacturer Name"}</span>
                  <span style={{fontFamily:"monospace",fontSize:11,color:T.muted}}>→ {cat?.code||"AA"}-{form.code||"BB"}-CC-DD-EE-0001</span>
                </div>
              );})()}
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={closeForm}>Cancel</Btn>
              <Btn onClick={handleSave}>{editingCode?"💾 Save Changes":"＋ Add Manufacturer"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM */}
      {deleteTarget&&(
        <Modal title="Delete Manufacturer" onClose={()=>setDeleteTarget(null)}>
          <div style={{marginBottom:20}}>
            <div style={{padding:14,background:T.dangerBg,borderRadius:8,marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:15,color:T.danger}}>{deleteTarget.code} — {deleteTarget.label}</div>
              <div style={{fontSize:12,color:T.muted,marginTop:4}}>{parts.filter(p=>p.mfr===deleteTarget.code).length} parts use this manufacturer</div>
            </div>
            <p style={{fontSize:13,color:T.text,lineHeight:1.6}}>
              {parts.filter(p=>p.mfr===deleteTarget.code).length>0
                ?<strong style={{color:T.danger}}>This manufacturer still has coded parts — remove those first.</strong>
                :"Are you sure? This action cannot be undone."}
            </p>
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)}>🗑 Delete</Btn>
          </div>
        </Modal>
      )}

      <CodeLegend items={manufacturers.map(m=>({code:m.code,label:m.label}))}/>
    </div>
  );
}

// ─── MODELS ADMIN ─────────────────────────────────────────────
function ModelsPage({ data }) {
  const { models, manufacturers, engineSystems, parts, ops } = data;
  const [saving, setSaving] = useState(false);
  const EMPTY = { code:"", label:"", mfrCode:"" };
  const [form, setForm] = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");

  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };
  const filtered = useMemo(()=>{
    const q=search.toLowerCase();
    return !q ? models : models.filter(m=>m.code.toLowerCase().includes(q)||m.label.toLowerCase().includes(q)||m.mfrCode.toLowerCase().includes(q));
  },[models,search]);

  const openAdd  = (mfrCode="") => { setForm({...EMPTY,mfrCode}); setEditingCode(null); setShowForm(true); };
  const openEdit = (m) => { setForm({...m}); setEditingCode(m.code); setShowForm(true); };
  const closeForm= () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = () => {
    const code = form.code.trim().toUpperCase();
    if(!code||!form.label.trim()||!form.mfrCode) return flash("All fields are required","err");
    if(code.length<2||code.length>5) return flash("Model code must be 2–5 characters","err");
    const record = { code, label:form.label.trim(), mfrCode:form.mfrCode };
    if(editingCode===null){
      if(models.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
      setModels(p=>[...p,record]);
      flash(`Model "${code} — ${record.label}" added`);
    } else {
      if(code!==editingCode && models.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
      setModels(p=>p.map(m=>m.code===editingCode?record:m));
      flash(`Model "${code}" updated`);
    }
    closeForm();
  };

  const handleDelete = (model) => {
    const used = parts.filter(p=>p.model===model.code).length;
    if(used>0) return flash(`Cannot delete "${model.code}" — ${used} part(s) use it.`,"err");
    setModels(p=>p.filter(m=>m.code!==model.code));
    setDeleteTarget(null);
    flash(`Model "${model.code}" deleted`);
  };

  const fStyle = { display:"flex",flexDirection:"column",gap:4 };
  const lStyle = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8 };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Equipment Models (CC)" sub="Add, edit, or remove models per manufacturer — third code segment"/>

      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search models…" style={{maxWidth:260,width:"auto"}}/>
          <span style={{fontSize:13,color:T.muted}}>{filtered.length} of {models.length}</span>
          <div style={{marginLeft:"auto"}}><Btn onClick={()=>openAdd()}>＋ Add Model</Btn></div>
        </div>
      </Card>

      {/* Grouped by manufacturer */}
      {manufacturers.map(mfr=>{
        const mfrModels = filtered.filter(m=>m.mfrCode===mfr.code);
        if(mfrModels.length===0&&search) return null;
        const isEngine = (mfr.catCodes||[]).includes("EN");
        const color = isEngine?"#b45309":"#1d4ed8";
        const bg    = isEngine?"#fef3c7":"#dbeafe";
        const icon  = isEngine?"🔧":"⚙️";
        return (
          <div key={mfr.code} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <span style={{fontSize:18}}>{icon}</span>
              <span style={{fontWeight:800,fontSize:15,color:T.text}}>{mfr.label}</span>
              <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color,background:bg,padding:"2px 8px",borderRadius:4}}>{mfr.code}</span>
              {isEngine&&<span style={{fontSize:11,background:"#fef3c7",color:"#b45309",padding:"2px 8px",borderRadius:4,fontWeight:700}}>Engine</span>}
              <span style={{fontSize:12,color:T.muted}}>({mfrModels.length} model{mfrModels.length!==1?"s":""})</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
              {mfrModels.map(model=>{
                const pc=parts.filter(p=>p.model===model.code).length;
                return (
                  <Card key={model.code} style={{borderLeft:`4px solid ${color}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:14,color,background:bg,padding:"2px 8px",borderRadius:4}}>{model.code}</span>
                      <span style={{fontSize:11,color:T.muted,background:T.subtle,padding:"2px 6px",borderRadius:4,fontWeight:600}}>{pc} part{pc!==1?"s":""}</span>
                    </div>
                    <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:4}}>{model.label}</div>
                    <div style={{fontFamily:"monospace",fontSize:10,color:T.muted,marginBottom:10}}>
                      AA-{mfr.code}-<span style={{color,fontWeight:800}}>{model.code}</span>-DD-EE-0001
                    </div>
                    <div style={{display:"flex",gap:6,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                      <Btn small variant="secondary" onClick={()=>openEdit(model)} style={{flex:1}}>✏️ Edit</Btn>
                      <Btn small variant="danger" onClick={()=>setDeleteTarget(model)} style={{flex:1}}>🗑 Delete</Btn>
                    </div>
                  </Card>
                );
              })}
              {/* Add card for this manufacturer */}
              <div onClick={()=>openAdd(mfr.code)}
                style={{border:`2px dashed ${T.border}`,borderRadius:8,padding:14,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",minHeight:110,color:T.muted,transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=color;e.currentTarget.style.background=bg+"44";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:24}}>＋</span>
                <span style={{fontSize:12,fontWeight:700}}>Add {mfr.label} Model</span>
              </div>
            </div>
          </div>
        );
      })}

      {/* ADD / EDIT MODAL */}
      {showForm&&(
        <Modal title={editingCode?`Edit Model — ${editingCode}`:"Add New Model"} onClose={closeForm}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={fStyle}>
                <label style={lStyle}>Model Code (2–5 chars) *</label>
                <Input value={form.code||""} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="e.g. CA03" maxLength={5}
                  style={{fontFamily:"monospace",fontWeight:800,fontSize:15}}/>
              </div>
              <div style={fStyle}>
                <label style={lStyle}>Manufacturer *</label>
                <Select value={form.mfrCode||""} onChange={e=>setForm(f=>({...f,mfrCode:e.target.value}))}>
                  <option value="">Select…</option>
                  {manufacturers.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
                </Select>
              </div>
            </div>
            <div style={fStyle}>
              <label style={lStyle}>Model Description *</label>
              <Input value={form.label||""} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="e.g. 3406 NA"/>
            </div>
            {/* Preview */}
            <div style={{background:T.subtle,borderRadius:8,padding:12,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6,textTransform:"uppercase"}}>Preview</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:T.accent,background:T.accentLight,padding:"3px 10px",borderRadius:4}}>
                  {form.mfrCode||"BB"}-{form.code||"CC"}
                </span>
                <span style={{fontWeight:700,color:T.text}}>{form.label||"Model Name"}</span>
              </div>
              <div style={{fontFamily:"monospace",fontSize:11,color:T.muted,marginTop:6}}>
                AA-{form.mfrCode||"BB"}-<span style={{color:T.accent,fontWeight:700}}>{form.code||"CC"}</span>-DD-EE-0001
              </div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={closeForm}>Cancel</Btn>
              <Btn onClick={handleSave}>{editingCode?"💾 Save Changes":"＋ Add Model"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM */}
      {deleteTarget&&(
        <Modal title="Delete Model" onClose={()=>setDeleteTarget(null)}>
          <div style={{marginBottom:20}}>
            <div style={{padding:14,background:T.dangerBg,borderRadius:8,marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:15,color:T.danger}}>{deleteTarget.code} — {deleteTarget.label}</div>
              <div style={{fontSize:12,color:T.muted,marginTop:4}}>{parts.filter(p=>p.model===deleteTarget.code).length} parts use this model</div>
            </div>
            <p style={{fontSize:13,color:T.text,lineHeight:1.6}}>
              {parts.filter(p=>p.model===deleteTarget.code).length>0
                ?<strong style={{color:T.danger}}>This model still has coded parts — remove those first.</strong>
                :"Are you sure? This action cannot be undone."}
            </p>
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)}>🗑 Delete</Btn>
          </div>
        </Modal>
      )}

      <CodeLegend items={models.map(m=>({code:m.code,label:`${m.label} (${m.mfrCode})`}))}/>
    </div>
  );
}

// ─── DISCIPLINES ──────────────────────────────────────────────
function DisciplinesPage({ data }) {
  const { disciplines, engineSystems, parts, ops } = data;

  // ── Standard Disciplines editor ──
  const EMPTY_D = { code:"", label:"", desc:"", color:"#1d4ed8", bg:"#dbeafe" };
  const [formD, setFormD] = useState(EMPTY_D);
  const [editD, setEditD] = useState(null);
  const [showD, setShowD] = useState(false);
  const [delD,  setDelD]  = useState(null);

  // ── Engine Systems editor ──
  const EMPTY_E = { code:"", label:"", color:"#1d4ed8", bg:"#dbeafe" };
  const [formE, setFormE] = useState(EMPTY_E);
  const [editE, setEditE] = useState(null);
  const [showE, setShowE] = useState(false);
  const [delE,  setDelE]  = useState(null);

  const [toast, setToast] = useState(null);
  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const fStyle = { display:"flex",flexDirection:"column",gap:4 };
  const lStyle = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8 };

  // Save discipline
  const saveD = async () => {
    const code = formD.code.trim().toUpperCase();
    if(!code||!formD.label.trim()) return flash("Code and Name required","err");
    if(code.length<2||code.length>3) return flash("Discipline code must be 2–3 chars","err");
    if(editD===null && disciplines.find(d=>d.code===code)) return flash("Code already exists","err");
    const rec = { code, label:formD.label.trim(), desc:formD.desc.trim(), color:formD.color, bg:formD.bg };
    const { error } = await ops.saveDiscipline(rec, editD);
    if(error) return flash(`Error: ${error.message}`,"err");
    flash(editD ? `Discipline "${code}" updated` : `Discipline "${code}" added`);
    setShowD(false); setEditD(null); setFormD(EMPTY_D);
  };
  const deleteD = async (d) => {
    const used=parts.filter(p=>p.disc===d.code).length;
    if(used>0) return flash(`Cannot delete — ${used} part(s) use this discipline`,"err");
    const { error } = await ops.deleteDiscipline(d.code);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDelD(null); flash(`Discipline "${d.code}" deleted`);
  };

  // Save engine system
  const saveE = async () => {
    const code = formE.code.trim().toUpperCase();
    if(!code||!formE.label.trim()) return flash("Code and Name required","err");
    if(code.length<2||code.length>4) return flash("System code must be 2–4 chars","err");
    if(editE===null && engineSystems.find(s=>s.code===code)) return flash("Code already exists","err");
    const rec = { code, label:formE.label.trim(), color:formE.color, bg:formE.bg };
    const { error } = await ops.saveEngineSystem(rec, editE);
    if(error) return flash(`Error: ${error.message}`,"err");
    flash(editE ? `Engine System "${code}" updated` : `Engine System "${code}" added`);
    setShowE(false); setEditE(null); setFormE(EMPTY_E);
  };
  const deleteE = async (s) => {
    const used=parts.filter(p=>p.disc===s.code).length;
    if(used>0) return flash(`Cannot delete — ${used} part(s) use this system`,"err");
    const { error } = await ops.deleteEngineSystem(s.code);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDelE(null); flash(`Engine System "${s.code}" deleted`);
  };

  const ColorPicker = ({value, bg: bgVal, onChange}) => (
    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
      {COLOR_PRESETS.map(p=>(
        <button key={p.color} onClick={()=>onChange(p)} title={p.name}
          style={{width:28,height:28,borderRadius:5,background:p.bg,border:`3px solid ${value===p.color?p.color:"transparent"}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{width:12,height:12,borderRadius:2,background:p.color,display:"block"}}/>
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Disciplines & Engine Systems (DD)" sub="Fourth code segment — Standard disciplines for all categories; Engine-specific system sections for EN"/>

      {/* ══ STANDARD DISCIPLINES ══ */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontWeight:800,fontSize:16,color:T.text}}>Standard Disciplines</span>
          <span style={{fontSize:12,background:"#dbeafe",color:"#1d4ed8",padding:"2px 10px",borderRadius:4,fontWeight:700}}>CP · ST · DI · IN · LC · TL · OT</span>
        </div>
        <Btn small onClick={()=>{setFormD(EMPTY_D);setEditD(null);setShowD(true);}}>＋ Add Discipline</Btn>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14,marginBottom:28}}>
        {disciplines.map(d=>(
          <Card key={d.code} style={{borderTop:`4px solid ${d.color}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <Pill color={d.color} bg={d.bg} size={14}>{d.code}</Pill>
              <div style={{display:"flex",gap:6}}>
                <Btn small variant="secondary" onClick={()=>{setFormD({...d});setEditD(d.code);setShowD(true);}}>✏️</Btn>
                <Btn small variant="danger" onClick={()=>setDelD(d)}>🗑</Btn>
              </div>
            </div>
            <div style={{fontWeight:800,fontSize:17,color:T.text,marginBottom:4}}>{d.label}</div>
            <div style={{fontSize:13,color:T.muted,marginBottom:10}}>{d.desc}</div>
            <div style={{padding:"7px 10px",background:T.subtle,borderRadius:5,fontFamily:"monospace",fontSize:11,color:T.muted}}>
              AA-BB-CC-<span style={{color:d.color,fontWeight:800}}>{d.code}</span>-EE-0001
            </div>
          </Card>
        ))}
        {/* Add card */}
        <div onClick={()=>{setFormD(EMPTY_D);setEditD(null);setShowD(true);}}
          style={{border:`2px dashed ${T.border}`,borderRadius:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",minHeight:140,color:T.muted,transition:"all .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.background="#f0f9ff";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="transparent";}}>
          <span style={{fontSize:28}}>＋</span><span style={{fontSize:13,fontWeight:700}}>Add Discipline</span>
        </div>
      </div>

      {/* ══ ENGINE SYSTEMS ══ */}
      <Card style={{marginBottom:24,borderLeft:"4px solid #b45309"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>🔧</span>
            <div>
              <div style={{fontWeight:800,fontSize:15,color:T.text}}>Engine System Sections</div>
              <div style={{fontSize:12,color:T.muted}}>Exclusively for Engines (EN) — replaces ME/EL/AC for Caterpillar & Waukesha</div>
            </div>
          </div>
          <Btn small onClick={()=>{setFormE(EMPTY_E);setEditE(null);setShowE(true);}}>＋ Add System</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
          {engineSystems.map(s=>(
            <div key={s.code} style={{display:"flex",alignItems:"center",gap:10,background:s.bg,borderRadius:7,padding:"10px 14px",border:`1px solid ${s.color}22`}}>
              <div style={{flex:1}}>
                <div style={{fontFamily:"monospace",fontWeight:800,color:s.color,fontSize:13}}>{s.code}</div>
                <div style={{fontSize:13,fontWeight:600,color:s.color,marginTop:2}}>{s.label}</div>
              </div>
              <div style={{display:"flex",gap:4}}>
                <Btn small variant="secondary" onClick={()=>{setFormE({...s});setEditE(s.code);setShowE(true);}}>✏️</Btn>
                <Btn small variant="danger" onClick={()=>setDelE(s)}>🗑</Btn>
              </div>
            </div>
          ))}
          {/* Add engine system card */}
          <div onClick={()=>{setFormE(EMPTY_E);setEditE(null);setShowE(true);}}
            style={{border:`2px dashed #fbbf24`,borderRadius:7,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",minHeight:70,color:"#b45309",transition:"all .15s",padding:10}}
            onMouseEnter={e=>{e.currentTarget.style.background="#fef3c7";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
            <span style={{fontSize:22}}>＋</span><span style={{fontSize:12,fontWeight:700}}>Add Engine System</span>
          </div>
        </div>
      </Card>

      <Card style={{marginBottom:24}}>
        <SectionHeader>Auxiliary Circuits (AC) — Scope</SectionHeader>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
          {["Lubrication Systems","Cooling Systems","P&ID Components","Pressure Gauges","Pressure Switches","Pressure Transmitters","Temperature Gauges","Temperature Switches","Temperature Transmitters","Level Gauges","Flow Meters","Relief Valves","Solenoid Valves","Hoses","Fittings","Lubricants","Coolants","Separators","Dryers","Auxiliary Valves"].map(item=>(
            <div key={item} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"#d1fae5",borderRadius:5}}>
              <span style={{color:"#047857",fontWeight:700}}>✓</span>
              <span style={{fontSize:13,color:"#065f46"}}>{item}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── DISCIPLINE MODAL ── */}
      {showD&&(
        <Modal title={editD?`Edit Discipline — ${editD}`:"Add New Discipline"} onClose={()=>{setShowD(false);setFormD(EMPTY_D);}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={fStyle}>
                <label style={lStyle}>Code (2–3 chars) *</label>
                <Input value={formD.code||""} onChange={e=>setFormD(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="e.g. ME" maxLength={3}
                  style={{fontFamily:"monospace",fontWeight:800,fontSize:16,letterSpacing:2}}/>
              </div>
              <div style={fStyle}>
                <label style={lStyle}>Label *</label>
                <Input value={formD.label||""} onChange={e=>setFormD(f=>({...f,label:e.target.value}))} placeholder="e.g. Mechanical"/>
              </div>
            </div>
            <div style={fStyle}>
              <label style={lStyle}>Description</label>
              <Input value={formD.desc||""} onChange={e=>setFormD(f=>({...f,desc:e.target.value}))} placeholder="e.g. Rotating & static mechanical components"/>
            </div>
            <div style={fStyle}>
              <label style={lStyle}>Color Theme</label>
              <ColorPicker value={formD.color} bg={formD.bg} onChange={p=>setFormD(f=>({...f,color:p.color,bg:p.bg}))}/>
            </div>
            <div style={{background:T.subtle,borderRadius:8,padding:12,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6,textTransform:"uppercase"}}>Preview</div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontFamily:"monospace",fontWeight:800,color:formD.color,background:formD.bg,padding:"3px 10px",borderRadius:4}}>{formD.code||"XX"}</span>
                <span style={{fontWeight:700,color:T.text}}>{formD.label||"Discipline Name"}</span>
              </div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={()=>{setShowD(false);setFormD(EMPTY_D);}}>Cancel</Btn>
              <Btn onClick={saveD}>{editD?"💾 Save Changes":"＋ Add Discipline"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── ENGINE SYSTEM MODAL ── */}
      {showE&&(
        <Modal title={editE?`Edit Engine System — ${editE}`:"Add New Engine System"} onClose={()=>{setShowE(false);setFormE(EMPTY_E);}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={fStyle}>
                <label style={lStyle}>Code (2–4 chars) *</label>
                <Input value={formE.code||""} onChange={e=>setFormE(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="e.g. FUE" maxLength={4}
                  style={{fontFamily:"monospace",fontWeight:800,fontSize:16,letterSpacing:2}}/>
              </div>
              <div style={fStyle}>
                <label style={lStyle}>System Name *</label>
                <Input value={formE.label||""} onChange={e=>setFormE(f=>({...f,label:e.target.value}))} placeholder="e.g. Fuel System"/>
              </div>
            </div>
            <div style={fStyle}>
              <label style={lStyle}>Color Theme</label>
              <ColorPicker value={formE.color} bg={formE.bg} onChange={p=>setFormE(f=>({...f,color:p.color,bg:p.bg}))}/>
            </div>
            <div style={{background:"#fffbeb",borderRadius:8,padding:12,border:"1px solid #fbbf24"}}>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6,textTransform:"uppercase"}}>Preview</div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontFamily:"monospace",fontWeight:800,color:formE.color,background:formE.bg,padding:"3px 10px",borderRadius:4}}>{formE.code||"XXX"}</span>
                <span style={{fontWeight:700,color:T.text}}>{formE.label||"System Name"}</span>
              </div>
              <div style={{fontFamily:"monospace",fontSize:11,color:T.muted,marginTop:6}}>EN-CA/WK-MODEL-<span style={{color:formE.color,fontWeight:700}}>{formE.code||"XXX"}</span>-EE-0001</div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={()=>{setShowE(false);setFormE(EMPTY_E);}}>Cancel</Btn>
              <Btn onClick={saveE}>{editE?"💾 Save Changes":"＋ Add Engine System"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM — Discipline */}
      {delD&&(<Modal title="Delete Discipline" onClose={()=>setDelD(null)}>
        <div style={{padding:14,background:T.dangerBg,borderRadius:8,marginBottom:16}}>
          <div style={{fontWeight:800,color:T.danger}}>{delD.code} — {delD.label}</div>
          <div style={{fontSize:12,color:T.muted,marginTop:4}}>{parts.filter(p=>p.disc===delD.code).length} parts use this</div>
        </div>
        <p style={{fontSize:13,color:T.text,marginBottom:16,lineHeight:1.6}}>
          {parts.filter(p=>p.disc===delD.code).length>0
            ?<strong style={{color:T.danger}}>Remove all parts in this discipline first.</strong>
            :"This action cannot be undone."}
        </p>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn variant="secondary" onClick={()=>setDelD(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={()=>deleteD(delD)}>🗑 Delete</Btn>
        </div>
      </Modal>)}

      {/* DELETE CONFIRM — Engine System */}
      {delE&&(<Modal title="Delete Engine System" onClose={()=>setDelE(null)}>
        <div style={{padding:14,background:T.dangerBg,borderRadius:8,marginBottom:16}}>
          <div style={{fontWeight:800,color:T.danger}}>{delE.code} — {delE.label}</div>
          <div style={{fontSize:12,color:T.muted,marginTop:4}}>{parts.filter(p=>p.disc===delE.code).length} parts use this</div>
        </div>
        <p style={{fontSize:13,color:T.text,marginBottom:16,lineHeight:1.6}}>
          {parts.filter(p=>p.disc===delE.code).length>0
            ?<strong style={{color:T.danger}}>Remove all parts in this system first.</strong>
            :"This action cannot be undone."}
        </p>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn variant="secondary" onClick={()=>setDelE(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={()=>deleteE(delE)}>🗑 Delete</Btn>
        </div>
      </Modal>)}

      <CodeLegend items={[
        ...disciplines.map(d=>({code:d.code,label:d.label+" (Standard)"})),
        ...engineSystems.map(s=>({code:s.code,label:s.label+" (Engine Only)"})),
      ]}/>
    </div>
  );
}

// ─── FUNCTIONAL GROUPS ────────────────────────────────────────
function FunctionalGroupsPage({ data }) {
  const { funcGroups, disciplines, parts, ops } = data;
  const [saving, setSaving] = useState(false);
  const EMPTY = { code:"", label:"", disc:"ME" };
  const [form, setForm] = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");

  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };
  const filtered = useMemo(()=>{
    const q=search.toLowerCase();
    return !q ? funcGroups : funcGroups.filter(f=>f.code.toLowerCase().includes(q)||f.label.toLowerCase().includes(q));
  },[funcGroups,search]);

  const openAdd  = (disc="ME") => { setForm({...EMPTY,disc}); setEditingCode(null); setShowForm(true); };
  const openEdit = (fg) => { setForm({...fg}); setEditingCode(fg.code); setShowForm(true); };
  const closeForm= () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if(!code||!form.label.trim()||!form.disc) return flash("All fields are required","err");
    if(code.length<2||code.length>4) return flash("Code must be 2–4 characters","err");
    if(editingCode===null && funcGroups.find(f=>f.code===code)) return flash(`Code "${code}" already exists`,"err");
    const rec = { code, label:form.label.trim(), disc:form.disc };
    setSaving(true);
    const { error } = await ops.saveFuncGroup(rec, editingCode);
    setSaving(false);
    if(error) return flash(`Error: ${error.message}`,"err");
    flash(editingCode ? `Functional Group "${code}" updated` : `Functional Group "${code}" added`);
    closeForm();
  };

  const handleDelete = async (fg) => {
    const used=parts.filter(p=>p.fg===fg.code).length;
    if(used>0) return flash(`Cannot delete "${fg.code}" — ${used} part(s) use it.`,"err");
    const { error } = await ops.deleteFuncGroup(fg.code);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDeleteTarget(null); flash(`"${fg.code}" deleted`);
  };

  const fStyle = { display:"flex",flexDirection:"column",gap:4 };
  const lStyle = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8 };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Functional Groups (EE)" sub="Add, edit, or remove functional component groups — fifth code segment"/>

      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search functional groups…" style={{maxWidth:260,width:"auto"}}/>
          <span style={{fontSize:13,color:T.muted}}>{filtered.length} of {funcGroups.length}</span>
          <div style={{marginLeft:"auto"}}><Btn onClick={()=>openAdd()}>＋ Add Functional Group</Btn></div>
        </div>
      </Card>

      {/* Grouped by discipline */}
      {disciplines.map(disc=>{
        const items = filtered.filter(f=>f.disc===disc.code);
        if(items.length===0&&search) return null;
        return (
          <div key={disc.code} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontFamily:"monospace",fontWeight:800,fontSize:14,color:disc.color,background:disc.bg,padding:"3px 10px",borderRadius:4}}>{disc.code}</span>
                <span style={{fontWeight:800,fontSize:15,color:T.text}}>{disc.label}</span>
                <span style={{fontSize:12,color:T.muted}}>({items.length} group{items.length!==1?"s":""})</span>
              </div>
              <Btn small onClick={()=>openAdd(disc.code)}>＋ Add to {disc.label}</Btn>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
              {items.map(fg=>{
                const pc=parts.filter(p=>p.fg===fg.code).length;
                return (
                  <Card key={fg.code} style={{borderLeft:`3px solid ${disc.color}`,padding:14}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:disc.color,background:disc.bg,padding:"2px 8px",borderRadius:4}}>{fg.code}</span>
                      <span style={{fontSize:11,color:T.muted,fontWeight:600}}>{pc} part{pc!==1?"s":""}</span>
                    </div>
                    <div style={{fontWeight:600,fontSize:14,color:T.text,marginBottom:10}}>{fg.label}</div>
                    <div style={{display:"flex",gap:6}}>
                      <Btn small variant="secondary" onClick={()=>openEdit(fg)} style={{flex:1}}>✏️ Edit</Btn>
                      <Btn small variant="danger" onClick={()=>setDeleteTarget(fg)} style={{flex:1}}>🗑</Btn>
                    </div>
                  </Card>
                );
              })}
              {/* Add card */}
              <div onClick={()=>openAdd(disc.code)}
                style={{border:`2px dashed ${disc.color}44`,borderRadius:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",minHeight:100,color:disc.color,transition:"all .15s",padding:10}}
                onMouseEnter={e=>{e.currentTarget.style.background=disc.bg+"66";}}
                onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:24}}>＋</span>
                <span style={{fontSize:12,fontWeight:700}}>Add {disc.code} Group</span>
              </div>
            </div>
          </div>
        );
      })}

      {/* ADD / EDIT MODAL */}
      {showForm&&(
        <Modal title={editingCode?`Edit Functional Group — ${editingCode}`:"Add New Functional Group"} onClose={closeForm}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={fStyle}>
                <label style={lStyle}>Code (2–4 chars) *</label>
                <Input value={form.code||""} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="e.g. BRG" maxLength={4}
                  style={{fontFamily:"monospace",fontWeight:800,fontSize:16,letterSpacing:2}}/>
              </div>
              <div style={fStyle}>
                <label style={lStyle}>Discipline *</label>
                <Select value={form.disc||"ME"} onChange={e=>setForm(f=>({...f,disc:e.target.value}))}>
                  {disciplines.map(d=><option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
                </Select>
              </div>
            </div>
            <div style={fStyle}>
              <label style={lStyle}>Group Name *</label>
              <Input value={form.label||""} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Bearing"/>
            </div>
            {/* Preview */}
            {(()=>{const d=disciplines.find(x=>x.code===form.disc);return(
              <div style={{background:T.subtle,borderRadius:8,padding:12,border:`1px solid ${T.border}`}}>
                <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6,textTransform:"uppercase"}}>Preview</div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:d?.color||T.muted,background:d?.bg||T.subtle,padding:"3px 10px",borderRadius:4}}>{form.code||"EE"}</span>
                  <span style={{fontWeight:700,color:T.text}}>{form.label||"Group Name"}</span>
                  <span style={{fontSize:11,color:T.muted}}>({d?.label})</span>
                </div>
                <div style={{fontFamily:"monospace",fontSize:11,color:T.muted,marginTop:6}}>
                  AA-BB-CC-{form.disc||"DD"}-<span style={{color:d?.color||T.muted,fontWeight:700}}>{form.code||"EE"}</span>-0001
                </div>
              </div>
            );})()}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={closeForm}>Cancel</Btn>
              <Btn onClick={handleSave}>{editingCode?"💾 Save Changes":"＋ Add Group"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM */}
      {deleteTarget&&(
        <Modal title="Delete Functional Group" onClose={()=>setDeleteTarget(null)}>
          <div style={{padding:14,background:T.dangerBg,borderRadius:8,marginBottom:16}}>
            <div style={{fontWeight:800,color:T.danger}}>{deleteTarget.code} — {deleteTarget.label}</div>
            <div style={{fontSize:12,color:T.muted,marginTop:4}}>{parts.filter(p=>p.fg===deleteTarget.code).length} parts use this group</div>
          </div>
          <p style={{fontSize:13,color:T.text,marginBottom:16,lineHeight:1.6}}>
            {parts.filter(p=>p.fg===deleteTarget.code).length>0
              ?<strong style={{color:T.danger}}>Remove all parts in this group first.</strong>
              :"Are you sure? This action cannot be undone."}
          </p>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)}>🗑 Delete</Btn>
          </div>
        </Modal>
      )}

      <CodeLegend items={funcGroups.map(f=>({code:f.code,label:f.label}))}/>
    </div>
  );
}

// ─── CODE GENERATOR ───────────────────────────────────────────
function CodeGeneratorPage({ data }) {
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, parts, ops, dbReady } = data;
  const [step,      setStep]      = useState({ cat:"",mfr:"",model:"",disc:"",fg:"" });
  const [seqMode,   setSeqMode]   = useState("auto");   // "auto" | "manual"
  const [manualSeq, setManualSeq] = useState("");
  const [partNo,    setPartNo]    = useState("");
  const [oemPart,   setOemPart]   = useState("");
  const [qty,       setQty]       = useState(0);
  const [unit,      setUnit]      = useState("EA");
  const [loc,       setLoc]       = useState("");
  const [remarks,   setRemarks]   = useState("");
  const [imageUrl,  setImageUrl]  = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [toast,     setToast]     = useState(null);

  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const isEngine       = step.cat === "EN";
  const activeSections = isEngine ? engineSystems : disciplines;
  const filteredMfrs   = manufacturers.filter(m => !step.cat || (m.catCodes||[]).includes(step.cat));
  const filteredModels = models.filter(m => !step.mfr || m.mfrCode === step.mfr);
  const filteredFG     = isEngine
    ? funcGroups
    : funcGroups.filter(f => !step.disc || f.disc === step.disc);

  const canGenerate = step.cat && step.mfr && step.model && step.disc && step.fg;

  // Auto sequence — queries DB directly since local `parts` state is no longer preloaded
  const [autoSeq,     setAutoSeq]     = useState("0001");
  const [seqLoading,  setSeqLoading]  = useState(false);
  const [codeExists,  setCodeExists]  = useState(false);

  useEffect(() => {
    if (!canGenerate) { setAutoSeq("0001"); setCodeExists(false); return; }
    const prefix = `${step.cat}-${step.mfr}-${step.model}-${step.disc}-${step.fg}-`;
    if (!dbReady) {
      // local mode — use in-memory parts array
      const existing = (data.parts||[]).filter(p => p.code.startsWith(prefix));
      const nums = existing.map(p => parseInt(p.code.split("-").pop() || "0"));
      setAutoSeq(String((nums.length?Math.max(...nums):0) + 1).padStart(4, "0"));
      return;
    }
    setSeqLoading(true);
    db.fetchParts({ search: prefix }, 0, 200).then(({ data: rows }) => {
      const matching = (rows||[]).filter(r => r.code.startsWith(prefix));
      const nums = matching.map(r => parseInt(r.code.split("-").pop() || "0"));
      setAutoSeq(String((nums.length?Math.max(...nums):0) + 1).padStart(4, "0"));
    }).finally(()=>setSeqLoading(false));
  }, [canGenerate, step.cat, step.mfr, step.model, step.disc, step.fg, dbReady]);

  const seqNum = seqMode === "auto"
    ? autoSeq
    : String(parseInt(manualSeq)||1).padStart(4,"0");

  const generatedCode = canGenerate ? `${step.cat}-${step.mfr}-${step.model}-${step.disc}-${step.fg}-${seqNum}` : null;

  // Check DB for exact code existence whenever generatedCode changes
  useEffect(() => {
    if (!generatedCode) { setCodeExists(false); return; }
    if (!dbReady) {
      setCodeExists((data.parts||[]).some(p => p.code === generatedCode));
      return;
    }
    let cancelled = false;
    db.fetchParts({ search: generatedCode }, 0, 5).then(({ data: rows }) => {
      if (cancelled) return;
      setCodeExists((rows||[]).some(r => r.code === generatedCode));
    });
    return () => { cancelled = true; };
  }, [generatedCode, dbReady]);

  const cat   = categories.find(c=>c.code===step.cat);
  const mfr   = manufacturers.find(m=>m.code===step.mfr);
  const model = models.find(m=>m.code===step.model);
  const disc  = isEngine ? engineSystems.find(s=>s.code===step.disc) : disciplines.find(d=>d.code===step.disc);
  const fg    = funcGroups.find(f=>f.code===step.fg);

  const shortDesc = (mfr&&model&&fg) ? `${mfr.label} ${model.label} ${fg.label}` : "—";
  const longDesc  = (fg&&mfr&&cat&&model) ? `${fg.label} for ${mfr.label} ${cat.label} ${model.label}` : "—";

  // Reset saved state when step changes
  useEffect(() => { setSaved(false); setImageUrl(null); }, [step, seqMode, manualSeq]);

  const handleSave = async () => {
    if (!canGenerate) return;
    const newPart = {
      code:generatedCode, shortDesc, longDesc,
      cat:step.cat, mfr:step.mfr, model:step.model, disc:step.disc, fg:step.fg,
      partNo, oemPart, qty:Number(qty)||0, unit, loc, minStock:0, maxStock:0,
      remarks, status:"Active", imageUrl:imageUrl||null, datasheetUrl:null,
    };
    setSaving(true);
    const { error } = await ops.savePart(newPart, null);
    setSaving(false);
    if (error) { flash(`Error: ${error.message}`,"err"); return; }
    setSaved(true);
    flash(`✅ Code ${generatedCode} saved to Master Table`);
  };

  const resetForm = () => {
    setStep({cat:"",mfr:"",model:"",disc:"",fg:""});
    setSeqMode("auto"); setManualSeq(""); setPartNo(""); setOemPart("");
    setQty(0); setUnit("EA"); setLoc(""); setRemarks(""); setImageUrl(null); setSaved(false);
  };

  const sStep  = { padding:"10px 16px", borderRadius:6, background:T.subtle, border:`1px solid ${T.border}`, marginBottom:12 };
  const sLabel = { fontSize:11, fontWeight:700, color:T.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:6, display:"block" };

  return (
    <div>
      <Toast msg={toast} />
      <PageHeader title="Code Generator" sub="Build a valid 6-segment spare part code step by step" />

      <div style={{ display:"grid", gridTemplateColumns:"1.1fr 1fr", gap:20, alignItems:"start" }}>

        {/* ── LEFT: Steps ── */}
        <Card>
          <SectionHeader>Step-by-Step Selection</SectionHeader>

          {/* Step 1 */}
          <div style={sStep}>
            <span style={sLabel}>Step 1 — AA: Main Category</span>
            <Select value={step.cat} onChange={e=>setStep(s=>({...s,cat:e.target.value,mfr:"",model:"",disc:"",fg:""}))}>
              <option value="">Select Category…</option>
              {categories.map(c=><option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </Select>
          </div>

          {/* Step 2 */}
          <div style={{...sStep,opacity:step.cat?1:0.4}}>
            <span style={sLabel}>Step 2 — BB: Manufacturer</span>
            <Select value={step.mfr} onChange={e=>setStep(s=>({...s,mfr:e.target.value,model:"",disc:"",fg:""}))} disabled={!step.cat}>
              <option value="">Select Manufacturer…</option>
              {filteredMfrs.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
            </Select>
          </div>

          {/* Step 3 */}
          <div style={{...sStep,opacity:step.mfr?1:0.4}}>
            <span style={sLabel}>Step 3 — CC: Equipment Model</span>
            <Select value={step.model} onChange={e=>setStep(s=>({...s,model:e.target.value,disc:"",fg:""}))} disabled={!step.mfr}>
              <option value="">Select Model…</option>
              {filteredModels.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
            </Select>
          </div>

          {/* Step 4 */}
          <div style={{...sStep,opacity:step.model?1:0.4,borderColor:isEngine?"#fbbf24":T.border,background:isEngine?"#fffbeb":T.subtle}}>
            <span style={sLabel}>Step 4 — DD: {isEngine?"Engine System":"Discipline"}</span>
            {isEngine&&<div style={{fontSize:11,color:"#b45309",marginBottom:6,fontWeight:600}}>🔧 Engine-specific system sections</div>}
            <Select value={step.disc} onChange={e=>setStep(s=>({...s,disc:e.target.value,fg:""}))} disabled={!step.model}>
              <option value="">{isEngine?"Select Engine System…":"Select Discipline…"}</option>
              {activeSections.map(d=><option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
            </Select>
          </div>

          {/* Step 5 */}
          <div style={{...sStep,opacity:step.disc?1:0.4}}>
            <span style={sLabel}>Step 5 — EE: Functional Group</span>
            <Select value={step.fg} onChange={e=>setStep(s=>({...s,fg:e.target.value}))} disabled={!step.disc}>
              <option value="">Select Functional Group…</option>
              {filteredFG.map(f=><option key={f.code} value={f.code}>{f.code} — {f.label}</option>)}
            </Select>
          </div>

          {/* Step 6 — Sequence (auto + manual) */}
          <div style={{...sStep,background:"#f0f9ff",borderColor:"#bae6fd",opacity:canGenerate?1:0.4}}>
            <span style={sLabel}>Step 6 — NNNN: Sequence Number</span>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <button onClick={()=>setSeqMode("auto")}
                style={{flex:1,padding:"6px",borderRadius:5,border:`2px solid ${seqMode==="auto"?T.accent:T.border}`,background:seqMode==="auto"?T.accentLight:"#fff",color:seqMode==="auto"?T.accent:T.muted,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                🔄 Auto
              </button>
              <button onClick={()=>setSeqMode("manual")}
                style={{flex:1,padding:"6px",borderRadius:5,border:`2px solid ${seqMode==="manual"?"#047857":T.border}`,background:seqMode==="manual"?"#d1fae5":"#fff",color:seqMode==="manual"?"#047857":T.muted,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                ✏️ Manual
              </button>
            </div>
            {seqMode==="auto"
              ? <div style={{fontFamily:"monospace",fontWeight:800,fontSize:22,color:T.accent}}>{autoSeq}
                  <span style={{fontSize:11,color:T.muted,fontWeight:400,marginLeft:10}}>auto-incremented</span>
                </div>
              : <Input
                  type="number" min={1} max={9999}
                  value={manualSeq}
                  onChange={e=>setManualSeq(e.target.value)}
                  placeholder="e.g. 5"
                  style={{fontFamily:"monospace",fontWeight:800,fontSize:18}}
                />
            }
          </div>

          {/* Part details (optional, before save) */}
          {canGenerate && (
            <div style={{marginTop:4}}>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,marginBottom:10}}>
                Part Details (Optional)
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div><label style={sLabel}>Part No.</label><Input value={partNo} onChange={e=>setPartNo(e.target.value)} placeholder="e.g. AN-BRG-001"/></div>
                <div><label style={sLabel}>OEM Part No.</label><Input value={oemPart} onChange={e=>setOemPart(e.target.value)} placeholder="e.g. 1234567"/></div>
                <div><label style={sLabel}>Qty</label><Input type="number" value={qty} onChange={e=>setQty(e.target.value)} placeholder="0"/></div>
                <div>
                  <label style={sLabel}>Unit</label>
                  <Select value={unit} onChange={e=>setUnit(e.target.value)}>
                    {["EA","SET","KIT","L","KG","M","BOX","ROLL"].map(u=><option key={u}>{u}</option>)}
                  </Select>
                </div>
              </div>
              <div style={{marginBottom:10}}><label style={sLabel}>Location</label><Input value={loc} onChange={e=>setLoc(e.target.value)} placeholder="e.g. WH-A1"/></div>
              <div><label style={sLabel}>Remarks</label><Input value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="e.g. Critical spare, change every 500hr"/></div>
            </div>
          )}
        </Card>

        {/* ── RIGHT: Output + Image ── */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Generated Code */}
          <Card style={{borderTop:`3px solid ${T.accent}`}}>
            <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>Generated Code</div>
            {generatedCode ? (
              <>
                <div style={{textAlign:"center",margin:"12px 0"}}>
                  <span style={{background:T.header,color:"#38bdf8",fontFamily:"monospace",fontWeight:800,fontSize:22,padding:"12px 18px",borderRadius:8,letterSpacing:3,display:"inline-block"}}>
                    {generatedCode}
                  </span>
                </div>
                {seqLoading
                  ? <div style={{textAlign:"center",color:T.muted,fontSize:12,marginBottom:10}}>⏳ Checking sequence…</div>
                  : codeExists
                    ? <div style={{textAlign:"center",color:T.danger,fontWeight:700,fontSize:13,marginBottom:10}}>⚠️ This code already exists</div>
                    : <div style={{textAlign:"center",color:T.success,fontSize:12,marginBottom:10}}>✅ Valid 6-segment code</div>
                }
                {saved
                  ? <div style={{display:"flex",gap:8}}>
                      <div style={{flex:1,textAlign:"center",padding:"10px",background:"#d1fae5",borderRadius:6,color:"#047857",fontWeight:700,fontSize:13}}>✅ Saved!</div>
                      <Btn variant="secondary" onClick={resetForm} style={{flex:1}}>＋ New Code</Btn>
                    </div>
                  : <Btn onClick={handleSave} style={{width:"100%"}} disabled={saving||codeExists||seqLoading}>
                      {saving?"Saving…":"💾 Save to Master Table"}
                    </Btn>
                }
              </>
            ) : (
              <div style={{textAlign:"center",padding:"28px 0",color:T.muted,fontSize:13}}>Complete all 5 selections to generate code</div>
            )}
          </Card>

          {/* Code Interpretation */}
          {generatedCode && (
            <Card>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>Code Breakdown</div>
              {[
                {seg:step.cat,  name:"Main Category",   val:cat?.label},
                {seg:step.mfr,  name:"Manufacturer",     val:mfr?.label},
                {seg:step.model,name:"Model",             val:model?.label},
                {seg:step.disc, name:isEngine?"Engine System":"Discipline", val:disc?.label},
                {seg:step.fg,   name:"Functional Group", val:fg?.label},
                {seg:seqNum,    name:"Sequence",          val:`Item Number ${parseInt(seqNum)}`},
              ].map(b=>(
                <div key={b.seg} style={{display:"flex",alignItems:"center",gap:12,marginBottom:7,padding:"6px 10px",background:T.subtle,borderRadius:5}}>
                  <Pill size={11}>{b.seg}</Pill>
                  <div>
                    <div style={{fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase"}}>{b.name}</div>
                    <div style={{fontSize:13,fontWeight:600,color:T.text}}>{b.val||"—"}</div>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* Descriptions */}
          {generatedCode && (
            <Card>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Auto-Generated Descriptions</div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,color:T.muted,fontWeight:700,marginBottom:3}}>SHORT</div>
                <div style={{fontSize:13,fontWeight:700,color:T.text,padding:"6px 10px",background:"#f0f9ff",borderRadius:5}}>{shortDesc}</div>
              </div>
              <div>
                <div style={{fontSize:11,color:T.muted,fontWeight:700,marginBottom:3}}>LONG</div>
                <div style={{fontSize:13,color:T.text,padding:"6px 10px",background:"#f0f9ff",borderRadius:5}}>{longDesc}</div>
              </div>
            </Card>
          )}

          {/* Image Upload */}
          {generatedCode && (
            <Card style={{borderLeft:"3px solid #0e7490"}}>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>
                📷 Part Image (Optional)
              </div>
              {dbReady
                ? <FileUpload
                    partCode={generatedCode}
                    bucket="part-images"
                    label="Upload part photo (JPG / PNG / WEBP, max 10MB)"
                    currentUrl={imageUrl}
                    onUploaded={url=>{ setImageUrl(url); flash("Image uploaded successfully"); }}
                  />
                : <div style={{fontSize:12,color:T.muted,padding:"12px",background:T.subtle,borderRadius:6}}>
                    🟡 Image upload requires a connected Supabase database. Running in local mode.
                  </div>
              }
              {imageUrl && (
                <div style={{marginTop:10,padding:"8px 12px",background:"#d1fae5",borderRadius:6,fontSize:12,color:"#047857",fontWeight:600}}>
                  ✅ Image will be saved with the part when you click "Save to Master Table"
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <CodeLegend items={[
        {code:"AA",label:"Main Category"},{code:"BB",label:"Manufacturer"},
        {code:"CC",label:"Model"},{code:"DD",label:"Discipline / Engine System"},
        {code:"EE",label:"Functional Group"},{code:"NNNN",label:"Sequence Number (auto or manual)"},
      ]} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PART DETAIL MODAL — View + Edit + Delete
// ═══════════════════════════════════════════════════════════════

function PartDetailModal({ part, data, onClose, onDeleted, onUpdated }) {
  if (!part) return null;
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, ops, dbReady } = data;

  const [mode,        setMode]        = useState('view'); // 'view' | 'edit' | 'confirm-delete'
  const [fullPart,     setFullPart]    = useState(part);   // full record once fetched
  const [loadingFull,  setLoadingFull] = useState(false);
  const [form,        setForm]        = useState({ ...part });
  const [saving,      setSaving]      = useState(false);
  const [toast,       setToast]       = useState(null);
  const [imgUrl,      setImgUrl]      = useState(part.imageUrl || null);

  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  // The Hierarchy Tree passes a lightweight part object (code, short_desc,
  // cat, mfr, model, disc, fg, image_url, status only — no part_no, qty,
  // location, etc). Fetch the full record here so the modal always shows
  // complete data regardless of which page opened it.
  useEffect(() => {
    if (!dbReady) return; // local mode already has the full object
    // The Hierarchy Tree passes a lightweight part object (code, short_desc,
    // cat, mfr, model, disc, fg, image_url, status only — no part_no, qty,
    // location, etc). It's explicitly flagged with _isLightweight so we know
    // to fetch the full record here, regardless of default values mapPart()
    // fills in (e.g. partNo defaults to '' even when the column wasn't
    // fetched at all, so checking `=== undefined` doesn't work).
    if (!part._isLightweight) return;
    let cancelled = false;
    setLoadingFull(true);
    db.fetchParts({ search: part.code }, 0, 5).then(({ data: rows }) => {
      if (cancelled) return;
      const match = (rows || []).find(r => r.code === part.code);
      if (match) {
        const full = mapPart(match);
        setFullPart(full);
        setForm(full);
        setImgUrl(full.imageUrl || null);
      }
    }).finally(() => { if (!cancelled) setLoadingFull(false); });
    return () => { cancelled = true; };
  }, [part.code, dbReady]);

  const partView = fullPart; // use this everywhere below instead of raw `part`

  const cat  = categories.find(c => c.code === partView.cat);
  const mfr  = manufacturers.find(m => m.code === partView.mfr);
  const mdl  = models.find(m => m.code === partView.model);
  const isEng = partView.cat === "EN";
  const disc = isEng
    ? engineSystems.find(s => s.code === partView.disc)
    : disciplines.find(d => d.code === partView.disc);
  const fg   = funcGroups.find(f => f.code === partView.fg);

  const segments = [
    { seg:partView.cat,   label:"Category",              val:cat?.label,  color:cat?.color||T.accent, bg:cat?.bg||T.accentLight },
    { seg:partView.mfr,   label:"Manufacturer",           val:mfr?.label,  color:"#b45309", bg:"#fef3c7" },
    { seg:partView.model, label:"Model",                  val:mdl?.label,  color:"#047857", bg:"#d1fae5" },
    { seg:partView.disc,  label:isEng?"Engine System":"Discipline", val:disc?.label, color:disc?.color||"#374151", bg:disc?.bg||"#f3f4f6" },
    { seg:partView.fg,    label:"Functional Group",       val:fg?.label,   color:"#6d28d9", bg:"#f5f3ff" },
    { seg:partView.code.split("-").pop(), label:"Sequence", val:`Item #${parseInt(partView.code.split("-").pop())}`, color:"#475569", bg:"#f1f5f9" },
  ];

  const handleSave = async () => {
    setSaving(true);
    const dbRow = {
      short_desc:form.shortDesc, long_desc:form.longDesc,
      part_no:form.partNo||'', oem_part:form.oemPart||'',
      qty:Number(form.qty)||0, unit:form.unit||'EA',
      location:form.loc||'', min_stock:Number(form.minStock)||0,
      max_stock:Number(form.maxStock)||0, remarks:form.remarks||'',
      status:form.status||'Active', image_url:imgUrl||null,
    };
    const { error } = await ops.savePart({ ...form, imageUrl:imgUrl }, part.code);
    setSaving(false);
    if (error) { flash(`Error: ${error.message}`, 'err'); return; }
    flash('Part updated successfully');
    if (onUpdated) onUpdated({ ...form, imageUrl:imgUrl });
    setMode('view');
  };

  const handleDelete = async () => {
    setSaving(true);
    const { error } = await ops.deletePart(part.code);
    setSaving(false);
    if (error) { flash(`Error: ${error.message}`, 'err'); setMode('view'); return; }
    if (onDeleted) onDeleted(part.code);
    onClose();
  };

  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };
  const statusColor = { Active:T.success,   Inactive:T.warn,   Obsolete:T.danger };
  const statusBg    = { Active:T.successBg, Inactive:T.warnBg, Obsolete:T.dangerBg };

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}
      onClick={e=>{ if(e.target===e.currentTarget && mode!=='confirm-delete') onClose(); }}>
      <Toast msg={toast}/>
      <div style={{ background:T.card,borderRadius:12,width:"100%",maxWidth:740,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,0.4)",display:"flex",flexDirection:"column" }}>

        {/* Header */}
        <div style={{ padding:"18px 24px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between",position:"sticky",top:0,background:T.card,zIndex:1 }}>
          <div>
            <div style={{ marginBottom:6 }}><CodeTag code={partView.code}/></div>
            <div style={{ fontWeight:800,fontSize:16,color:T.text }}>{partView.shortDesc}</div>
          </div>
          <div style={{ display:"flex",gap:8,alignItems:"center",flexShrink:0,marginLeft:12 }}>
            {mode==='view' && <>
              <Btn small onClick={()=>setMode('edit')}>✏️ Edit</Btn>
              <Btn small variant="danger" onClick={()=>setMode('confirm-delete')}>🗑 Delete</Btn>
            </>}
            <button onClick={onClose} style={{ background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted,padding:4 }}>✕</button>
          </div>
        </div>

        {/* CONFIRM DELETE */}
        {mode==='confirm-delete' && (
          <div style={{ padding:24 }}>
            <div style={{ background:T.dangerBg,borderRadius:8,padding:20,marginBottom:20,border:`1px solid #fca5a5` }}>
              <div style={{ fontWeight:800,fontSize:16,color:T.danger,marginBottom:8 }}>⚠️ Delete this spare part?</div>
              <div style={{ fontFamily:"monospace",fontWeight:700,color:T.danger,fontSize:14,marginBottom:6 }}>{partView.code}</div>
              <div style={{ fontSize:13,color:T.text }}>{partView.shortDesc}</div>
            </div>
            <p style={{ fontSize:13,color:T.muted,marginBottom:20 }}>This will soft-delete the record. It will no longer appear in any page but is recoverable from the database.</p>
            <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
              <Btn variant="secondary" onClick={()=>setMode('view')}>Cancel</Btn>
              <Btn variant="danger" onClick={handleDelete} disabled={saving}>{saving?"Deleting…":"🗑 Confirm Delete"}</Btn>
            </div>
          </div>
        )}

        {/* VIEW MODE */}
        {mode==='view' && (
          <div style={{ padding:"20px 24px" }}>
            {loadingFull && (
              <div style={{ textAlign:"center", padding:"10px 0", color:T.muted, fontSize:12 }}>⏳ Loading full part details…</div>
            )}
            {/* Image */}
            <div style={{ marginBottom:20,textAlign:"center" }}>
              {partView.imageUrl
                ? <img src={partView.imageUrl} alt={partView.shortDesc} style={{ maxWidth:"100%",maxHeight:280,borderRadius:10,border:`1px solid ${T.border}`,objectFit:"contain",background:"#f8fafc" }} onError={e=>e.target.style.display="none"}/>
                : <div style={{ padding:"28px 0",background:T.subtle,borderRadius:10,border:`1px dashed ${T.border}` }}>
                    <div style={{ fontSize:32,marginBottom:4 }}>📷</div>
                    <div style={{ fontSize:12,color:T.muted }}>No image — click Edit to add one</div>
                  </div>
              }
            </div>
            {/* Segments */}
            <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:20 }}>
              {segments.map(s=>(
                <div key={s.seg} style={{ background:s.bg,borderRadius:7,padding:"8px 14px",textAlign:"center",minWidth:80 }}>
                  <div style={{ fontFamily:"monospace",fontWeight:800,fontSize:13,color:s.color }}>{s.seg}</div>
                  <div style={{ fontSize:10,color:s.color,marginTop:2,fontWeight:600 }}>{s.label}</div>
                  <div style={{ fontSize:11,color:T.text,marginTop:2 }}>{s.val||"—"}</div>
                </div>
              ))}
            </div>
            {/* Details grid */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20 }}>
              {[
                {label:"Short Description", val:partView.shortDesc},
                {label:"Long Description",  val:partView.longDesc||"—"},
                {label:"Part Number",       val:partView.partNo||"—"},
                {label:"OEM Part Number",   val:partView.oemPart||"—"},
                {label:"Quantity",          val:`${partView.qty??0} ${partView.unit||"EA"}`},
                {label:"Location",          val:partView.loc||"—"},
                {label:"Min Stock",         val:partView.minStock??0},
                {label:"Max Stock",         val:partView.maxStock??0},
                {label:"Status",            val:partView.status||"Active"},
                {label:"Remarks",           val:partView.remarks||"—"},
              ].map(f=>(
                <div key={f.label} style={{ background:T.subtle,borderRadius:6,padding:"9px 12px" }}>
                  <div style={{ fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,marginBottom:3 }}>{f.label}</div>
                  <div style={{ fontSize:13,fontWeight:600,
                    color:f.label==="Status"?(statusColor[f.val]||T.text):T.text,
                    background:f.label==="Status"?(statusBg[f.val]||"transparent"):"transparent",
                    display:"inline-block",padding:f.label==="Status"?"1px 8px":0,borderRadius:4,
                  }}>{f.val}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex",justifyContent:"flex-end" }}>
              <Btn variant="secondary" onClick={onClose}>Close</Btn>
            </div>
          </div>
        )}

        {/* EDIT MODE */}
        {mode==='edit' && (
          <div style={{ padding:"20px 24px" }}>
            <div style={{ background:"#fffbeb",border:"1px solid #fbbf24",borderRadius:7,padding:"10px 14px",marginBottom:18,fontSize:12,color:"#92400e",fontWeight:600 }}>
              ✏️ Editing editable fields only. The 6-segment code (<strong>{part.code}</strong>) cannot be changed.
            </div>
            <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
                <div><label style={sLabel}>Short Description</label><Input value={form.shortDesc||""} onChange={e=>setForm(f=>({...f,shortDesc:e.target.value}))}/></div>
                <div><label style={sLabel}>Long Description</label><Input value={form.longDesc||""} onChange={e=>setForm(f=>({...f,longDesc:e.target.value}))}/></div>
                <div><label style={sLabel}>Part Number</label><Input value={form.partNo||""} onChange={e=>setForm(f=>({...f,partNo:e.target.value}))} placeholder="e.g. AN-BRG-001"/></div>
                <div><label style={sLabel}>OEM Part Number</label><Input value={form.oemPart||""} onChange={e=>setForm(f=>({...f,oemPart:e.target.value}))} placeholder="e.g. 1234567"/></div>
                <div><label style={sLabel}>Quantity</label><Input type="number" value={form.qty||0} onChange={e=>setForm(f=>({...f,qty:e.target.value}))}/></div>
                <div><label style={sLabel}>Unit</label>
                  <Select value={form.unit||"EA"} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}>
                    {["EA","SET","KIT","L","KG","M","BOX","ROLL"].map(u=><option key={u}>{u}</option>)}
                  </Select>
                </div>
                <div><label style={sLabel}>Location</label><Input value={form.loc||""} onChange={e=>setForm(f=>({...f,loc:e.target.value}))} placeholder="e.g. WH-A1"/></div>
                <div><label style={sLabel}>Status</label>
                  <Select value={form.status||"Active"} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {["Active","Inactive","Obsolete"].map(s=><option key={s}>{s}</option>)}
                  </Select>
                </div>
                <div><label style={sLabel}>Min Stock</label><Input type="number" value={form.minStock||0} onChange={e=>setForm(f=>({...f,minStock:e.target.value}))}/></div>
                <div><label style={sLabel}>Max Stock</label><Input type="number" value={form.maxStock||0} onChange={e=>setForm(f=>({...f,maxStock:e.target.value}))}/></div>
              </div>
              <div><label style={sLabel}>Remarks</label><Input value={form.remarks||""} onChange={e=>setForm(f=>({...f,remarks:e.target.value}))}/></div>

              {/* Image upload in edit mode */}
              <div>
                <label style={sLabel}>Part Image</label>
                {dbReady
                  ? <FileUpload partCode={part.code} bucket="part-images" label="" currentUrl={imgUrl} onUploaded={url=>{setImgUrl(url);flash("Image uploaded");}}/>
                  : <div style={{ fontSize:12,color:T.muted,padding:10,background:T.subtle,borderRadius:6 }}>🟡 Image upload requires live DB</div>
                }
              </div>

              <div style={{ display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:`1px solid ${T.border}` }}>
                <Btn variant="secondary" onClick={()=>setMode('view')}>Cancel</Btn>
                <Btn onClick={handleSave} disabled={saving}>{saving?"Saving…":"💾 Save Changes"}</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function HierarchyTreePage({ data }) {
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, dbReady } = data;
  const [expanded,     setExpanded]     = useState({ ROOT:true });
  const [selectedPart, setSelectedPart] = useState(null);
  const [treeParts,    setTreeParts]    = useState(null);   // null = not loaded yet
  const [loadError,    setLoadError]    = useState(null);
  const [loadingTree,  setLoadingTree]  = useState(false);

  const toggle = k => setExpanded(e=>({...e,[k]:!e[k]}));

  // Load ALL parts ONCE, but only the lightweight fields needed for the tree
  // (code, cat, mfr, model, disc, fg, short_desc, image presence).
  // This single query replaces hundreds of per-node count queries.
  useEffect(() => {
    if (!dbReady) { setTreeParts(data.parts || []); return; }
    let cancelled = false;
    setLoadingTree(true);
    setLoadError(null);

    (async () => {
      try {
        const PAGE = 1000;
        let all = [];
        let page = 0;
        // Pull pages of lightweight rows until exhausted (safety cap 20 pages = 20k parts)
        while (page < 20) {
          const { data: rows, error } = await db.fetchTreeParts(page, PAGE);
          if (error) throw error;
          if (!rows || rows.length === 0) break;
          all = all.concat(rows);
          if (rows.length < PAGE) break;
          page++;
        }
        if (!cancelled) setTreeParts(all.map(mapPart));
      } catch (e) {
        if (!cancelled) setLoadError(e.message || "Failed to load hierarchy data");
      } finally {
        if (!cancelled) setLoadingTree(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dbReady]);

  const parts = treeParts || [];

  const expandAll = () => {
    const keys = {ROOT:true};
    categories.forEach(cat=>{
      keys[cat.code]=true;
      manufacturers.filter(m=>(m.catCodes||[]).includes(cat.code)).forEach(mfr=>{
        keys[`${cat.code}-${mfr.code}`]=true;
        models.filter(m=>m.mfrCode===mfr.code).forEach(mod=>{
          const modKey = `${cat.code}-${mfr.code}-${mod.code}`;
          keys[modKey]=true;
          const sections = cat.code === "EN" ? engineSystems : disciplines;
          sections.forEach(s=>{ keys[`${modKey}-${s.code}`]=true; });
        });
      });
    });
    setExpanded(keys);
  };

  const Node = ({label,pill,pillColor,pillBg,nodeKey,depth=0,count,children,alwaysExpandable=false,tag}) => {
    const isOpen = expanded[nodeKey];
    const hasKids = alwaysExpandable || (children && (Array.isArray(children) ? children.filter(Boolean).length > 0 : true));
    return (
      <div style={{marginLeft:depth*18}}>
        <div onClick={()=>hasKids&&toggle(nodeKey)} style={{ display:"flex",alignItems:"center",gap:8,padding:"5px 8px",borderRadius:5,cursor:hasKids?"pointer":"default",marginBottom:2,background:isOpen&&hasKids?"#eff6ff":"transparent",transition:"background .1s" }}>
          <span style={{ fontSize:11,color:"#94a3b8",width:14,flexShrink:0 }}>{hasKids?(isOpen?"▼":"▶"):"—"}</span>
          {pill&&<Pill color={pillColor} bg={pillBg} size={11}>{pill}</Pill>}
          <span style={{ fontSize:13,fontWeight:depth<3?700:400,color:depth===0?T.accent:T.text }}>{label}</span>
          {tag&&<span style={{ fontSize:10,background:"#fef3c7",color:"#92400e",padding:"1px 6px",borderRadius:3,fontWeight:700 }}>{tag}</span>}
          {count!==undefined&&(
            <span style={{ fontSize:11,color:count>0?T.accent:T.muted,marginLeft:4,fontWeight:count>0?700:400 }}>
              ({count > 0 ? count+" parts" : "empty"})
            </span>
          )}
        </div>
        {isOpen&&children}
      </div>
    );
  };

  // Render discipline/section level — all data comes from the single `parts` array loaded once
  const renderSectionLevel = (cat, mfr, mod, sections, isEngine) => {
    return sections.map(sec=>{
      const secKey = `${cat.code}-${mfr.code}-${mod.code}-${sec.code}`;
      const partsInSec = parts.filter(p=>p.cat===cat.code&&p.mfr===mfr.code&&p.model===mod.code&&p.disc===sec.code);
      const usedFGs = funcGroups.filter(fg=>
        partsInSec.some(p=>p.fg===fg.code)
      );
      return (
        <Node
          key={sec.code}
          label={sec.label}
          pill={sec.code}
          pillColor={sec.color}
          pillBg={sec.bg}
          nodeKey={secKey}
          depth={4}
          count={partsInSec.length}
          alwaysExpandable={true}
          tag={isEngine ? "Engine System" : null}
        >
          {usedFGs.map(fg=>{
            const fgParts = partsInSec.filter(p=>p.fg===fg.code);
            const fgKey = `${secKey}-${fg.code}`;
            return (
              <Node key={fg.code} label={fg.label} pill={fg.code} pillColor="#6d28d9" pillBg="#f5f3ff" nodeKey={fgKey} depth={5} count={fgParts.length}>
                {fgParts.slice(0, 100).map(p=>(
                  <div key={p.code}
                    onClick={()=>setSelectedPart({ ...p, _isLightweight: true })}
                    style={{ marginLeft:90,padding:"5px 10px",borderRadius:5,marginBottom:3,background:"#f8fafc",display:"flex",alignItems:"center",gap:8,cursor:"pointer",border:`1px solid transparent`,transition:"all .15s" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.borderColor=T.accent;}}
                    onMouseLeave={e=>{e.currentTarget.style.background="#f8fafc";e.currentTarget.style.borderColor="transparent";}}>
                    <span style={{ fontSize:11,color:"#94a3b8" }}>—</span>
                    <CodeTag code={p.code} />
                    <span style={{ fontSize:12,color:T.muted,flex:1 }}>{p.shortDesc}</span>
                    {p.imageUrl&&<span style={{ fontSize:11 }}>📷</span>}
                    <span style={{ fontSize:11,color:T.accent,fontWeight:600 }}>View →</span>
                  </div>
                ))}
                {fgParts.length > 100 && (
                  <div style={{ marginLeft:90,fontSize:11,color:T.muted,padding:"4px 0",fontStyle:"italic" }}>
                    …and {fgParts.length - 100} more. Use Master Table to browse all.
                  </div>
                )}
              </Node>
            );
          })}
          {usedFGs.length===0&&(
            <div style={{ marginLeft:72,padding:"5px 10px",borderRadius:4,marginBottom:2,background:"#f8fafc",border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",gap:8 }}>
              <span style={{ fontSize:11,color:"#94a3b8" }}>—</span>
              <span style={{ fontSize:12,color:"#94a3b8",fontStyle:"italic" }}>No parts coded yet</span>
            </div>
          )}
        </Node>
      );
    });
  };

  return (
    <div>
      <PageHeader title="Hierarchy Tree" sub="Full expandable classification tree — Engines use dedicated system sections" />

      <Card style={{ marginBottom:16,borderLeft:"4px solid #b45309",background:"#fffbeb" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10 }}>
          <span style={{ fontSize:16 }}>🔧</span>
          <span style={{ fontWeight:700,fontSize:14,color:"#92400e" }}>Engine Classification Note</span>
        </div>
        <p style={{ margin:"0 0 10px",fontSize:13,color:T.muted }}>
          <strong>Engines (EN)</strong> use dedicated system sections instead of the standard ME/EL/AC disciplines:
        </p>
        <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
          {engineSystems.map(s=>(
            <div key={s.code} style={{ display:"flex",alignItems:"center",gap:6,background:s.bg,borderRadius:5,padding:"4px 10px" }}>
              <span style={{ fontFamily:"monospace",fontWeight:800,color:s.color,fontSize:11 }}>{s.code}</span>
              <span style={{ fontSize:12,color:s.color }}>{s.label}</span>
            </div>
          ))}
        </div>
      </Card>

      {loadingTree && (
        <Card style={{ marginBottom:16, textAlign:"center", padding:24 }}>
          <div style={{ color:T.muted, fontSize:13 }}>⏳ Loading hierarchy data ({parts.length.toLocaleString()} loaded so far)…</div>
        </Card>
      )}
      {loadError && (
        <Card style={{ marginBottom:16, background:T.dangerBg, border:"1px solid #fca5a5" }}>
          <div style={{ color:T.danger, fontSize:13, fontWeight:600 }}>⚠️ {loadError}</div>
        </Card>
      )}

      {!loadingTree && (
        <Card>
          <div style={{ display:"flex",gap:10,marginBottom:16,alignItems:"center" }}>
            <Btn small variant="secondary" onClick={()=>setExpanded({ROOT:true})}>Collapse All</Btn>
            <Btn small onClick={expandAll}>Expand All</Btn>
            <span style={{ fontSize:12, color:T.muted, marginLeft:"auto" }}>{parts.length.toLocaleString()} parts loaded</span>
          </div>
          <Node label="Engineering Spare Parts" nodeKey="ROOT" depth={0} count={parts.length}>
            {categories.map(cat=>{
              const isEngine = cat.code === "EN";
              const catMfrs = manufacturers.filter(m=>(m.catCodes||[]).includes(cat.code));
              const catParts = parts.filter(p=>p.cat===cat.code);
              return (
                <Node key={cat.code} label={cat.label} pill={cat.code} pillColor={cat.color} pillBg={cat.bg} nodeKey={cat.code} depth={1} count={catParts.length}>
                  {catMfrs.map(mfr=>{
                    const mfrModels = models.filter(m=>m.mfrCode===mfr.code);
                    const mfrParts = catParts.filter(p=>p.mfr===mfr.code);
                    return (
                      <Node key={mfr.code} label={mfr.label} pill={mfr.code} pillColor="#b45309" pillBg="#fef3c7" nodeKey={`${cat.code}-${mfr.code}`} depth={2} count={mfrParts.length}>
                        {mfrModels.map(mod=>{
                          const modParts = mfrParts.filter(p=>p.model===mod.code);
                          const sections = isEngine ? engineSystems : disciplines;
                          return (
                            <Node key={mod.code} label={mod.label} pill={mod.code} pillColor="#047857" pillBg="#d1fae5" nodeKey={`${cat.code}-${mfr.code}-${mod.code}`} depth={3} count={modParts.length} alwaysExpandable={true}>
                              {renderSectionLevel(cat, mfr, mod, sections, isEngine)}
                            </Node>
                          );
                        })}
                      </Node>
                    );
                  })}
                </Node>
              );
            })}
          </Node>
        </Card>
      )}
      <CodeLegend items={[
        ...categories.map(c=>({code:c.code,label:c.label})),
        ...manufacturers.filter(m=>m.catCodes.includes("EN")).map(m=>({code:m.code,label:m.label+" (Engine)"})),
        ...engineSystems.map(s=>({code:s.code,label:s.label+" (Engine System)"})),
        ...disciplines.map(d=>({code:d.code,label:d.label+" (Other Categories)"})),
      ]} />
      {selectedPart && (
        <PartDetailModal
          part={selectedPart} data={data}
          onClose={()=>setSelectedPart(null)}
          onUpdated={(updated)=>{
            setSelectedPart(prev=>({...prev,...updated}));
            setTreeParts(prev => prev ? prev.map(p=>p.code===selectedPart.code?{...p,...updated}:p) : prev);
          }}
          onDeleted={()=>{
            setSelectedPart(null);
            setTreeParts(prev => prev ? prev.filter(p=>p.code!==selectedPart.code) : prev);
          }}
        />
      )}
    </div>
  );
}

// ─── MASTER TABLE ─────────────────────────────────────────────
const PAGE_SIZE = 50;

function MasterTablePage({ data }) {
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, ops, dbReady } = data;
  const allSections = [...disciplines, ...engineSystems];

  // Filters
  const [search,   setSearch]   = useState("");
  const [fCat,     setFCat]     = useState("");
  const [fMfr,     setFMfr]     = useState("");
  const [fModel,   setFModel]   = useState("");
  const [fDisc,    setFDisc]    = useState("");
  const [fStatus,  setFStatus]  = useState("");

  // Pagination
  const [page,       setPage]       = useState(0);
  const [total,      setTotal]      = useState(0);
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [searchInput,setSearchInput]= useState("");

  // Part detail modal
  const [selectedPart, setSelectedPart] = useState(null);

  const filters = useMemo(()=>({
    search: search||undefined, cat: fCat||undefined, mfr: fMfr||undefined,
    model: fModel||undefined, disc: fDisc||undefined, status: fStatus||undefined,
  }),[search, fCat, fMfr, fModel, fDisc, fStatus]);

  // Debounce search
  useEffect(()=>{
    const t = setTimeout(()=>setSearch(searchInput), 400);
    return ()=>clearTimeout(t);
  },[searchInput]);

  // Reset page on filter change
  useEffect(()=>{ setPage(0); },[filters]);

  // Fetch from DB when dbReady, else use INIT_PARTS
  useEffect(()=>{
    if (!dbReady) {
      // local mode — use INIT_PARTS from data
      setRows(data.parts || []);
      setTotal((data.parts||[]).length);
      return;
    }
    setLoading(true);
    Promise.all([
      db.fetchPartsCount(filters),
      db.fetchParts(filters, page, PAGE_SIZE),
    ]).then(([countRes, dataRes]) => {
      setTotal(countRes.count ?? 0);
      setRows((dataRes.data ?? []).map(mapPart));
    }).finally(()=>setLoading(false));
  },[filters, page, dbReady]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filteredMfrs  = manufacturers.filter(m => !fCat  || (m.catCodes||[]).includes(fCat));
  const filteredModels= models.filter(m => !fMfr || m.mfrCode === fMfr);

  const selStyle = { padding:"7px 10px", borderRadius:5, border:`1px solid ${T.border}`, fontSize:13, color:T.text, background:"#fff", fontFamily:"inherit" };

  return (
    <div>
      <PageHeader title="Master Spare Parts Table" sub={`${total.toLocaleString()} total coded parts`} />

      {/* Filters */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <input
            value={searchInput}
            onChange={e=>setSearchInput(e.target.value)}
            placeholder="🔍 Code, description, part no…"
            style={{ ...selStyle, minWidth:220, flex:"1 1 200px" }}
          />
          <select value={fCat} onChange={e=>{setFCat(e.target.value);setFMfr("");setFModel("");}} style={selStyle}>
            <option value="">All Categories</option>
            {categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <select value={fMfr} onChange={e=>{setFMfr(e.target.value);setFModel("");}} style={selStyle}>
            <option value="">All Manufacturers</option>
            {filteredMfrs.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <select value={fModel} onChange={e=>setFModel(e.target.value)} style={selStyle}>
            <option value="">All Models</option>
            {filteredModels.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <select value={fDisc} onChange={e=>setFDisc(e.target.value)} style={selStyle}>
            <option value="">All Systems</option>
            <optgroup label="Standard">{disciplines.map(d=><option key={d.code} value={d.code}>{d.label}</option>)}</optgroup>
            <optgroup label="Engine">{engineSystems.map(s=><option key={s.code} value={s.code}>{s.label}</option>)}</optgroup>
          </select>
          <select value={fStatus} onChange={e=>setFStatus(e.target.value)} style={selStyle}>
            <option value="">All Status</option>
            {["Active","Inactive","Obsolete"].map(s=><option key={s}>{s}</option>)}
          </select>
          {(search||fCat||fMfr||fModel||fDisc||fStatus)&&(
            <button onClick={()=>{setSearchInput("");setSearch("");setFCat("");setFMfr("");setFModel("");setFDisc("");setFStatus("");}}
              style={{ padding:"7px 12px", borderRadius:5, border:"1px solid #fca5a5", background:"#fee2e2", color:T.danger, fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>
              ✕ Clear
            </button>
          )}
        </div>
      </Card>

      {/* Pagination controls */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10, flexWrap:"wrap" }}>
        <span style={{ fontSize:13, color:T.muted }}>
          {loading ? "Loading…" : `${total.toLocaleString()} results · Page ${page+1} of ${totalPages||1}`}
        </span>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          <button onClick={()=>setPage(0)} disabled={page===0||loading}
            style={{ padding:"5px 10px", borderRadius:5, border:`1px solid ${T.border}`, background:page===0?"#f1f5f9":"#fff", cursor:page===0?"default":"pointer", fontSize:12, fontFamily:"inherit" }}>«</button>
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0||loading}
            style={{ padding:"5px 12px", borderRadius:5, border:`1px solid ${T.border}`, background:page===0?"#f1f5f9":"#fff", cursor:page===0?"default":"pointer", fontSize:12, fontFamily:"inherit" }}>‹ Prev</button>
          <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1||loading}
            style={{ padding:"5px 12px", borderRadius:5, border:`1px solid ${T.border}`, background:page>=totalPages-1?"#f1f5f9":"#fff", cursor:page>=totalPages-1?"default":"pointer", fontSize:12, fontFamily:"inherit" }}>Next ›</button>
          <button onClick={()=>setPage(totalPages-1)} disabled={page>=totalPages-1||loading}
            style={{ padding:"5px 10px", borderRadius:5, border:`1px solid ${T.border}`, background:page>=totalPages-1?"#f1f5f9":"#fff", cursor:page>=totalPages-1?"default":"pointer", fontSize:12, fontFamily:"inherit" }}>»</button>
        </div>
      </div>

      <div style={{ fontSize:12, color:T.muted, marginBottom:8 }}>👆 Click any row to view, edit or delete the part</div>

      <Card>
        <div style={{ overflowX:"auto" }}>
          {loading
            ? <div style={{ textAlign:"center", padding:40, color:T.muted }}>⏳ Loading parts…</div>
            : (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:T.header }}>
                  {["","Code","Short Description","Cat","Mfr","Model","System","Func","Part No","Qty","Loc","Status"].map(h=>(
                    <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", fontSize:10, letterSpacing:0.8, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length===0
                  ? <tr><td colSpan={12} style={{ textAlign:"center", padding:36, color:T.muted }}>No parts found.</td></tr>
                  : rows.map((r,i)=>{
                    const cat = categories.find(x=>x.code===r.cat);
                    const mdl = models.find(x=>x.code===r.model);
                    const sec = allSections.find(x=>x.code===r.disc);
                    const dc  = T.disc[r.disc]||{c:sec?.color||T.muted, b:sec?.bg||T.subtle};
                    return (
                      <tr key={r.code}
                        onClick={()=>setSelectedPart(r)}
                        style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card, cursor:"pointer" }}
                        onMouseEnter={e=>e.currentTarget.style.background="#eff6ff"}
                        onMouseLeave={e=>e.currentTarget.style.background=i%2?T.subtle:T.card}>
                        <td style={{ padding:"7px 10px", textAlign:"center" }}>
                          {r.imageUrl ? <span title="Has image">📷</span> : <span style={{ color:"#d1d5db",fontSize:10 }}>—</span>}
                        </td>
                        <td style={{ padding:"7px 10px" }}><CodeTag code={r.code}/></td>
                        <td style={{ padding:"7px 10px", fontWeight:600, color:T.text, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.shortDesc}</td>
                        <td style={{ padding:"7px 10px" }}><Pill color={cat?.color} bg={cat?.bg}>{r.cat}</Pill></td>
                        <td style={{ padding:"7px 10px" }}><Pill color="#b45309" bg="#fef3c7">{r.mfr}</Pill></td>
                        <td style={{ padding:"7px 10px", fontSize:11, color:T.muted, whiteSpace:"nowrap" }}>{mdl?.label||r.model}</td>
                        <td style={{ padding:"7px 10px" }}><Pill color={dc.c||sec?.color} bg={dc.b||sec?.bg}>{r.disc}</Pill></td>
                        <td style={{ padding:"7px 10px" }}><Pill color="#6d28d9" bg="#f5f3ff" size={11}>{r.fg}</Pill></td>
                        <td style={{ padding:"7px 10px", fontFamily:"monospace", fontSize:11, color:T.muted }}>{r.partNo||"—"}</td>
                        <td style={{ padding:"7px 10px", textAlign:"center", fontWeight:700 }}>{r.qty}</td>
                        <td style={{ padding:"7px 10px", fontFamily:"monospace", fontSize:11, color:T.muted }}>{r.loc||"—"}</td>
                        <td style={{ padding:"7px 10px" }}>
                          <Pill color={r.status==="Active"?T.success:T.danger} bg={r.status==="Active"?T.successBg:T.dangerBg} mono={false} size={11}>{r.status}</Pill>
                        </td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Bottom pagination */}
      <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:14 }}>
        {Array.from({length:Math.min(7,totalPages)},(_,i)=>{
          let p = i;
          if(totalPages>7){
            if(page<4) p=i;
            else if(page>totalPages-4) p=totalPages-7+i;
            else p=page-3+i;
          }
          return (
            <button key={p} onClick={()=>setPage(p)} disabled={loading}
              style={{ width:32,height:32,borderRadius:5,border:`1px solid ${p===page?T.accent:T.border}`,background:p===page?T.accent:"#fff",color:p===page?"#fff":T.text,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:p===page?700:400 }}>
              {p+1}
            </button>
          );
        })}
      </div>

      <CodeLegend items={[
        ...categories.map(c=>({code:c.code,label:c.label})),
        ...disciplines.map(d=>({code:d.code,label:d.label})),
        {code:"Qty",label:"Quantity"},{code:"Loc",label:"Storage Location"},
      ]} />

      {selectedPart && (
        <PartDetailModal
          part={selectedPart}
          data={data}
          onClose={()=>setSelectedPart(null)}
          onUpdated={(updated)=>{
            setSelectedPart(prev => ({ ...prev, ...updated }));
            setRows(r => r.map(p => p.code===selectedPart.code ? { ...p, ...updated } : p));
          }}
          onDeleted={()=>{
            setSelectedPart(null);
            setRows(r=>r.filter(p=>p.code!==selectedPart.code));
            setTotal(t=>t-1);
          }}
        />
      )}
    </div>
  );
}

// ─── ADMINISTRATION HUB ───────────────────────────────────────
function AdminPage({ data }) {
  const modules = [
    { id:"categories",    icon:"📦", title:"Main Categories",   desc:"Manage AA segment — equipment top-level classes", color:"#1d4ed8" },
    { id:"manufacturers", icon:"🏭", title:"Manufacturers",     desc:"Manage BB segment — equipment makers", color:"#b45309" },
    { id:"models",        icon:"📐", title:"Equipment Models",   desc:"Manage CC segment — machine model codes", color:"#047857" },
    { id:"disciplines",   icon:"🔬", title:"Disciplines",        desc:"View DD segment — ME / EL / AC", color:"#7c3aed" },
    { id:"funcgroups",    icon:"⚙️", title:"Functional Groups", desc:"Manage EE segment — component function codes", color:"#be123c" },
  ];

  return (
    <div>
      <PageHeader title="Administration" sub="Manage all master data modules for the coding framework" />
      <div style={{ padding:"14px 18px",background:"#0f172a",borderRadius:8,marginBottom:24,color:"#38bdf8",fontFamily:"monospace",fontWeight:700,fontSize:14 }}>
        ⚠️ All changes must preserve the mandatory format: AA – BB – CC – DD – EE – 0001
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:16 }}>
        {modules.map(m=>(
          <Card key={m.id} style={{ borderLeft:`4px solid ${m.color}`,cursor:"pointer" }}>
            <div style={{ fontSize:28,marginBottom:8 }}>{m.icon}</div>
            <div style={{ fontWeight:800,fontSize:16,color:T.text,marginBottom:4 }}>{m.title}</div>
            <div style={{ fontSize:13,color:T.muted }}>{m.desc}</div>
          </Card>
        ))}
      </div>
      <Card style={{ marginTop:24,background:T.subtle }}>
        <SectionHeader>Code Structure Integrity Rules</SectionHeader>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10 }}>
          {[
            "AA: Exactly 2 uppercase characters",
            "BB: Exactly 2 uppercase characters",
            "CC: 2 to 4 uppercase characters",
            "DD: Exactly 2 uppercase characters (ME/EL/AC)",
            "EE: Exactly 3 uppercase characters",
            "NNNN: 4-digit zero-padded integer (auto)",
            "Separator: Hyphen (-) between all segments",
            "Total segments: Always exactly 6",
          ].map(r=>(
            <div key={r} style={{ display:"flex",gap:8,alignItems:"flex-start",padding:"8px 12px",background:"#d1fae5",borderRadius:5 }}>
              <span style={{ color:"#047857",fontWeight:700 }}>✓</span>
              <span style={{ fontSize:13,color:"#065f46" }}>{r}</span>
            </div>
          ))}
        </div>
      </Card>
      <CodeLegend items={[
        {code:"AA",label:"Main Category"},{code:"BB",label:"Manufacturer"},
        {code:"CC",label:"Equipment Model"},{code:"DD",label:"Discipline"},
        {code:"EE",label:"Functional Group"},{code:"NNNN",label:"Sequence Number"},
      ]} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

const NAV = [
  { id:"dashboard",     label:"Dashboard",           icon:"🏠", group:"",            adminOnly:false },
  { id:"framework",     label:"Coding Framework",    icon:"📐", group:"Reference",   adminOnly:false },
  { id:"categories",    label:"Main Categories",     icon:"📦", group:"Reference",   adminOnly:false },
  { id:"disciplines",   label:"Disciplines",         icon:"🔬", group:"Reference",   adminOnly:false },
  { id:"manufacturers", label:"Manufacturers",       icon:"🏭", group:"Master Data", adminOnly:false },
  { id:"models",        label:"Equipment Models",    icon:"📋", group:"Master Data", adminOnly:false },
  { id:"funcgroups",    label:"Functional Groups",   icon:"⚙️", group:"Master Data", adminOnly:false },
  { id:"generator",     label:"Code Generator",      icon:"✨", group:"Tools",       adminOnly:false },
  { id:"tree",          label:"Hierarchy Tree",      icon:"🌳", group:"Tools",       adminOnly:false },
  { id:"master",        label:"Master Parts Table",  icon:"📊", group:"Inventory",   adminOnly:false },
  { id:"admin",         label:"Administration",      icon:"🔑", group:"System",      adminOnly:true  },
  { id:"auditlog",      label:"Audit Log",           icon:"📜", group:"System",      adminOnly:true  },
  { id:"users",         label:"User Management",     icon:"👥", group:"System",      adminOnly:true  },
];

// ═══════════════════════════════════════════════════════════════
// APP SHELL (rendered after auth check)
// ═══════════════════════════════════════════════════════════════

function AppShell() {
  const { profile, isAdmin, signOut } = useAuth();
  const [page,      setPage]      = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);

  const initData = {
    categories: INIT_CATEGORIES, manufacturers: INIT_MANUFACTURERS,
    models: INIT_MODELS, disciplines: INIT_DISCIPLINES,
    engineSystems: ENGINE_SYSTEMS, funcGroups: INIT_FUNC_GROUPS,
    parts: INIT_PARTS,
  };
  const { state, loading, dbReady, ops } = useDb(initData);

  // data object passed to every page — includes both read state and write ops
  const data = {
    ...state,
    dbReady,
    ops, // Supabase-aware save/delete functions for every entity
    // Legacy compat setters — pages that still use setXxx() directly
    // will update local state only; pages that use ops.saveXxx() persist to DB
    setCategories:    (fn) => { /* no-op: use ops.saveCategory */ },
    setManufacturers: (fn) => { /* no-op: use ops.saveManufacturer */ },
    setModels:        (fn) => { /* no-op: use ops.saveModel */ },
    setDisciplines:   (fn) => { /* no-op: use ops.saveDiscipline */ },
    setEngineSystems: (fn) => { /* no-op: use ops.saveEngineSystem */ },
    setFuncGroups:    (fn) => { /* no-op: use ops.saveFuncGroup */ },
    setParts:         (fn) => { /* no-op: use ops.savePart */ },
  };

  // All nav items visible; admin-only pages self-protect
  const visibleNav = NAV.filter(n => !n.adminOnly || isAdmin);
  const groups = [...new Set(visibleNav.filter(n=>n.group).map(n=>n.group))];

  const effectivePage = (NAV.find(n=>n.id===page)?.adminOnly && !isAdmin) ? 'dashboard' : page;

  const pageMap = {
    dashboard:     <Dashboard data={data} />,
    framework:     <CodingFrameworkPage data={data} />,
    categories:    <CategoriesPage data={data} />,
    disciplines:   <DisciplinesPage data={data} />,
    manufacturers: <ManufacturersPage data={data} />,
    models:        <ModelsPage data={data} />,
    funcgroups:    <FunctionalGroupsPage data={data} />,
    generator:     <CodeGeneratorPage data={data} />,
    tree:          <HierarchyTreePage data={data} />,
    master:        <MasterTablePage data={data} />,
    admin:         <AdminPage data={data} />,
    auditlog:      <AuditLogPage />,
    users:         <UsersPage />,
  };

  const roleColor = { admin:'#1d4ed8', department_user:'#047857' };
  const roleBg    = { admin:'#dbeafe', department_user:'#d1fae5' };

  return (
    <div style={{ display:"flex",height:"100vh",fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",background:T.bg,overflow:"hidden" }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width:collapsed?52:228,background:T.sidebar,transition:"width .2s",flexShrink:0,display:"flex",flexDirection:"column",overflowY:"auto",overflowX:"hidden" }}>
        <div style={{ padding:"16px 14px",borderBottom:`1px solid ${T.sidebarBorder}`,display:"flex",alignItems:"center",gap:10,minHeight:60 }}>
          <img src="/logo.png" alt="CarGas" style={{ width:28,height:28,objectFit:"contain",flexShrink:0 }}/>
          {!collapsed&&(
            <div>
              <div style={{ color:"#f1f5f9",fontWeight:800,fontSize:12,lineHeight:1.2 }}>CarGas Coding System</div>
              <div style={{ color:"#475569",fontSize:10 }}>Master Data v3.0</div>
            </div>
          )}
        </div>

        <nav style={{ flex:1,padding:"8px 0" }}>
          {[visibleNav[0]].map(n=>(
            <NavItem key={n.id} n={n} active={effectivePage===n.id} onClick={()=>setPage(n.id)} collapsed={collapsed} />
          ))}
          {groups.map(g=>(
            <div key={g}>
              {!collapsed&&<div style={{ fontSize:9,fontWeight:700,color:"#334155",letterSpacing:1.5,textTransform:"uppercase",padding:"10px 14px 4px" }}>{g}</div>}
              {visibleNav.filter(n=>n.group===g).map(n=>(
                <NavItem key={n.id} n={n} active={effectivePage===n.id} onClick={()=>setPage(n.id)} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </nav>

        <div onClick={()=>setCollapsed(!collapsed)} style={{ padding:"10px 14px",borderTop:`1px solid ${T.sidebarBorder}`,cursor:"pointer",color:"#475569",fontSize:12,display:"flex",alignItems:"center",gap:8 }}>
          <span style={{ fontSize:14 }}>{collapsed?"▶":"◀"}</span>
          {!collapsed&&<span>Collapse</span>}
        </div>
      </div>

      {/* ── MAIN ── */}
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
        <div style={{ background:T.card,borderBottom:`1px solid ${T.border}`,padding:"11px 28px",display:"flex",alignItems:"center",gap:16,flexShrink:0 }}>
          <div>
            <div style={{ fontWeight:700,fontSize:14,color:T.text }}>{NAV.find(n=>n.id===effectivePage)?.label}</div>
            <div style={{ fontSize:11,color:T.muted }}>CarGas Coding System — Engineering Spare Parts Master Coding</div>
          </div>
          <div style={{ marginLeft:"auto",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
            {dbReady
              ? <span style={{ fontSize:11,background:"#dcfce7",color:"#15803d",fontWeight:700,padding:"3px 8px",borderRadius:10 }}>🟢 Live DB</span>
              : <span style={{ fontSize:11,background:"#fef3c7",color:"#b45309",fontWeight:700,padding:"3px 8px",borderRadius:10 }}>🟡 Local</span>
            }
            <span style={{ background:T.header,color:"#38bdf8",fontFamily:"monospace",fontWeight:800,fontSize:12,padding:"4px 12px",borderRadius:5,letterSpacing:1.5 }}>AA-BB-CC-DD-EE-0001</span>
            {profile && (
              <span style={{ background:roleBg[profile.role]??T.subtle,color:roleColor[profile.role]??T.muted,fontWeight:700,fontSize:11,padding:"4px 10px",borderRadius:12 }}>
                {profile.role==='admin'?'🔑':'👤'} {profile.full_name||profile.email?.split('@')[0]}
              </span>
            )}
            <button onClick={signOut}
              style={{ background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,padding:"4px 10px",fontSize:12,color:T.muted,cursor:"pointer",fontFamily:"inherit" }}>
              Sign Out
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ height:3,background:`linear-gradient(90deg,${T.accent},#38bdf8)`,flexShrink:0 }}/>
        )}

        <div style={{ flex:1,overflowY:"auto",padding:28 }}>
          {pageMap[effectivePage]}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// APP ROOT — Auth gate
// ═══════════════════════════════════════════════════════════════

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { session } = useAuth();
  const supabaseConfigured = !!(
    import.meta.env.VITE_SUPABASE_URL &&
    !import.meta.env.VITE_SUPABASE_URL.includes('your-project')
  );

  // Still loading session
  if (session === undefined) {
    return (
      <div style={{ minHeight:'100vh',background:'#0c1526',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter',system-ui,sans-serif" }}>
        <div style={{ color:'#475569',fontSize:14 }}>Loading…</div>
      </div>
    );
  }

  // Supabase not configured — run in offline/local mode (no login required)
  if (!supabaseConfigured) return <AppShell />;

  // Supabase configured but no session — show login
  if (!session) return <LoginPage />;

  
  // Authenticated
  return <AppShell />;
}

function NavItem({ n, active, onClick, collapsed }) {
  return (
    <div onClick={onClick} title={collapsed?n.label:""} style={{ display:"flex",alignItems:"center",gap:10,padding:"9px 14px",cursor:"pointer",background:active?"#1a3460":"transparent",borderLeft:active?"3px solid #38bdf8":"3px solid transparent",transition:"background .12s" }}>
      <span style={{ fontSize:15,flexShrink:0 }}>{n.icon}</span>
      {!collapsed&&<span style={{ fontSize:13,color:active?"#f1f5f9":"#94a3b8",fontWeight:active?700:400,whiteSpace:"nowrap" }}>{n.label}</span>}
    </div>
  );
}

