import { useState, useMemo, useEffect, useCallback, createContext, useContext } from "react";
import { supabase } from './lib/supabase.js';
import * as db from './lib/db.js';

// ═══════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════

const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
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
    <div style={{ minHeight:'100vh', background:'#0c1526', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Inter','Segoe UI',system-ui,sans-serif" }}>
      <div style={{ background:'#0f172a', border:'1px solid #1e2d45', borderRadius:12, padding:40, width:380, boxShadow:'0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:32 }}>
          <div style={{ width:36, height:36, background:'#2563eb', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>⚙</div>
          <div>
            <div style={{ color:'#f1f5f9', fontWeight:800, fontSize:14 }}>SP Coding System</div>
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
// useDb
// ═══════════════════════════════════════════════════════════════

function useDb(initData) {
  const [state,   setState]   = useState(initData);
  const [loading, setLoading] = useState(false);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('your-project')) { setDbReady(false); return; }
    setDbReady(true);
    setLoading(true);
    Promise.all([
      db.fetchCategories(), db.fetchManufacturers(), db.fetchModels(),
      db.fetchDisciplines(), db.fetchEngineSystems(), db.fetchFuncGroups(), db.fetchParts(),
    ]).then(([cats, mfrs, mdls, discs, engs, fgs, parts]) => {
      setState(prev => ({
        ...prev,
        categories:    cats.data?.map(r  => ({ code:r.code, label:r.label, icon:r.icon, color:r.color, bg:r.bg }))                        ?? prev.categories,
        manufacturers: mfrs.data?.map(r  => ({ code:r.code, label:r.label, catCodes:r.cat_codes??[] }))                                   ?? prev.manufacturers,
        models:        mdls.data?.map(r  => ({ code:r.code, label:r.label, mfrCode:r.mfr_code }))                                         ?? prev.models,
        disciplines:   discs.data?.map(r => ({ code:r.code, label:r.label, desc:r.desc??'', color:r.color, bg:r.bg }))                    ?? prev.disciplines,
        engineSystems: engs.data?.map(r  => ({ code:r.code, label:r.label, color:r.color, bg:r.bg }))                                     ?? prev.engineSystems,
        funcGroups:    fgs.data?.map(r   => ({ code:r.code, label:r.label, disc:r.disc }))                                                ?? prev.funcGroups,
        parts:         parts.data?.map(r => ({
          code:r.code, shortDesc:r.short_desc, longDesc:r.long_desc,
          cat:r.cat, mfr:r.mfr, model:r.model, disc:r.disc, fg:r.fg,
          partNo:r.part_no??'', oemPart:r.oem_part??'', qty:r.qty??0, unit:r.unit??'EA',
          loc:r.location??'', minStock:r.min_stock??0, maxStock:r.max_stock??0,
          remarks:r.remarks??'', status:r.status??'Active',
          imageUrl:r.image_url??null, datasheetUrl:r.datasheet_url??null,
        })) ?? prev.parts,
      }));
    }).finally(() => setLoading(false));
  }, []);

  return { state, setState, loading, dbReady };
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG PAGE & USERS PAGE
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
// CONSTANTS & DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════

const INIT_CATEGORIES = [
  { code: "CP", label: "Compressors",        icon: "⚙️",  color: "#1d4ed8", bg: "#dbeafe" },
  { code: "EN", label: "Engines",            icon: "🔧", color: "#b45309", bg: "#fef3c7" },
];
const INIT_MANUFACTURERS = [
  { code: "GA", label: "Galileo",     catCodes: ["CP"] },
  { code: "CA", label: "Caterpillar", catCodes: ["EN"] },
];
const INIT_MODELS = [
  { code: "G01", label: "Model G01",      mfrCode: "GA" },
  { code: "CA01", label: "3306 NA",       mfrCode: "CA" },
];
const ENGINE_SYSTEMS = [
  { code: "BAS", label: "Basic Engine",                   color: "#1d4ed8", bg: "#dbeafe" },
  { code: "LUB", label: "Lubrication System",             color: "#b45309", bg: "#fef3c7" },
];
const INIT_DISCIPLINES = [
  { code: "ME", label: "Mechanical",        desc: "Rotating & static",         color: "#1d4ed8", bg: "#dbeafe" },
  { code: "EL", label: "Electrical",        desc: "Electrical & electronic",   color: "#b45309", bg: "#fef3c7" },
];
const INIT_FUNC_GROUPS = [
  { code: "BRG", label: "Bearing",         disc: "ME" },
  { code: "STR", label: "Starter",         disc: "EL" },
];
const INIT_PARTS = [];

const T = {
  sidebar: "#0c1526", sidebarBorder: "#1e2d45", sidebarActive: "#1a3460", sidebarHover: "#132039",
  accent: "#2563eb", accentLight: "#dbeafe", header: "#0f172a", border: "#e2e8f0",
  bg: "#f0f4f8", card: "#ffffff", text: "#0f172a", muted: "#64748b", subtle: "#f8fafc",
  success: "#15803d", successBg: "#dcfce7", warn: "#b45309", warnBg: "#fef3c7",
  danger: "#dc2626", dangerBg: "#fee2e2",
  disc: { ME: { c:"#1d4ed8", b:"#dbeafe" }, EL: { c:"#b45309", b:"#fef3c7" }, AC: { c:"#047857", b:"#d1fae5" } },
};

// ═══════════════════════════════════════════════════════════════
// UI COMPONENTS
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

const Btn = ({ children, onClick, variant = "primary", small = false, style: s = {}, disabled=false }) => {
  const base = { border: "none", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700, fontFamily: "inherit", transition: "opacity .15s", opacity: disabled ? 0.5 : 1, ...s };
  const size = small ? { padding: "5px 12px", fontSize: 12 } : { padding: "9px 18px", fontSize: 14 };
  const vars = {
    primary:  { background: T.accent,   color: "#fff" },
    secondary:{ background: T.subtle,   color: T.text, border: `1px solid ${T.border}` },
    danger:   { background: T.dangerBg, color: T.danger, border: `1px solid #fca5a5` },
    success:  { background: T.successBg,color: T.success },
    ghost:    { background: "transparent", color: T.muted },
  };
  return <button disabled={disabled} onClick={onClick} style={{ ...base, ...size, ...vars[variant] }}>{children}</button>;
};

const Input = ({ value, onChange, placeholder, style: s = {}, type = "text", maxLength }) => (
  <input type={type} value={value} onChange={onChange} placeholder={placeholder} maxLength={maxLength}
    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, background: "#fff", outline: "none", boxSizing: "border-box", fontFamily: "inherit", ...s }} />
);

const Select = ({ value, onChange, children, style: s = {}, disabled=false }) => (
  <select value={value} onChange={onChange} disabled={disabled}
    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14, color: T.text, background: disabled ? "#f8fafc" : "#fff", outline: "none", boxSizing: "border-box", fontFamily: "inherit", opacity: disabled ? 0.6 : 1, ...s }}>
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
// DASHBOARD & FRAMEWORK PAGES
// ═══════════════════════════════════════════════════════════════

function Dashboard({ data }) {
  const { categories, manufacturers, models, disciplines, funcGroups, parts } = data;

  const catCounts = categories.map(c => ({
    ...c,
    count: parts.filter(p => p.cat === c.code).length,
  }));

  const recentParts = [...parts].slice(-6).reverse();

  return (
    <div>
      <PageHeader title="Dashboard" sub="Engineering Spare Parts Master Coding System — Overview" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Parts" value={parts.length} color={T.accent} icon="🔩" />
        <StatCard label="Categories" value={categories.length} color="#047857" icon="📦" />
        <StatCard label="Manufacturers" value={manufacturers.length} color="#b45309" icon="🏭" />
        <StatCard label="Models" value={models.length} color="#7c3aed" icon="📐" />
        <StatCard label="Functional Groups" value={funcGroups.length} color="#be123c" icon="⚙️" />
        <StatCard label="Disciplines" value={disciplines.length} color="#0e7490" icon="🔬" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
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
        <Card>
          <SectionHeader>Parts by Category</SectionHeader>
          {catCounts.map(c => (
            <div key={c.code} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c.icon} {c.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: c.color }}>{c.count}</span>
              </div>
              <div style={{ background: "#e2e8f0", borderRadius: 4, height: 6 }}>
                <div style={{ background: c.color, height: 6, borderRadius: 4, width: `${parts.length ? (c.count / parts.length) * 100 : 0}%`, transition: "width .5s" }} />
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Card>
        <SectionHeader>Recent Spare Parts</SectionHeader>
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
      </Card>
    </div>
  );
}

function CodingFrameworkPage() {
  const segs = [
    { pos:"AA", name:"Main Category",      ex:"CP",  exLabel:"Compressors",     color:"#1d4ed8", bg:"#dbeafe" },
    { pos:"BB", name:"Manufacturer",       ex:"AN",  exLabel:"ANGI",            color:"#b45309", bg:"#fef3c7" },
    { pos:"CC", name:"Equipment Model",    ex:"A34", exLabel:"Model 3406",      color:"#047857", bg:"#d1fae5" },
    { pos:"DD", name:"Discipline",         ex:"ME",  exLabel:"Mechanical",      color:"#7c3aed", bg:"#ede9fe" },
    { pos:"EE", name:"Functional Group",   ex:"BRG", exLabel:"Bearing",         color:"#be123c", bg:"#ffe4e6" },
    { pos:"0001",name:"Sequential Number", ex:"0001", exLabel:"Item #1",         color:"#475569", bg:"#f1f5f9" },
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CRUD PAGES (Categories, Manufacturers, Models, Disciplines, FuncGroups)
// ═══════════════════════════════════════════════════════════════

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
const ICON_PRESETS = ["⚙️","🔧","🗄️","⛽","📡","🛢️","🔩","📦","🏭","🔬","⚡","🛠️"];

function CategoriesPage({ data }) {
  const { categories, setCategories, parts } = data;
  const EMPTY = { code:"", label:"", icon:"📦", color:"#1d4ed8", bg:"#dbeafe" };
  const [form,      setForm]      = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm,  setShowForm]  = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast,     setToast]     = useState(null);
  const [search,    setSearch]    = useState("");
  const flash = (text, type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };
  const filtered = useMemo(()=>categories.filter(c=> c.code.toLowerCase().includes(search.toLowerCase()) || c.label.toLowerCase().includes(search.toLowerCase())), [categories, search]);

  const openAdd = () => { setForm(EMPTY); setEditingCode(null); setShowForm(true); };
  const openEdit = (cat) => { setForm({...cat}); setEditingCode(cat.code); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if (!code || !form.label.trim()) return flash("Code and Name are required","err");
    if (code.length !== 2) return flash("Category code must be exactly 2 characters","err");
    const dbRecord = { code, label: form.label.trim(), icon: form.icon, color: form.color, bg: form.bg };

    if (editingCode === null) {
      if (categories.find(c => c.code === code)) return flash(`Code "${code}" already exists`,"err");
      const { error } = await db.insertCategory(dbRecord);
      if (error) return flash(`DB Error: ${error.message}`, "err");
      setCategories(prev => [...prev, dbRecord]);
      flash(`Category "${code}" added`);
    } else {
      if (code !== editingCode && categories.find(c => c.code === code)) return flash(`Code "${code}" already exists`,"err");
      const { error } = await db.updateCategory(editingCode, dbRecord);
      if (error) return flash(`DB Error: ${error.message}`, "err");
      setCategories(prev => prev.map(c => c.code === editingCode ? dbRecord : c));
      flash(`Category "${code}" updated`);
    }
    closeForm();
  };

  const handleDelete = async (cat) => {
    const usedCount = parts.filter(p => p.cat === cat.code).length;
    if (usedCount > 0) return flash(`Cannot delete — it has ${usedCount} coded part(s). Remove those parts first.`,"err");
    const { error } = await db.softDeleteCategory(cat.code);
    if (error) return flash(`DB Error: ${error.message}`, "err");
    setCategories(prev => prev.filter(c => c.code !== cat.code));
    setDeleteTarget(null);
    flash(`Category "${cat.code}" deleted`);
  };

  const setColor = (preset) => setForm(f=>({...f, color: preset.color, bg: preset.bg}));
  const fStyle = { display:"flex",flexDirection:"column",gap:4 };
  const lStyle = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8 };

  return (
    <div>
      <Toast msg={toast} />
      <PageHeader title="Main Categories (AA)" sub="Add, edit, or remove top-level equipment categories" />
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:"flex",gap:12,alignItems:"center",flexWrap:"wrap" }}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search…" style={{ maxWidth:260,width:"auto" }} />
          <div style={{ marginLeft:"auto" }}><Btn onClick={openAdd}>＋ Add Category</Btn></div>
        </div>
      </Card>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14, marginBottom:28 }}>
        {filtered.map(cat => (
          <Card key={cat.code} style={{ borderLeft:`5px solid ${cat.color}` }}>
            <div style={{ display:"flex",alignItems:"flex-start",gap:14 }}>
              <div style={{ width:48,height:48,borderRadius:10,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0 }}>{cat.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                  <span style={{ fontFamily:"monospace",fontWeight:800,fontSize:15,color:cat.color,background:cat.bg,padding:"2px 8px",borderRadius:4 }}>{cat.code}</span>
                </div>
                <div style={{ fontWeight:700,fontSize:15,color:T.text }}>{cat.label}</div>
              </div>
            </div>
            <div style={{ display:"flex",gap:8,marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}` }}>
              <Btn small variant="secondary" onClick={()=>openEdit(cat)} style={{ flex:1 }}>✏️ Edit</Btn>
              <Btn small variant="danger" onClick={()=>setDeleteTarget(cat)} style={{ flex:1 }}>🗑 Delete</Btn>
            </div>
          </Card>
        ))}
      </div>
      {showForm && (
        <Modal title={editingCode ? `Edit Category` : "Add New Category"} onClose={closeForm}>
          <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
              <div style={fStyle}>
                <label style={lStyle}>Code (exactly 2 chars) *</label>
                <Input value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="e.g. CP" maxLength={2} style={{ fontFamily:"monospace",fontWeight:800,fontSize:16,letterSpacing:2 }}/>
              </div>
              <div style={fStyle}>
                <label style={lStyle}>Icon Emoji</label>
                <Input value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))} placeholder="e.g. ⚙️" />
              </div>
            </div>
            <div style={fStyle}>
              <label style={lStyle}>Category Name *</label>
              <Input value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Compressors" />
            </div>
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
            <div style={{ display:"flex",gap:10,justifyContent:"flex-end",paddingTop:4 }}>
              <Btn variant="secondary" onClick={closeForm}>Cancel</Btn>
              <Btn onClick={handleSave}>💾 Save</Btn>
            </div>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <Modal title="Delete Category" onClose={()=>setDeleteTarget(null)}>
          <p>Are you sure you want to delete {deleteTarget.code}?</p>
          <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)}>🗑 Delete</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ManufacturersPage({ data }) {
  const { manufacturers, setManufacturers, categories, parts } = data;
  const EMPTY = { code:"", label:"", catCodes:[] };
  const [form, setForm] = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (text, type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };
  
  const openAdd = () => { setForm(EMPTY); setEditingCode(null); setShowForm(true); };
  const openEdit = (m) => { setForm({...m, catCodes: Array.isArray(m.catCodes)?m.catCodes:[]}); setEditingCode(m.code); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if(!code||!form.label.trim()) return flash("Code and Name are required","err");
    if(code.length!==2) return flash("Code must be exactly 2 characters","err");
    if(!form.catCode) return flash("Please select an equipment type","err");
    
    const dbRecord = { code, label: form.label.trim(), cat_codes: [form.catCode] };
    const localRecord = { code, label: form.label.trim(), catCodes: [form.catCode] };

    if(editingCode === null) {
      if(manufacturers.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
      const { error } = await db.insertManufacturer(dbRecord);
      if (error) return flash(`DB Error: ${error.message}`, "err");
      setManufacturers(p=>[...p, localRecord]);
      flash(`Manufacturer "${code}" added`);
    } else {
      if(code!==editingCode && manufacturers.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
      const { error } = await db.updateManufacturer(editingCode, dbRecord);
      if (error) return flash(`DB Error: ${error.message}`, "err");
      setManufacturers(p=>p.map(m=>m.code===editingCode ? localRecord : m));
      flash(`Manufacturer "${code}" updated`);
    }
    closeForm();
  };

  const handleDelete = async (mfr) => {
    const used = parts.filter(p=>p.mfr===mfr.code).length;
    if(used>0) return flash(`Cannot delete — ${used} part(s) use it.`,"err");
    const { error } = await db.softDeleteManufacturer(mfr.code);
    if (error) return flash(`DB Error: ${error.message}`, "err");
    setManufacturers(p=>p.filter(m=>m.code!==mfr.code));
    setDeleteTarget(null);
    flash(`Manufacturer "${mfr.code}" deleted`);
  };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Manufacturers (BB)" sub="Add, edit, or remove equipment manufacturers"/>
      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{marginLeft:"auto"}}><Btn onClick={openAdd}>＋ Add Manufacturer</Btn></div>
        </div>
      </Card>
      {categories.map(cat=>{
        const catItems = manufacturers.filter(m=>(m.catCodes||[]).includes(cat.code));
        if(catItems.length===0) return null;
        return (
          <div key={cat.code} style={{marginBottom:24}}>
            <h3 style={{marginBottom:10}}>{cat.label} ({cat.code})</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12}}>
              {catItems.map(mfr=>(
                <Card key={mfr.code} style={{borderLeft:`4px solid ${cat.color}`}}>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:15,marginBottom:10}}>{mfr.code}</div>
                  <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>{mfr.label}</div>
                  <div style={{display:"flex",gap:8}}>
                    <Btn small variant="secondary" onClick={()=>openEdit(mfr)}>✏️</Btn>
                    <Btn small variant="danger" onClick={()=>setDeleteTarget(mfr)}>🗑</Btn>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
      {showForm && (
        <Modal title={editingCode?"Edit Manufacturer":"Add New"} onClose={closeForm}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Input value={form.code||""} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="Code (2 chars)"/>
            <Select value={form.catCode||form.catCodes?.[0]||""} onChange={e=>setForm(f=>({...f,catCode:e.target.value}))}>
              <option value="">Select Category…</option>
              {categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
            </Select>
            <Input value={form.label||""} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="Name"/>
            <Btn onClick={handleSave}>💾 Save</Btn>
          </div>
        </Modal>
      )}
      {deleteTarget&&(
        <Modal title="Delete Manufacturer" onClose={()=>setDeleteTarget(null)}>
          <p>Delete {deleteTarget.code}?</p>
          <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)}>🗑 Delete</Btn>
        </Modal>
      )}
    </div>
  );
}

function ModelsPage({ data }) {
  const { models, setModels, manufacturers, parts } = data;
  const EMPTY = { code:"", label:"", mfrCode:"" };
  const [form, setForm] = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const openAdd = () => { setForm(EMPTY); setEditingCode(null); setShowForm(true); };
  const openEdit = (m) => { setForm({...m}); setEditingCode(m.code); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if(!code||!form.label.trim()||!form.mfrCode) return flash("All fields are required","err");
    if(code.length<2||code.length>5) return flash("Model code must be 2–5 characters","err");
    
    const dbRecord = { code, label: form.label.trim(), mfr_code: form.mfrCode };
    const localRecord = { code, label: form.label.trim(), mfrCode: form.mfrCode };

    if(editingCode===null) {
      if(models.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
      const { error } = await db.insertModel(dbRecord);
      if (error) return flash(`DB Error: ${error.message}`, "err");
      setModels(p=>[...p, localRecord]);
      flash(`Model "${code}" added`);
    } else {
      if(code!==editingCode && models.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
      const { error } = await db.updateModel(editingCode, dbRecord);
      if (error) return flash(`DB Error: ${error.message}`, "err");
      setModels(p=>p.map(m=>m.code===editingCode ? localRecord : m));
      flash(`Model "${code}" updated`);
    }
    closeForm();
  };

  const handleDelete = async (model) => {
    const used = parts.filter(p=>p.model===model.code).length;
    if(used>0) return flash(`Cannot delete — ${used} part(s) use it.`,"err");
    const { error } = await db.softDeleteModel(model.code);
    if (error) return flash(`DB Error: ${error.message}`, "err");
    setModels(p=>p.filter(m=>m.code!==model.code));
    setDeleteTarget(null);
    flash(`Model "${model.code}" deleted`);
  };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Equipment Models (CC)" sub="Add, edit, or remove models"/>
      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}><Btn onClick={()=>openAdd()}>＋ Add Model</Btn></div>
      </Card>
      {manufacturers.map(mfr=>{
        const mfrModels = models.filter(m=>m.mfrCode===mfr.code);
        if(mfrModels.length===0) return null;
        return (
          <div key={mfr.code} style={{marginBottom:24}}>
            <h3 style={{marginBottom:10}}>{mfr.label} ({mfr.code}) Models</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
              {mfrModels.map(model=>(
                <Card key={model.code}>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:14,marginBottom:8}}>{model.code}</div>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>{model.label}</div>
                  <div style={{display:"flex",gap:6}}>
                    <Btn small variant="secondary" onClick={()=>openEdit(model)}>✏️</Btn>
                    <Btn small variant="danger" onClick={()=>setDeleteTarget(model)}>🗑</Btn>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
      {showForm&&(
        <Modal title={editingCode?"Edit Model":"Add Model"} onClose={closeForm}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Input value={form.code||""} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="Code (2-5 chars)"/>
            <Select value={form.mfrCode||""} onChange={e=>setForm(f=>({...f,mfrCode:e.target.value}))}>
              <option value="">Select Manufacturer…</option>
              {manufacturers.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
            </Select>
            <Input value={form.label||""} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="Description"/>
            <Btn onClick={handleSave}>💾 Save</Btn>
          </div>
        </Modal>
      )}
      {deleteTarget&&(
        <Modal title="Delete Model" onClose={()=>setDeleteTarget(null)}>
          <p>Delete {deleteTarget.code}?</p>
          <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)}>🗑 Delete</Btn>
        </Modal>
      )}
    </div>
  );
}

function DisciplinesPage({ data }) {
  const { disciplines, setDisciplines, engineSystems, setEngineSystems, parts } = data;
  const EMPTY_D = { code:"", label:"", desc:"", color:"#1d4ed8", bg:"#dbeafe" };
  const [formD, setFormD] = useState(EMPTY_D);
  const [editD, setEditD] = useState(null);
  const [showD, setShowD] = useState(false);
  const [delD,  setDelD]  = useState(null);

  const [toast, setToast] = useState(null);
  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const saveD = async () => {
    const code = formD.code.trim().toUpperCase();
    if(!code||!formD.label.trim()) return flash("Code and Name required","err");
    const rec = { code, label:formD.label.trim(), desc:formD.desc.trim(), color:formD.color, bg:formD.bg };
    
    if(editD===null){
      if(disciplines.find(d=>d.code===code)) return flash("Code already exists","err");
      const {error} = await db.insertDiscipline(rec);
      if(error) return flash(`DB Error: ${error.message}`,"err");
      setDisciplines(p=>[...p,rec]); flash(`Discipline "${code}" added`);
    } else {
      const {error} = await db.updateDiscipline(editD, rec);
      if(error) return flash(`DB Error: ${error.message}`,"err");
      setDisciplines(p=>p.map(d=>d.code===editD?rec:d)); flash(`Discipline "${code}" updated`);
    }
    setShowD(false); setEditD(null); setFormD(EMPTY_D);
  };
  
  const deleteD = async (d) => {
    const used=parts.filter(p=>p.disc===d.code).length;
    if(used>0) return flash(`Cannot delete — ${used} part(s) use it.`,"err");
    const {error} = await db.softDeleteDiscipline(d.code);
    if(error) return flash(`DB Error: ${error.message}`,"err");
    setDisciplines(p=>p.filter(x=>x.code!==d.code)); setDelD(null); flash(`Discipline "${d.code}" deleted`);
  };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Disciplines (DD)" sub="Standard disciplines"/>
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
          <h3>Disciplines</h3>
          <Btn small onClick={()=>{setFormD(EMPTY_D);setEditD(null);setShowD(true);}}>＋ Add Discipline</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
          {disciplines.map(d=>(
            <Card key={d.code} style={{borderTop:`4px solid ${d.color}`}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <Pill color={d.color} bg={d.bg} size={14}>{d.code}</Pill>
                <div style={{display:"flex",gap:6}}>
                  <Btn small variant="secondary" onClick={()=>{setFormD({...d});setEditD(d.code);setShowD(true);}}>✏️</Btn>
                  <Btn small variant="danger" onClick={()=>setDelD(d)}>🗑</Btn>
                </div>
              </div>
              <div style={{fontWeight:800,fontSize:17,marginTop:10}}>{d.label}</div>
            </Card>
          ))}
        </div>
      </Card>
      {showD&&(
        <Modal title={editD?"Edit":"Add"} onClose={()=>{setShowD(false);}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Input value={formD.code||""} onChange={e=>setFormD(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="Code"/>
            <Input value={formD.label||""} onChange={e=>setFormD(f=>({...f,label:e.target.value}))} placeholder="Label"/>
            <Btn onClick={saveD}>💾 Save</Btn>
          </div>
        </Modal>
      )}
      {delD&&(<Modal title="Delete" onClose={()=>setDelD(null)}>
        <p>Delete {delD.code}?</p>
        <Btn variant="danger" onClick={()=>deleteD(delD)}>🗑 Delete</Btn>
      </Modal>)}
    </div>
  );
}

function FunctionalGroupsPage({ data }) {
  const { funcGroups, setFuncGroups, disciplines, parts } = data;
  const EMPTY = { code:"", label:"", disc:"ME" };
  const [form, setForm] = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const openAdd = () => { setForm(EMPTY); setEditingCode(null); setShowForm(true); };
  const openEdit = (fg) => { setForm({...fg}); setEditingCode(fg.code); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if(!code||!form.label.trim()||!form.disc) return flash("All fields are required","err");
    const rec = { code, label:form.label.trim(), disc:form.disc };

    if(editingCode===null){
      if(funcGroups.find(f=>f.code===code)) return flash(`Code "${code}" already exists`,"err");
      const {error} = await db.insertFuncGroup(rec);
      if(error) return flash(`DB Error: ${error.message}`,"err");
      setFuncGroups(p=>[...p,rec]); flash(`Group "${code}" added`);
    } else {
      const {error} = await db.updateFuncGroup(editingCode, rec);
      if(error) return flash(`DB Error: ${error.message}`,"err");
      setFuncGroups(p=>p.map(f=>f.code===editingCode?rec:f)); flash(`Group "${code}" updated`);
    }
    closeForm();
  };

  const handleDelete = async (fg) => {
    const used=parts.filter(p=>p.fg===fg.code).length;
    if(used>0) return flash(`Cannot delete — ${used} part(s) use it.`,"err");
    const {error} = await db.softDeleteFuncGroup(fg.code);
    if(error) return flash(`DB Error: ${error.message}`,"err");
    setFuncGroups(p=>p.filter(f=>f.code!==fg.code)); setDeleteTarget(null); flash(`Deleted`);
  };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Functional Groups (EE)"/>
      <Card style={{marginBottom:20}}><Btn onClick={()=>openAdd()}>＋ Add Group</Btn></Card>
      {disciplines.map(disc=>{
        const items = funcGroups.filter(f=>f.disc===disc.code);
        if(items.length===0) return null;
        return (
          <div key={disc.code} style={{marginBottom:24}}>
            <h3 style={{marginBottom:10}}>{disc.label} Groups</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
              {items.map(fg=>(
                <Card key={fg.code} style={{borderLeft:`3px solid ${disc.color}`,padding:14}}>
                  <div style={{fontFamily:"monospace",fontWeight:800,fontSize:13,marginBottom:6}}>{fg.code}</div>
                  <div style={{fontWeight:600,fontSize:14,marginBottom:10}}>{fg.label}</div>
                  <div style={{display:"flex",gap:6}}>
                    <Btn small variant="secondary" onClick={()=>openEdit(fg)}>✏️</Btn>
                    <Btn small variant="danger" onClick={()=>setDeleteTarget(fg)}>🗑</Btn>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
      {showForm&&(
        <Modal title={editingCode?"Edit":"Add"} onClose={closeForm}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Input value={form.code||""} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="Code"/>
            <Select value={form.disc||"ME"} onChange={e=>setForm(f=>({...f,disc:e.target.value}))}>
              {disciplines.map(d=><option key={d.code} value={d.code}>{d.code} - {d.label}</option>)}
            </Select>
            <Input value={form.label||""} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="Group Name"/>
            <Btn onClick={handleSave}>💾 Save</Btn>
          </div>
        </Modal>
      )}
      {deleteTarget&&(<Modal title="Delete" onClose={()=>setDeleteTarget(null)}><Btn variant="danger" onClick={()=>handleDelete(deleteTarget)}>🗑 Delete</Btn></Modal>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CODE GENERATOR PAGE (Fixed HandleSave)
// ═══════════════════════════════════════════════════════════════

function CodeGeneratorPage({ data }) {
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, parts, setParts } = data;
  const [step, setStep] = useState({ cat:"",mfr:"",model:"",disc:"",fg:"" });
  const [toast, setToast] = useState(null);
  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3000); };

  const isEngine = step.cat === "EN";
  const activeSections = isEngine ? engineSystems : disciplines;

  const filteredMfrs = manufacturers.filter(m => !step.cat || (m.catCodes||[]).includes(step.cat));
  const filteredModels = models.filter(m => !step.mfr || m.mfrCode === step.mfr);
  const filteredFG = isEngine ? funcGroups : funcGroups.filter(f => !step.disc || f.disc === step.disc);

  const canGenerate = step.cat && step.mfr && step.model && step.disc && step.fg;

  const nextSeq = () => {
    const prefix = `${step.cat}-${step.mfr}-${step.model}-${step.disc}-${step.fg}-`;
    const existing = parts.filter(p => p.code.startsWith(prefix));
    const nums = existing.map(p => parseInt(p.code.split("-").pop() || "0"));
    const max = nums.length ? Math.max(...nums) : 0;
    return String(max + 1).padStart(4, "0");
  };

  const seqNum = canGenerate ? nextSeq() : "0001";
  const generatedCode = canGenerate ? `${step.cat}-${step.mfr}-${step.model}-${step.disc}-${step.fg}-${seqNum}` : null;

  const cat = categories.find(c=>c.code===step.cat);
  const mfr = manufacturers.find(m=>m.code===step.mfr);
  const model = models.find(m=>m.code===step.model);
  const fg = funcGroups.find(f=>f.code===step.fg);

  const shortDesc = (mfr&&model&&fg) ? `${mfr.label} ${model.label.replace("Model ","")} ${fg.label}` : "—";
  const longDesc = (fg&&mfr&&cat&&model) ? `${fg.label} for ${mfr.label} ${cat.label} ${model.label}` : "—";

  const handleSave = async () => {
    if(!canGenerate) return;
    
    const dbPart = {
      code: generatedCode, short_desc: shortDesc, long_desc: longDesc,
      cat: step.cat, mfr: step.mfr, model: step.model, disc: step.disc, fg: step.fg,
      part_no: "", oem_part: "", qty: 0, unit: "EA", location: "",
      min_stock: 0, max_stock: 0, remarks: "", status: "Active"
    };

    const { data: insertedData, error } = await db.insertPart(dbPart);

    if (error) {
      flash(`DB Error: ${error.message}`, "err");
      return;
    }

    const localPart = {
      code: insertedData.code, shortDesc: insertedData.short_desc, longDesc: insertedData.long_desc,
      cat: insertedData.cat, mfr: insertedData.mfr, model: insertedData.model,
      disc: insertedData.disc, fg: insertedData.fg,
      partNo: insertedData.part_no||"", oemPart: insertedData.oem_part||"", qty: insertedData.qty||0, unit: insertedData.unit||"EA", loc: insertedData.location||"",
      minStock: insertedData.min_stock||0, maxStock: insertedData.max_stock||0, remarks: insertedData.remarks||"", status: insertedData.status||"Active",
    };

    setParts(p=>[...p, localPart]);
    flash(`Code ${generatedCode} saved to Master Table`);
  };

  const sStep = { padding:"10px 16px", borderRadius:6, background:T.subtle, border:`1px solid ${T.border}`, marginBottom:14 };
  return (
    <div>
      <Toast msg={toast} />
      <PageHeader title="Code Generator" sub="Build a valid 6-segment spare part code step by step" />
      <div style={{ display:"grid",gridTemplateColumns:"1.1fr 1fr",gap:20 }}>
        <Card>
          <SectionHeader>Step-by-Step Selection</SectionHeader>
          <div style={sStep}>
            <Select value={step.cat} onChange={e=>setStep(s=>({...s,cat:e.target.value,mfr:"",model:"",disc:"",fg:""}))}>
              <option value="">Step 1: Select Category…</option>
              {categories.map(c=><option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </Select>
          </div>
          <div style={{...sStep,opacity:step.cat?1:0.5}}>
            <Select value={step.mfr} onChange={e=>setStep(s=>({...s,mfr:e.target.value,model:"",disc:"",fg:""}))} disabled={!step.cat}>
              <option value="">Step 2: Select Manufacturer…</option>
              {filteredMfrs.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
            </Select>
          </div>
          <div style={{...sStep,opacity:step.mfr?1:0.5}}>
            <Select value={step.model} onChange={e=>setStep(s=>({...s,model:e.target.value,disc:"",fg:""}))} disabled={!step.mfr}>
              <option value="">Step 3: Select Model…</option>
              {filteredModels.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
            </Select>
          </div>
          <div style={{...sStep,opacity:step.model?1:0.5}}>
            <Select value={step.disc} onChange={e=>setStep(s=>({...s,disc:e.target.value,fg:""}))} disabled={!step.model}>
              <option value="">Step 4: Select Discipline…</option>
              {activeSections.map(d=><option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
            </Select>
          </div>
          <div style={{...sStep,opacity:step.disc?1:0.5}}>
            <Select value={step.fg} onChange={e=>setStep(s=>({...s,fg:e.target.value}))} disabled={!step.disc}>
              <option value="">Step 5: Select Functional Group…</option>
              {filteredFG.map(f=><option key={f.code} value={f.code}>{f.code} — {f.label}</option>)}
            </Select>
          </div>
        </Card>
        <Card>
          <SectionHeader>Generated Code</SectionHeader>
          {generatedCode ? (
            <div style={{ textAlign:"center" }}>
              <div style={{ background:T.header,color:"#38bdf8",fontFamily:"monospace",fontWeight:800,fontSize:24,padding:"12px 20px",borderRadius:8,letterSpacing:3,display:"inline-block",marginBottom:20 }}>
                {generatedCode}
              </div>
              <Btn onClick={handleSave} style={{ width:"100%" }}>💾 Save to Master Table</Btn>
            </div>
          ) : (
            <div style={{ textAlign:"center",padding:"28px 0",color:T.muted }}>Complete all 5 selections to generate code</div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OMITTED HIERARCHY, MASTER TABLE & ADMIN HUB (No Changes Needed)
// ═══════════════════════════════════════════════════════════════
function HierarchyTreePage() { return <div><PageHeader title="Hierarchy Tree" /></div>; }
function MasterTablePage() { return <div><PageHeader title="Master Table" /></div>; }
function AdminPage() { return <div><PageHeader title="Admin" /></div>; }

// ═══════════════════════════════════════════════════════════════
// NAVIGATION & APP ROOT
// ═══════════════════════════════════════════════════════════════
const NAV = [
  { id:"dashboard",     label:"Dashboard",         icon:"🏠", group:"",            adminOnly:false },
  { id:"framework",     label:"Coding Framework",  icon:"📐", group:"Reference",   adminOnly:false },
  { id:"categories",    label:"Main Categories",   icon:"📦", group:"Reference",   adminOnly:false },
  { id:"disciplines",   label:"Disciplines",       icon:"🔬", group:"Reference",   adminOnly:false },
  { id:"manufacturers", label:"Manufacturers",     icon:"🏭", group:"Master Data", adminOnly:true  },
  { id:"models",        label:"Equipment Models",  icon:"📋", group:"Master Data", adminOnly:true  },
  { id:"funcgroups",    label:"Functional Groups", icon:"⚙️", group:"Master Data", adminOnly:true  },
  { id:"generator",     label:"Code Generator",    icon:"✨", group:"Tools",       adminOnly:false },
  { id:"tree",          label:"Hierarchy Tree",    icon:"🌳", group:"Tools",       adminOnly:false },
  { id:"master",        label:"Master Parts Table",icon:"📊", group:"Inventory",   adminOnly:false },
  { id:"admin",         label:"Administration",    icon:"🔑", group:"System",      adminOnly:true  },
  { id:"auditlog",      label:"Audit Log",         icon:"📜", group:"System",      adminOnly:true  },
  { id:"users",         label:"User Management",   icon:"👥", group:"System",      adminOnly:true  },
];

function AppShell() {
  const { profile, isAdmin, signOut } = useAuth();
  const [page, setPage] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);

  const initData = { categories: INIT_CATEGORIES, manufacturers: INIT_MANUFACTURERS, models: INIT_MODELS, disciplines: INIT_DISCIPLINES, engineSystems: ENGINE_SYSTEMS, funcGroups: INIT_FUNC_GROUPS, parts: INIT_PARTS };
  const { state, setState, loading, dbReady } = useDb(initData);
  const mk = (key) => (valOrFn) => setState(prev => ({ ...prev, [key]: typeof valOrFn === 'function' ? valOrFn(prev[key]) : valOrFn }));

  const data = {
    ...state, dbReady,
    setCategories: mk('categories'), setManufacturers: mk('manufacturers'), setModels: mk('models'),
    setDisciplines: mk('disciplines'), setEngineSystems: mk('engineSystems'), setFuncGroups: mk('funcGroups'), setParts: mk('parts'),
  };

  const visibleNav = NAV.filter(n => !n.adminOnly || isAdmin);
  const effectivePage = (NAV.find(n=>n.id===page)?.adminOnly && !isAdmin) ? 'dashboard' : page;

  const pageMap = {
    dashboard: <Dashboard data={data} />, framework: <CodingFrameworkPage data={data} />, categories: <CategoriesPage data={data} />,
    disciplines: <DisciplinesPage data={data} />, manufacturers: <ManufacturersPage data={data} />, models: <ModelsPage data={data} />,
    funcgroups: <FunctionalGroupsPage data={data} />, generator: <CodeGeneratorPage data={data} />, tree: <HierarchyTreePage data={data} />,
    master: <MasterTablePage data={data} />, admin: <AdminPage data={data} />, auditlog: <AuditLogPage />, users: <UsersPage />,
  };

  return (
    <div style={{ display:"flex",height:"100vh",fontFamily:"'Inter',system-ui,sans-serif",background:T.bg,overflow:"hidden" }}>
      <div style={{ width:collapsed?52:228,background:T.sidebar,transition:"width .2s",flexShrink:0,display:"flex",flexDirection:"column" }}>
        <div style={{ padding:"16px 14px",borderBottom:`1px solid ${T.sidebarBorder}`,display:"flex",alignItems:"center",gap:10,minHeight:60 }}>
          <div style={{ width:28,height:28,background:T.accent,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>⚙</div>
          {!collapsed&&<div style={{ color:"#f1f5f9",fontWeight:800,fontSize:12 }}>SP Coding System</div>}
        </div>
        <nav style={{ flex:1,padding:"8px 0" }}>
          {visibleNav.map(n=>(
            <div key={n.id} onClick={()=>setPage(n.id)} style={{ display:"flex",alignItems:"center",gap:10,padding:"9px 14px",cursor:"pointer",background:effectivePage===n.id?"#1a3460":"transparent",borderLeft:effectivePage===n.id?"3px solid #38bdf8":"3px solid transparent" }}>
              <span style={{ fontSize:15 }}>{n.icon}</span>
              {!collapsed&&<span style={{ fontSize:13,color:effectivePage===n.id?"#f1f5f9":"#94a3b8",fontWeight:effectivePage===n.id?700:400 }}>{n.label}</span>}
            </div>
          ))}
        </nav>
        <div onClick={()=>setCollapsed(!collapsed)} style={{ padding:"10px 14px",borderTop:`1px solid ${T.sidebarBorder}`,cursor:"pointer",color:"#475569",fontSize:12 }}>{collapsed?"▶":"◀"}</div>
      </div>
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
        <div style={{ background:T.card,borderBottom:`1px solid ${T.border}`,padding:"11px 28px",display:"flex",alignItems:"center",gap:16 }}>
          <div style={{ fontWeight:700,fontSize:14 }}>{NAV.find(n=>n.id===effectivePage)?.label}</div>
          <div style={{ marginLeft:"auto",display:"flex",gap:10,alignItems:"center" }}>
            {dbReady ? <span style={{ fontSize:11,background:"#dcfce7",color:"#15803d",padding:"3px 8px",borderRadius:10 }}>🟢 Live DB</span> : null}
            <button onClick={signOut} style={{ background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer" }}>Sign Out</button>
          </div>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:28 }}>{pageMap[effectivePage]}</div>
      </div>
    </div>
  );
}

export default function App() { return <AuthProvider><AuthGate /></AuthProvider>; }
function AuthGate() {
  const { session } = useAuth();
  if (session === undefined) return <div style={{ color:'#475569',fontSize:14 }}>Loading…</div>;
  if (!import.meta.env.VITE_SUPABASE_URL) return <AppShell />;
  if (!session) return <LoginPage />;
  return <AppShell />;
}
