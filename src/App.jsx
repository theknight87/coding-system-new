import { useState, useMemo, useEffect, useCallback, useRef, createContext, useContext, Fragment } from "react";
import { supabase } from './lib/supabase.js';
import * as db from './lib/db.js';

// ═══════════════════════════════════════════════════════════════
// STOCK MOVEMENT MODAL — records a Receipt / Issue / Consumption /
// Return / Transfer against a part. Reused by PartDetailModal (part
// pre-filled) and StockLedgerPage (free-entry part code).
// ═══════════════════════════════════════════════════════════════

function StockMovementModal({ partCode, ops, onClose, onSaved }) {
  const [form, setForm] = useState({
    partCode: partCode || '', transactionType: 'RECEIPT',
    quantity: '', reference: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };

  const handleSubmit = async () => {
    const code = (form.partCode || '').trim().toUpperCase();
    const qtyNum = Number(form.quantity);
    if (!code) return setError('Enter a part code.');
    if (!qtyNum || qtyNum <= 0) return setError('Quantity must be greater than zero.');
    setSaving(true); setError('');
    const { error: err } = await ops.saveStockMovement({
      partCode: code, transactionType: form.transactionType,
      quantity: qtyNum, reference: form.reference, notes: form.notes,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved && onSaved();
    onClose();
  };

  return (
    <Modal title="New Stock Transaction" onClose={onClose}>
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {error && <div style={{ background:T.dangerBg, color:T.danger, borderRadius:6, padding:"8px 12px", fontSize:12, fontWeight:600 }}>⚠️ {error}</div>}
        {partCode ? (
          <div><label style={sLabel}>Part Code</label><CodeTag code={partCode}/></div>
        ) : (
          <div>
            <label style={sLabel}>Part Code</label>
            <Input value={form.partCode} onChange={e=>setForm(f=>({...f,partCode:e.target.value}))} placeholder="e.g. CP-GA-G04-ME-PST-0133"/>
          </div>
        )}
        <div>
          <label style={sLabel}>Transaction Type</label>
          <Select value={form.transactionType} onChange={e=>setForm(f=>({...f,transactionType:e.target.value}))}>
            {db.STOCK_TRANSACTION_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <div>
          <label style={sLabel}>Quantity</label>
          <Input type="number" value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:e.target.value}))} placeholder="0"/>
        </div>
        <div>
          <label style={sLabel}>Reference</label>
          <Input value={form.reference} onChange={e=>setForm(f=>({...f,reference:e.target.value}))} placeholder="e.g. PO-1029, WO-455"/>
        </div>
        <div>
          <label style={sLabel}>Notes</label>
          <Input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional"/>
        </div>
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:`1px solid ${T.border}` }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSubmit} disabled={saving}>{saving?"Saving…":"Record Transaction"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// RECORD MOVEMENT MODAL — the real ledger (stock_transactions, via
// migrations 011/012/014). Reusable: pass `part` to lock it to one
// part (Part Detail, Master Table row action), or omit it to show a
// server-side, debounced part picker (Stock Movements page header).
// ═══════════════════════════════════════════════════════════════

const TXN_LABELS = {
  receipt: 'Receipt', issue: 'Issue', return_to_store: 'Return',
  transfer_in: 'Transfer In', transfer_out: 'Transfer Out',
  adjustment_in: 'Adjustment +', adjustment_out: 'Adjustment −', scrap: 'Scrap',
  opening_balance: 'Opening Balance',
};
const TXN_NEEDS_FROM = ['issue', 'transfer_in', 'transfer_out', 'adjustment_out', 'scrap'];
const TXN_NEEDS_TO   = ['receipt', 'return_to_store', 'transfer_in', 'transfer_out', 'adjustment_in'];

function RecordMovementModal({ part, initialTxnType, onClose, onSaved }) {
  const { isAdmin, isDeptUser } = useAuth();
  const alerts = useAlerts();
  const canPost = isAdmin || isDeptUser; // this app's two roles both have stock_transactions_insert rights

  const [selectedPart, setSelectedPart] = useState(part || null);
  const [pickerInput,  setPickerInput]  = useState('');
  const [pickerQuery,  setPickerQuery]  = useState('');
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const [txnType,     setTxnType]     = useState(initialTxnType || 'receipt');
  const [quantity,    setQuantity]    = useState('');
  const [locationFrom,setLocationFrom]= useState('');
  const [locationTo,  setLocationTo]  = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [unitCost,    setUnitCost]    = useState('');
  const [notes,       setNotes]       = useState('');
  const [occurredAt,  setOccurredAt]  = useState(() => {
    const d = new Date(); d.setSeconds(0,0);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); // local time for datetime-local input
    return d.toISOString().slice(0,16);
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };

  // Debounced server-side part search (same pattern as Master Parts Table).
  useEffect(() => {
    const t = setTimeout(() => setPickerQuery(pickerInput.trim()), 400);
    return () => clearTimeout(t);
  }, [pickerInput]);

  useEffect(() => {
    if (selectedPart || !pickerQuery) { setPickerResults([]); return; }
    let cancelled = false;
    setPickerLoading(true);
    db.fetchParts({ search: pickerQuery }, 0, 8).then(({ data }) => {
      if (!cancelled) setPickerResults((data || []).map(mapPart));
    }).finally(() => { if (!cancelled) setPickerLoading(false); });
    return () => { cancelled = true; };
  }, [pickerQuery, selectedPart]);

  const qtyNum = Number(quantity) || 0;
  const isInbound = db.TXN_TYPES_INBOUND.includes(txnType);
  const delta = isInbound ? qtyNum : -qtyNum;
  const currentQty = selectedPart?.qtyOnHand ?? 0;
  const resultQty = currentQty + delta;
  const goesNegative = qtyNum > 0 && resultQty < 0;

  const handleSubmit = async () => {
    if (!selectedPart) return setError('Select a part.');
    if (!qtyNum || qtyNum <= 0) return setError('Quantity must be greater than zero.');
    if (TXN_NEEDS_FROM.includes(txnType) && !locationFrom.trim()) return setError('Location From is required for this movement type.');
    if (TXN_NEEDS_TO.includes(txnType) && !locationTo.trim()) return setError('Location To is required for this movement type.');
    setSaving(true); setError('');
    const { data, error: err } = await db.insertStockTransaction({
      partId: selectedPart.id, txnType, quantity: qtyNum,
      locationFrom: TXN_NEEDS_FROM.includes(txnType) ? locationFrom.trim() : null,
      locationTo: TXN_NEEDS_TO.includes(txnType) ? locationTo.trim() : null,
      referenceNo: referenceNo.trim(), unitCost, notes: notes.trim(),
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    alerts.refreshAlerts();
    onSaved && onSaved({ txn: data, part: selectedPart, newBalance: resultQty });
    onClose();
  };

  const typeBtn = (t) => (
    <button key={t} type="button" onClick={()=>setTxnType(t)}
      style={{
        padding:"7px 12px", borderRadius:6, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
        border:`1.5px solid ${txnType===t?T.accent:T.border}`,
        background:txnType===t?T.accentLight:"#fff", color:txnType===t?T.accent:T.text,
      }}>
      {TXN_LABELS[t]}
    </button>
  );

  return (
    <Modal title="Record Stock Movement" onClose={onClose} maxWidth={640}>
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {error && <div style={{ background:T.dangerBg, color:T.danger, borderRadius:6, padding:"8px 12px", fontSize:12, fontWeight:600 }}>⚠️ {error}</div>}

        {/* Part picker */}
        <div>
          <label style={sLabel}>Part</label>
          {selectedPart ? (
            <div style={{ display:"flex", alignItems:"center", gap:10, background:T.subtle, borderRadius:6, padding:"8px 12px" }}>
              <CodeTag code={selectedPart.code}/>
              <span style={{ fontSize:13, color:T.text, flex:1 }}>{selectedPart.shortDesc}</span>
              <span style={{ fontSize:12 }}>On hand: <StockQtyDisplay qty={selectedPart.qtyOnHand} unit={selectedPart.unit} stockSource={selectedPart.stockSource} small/></span>
              {!part && <Btn small variant="ghost" onClick={()=>{setSelectedPart(null); setPickerInput(''); }}>Change</Btn>}
            </div>
          ) : (
            <div style={{ position:"relative" }}>
              <Input value={pickerInput} onChange={e=>setPickerInput(e.target.value)} placeholder="Search by code, description or manufacturer part no…"/>
              {pickerInput && (
                <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#fff", border:`1px solid ${T.border}`, borderRadius:6, boxShadow:"0 8px 24px rgba(0,0,0,0.12)", zIndex:10, maxHeight:220, overflowY:"auto", marginTop:4 }}>
                  {pickerLoading ? (
                    <div style={{ padding:"10px 12px", fontSize:12, color:T.muted }}>Searching…</div>
                  ) : pickerResults.length === 0 ? (
                    <div style={{ padding:"10px 12px", fontSize:12, color:T.muted }}>No matching parts.</div>
                  ) : pickerResults.map(p => (
                    <div key={p.id} onClick={()=>{setSelectedPart(p); setPickerInput('');}}
                      style={{ padding:"8px 12px", cursor:"pointer", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10 }}
                      onMouseEnter={e=>e.currentTarget.style.background=T.subtle}
                      onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                      <CodeTag code={p.code}/>
                      <span style={{ fontSize:12, color:T.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.shortDesc}</span>
                      <StockQtyDisplay qty={p.qtyOnHand} unit={p.unit} stockSource={p.stockSource} small/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Movement type — segmented control, grouped */}
        <div>
          <label style={sLabel}>Movement Type</label>
          <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:0.6, marginBottom:5 }}>Everyday</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
            {db.TXN_TYPES_EVERYDAY.map(typeBtn)}
          </div>
          <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:0.6, marginBottom:5 }}>Corrective</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {db.TXN_TYPES_CORRECTIVE.map(typeBtn)}
          </div>
        </div>

        {/* Quantity + live balance preview */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div>
            <label style={sLabel}>Quantity</label>
            <Input type="number" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="0"/>
          </div>
          <div>
            <label style={sLabel}>Occurred At</label>
            <Input type="datetime-local" value={occurredAt} onChange={e=>setOccurredAt(e.target.value)}/>
          </div>
        </div>
        {selectedPart && qtyNum > 0 && (
          <div style={{ fontSize:12, color:T.muted, background:T.subtle, borderRadius:6, padding:"8px 12px" }}> On hand {currentQty} → <strong style={{ color:T.text }}>{resultQty}</strong> after this {TXN_LABELS[txnType].toLowerCase()}
          </div>
        )}
        {goesNegative && (
          <div style={{ fontSize:12, color:"#92400e", background:T.warnBg, border:"1px solid #fbbf24", borderRadius:6, padding:"8px 12px", fontWeight:600 }}>
            ⚠️ This will take the balance below zero ({resultQty}). Allowed, but double-check before posting.
          </div>
        )}

        {/* Locations — shown only where the movement type needs them */}
        {(TXN_NEEDS_FROM.includes(txnType) || TXN_NEEDS_TO.includes(txnType)) && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {TXN_NEEDS_FROM.includes(txnType) && (
              <div><label style={sLabel}>Location From</label><Input value={locationFrom} onChange={e=>setLocationFrom(e.target.value)} placeholder="e.g. WH-A1"/></div>
            )}
            {TXN_NEEDS_TO.includes(txnType) && (
              <div><label style={sLabel}>Location To</label><Input value={locationTo} onChange={e=>setLocationTo(e.target.value)} placeholder="e.g. WH-B2"/></div>
            )}
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div><label style={sLabel}>Reference No.</label><Input value={referenceNo} onChange={e=>setReferenceNo(e.target.value)} placeholder="PO / WO / delivery note"/></div>
          <div><label style={sLabel}>Unit Cost (optional)</label><Input type="number" value={unitCost} onChange={e=>setUnitCost(e.target.value)} placeholder="0.00"/></div>
        </div>
        <div><label style={sLabel}>Notes</label><Input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional"/></div>

        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:`1px solid ${T.border}` }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          {canPost && (
            <Btn onClick={handleSubmit} disabled={saving}>{saving?"Posting…":"Post Movement"}</Btn>
          )}
        </div>
        {!canPost && (
          <div style={{ fontSize:12, color:T.muted, textAlign:"right" }}>Your account doesn't have permission to post stock movements.</div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// LANGUAGE CONTEXT
//
// Scope: translates primary chrome (sidebar nav labels, top bar, login
// screen, page headers) and flips document direction for RTL. It does
// NOT translate every string in this ~5700-line app — that would be a
// much larger, separate effort. This gives the whole app a working
// Arabic/English switch immediately without touching page internals.
// ═══════════════════════════════════════════════════════════════

const TRANSLATIONS = {
  en: {
    appName: "CarGas Coding System", appVersion: "Master Data v3.0",
    signOut: "Sign Out", collapse: "Collapse", expand: "Expand menu", liveDb: "Live DB", local: "Local",
    topBarSub: "CarGas Coding System — Engineering Spare Parts Master Coding",
    loading: "Loading…",
    nav_dashboard: "Dashboard", nav_framework: "Coding Framework", nav_categories: "Main Categories",
    nav_disciplines: "Disciplines", nav_manufacturers: "Manufacturers", nav_models: "Equipment Models",
    nav_funcgroups: "Functional Groups", nav_generator: "Code Generator", nav_tree: "Hierarchy Tree",
    nav_master: "Master Parts Table", nav_ledger: "Stock Ledger", nav_stockcount: "Stock Count",
    nav_movements: "Stock Movements", nav_reorder: "Reorder Settings", nav_alerts: "Stock Alerts", nav_assets: "Asset Registry", nav_reports: "Reliability Indicators", nav_admin: "Administration",
    nav_auditlog: "Audit Log", nav_users: "User Management", nav_trash: "Trash",
    group_Reference: "Reference", group_MasterData: "Master Data", group_Tools: "Tools",
    group_Inventory: "Inventory", group_System: "System", group_Assets: "Assets",
  },
  ar: {
    appName: "نظام ترميز كار جاز", appVersion: "البيانات الرئيسية v3.0",
    signOut: "تسجيل الخروج", collapse: "طي القائمة", expand: "فتح القائمة", liveDb: "متصل", local: "محلي",
    topBarSub: "نظام ترميز كار جاز — ترميز قطع غيار الهندسة",
    loading: "جاري التحميل…",
    nav_dashboard: "الرئيسية", nav_framework: "إطار الترميز", nav_categories: "الفئات الرئيسية",
    nav_disciplines: "التخصصات", nav_manufacturers: "الشركات المصنعة", nav_models: "موديلات المعدات",
    nav_funcgroups: "المجموعات الوظيفية", nav_generator: "مولد الأكواد", nav_tree: "الشجرة الهرمية",
    nav_master: "جدول قطع الغيار الرئيسي", nav_ledger: "دفتر المخزون", nav_stockcount: "جرد المخزون",
    nav_movements: "حركات المخزون", nav_reorder: "إعدادات إعادة الطلب", nav_alerts: "تنبيهات المخزون", nav_assets: "سجل الأصول", nav_reports: "مؤشرات الاعتمادية", nav_admin: "الإدارة",
    nav_auditlog: "سجل التدقيق", nav_users: "إدارة المستخدمين", nav_trash: "المهملات",
    group_Reference: "مرجع", group_MasterData: "البيانات الرئيسية", group_Tools: "أدوات",
    group_Inventory: "المخزون", group_System: "النظام", group_Assets: "الأصول",
  },
};

const LanguageContext = createContext(null);
const useLang = () => useContext(LanguageContext);

function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('cargas_lang') || 'en'; } catch { return 'en'; }
  });

  useEffect(() => {
    try { localStorage.setItem('cargas_lang', lang); } catch {}
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const t = (key) => dict[key] ?? key;
  const toggleLang = () => setLang(l => l === 'en' ? 'ar' : 'en');
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <LanguageContext.Provider value={{ lang, dir, t, toggleLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

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
// ALERTS CONTEXT
//
// Single shared source for alert counts, read by the Dashboard tiles,
// the header bell, and the /alerts page — all three read the same
// get_alert_counts() result instead of each running their own query.
//
// Scope note: the spec's "preferred addition" of a debounced Supabase
// Realtime subscription on stock changes is not included here — this
// codebase doesn't use Realtime anywhere else, and polling (60s) +
// refresh-on-focus + an explicit refreshAlerts() call after every
// stock-changing operation (Stock Count, Stock Movements, Reorder
// Settings save) covers the same need without introducing a new
// pattern. Can be added later if 60s is too slow in practice.
// ═══════════════════════════════════════════════════════════════

const AlertsContext = createContext(null);
const useAlerts = () => useContext(AlertsContext);

function AlertsProvider({ children, dbReady }) {
  const [counts, setCounts] = useState({ out: 0, critical: 0, low: 0 });
  const [unacknowledged, setUnacknowledged] = useState({ out: 0, critical: 0, low: 0 });
  const [unconfigured, setUnconfigured] = useState(0);
  const [loading, setLoading] = useState(true);

  const refreshAlerts = useCallback(() => {
    if (!dbReady) { setLoading(false); return; }
    Promise.all([db.fetchAlertCounts(), db.fetchUnconfiguredCount()]).then(([countsRes, unconfRes]) => {
      const next = { out: 0, critical: 0, low: 0 };
      const nextUnack = { out: 0, critical: 0, low: 0 };
      (countsRes.data || []).forEach(r => {
        if (r.severity in next) { next[r.severity] = r.total; nextUnack[r.severity] = r.unacknowledged; }
      });
      setCounts(next);
      setUnacknowledged(nextUnack);
      setUnconfigured(unconfRes.data ?? 0);
    }).finally(() => setLoading(false));
  }, [dbReady]);

  useEffect(() => { refreshAlerts(); }, [refreshAlerts]);

  useEffect(() => {
    const id = setInterval(refreshAlerts, 60000);
    return () => clearInterval(id);
  }, [refreshAlerts]);

  useEffect(() => {
    const onFocus = () => refreshAlerts();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAlerts]);

  const value = useMemo(() => ({
    counts, unacknowledged, unconfigured, loading, refreshAlerts,
    badgeCount: unacknowledged.out + unacknowledged.critical,
  }), [counts, unacknowledged, unconfigured, loading, refreshAlerts]);

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
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
          width:'760px', maxWidth:'85vw', opacity:0.07, filter:'grayscale(1) brightness(2)',
          pointerEvents:'none', userSelect:'none',
        }}
      />
      <div style={{ background:'#0f172a', border:'1px solid #1e2d45', borderRadius:14, padding:'44px 40px', width:420, boxShadow:'0 24px 70px rgba(0,0,0,0.55)', position:'relative', zIndex:1 }}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14, marginBottom:34 }}>
          <img src="/logo.png" alt="CarGas" style={{ width:96, height:96, objectFit:'contain', flexShrink:0, filter:'drop-shadow(0 6px 16px rgba(0,0,0,0.35))' }}/>
          <div style={{ textAlign:'center' }}>
            <div style={{ color:'#f8fafc', fontWeight:800, fontSize:24, letterSpacing:0.3, lineHeight:1.25 }}>CarGas Coding System</div>
            <div style={{ color:'#64748b', fontSize:13, marginTop:4, fontWeight:500, letterSpacing:0.4, textTransform:'uppercase' }}>Engineering Master Data</div>
          </div>
        </div>
        <div style={{ color:'#94a3b8', fontSize:13, marginBottom:24, textAlign:'center' }}>Sign in to your account</div>
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
  id:r.id, code:r.code, shortDesc:r.short_desc, longDesc:r.long_desc,
  cat:r.cat, mfr:r.mfr, model:r.model, disc:r.disc, fg:r.fg,
  partNo:r.part_no??'', oemPart:r.oem_part??'',
  // qtyPerAssembly = catalogue BOM figure (spare_parts.qty_per_assembly, ex-"qty").
  // qtyOnHand = the real running balance from the stock_transactions ledger.
  qtyPerAssembly:r.qty_per_assembly??0,
  qtyOnHand:r.qty_on_hand??0, stockSource:r.stock_source??'none', lastCountedAt:r.last_counted_at??null,
  unit:r.unit??'EA',
  loc:r.location??'', minStock:r.min_stock??0, maxStock:r.max_stock??0,
  remarks:r.remarks??'', status:r.status??'Active',
  imageUrl:r.image_url??null, datasheetUrl:r.datasheet_url??null,
});
const mapMovement = r => ({
  id:r.id, partCode:r.part_code, transactionType:r.transaction_type,
  quantity:r.quantity, reference:r.reference??'', notes:r.notes??'',
  assetId:r.asset_id??null, createdAt:r.created_at, createdBy:r.created_by,
  userEmail:r.user_profiles?.email, userName:r.user_profiles?.full_name,
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
      // Cascade: remove every spare part still filed under this category first,
      // so nothing is orphaned in Supabase after the category disappears.
      await db.deletePartsByFilter({ cat: code });
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
      // Cascade: remove every spare part still filed under this manufacturer first.
      await db.deletePartsByFilter({ mfr: code });
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
      // Cascade: remove every spare part still filed under this model first,
      // so the Hierarchy Tree and Master Table never show orphaned parts
      // for a model that no longer exists.
      await db.deletePartsByFilter({ model: code });
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
      // Cascade: remove every spare part still filed under this discipline first.
      await db.deletePartsByFilter({ disc: code });
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
      // Cascade: remove every spare part still filed under this engine system first.
      await db.deletePartsByFilter({ disc: code });
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
      // Cascade: remove every spare part still filed under this functional group first.
      await db.deletePartsByFilter({ fg: code });
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
      // NOTE: no quantity field is ever sent here. spare_parts.qty_on_hand
      // (migration 002_opening_balances.sql) is a computed running balance
      // maintained exclusively by stock_transactions + post_physical_count().
      // spare_parts.qty_per_assembly is read-only catalogue data in this app.
      const dbRow = {
        code:row.code, short_desc:row.shortDesc, long_desc:row.longDesc,
        cat:row.cat, mfr:row.mfr, model:row.model, disc:row.disc, fg:row.fg,
        part_no:row.partNo, oem_part:row.oemPart, unit:row.unit,
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

    // STOCK MOVEMENTS (LEDGER)
    // In local/offline mode there is no DB trigger to maintain qty, so we
    // apply the same delta rules here directly against the in-memory part.
    saveStockMovement: async (row) => {
      if (!dbReadyRef.current) {
        setState(prev => ({
          ...prev,
          parts: prev.parts.map(p => {
            if (p.code !== row.partCode) return p;
            const delta =
              (row.transactionType === 'RECEIPT' || row.transactionType === 'RETURN') ? row.quantity :
              (row.transactionType === 'ISSUE' || row.transactionType === 'CONSUMPTION') ? -row.quantity : 0;
            return { ...p, qty: Math.max(0, (p.qty||0) + delta) };
          }),
        }));
        return { data: null, error: null };
      }
      return db.insertStockMovement(row);
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
          <div style={TABLE_SCROLL}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:T.header }}>
                  {['Timestamp','User','Action','Table','Record','Details'].map(h=>(
                    <th key={h} style={{ padding:'8px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:11, letterSpacing:0.4, whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0
                  ? <tr><td colSpan={6} style={{ textAlign:'center', padding:36, color:T.muted }}>No audit entries yet.</td></tr>
                  : logs.map((log, i) => (
                  <tr key={log.id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                    <td style={{ padding:'7px 9px', color:T.muted, whiteSpace:'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                    <td style={{ padding:'7px 9px', color:T.text, fontSize:12 }}>{log.user?.email ?? log.user_id?.slice(0,8) ?? '—'}</td>
                    <td style={{ padding:'7px 9px' }}>
                      <span style={{ background:AB[log.action]??T.subtle, color:AC[log.action]??T.muted, fontWeight:700, fontSize:11, padding:'2px 8px', borderRadius:4 }}>{log.action}</span>
                    </td>
                    <td style={{ padding:'7px 9px', fontFamily:'monospace', color:T.muted, fontSize:12 }}>{log.table_name}</td>
                    <td style={{ padding:'7px 9px', fontFamily:'monospace', fontWeight:700, color:T.text, fontSize:12 }}>{log.record_id}</td>
                    <td style={{ padding:'7px 9px', color:T.muted, maxWidth:240, whiteSpace:'normal', wordBreak:'break-word', lineHeight:1.35, fontSize:12 }}>
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
// STOCK LEDGER PAGE — every Receipt / Issue / Consumption / Return /
// Transfer, server-side paginated like the Master Parts Table.
// spare_parts.qty is derived entirely from these rows (see migration
// 010_stock_movements.sql) — this page is the audit trail for it.
// ═══════════════════════════════════════════════════════════════

function StockLedgerPage({ data }) {
  const { ops, dbReady } = data;
  const PAGE_SIZE = 50;

  const [movements,   setMovements]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [page,        setPage]        = useState(0);
  const [total,       setTotal]       = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [fPart,       setFPart]       = useState('');
  const [fType,       setFType]       = useState('');
  const [showModal,   setShowModal]   = useState(false);
  const [toast,       setToast]       = useState(null);

  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  // Debounce the part-code search, same pattern as MasterTablePage.
  useEffect(() => {
    const t = setTimeout(() => setFPart(searchInput.trim().toUpperCase()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo(() => ({
    partCode: fPart || undefined,
    transactionType: fType || undefined,
  }), [fPart, fType]);

  useEffect(() => { setPage(0); }, [filters.partCode, filters.transactionType]);

  const load = useCallback(() => {
    if (!dbReady) { setLoading(false); setMovements([]); setTotal(0); return; }
    setLoading(true);
    Promise.all([
      db.fetchStockMovementsCount(filters),
      db.fetchStockMovements(filters, page, PAGE_SIZE),
    ]).then(([countRes, rowsRes]) => {
      setTotal(countRes.count || 0);
      setMovements((rowsRes.data || []).map(mapMovement));
      setLoading(false);
    });
  }, [filters.partCode, filters.transactionType, page, dbReady]);

  useEffect(() => { load(); }, [load]);

  const TC = { RECEIPT:'#047857', ISSUE:'#b45309', CONSUMPTION:'#dc2626', RETURN:'#1d4ed8', TRANSFER:'#6d28d9' };
  const TB = { RECEIPT:'#d1fae5', ISSUE:'#fef3c7', CONSUMPTION:'#fee2e2', RETURN:'#dbeafe', TRANSFER:'#f5f3ff' };
  const signPrefix = t => (t==='RECEIPT'||t==='RETURN') ? '+' : (t==='TRANSFER' ? '±' : '−');
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Stock Ledger" sub="Legacy movement history — read only. Kept for reference; it no longer affects any balance."/>
      {/* The primary "New Transaction" button used to sit directly
          under this warning. The loudest control on the page recorded a
          movement that, by the page's own notice, changes no balance —
          a storekeeper skimming the banner would believe they had
          issued stock when they had not. Warnings never beat buttons,
          so the button is gone and the page routes to the live one. */}
      <div style={{ background:T.warnBg, border:`1px solid ${T.warnBorder}`, borderLeft:`3px solid ${T.warn}`, borderRadius:T.radius, padding:"12px 16px", marginBottom:16, display:"flex", alignItems:"flex-start", gap:10, color:T.warn }}>
        <Icon name="warning" size={15} style={{ marginTop:1 }} />
        <div style={{ fontSize:13, lineHeight:1.5 }}>
          <strong>Superseded by Stock Count.</strong>{' '}
          <span style={{ color:T.textSecondary }}> Entries recorded here no longer affect any part's quantity on hand. This page is kept for historical reference only — post new movements from Stock Count.
          </span>
        </div>
      </div>
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
          <Input value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Filter by part code…" style={{ width:220 }}/>
          <Select value={fType} onChange={e=>setFType(e.target.value)} style={{ width:'auto', minWidth:160 }}>
            <option value="">All Types</option>
            {db.STOCK_TRANSACTION_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
          </Select>
          <span style={{ fontSize:13, color:T.muted }}>{total} transaction{total===1?'':'s'}</span>
        </div>
      </Card>
      <Card>
        {!dbReady ? (
          <div style={{ textAlign:'center', padding:40, color:T.muted }}>🟡 Stock Ledger requires a live database connection.</div>
        ) : loading ? (
          <div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading transactions…</div>
        ) : (
          <>
            <div style={TABLE_SCROLL}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:T.header }}>
                    {['Timestamp','Part Code','Type','Qty','Reference','Notes','User'].map(h=>(
                      <th key={h} style={{ padding:'8px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:11, letterSpacing:0.4, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0
                    ? <tr><td colSpan={7} style={{ textAlign:'center', padding:36, color:T.muted }}>No stock movements yet.</td></tr>
                    : movements.map((m,i) => (
                    <tr key={m.id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                      <td style={{ padding:'7px 9px', color:T.muted, whiteSpace:'nowrap' }}>{new Date(m.createdAt).toLocaleString()}</td>
                      <td style={{ padding:'7px 9px' }}><CodeTag code={m.partCode}/></td>
                      <td style={{ padding:'7px 9px' }}>
                        <span style={{ background:TB[m.transactionType]??T.subtle, color:TC[m.transactionType]??T.muted, fontWeight:700, fontSize:11, padding:'2px 8px', borderRadius:4 }}>{m.transactionType}</span>
                      </td>
                      <td style={{ padding:'7px 9px', fontWeight:700, color:T.text }}>{signPrefix(m.transactionType)}{m.quantity}</td>
                      <td style={{ padding:'7px 9px', color:T.muted }}>{m.reference||'—'}</td>
                      <td style={{ padding:'7px 9px', color:T.muted, maxWidth:200, whiteSpace:'normal', wordBreak:'break-word', lineHeight:1.35 }}>{m.notes||'—'}</td>
                      <td style={{ padding:'7px 9px', color:T.text, fontSize:12 }}>{m.userName || m.userEmail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:16, fontSize:13 }}>
              <span style={{ color:T.muted }}>Page {page+1} of {totalPages}</span>
              <div style={{ display:'flex', gap:8 }}>
                <Btn small variant="secondary" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>← Prev</Btn>
                <Btn small variant="secondary" disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}>Next →</Btn>
              </div>
            </div>
          </>
        )}
      </Card>
      {showModal && (
        <StockMovementModal
          ops={ops}
          onClose={()=>setShowModal(false)}
          onSaved={()=>{ flash('Stock movement recorded'); load(); }}
        />
      )}
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
    // The profile row cannot be created here — it has no id until the
    // person accepts and auth.users issues one. The chosen name, role
    // and department ride along as sign-up metadata instead, which the
    // handle_new_user trigger reads when it creates the profile.
    const { error } = await supabase.auth.signInWithOtp({
      email: form.email,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: form.full_name, role: form.role, department: form.department || null },
      },
    });
    if (error) return flash(error.message,'err');
    flash(`Invitation sent to ${form.email} — they will join as ${form.role === 'admin' ? 'Admin' : 'Department User'}`);
    setShowModal(false);
    reload();
  };

  const handleRoleChange = async (userId, newRole) => {
    const prev = users.find(u => u.id === userId)?.role;
    if (newRole === prev) return;
    // Show the new value immediately, then put it back if the write
    // is refused — the select must never disagree with the database.
    setUsers(us => us.map(u => u.id === userId ? { ...u, role:newRole } : u));
    const { error } = await db.updateUserRole(userId, newRole);
    if (error) {
      setUsers(us => us.map(u => u.id === userId ? { ...u, role:prev } : u));
      return flash(`Could not change role: ${error.message}`, 'err');
    }
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
          <Btn onClick={()=>setShowModal(true)}>Invite User</Btn>
        </div>
      </Card>
      <Card>
        {loading ? <div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading users…</div> : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:T.header }}>
                {['Name','Email','Role','Department','Change Role'].map(h=>(
                  <th key={h} style={{ padding:'8px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', fontSize:11, textTransform:'uppercase', letterSpacing:0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length===0
                ? <tr><td colSpan={5} style={{ textAlign:'center', padding:36, color:T.muted }}>No users yet.</td></tr>
                : users.map((u,i)=>(
                <tr key={u.id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                  <td style={{ padding:'7px 9px', fontWeight:600, color:T.text }}>{u.full_name||'—'}</td>
                  <td style={{ padding:'7px 9px', color:T.muted }}>{u.email}</td>
                  <td style={{ padding:'7px 9px' }}>
                    <span style={{ background:RB[u.role]??T.subtle, color:RC[u.role]??T.muted, fontWeight:700, fontSize:11, padding:'2px 8px', borderRadius:4 }}>{u.role}</span>
                  </td>
                  <td style={{ padding:'7px 9px', color:T.muted }}>{u.department||'—'}</td>
                  <td style={{ padding:'7px 9px' }}>
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
// TRASH PAGE (admin only)
// Shows every soft-deleted row across all tables, with Restore
// and Permanently Delete actions, plus a bulk Empty Trash action.
// ═══════════════════════════════════════════════════════════════

function TrashPage() {
  const [groups,       setGroups]       = useState([]);   // [{ table, label, data, error }]
  const [loading,      setLoading]      = useState(true);
  const [filterTable,  setFilterTable]  = useState('');
  const [toast,        setToast]        = useState(null);
  const [confirmPurge, setConfirmPurge] = useState(null);  // { table, code, label } | null
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busyCode,     setBusyCode]     = useState(null);  // code currently being restored/purged

  const flash = (t, type='ok') => { setToast({text:t,type}); setTimeout(()=>setToast(null),3200); };

  const [blockers, setBlockers] = useState({});   // "table|key" -> { canPurge, reasons }

  const reload = () => {
    setLoading(true);
    return Promise.all([db.fetchAllTrash(100), db.fetchTrashBlockers()])
      .then(([res, blk]) => { setGroups(res); setBlockers(blk.data || {}); setLoading(false); });
  };

  // A row is blocked when something still references it. The database
  // refuses the delete either way (the ledger's part_id is ON DELETE
  // RESTRICT); this just lets us say so before the user clicks.
  const blockerFor = (r) => blockers[`${r.__table}|${rowKey(r)}`] || { canPurge: true, reasons: [] };

  useEffect(() => { reload(); }, []);

  const rows = useMemo(() => {
    const all = [];
    for (const g of groups) {
      if (filterTable && g.table !== filterTable) continue;
      for (const r of g.data) all.push({ ...r, __table: g.table, __label: g.label });
    }
    return all.sort((a,b) => new Date(b.deleted_at) - new Date(a.deleted_at));
  }, [groups, filterTable]);

  const totalCount = groups.reduce((sum, g) => sum + g.data.length, 0);

  const rowKey = (r) => r[db.TRASH_TABLES.find(t=>t.table===r.__table)?.idCol || 'code'];
  const rowTitle = (r) => r.short_desc || r.label || r.asset_tag || r.code;

  const handleRestore = async (r) => {
    const key = rowKey(r);
    setBusyCode(key);
    const { error } = await db.restoreRecord(r.__table, key);
    setBusyCode(null);
    if (error) return flash(`Error: ${error.message}`, 'err');
    flash(`\"${key}\" restored`);
    reload();
  };

  const handlePurge = async (r) => {
    const key = rowKey(r);
    const blk = blockerFor(r);
    if (!blk.canPurge) {
      setConfirmPurge(null);
      return flash(`"${key}" cannot be permanently deleted — ${blk.reasons.join(' and ')} still reference it.`, 'err');
    }
    setBusyCode(key);
    const { error } = await db.hardDeleteRecord(r.__table, key);
    setBusyCode(null);
    setConfirmPurge(null);
    if (error) return flash(`Error: ${error.message}`, 'err');
    flash(`\"${key}\" permanently deleted`);
    reload();
  };

  // Purgeable rows grouped by table, so Empty Trash never attempts a
  // delete the foreign keys will refuse.
  const purgeableByTable = useMemo(() => {
    const out = {};
    rows.forEach(r => {
      if (!blockerFor(r).canPurge) return;
      (out[r.__table] ||= []).push(rowKey(r));
    });
    return out;
  }, [rows, blockers]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockedRows = rows.filter(r => !blockerFor(r).canPurge);

  const handleEmptyTrash = async () => {
    const { count, errors } = await db.emptyTrash(filterTable || null, purgeableByTable);
    setConfirmEmpty(false);
    if (errors) {
      return flash(`Deleted ${count}, but ${errors.length} table(s) failed: ${errors.map(e=>`${e.table} — ${e.message}`).join('; ')}`, 'err');
    }
    flash(blockedRows.length
      ? `Permanently deleted ${count}. Kept ${blockedRows.length} that still have history.`
      : `Permanently deleted ${count} record(s)`);
    reload();
  };


  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Trash" sub="Soft-deleted records — restore them or permanently remove them. Admin only."/>

      <Card style={{ marginBottom:20 }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
          <Select value={filterTable} onChange={e=>setFilterTable(e.target.value)} style={{ width:'auto', minWidth:200 }}>
            <option value="">All Tables ({totalCount})</option>
            {groups.map(g => (
              <option key={g.table} value={g.table}>{g.label} ({g.data.length})</option>
            ))}
          </Select>
          <span style={{ fontSize:13, color:T.muted }}>{rows.length} item{rows.length===1?'':'s'} shown</span>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <Btn small variant="secondary" onClick={reload}>↻ Refresh</Btn>
            {rows.length > 0 && (
              <Btn small variant="danger" onClick={()=>setConfirmEmpty(true)}>Empty Trash</Btn>
            )}
          </div>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading trash…</div>
        ) : (
          <div style={TABLE_SCROLL}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:T.header }}>
                  {['Deleted At','Table','Code','Description','Actions'].map(h=>(
                    <th key={h} style={{ padding:'8px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:11, letterSpacing:0.4, whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0
                  ? <tr><td colSpan={5} style={{ textAlign:'center', padding:36, color:T.muted }}>Trash is empty.</td></tr>
                  : rows.map((r, i) => (
                    <tr key={`${r.__table}-${rowKey(r)}`} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                      <td style={{ padding:'7px 9px', color:T.muted, whiteSpace:'nowrap' }}>{new Date(r.deleted_at).toLocaleString()}</td>
                      <td style={{ padding:'7px 9px' }}>
                        <span style={{ background:T.subtle, color:T.text, fontWeight:700, fontSize:11, padding:'2px 8px', borderRadius:4 }}>{r.__label}</span>
                      </td>
                      <td style={{ padding:'7px 9px', fontFamily:'monospace', fontWeight:700, color:T.text }}>{r.code || r.asset_tag}</td>
                      <td style={{ padding:'7px 9px', color:T.muted, maxWidth:320, whiteSpace:'normal', wordBreak:'break-word', lineHeight:1.35 }}>{rowTitle(r)}</td>
                      <td style={{ padding:'7px 9px' }}>
                        <div style={{ display:'flex', gap:6 }}>
                          <Btn small variant="success" onClick={()=>handleRestore(r)} disabled={busyCode===rowKey(r)}>
                            {busyCode===rowKey(r) ? '…' : 'Restore'}
                          </Btn>
                          {!blockerFor(r).canPurge ? (
                            <span title={`Cannot be permanently deleted — ${blockerFor(r).reasons.join(' and ')} still reference it. Its history would lose what it points to.`}
                              style={{ fontSize:11, fontWeight:700, color:T.muted, background:T.subtle,
                                border:`1px solid ${T.border}`, padding:"4px 10px", borderRadius:6, whiteSpace:"nowrap" }}>
                              🔒 Has history
                            </span>
                          ) : (
                          <Btn small variant="danger" onClick={()=>setConfirmPurge(r)} disabled={busyCode===rowKey(r)}>
                            🗑 Purge
                          </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* PURGE ONE — confirm modal */}
      {confirmPurge && (
        <Modal title="Permanently Delete" onClose={()=>setConfirmPurge(null)}>
          <div style={{ padding:14, background:T.dangerBg, borderRadius:8, marginBottom:16 }}>
            <div style={{ fontWeight:800, color:T.danger }}>{rowKey(confirmPurge)}</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:4 }}>{confirmPurge.__label} — {rowTitle(confirmPurge)}</div>
            {!blockerFor(confirmPurge).canPurge && (
              <div style={{ marginTop:10, background:T.dangerBg, border:`1px solid ${T.danger}`, borderRadius:6, padding:"10px 12px" }}>
                <div style={{ fontSize:12, fontWeight:700, color:T.danger }}>This record cannot be permanently deleted.</div>
                <div style={{ fontSize:12, color:T.text, marginTop:4 }}>
                  {blockerFor(confirmPurge).reasons.join(' and ')} still reference it. The stock ledger is permanent —
                  deleting this would leave those entries pointing at nothing. It can stay in Trash indefinitely, or be restored.
                </div>
              </div>
            )}
          </div>
          <p style={{ fontSize:13, color:T.text, marginBottom:16, lineHeight:1.6 }}>
            <strong style={{ color:T.danger }}>This cannot be undone.</strong> The record will be permanently removed from the database.
          </p>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Btn variant="secondary" onClick={()=>setConfirmPurge(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handlePurge(confirmPurge)}
              disabled={busyCode===rowKey(confirmPurge) || !blockerFor(confirmPurge).canPurge}>
              {busyCode===rowKey(confirmPurge) ? 'Deleting…' : 'Delete Permanently'}
            </Btn>
          </div>
        </Modal>
      )}

      {/* EMPTY TRASH — confirm modal */}
      {confirmEmpty && (
        <Modal title="Empty Trash" onClose={()=>setConfirmEmpty(false)}>
          <div style={{ padding:14, background:T.dangerBg, borderRadius:8, marginBottom:16 }}>
            <div style={{ fontWeight:800, color:T.danger }}>
              {filterTable ? `Empty trash for ${groups.find(g=>g.table===filterTable)?.label}` : 'Empty ALL trash'}
            </div>
            <div style={{ fontSize:12, color:T.muted, marginTop:4 }}>
              {rows.length - blockedRows.length} of {rows.length} record(s) will be permanently deleted
            </div>
          </div>
          <p style={{ fontSize:13, color:T.text, marginBottom:16, lineHeight:1.6 }}>
            <strong style={{ color:T.danger }}>This cannot be undone.</strong> Soft-deleted records {filterTable ? 'in this table' : 'across every table'} will be permanently removed.
          </p>
          {blockedRows.length > 0 && (
            <div style={{ marginBottom:16, background:T.subtle, border:`1px solid ${T.border}`, borderRadius:6, padding:"10px 12px" }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.text, marginBottom:6 }}>
                🔒 {blockedRows.length} record(s) will be kept — they still have history:
              </div>
              {blockedRows.slice(0, 8).map(r => (
                <div key={`${r.__table}|${rowKey(r)}`} style={{ fontSize:12, color:T.muted, padding:"2px 0" }}>
                  <span style={{ fontFamily:"monospace", color:T.text }}>{rowKey(r)}</span>
                  {' — '}{blockerFor(r).reasons.join(' and ')}
                </div>
              ))}
              {blockedRows.length > 8 && (
                <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>…and {blockedRows.length - 8} more.</div>
              )}
              <div style={{ fontSize:11, color:T.muted, marginTop:6 }}> The stock ledger is permanent, so a record its entries point at cannot be removed. These stay in Trash.
              </div>
            </div>
          )}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Btn variant="secondary" onClick={()=>setConfirmEmpty(false)}>Cancel</Btn>
            <Btn variant="danger" onClick={handleEmptyTrash}>Empty Trash</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FILE UPLOAD COMPONENT
// ═══════════════════════════════════════════════════════════════

// Opens a stored Storage file. Public buckets (part-images,
// asset-photos) can use their stored URL directly; private ones
// (asset-documents, part-datasheets/manuals/drawings) 404 on that URL
// — Supabase's /object/public/ route rejects a non-public bucket with
// "Bucket not found" before RLS is consulted — so those go through a
// short-lived signed URL instead. Pass `path` when the caller stored
// it (asset_documents does); otherwise it's recovered from the URL.
function StoredFileLink({ bucket, url, path, children, style }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const isPrivate = db.PRIVATE_BUCKETS.includes(bucket);

  if (!isPrivate) {
    return <a href={url} target="_blank" rel="noreferrer" style={{ color:T.accent, fontSize:12, ...style }}>{children}</a>;
  }

  const handleOpen = async () => {
    // The blank tab is opened synchronously, before the await, so the
    // popup blocker still sees it as part of the click gesture.
    const tab = window.open('', '_blank');
    setErr(''); setBusy(true);
    const filePath = path || db.pathFromPublicUrl(url, bucket);
    if (!filePath) { setBusy(false); if (tab) tab.close(); setErr('Cannot resolve file path'); return; }
    const { url: signed, error } = await db.createSignedUrl(bucket, filePath);
    setBusy(false);
    if (error || !signed) { if (tab) tab.close(); setErr(error?.message || 'Could not open file'); return; }
    if (tab) tab.location = signed; else window.location.href = signed;
  };

  return (
    <>
      <span onClick={handleOpen} style={{ color:T.accent, fontSize:12, cursor:'pointer', textDecoration:'underline', ...style }}>
        {busy ? 'Opening…' : children}
      </span>
      {err && <span style={{ fontSize:11, color:T.danger, marginLeft:6 }}>⚠️ {err}</span>}
    </>
  );
}

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
            : <StoredFileLink bucket={bucket} url={currentUrl}>View file</StoredFileLink>
          }
        </div>
      )}
      <input type="file" onChange={handleFile} disabled={uploading}
        accept={bucket==='part-images' ? 'image/jpeg,image/png,image/webp' : 'application/pdf'}
        style={{ fontSize:12, color:T.muted }}/>
      {uploading && <div style={{ fontSize:12, color:T.accent, marginTop:4 }}>Uploading…</div>}
      {err       && <div style={{ fontSize:12, color:T.danger, marginTop:4 }}>⚠️ {err}</div>}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════

const INIT_CATEGORIES = [
  { code: "CP", label: "Compressors",        icon: "",  color: "#1d4ed8", bg: "#dbeafe" },
  { code: "EN", label: "Engines",             icon: "🔧", color: "#b45309", bg: "#fef3c7" },
  { code: "ST", label: "Storage",             icon: "🗄️", color: "#047857", bg: "#d1fae5" },
  { code: "DI", label: "Dispensers",          icon: "⛽", color: "#7c3aed", bg: "#ede9fe" },
  { code: "IN", label: "Instrumentation",     icon: "📡", color: "#be123c", bg: "#ffe4e6" },
  { code: "LC", label: "Lubricants & Coolants",icon: "🛢️",color: "#0e7490", bg: "#cffafe" },
  { code: "TL", label: "Tools",               icon: "", color: "#6d28d9", bg: "#f5f3ff" },
  { code: "OT", label: "Others",              icon: "", color: "#374151", bg: "#f3f4f6" },
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

// ─── Direction B — "Engineering Console" ──────────────────────────
// The load-bearing rule of this palette: `success`, `warn` and
// `danger` communicate the STATE of a record and nothing else. They
// are not available for category identity, chart series or tile
// accents. Anything that is identity rather than state uses `subtle`
// with a `border` outline — see the `tag` / `statusTag` helpers below.
// Breaking that rule is what made a genuine stock-out the twelfth red
// thing on screen in the previous design.
const T = {
  // navigation chrome (dark) — frames the light working surface
  sidebar: "#151c27",
  sidebarBorder: "#26313f",
  sidebarActive: "#233248",
  sidebarHover: "#1f2937",
  sidebarText: "#9aa6b7",
  sidebarTextActive: "#f0f5fb",
  sidebarMarker: "#3fa9c4",
  sidebarGroup: "#5e6b7e",

  // interactive
  accent: "#15497f",
  accentHover: "#0f3862",
  accentLight: "#e6eef8",

  header: "#151c27",

  // surfaces
  bg: "#f4f6f8",
  card: "#ffffff",
  subtle: "#f8fafb",
  border: "#dfe4ea",
  borderStrong: "#c3cbd5",

  // ink — all four pass 4.5:1 on `card`
  text: "#171c24",
  textSecondary: "#4a5567",
  muted: "#7a8598",

  // STATE ONLY — never decoration
  success: "#0f6b45",
  successBg: "#e3f1ea",
  successBorder: "#bfdccc",
  warn: "#9a5b06",
  warnBg: "#fbf0da",
  warnBorder: "#e8d5a8",
  danger: "#a32b18",
  dangerBg: "#f9e7e3",
  dangerBorder: "#e9c6be",

  // Disciplines are IDENTITY, not state, so they are deliberately all
  // one neutral now. The shape is kept so the ~40 call sites that read
  // T.disc[x] keep working without a rewrite.
  disc: {
    ME: { c:"#4a5567", b:"#f8fafb" },
    EL: { c:"#4a5567", b:"#f8fafb" },
    AC: { c:"#4a5567", b:"#f8fafb" },
  },

  // type
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  radius: 4,        // controls
  radiusLg: 6,      // containers
  shadow: "0 1px 2px rgba(20,25,34,.06), 0 8px 24px -12px rgba(20,25,34,.18)",
};

// Type scale — seven steps with distinct roles, replacing the eight
// near-identical sizes measured on the old Master Parts Table.
const TYPE = {
  pageTitle: { fontSize: 27, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.015em" },
  h2:        { fontSize: 19, fontWeight: 600, lineHeight: 1.3 },
  h3:        { fontSize: 15, fontWeight: 600, lineHeight: 1.4 },
  body:      { fontSize: 15, fontWeight: 400, lineHeight: 1.6 },
  ui:        { fontSize: 13, fontWeight: 400, lineHeight: 1.5 },
  cell:      { fontSize: 12.5, fontWeight: 400, lineHeight: 1.4 },
  button:    { fontSize: 12.5, fontWeight: 600, lineHeight: 1.4 },
  helper:    { fontSize: 11.5, fontWeight: 400, lineHeight: 1.45, color: "#7a8598" },
  // uppercase micro-labels and table headers, both monospaced
  label:     { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" },
  th:        { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 10, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" },
  // codes, quantities, timestamps — always tabular so digits line up
  data:      { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 11.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
};

// ═══════════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════════
// One stroke-based set replacing the emoji that used to carry the
// navigation. Emoji render differently on every OS, cannot inherit
// colour or weight, and gave the collapsed 52px rail — where the icon
// IS the only navigation — no accessible name. Two nav items also
// shared the same 🏭.
//
// Paths are 24×24, stroked with `currentColor`, so an icon takes the
// colour and weight of whatever it sits in. `title` makes it a labelled
// image; without one it is decorative and hidden from screen readers.

const ICON_PATHS = {
  dashboard:   "M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  framework:   "M4 20h16M4 20V8l8-5 8 5v12M9 20v-6h6v6",
  category:    "M21 8l-9-5-9 5 9 5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5",
  discipline:  "M9 3v6l-5 9a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-5-9V3M9 3h6M7.5 14h9",
  manufacturer:"M2 20h20M4 20V9l5 3V9l5 3V9l5 3v8M8 20v-4h3v4",
  model:       "M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1zM9 12h6M9 16h4",
  funcgroup:   "M4 4h6v6H4zM14 14h6v6h-6zM7 10v4h7",
  generator:   "M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5",
  tree:        "M12 3v5M12 8H6v4M12 8h6v4M6 12v2M12 8v6M18 12v2M3 14h6v4H3zM9 18h6M9 14h6v4H9zM15 14h6v4h-6z",
  master:      "M3 3h18v18H3zM3 9h18M9 21V9",
  ledger:      "M5 3h11l3 3v15H5zM8 8h6M8 12h8M8 16h5",
  stockcount:  "M4 3h16v18H4zM8 7h8M8 11h2M12 11h2M16 11h.01M8 15h2M12 15h2M16 15h.01",
  movements:   "M1 3h15v13H1zM16 8h4l3 3v5h-7z M5.5 18.5a2 2 0 1 0 0-.1M18.5 18.5a2 2 0 1 0 0-.1",
  reorder:     "M2 3h2.5l2.2 11.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H5.2M9 21a1 1 0 1 0 0-.1M18 21a1 1 0 1 0 0-.1",
  alerts:      "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  assets:      "M2 20h20M4 20V8l5-4 5 4v12M14 20v-7h6v7M7 12h2M7 16h2",
  reports:     "M3 3v18h18M7 15l4-5 3 3 5-7",
  admin:       "M12 2l8 4v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6zM9 12l2 2 4-4",
  auditlog:    "M5 3h11l3 3v15H5zM9 9h6M9 13h6M9 17h3",
  users:       "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-.1M22 20v-2a4 4 0 0 0-3-3.9",
  trash:       "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 15H6L5 6M10 11v6M14 11v6",
  // actions
  search:      "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6",
  menu:        "M4 7h16M4 12h16M4 17h16",
  plus:        "M12 5v14M5 12h14",
  minus:       "M5 12h14",
  adjust:      "M4 8h16M4 16h16M9 4v8M15 12v8",
  download:    "M12 3v12M7 10l5 5 5-5M4 21h16",
  upload:      "M12 21V9M7 14l5-5 5 5M4 3h16",
  save:        "M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7",
  edit:        "M4 20h4L19 9a2 2 0 0 0-3-3L5 17z M14 5l3 3",
  close:       "M6 6l12 12M18 6L6 18",
  check:       "M20 6L9 17l-5-5",
  more:        "M12 5.5a1 1 0 1 0 0-.1M12 12a1 1 0 1 0 0-.1M12 18.5a1 1 0 1 0 0-.1",
  globe:       "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18",
  warning:     "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  clock:       "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  lock:        "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  undo:        "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  refresh:     "M20 11a8 8 0 1 0-2 6M20 5v6h-6",
  camera:      "M3 7h4l2-2h6l2 2h4v13H3zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  chevron:     "M9 6l6 6-6 6",
};

// `title` present → labelled image. Absent → decorative, hidden from
// assistive tech, because the surrounding control carries the label.
const Icon = ({ name, size = 15, stroke = 1.6, title, style }) => {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      style={{ flexShrink: 0, display: "block", ...style }}
    >
      {title && <title>{title}</title>}
      {d.split(" M").map((seg, i) => <path key={i} d={i === 0 ? seg : "M" + seg} />)}
    </svg>
  );
};

// ═══════════════════════════════════════════════════════════════
// PRIMITIVE UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

const Pill = ({ children, color = T.accent, bg = T.accentLight, mono = true, size = 12 }) => (
  <span style={{ background: bg, color, fontWeight: 700, fontSize: size, padding: "2px 8px", borderRadius: 4, fontFamily: mono ? "monospace" : "inherit", letterSpacing: mono ? 0.8 : 0, whiteSpace: "nowrap" }}>
    {children}
  </span>
);

// Identity, not state: category, manufacturer, discipline and
// functional group are all reference labels. They used to be six
// coloured chips per row, which left nothing for a real stock-out to
// shout with. They are neutral now — still chips, no longer competing.
const Tag = ({ children, title, mono = true }) => (
  <span title={title} style={{
    display:"inline-block", background:T.subtle, border:`1px solid ${T.border}`,
    color:T.textSecondary, fontFamily: mono ? T.mono : "inherit",
    fontSize:10.5, fontWeight:600, letterSpacing: mono ? "0.04em" : 0,
    padding:"2px 6px", borderRadius:3, whiteSpace:"nowrap",
  }}>{children}</span>
);

// State, and only state. Semantic colour lives here and nowhere else.
const StatusTag = ({ children, tone = "neutral" }) => {
  const tones = {
    ok:      { c:T.success, b:T.successBg, br:T.successBorder },
    warn:    { c:T.warn,    b:T.warnBg,    br:T.warnBorder },
    danger:  { c:T.danger,  b:T.dangerBg,  br:T.dangerBorder },
    neutral: { c:T.textSecondary, b:T.subtle, br:T.border },
  };
  const x = tones[tone] || tones.neutral;
  return (
    <span style={{
      display:"inline-block", background:x.b, border:`1px solid ${x.br}`, color:x.c,
      ...TYPE.label, fontSize:10, letterSpacing:"0.07em",
      padding:"3px 7px", borderRadius:3, whiteSpace:"nowrap",
    }}>{children}</span>
  );
};

// Destructive actions live behind this, never beside the action people
// use most. Delete used to sit ~8px from Edit in the part-detail header
// with no separator — a misclick risk on a dialog opened dozens of
// times a day.
const OverflowMenu = ({ items, label = "More actions" }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc  = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={()=>setOpen(o=>!o)} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        style={{ background:T.card,border:`1px solid ${T.borderStrong}`,borderRadius:T.radius,height:28,padding:"0 8px",cursor:"pointer",color:T.textSecondary,display:"flex",alignItems:"center" }}>
        <Icon name="more" size={14} />
      </button>
      {open && (
        <div role="menu" style={{ position:"absolute",top:"calc(100% + 6px)",right:0,minWidth:190,background:T.card,border:`1px solid ${T.border}`,borderRadius:T.radiusLg,boxShadow:T.shadow,zIndex:60,padding:4 }}>
          {visible.map((it,i)=>(
            <button key={i} role="menuitem"
              onClick={()=>{ setOpen(false); it.onClick(); }}
              style={{
                display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",
                background:"none",border:"none",cursor:"pointer",padding:"8px 10px",borderRadius:T.radius,
                fontSize:12.5,color: it.danger ? T.danger : T.text,
                // A rule separates destructive items from the rest.
                borderTop: it.danger && i > 0 ? `1px solid ${T.border}` : "none",
                marginTop:  it.danger && i > 0 ? 4 : 0,
                paddingTop: it.danger && i > 0 ? 10 : 8,
              }}
              onMouseEnter={e=>e.currentTarget.style.background = it.danger ? T.dangerBg : T.subtle}
              onMouseLeave={e=>e.currentTarget.style.background = "none"}>
              {it.icon && <Icon name={it.icon} size={13} />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CodeTag = ({ code }) => (
  // Was a dark navy pill with cyan text — the single loudest object in
  // every table row, competing with genuine status colour. The code is
  // still the row's anchor, so it keeps mono + weight, but it no longer
  // needs a filled badge to say so.
  <span style={{ color: T.text, fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
    {code}
  </span>
);

// Stock-level state color: red when zero, amber at/below the reorder
// point. `reorderPoint` isn't wired to real data yet — that column
// arrives in a later phase — so callers that don't have one yet just
// pass null/undefined and get red-when-zero only. Kept as a standalone
// helper (not baked into StockQtyDisplay's markup) so it's ready to
// wire up without touching every call site again.
function qtyStateColor(qty, reorderPoint = null) {
  const n = Number(qty) || 0;
  if (n === 0) return T.danger;
  if (reorderPoint != null && n <= reorderPoint) return T.warn;
  return T.text;
}

// Honesty-in-the-UI primitive: renders a stock quantity so an
// estimated (seeded, never physically counted) figure can never be
// mistaken for a real one. Used anywhere qty_on_hand is shown. Also
// applies qtyStateColor so a zero balance always reads as red.
const StockQtyDisplay = ({ qty, unit = "", stockSource, small = false, reorderPoint = null }) => {
  const size = small ? 12 : 13;
  const stateColor = qtyStateColor(qty, reorderPoint);
  const numStyle = { fontVariantNumeric: "tabular-nums" };
  if (stockSource === 'estimated') {
    return (
      <span title="Estimated starting balance — not yet physically counted" style={{ display:"inline-flex", alignItems:"center", gap:5, cursor:"help" }}>
        <span style={{ fontFamily:T.mono, color: stateColor===T.text?T.muted:stateColor, fontSize:size, fontWeight:600, ...numStyle }}>~{qty}{unit?<span style={{ color:T.muted, fontWeight:400, fontSize:size-1.5 }}>{` ${unit}`}</span>:null}</span>
        <span style={{ ...TYPE.label, fontSize:9, color:T.warn, background:T.warnBg, border:`1px solid ${T.warnBorder}`, padding:"1px 4px", borderRadius:3 }}>est.</span>
      </span>
    );
  }
  if (stockSource === 'counted') {
    return (
      <span style={{ fontFamily:T.mono, fontSize:size, color:stateColor, fontWeight:600, ...numStyle }}>
        {qty}{unit?<span style={{ color:T.muted, fontWeight:400, fontSize:size-1.5 }}>{` ${unit}`}</span>:null}
      </span>
    );
  }
  return <span title="No stock data recorded yet" style={{ fontSize:size, color:T.muted, cursor:"help" }}>— {unit}</span>;
};

// onClick/title are forwarded so a Card can be a clickable tile (the
// asset grid, the maintenance timeline). Without this they were
// silently dropped and the card looked clickable but did nothing.
// Full-bleed scroll container for a table that is the wide child of a
// Card: cancels the card's horizontal padding so the columns get the
// card's whole width.
const TABLE_SCROLL = { overflowX: "auto", margin: "0 -20px" };

// ─── CSV export helpers (shared) ──────────────────────────────────
// The BOM keeps Excel from mangling non-ASCII, and CRLF keeps it from
// treating the file as one long line on Windows.
const csvEsc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csvRow = arr => arr.map(csvEsc).join(',');
const downloadCsv = (lines, filename) => {
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Pins a table's last (actions) column to the right edge, so its
// buttons stay reachable on a table too wide to fit. A sticky cell is
// transparent by default and would show the scrolling columns through
// it, so each one paints its own row background; the left shadow marks
// where the pinned column starts.
const STICKY_ACTIONS_TH = {
  position: "sticky", right: 0, zIndex: 2, background: T.header,
  boxShadow: "-6px 0 6px -6px rgba(15,23,42,0.35)",
};
const stickyActionsTd = (bg) => ({
  position: "sticky", right: 0, zIndex: 1, background: bg,
  boxShadow: "-6px 0 6px -6px rgba(15,23,42,0.18)",
});

const Card = ({ children, style, pad = 20, onClick, title }) => (
  <div onClick={onClick} title={title}
    style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: pad, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", ...style }}>
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

const Btn = ({ children, onClick, variant = "primary", small = false, disabled = false, style: s = {}, title }) => {
  const base = { border: "none", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700, fontFamily: "inherit", transition: "opacity .15s", opacity: disabled ? 0.6 : 1, ...s };
  const size = small ? { padding: "5px 12px", fontSize: 12 } : { padding: "9px 18px", fontSize: 14 };
  const vars = {
    primary:  { background: T.accent,   color: "#fff" },
    secondary:{ background: T.subtle,   color: T.text, border: `1px solid ${T.border}` },
    danger:   { background: T.dangerBg, color: T.danger, border: `1px solid #fca5a5` },
    success:  { background: T.successBg,color: T.success },
    ghost:    { background: "transparent", color: T.muted },
  };
  return <button onClick={onClick} disabled={disabled} title={title} style={{ ...base, ...size, ...vars[variant] }}>{children}</button>;
};

const Input = ({ value, onChange, placeholder, style: s = {}, type = "text", maxLength, min, max, step }) => (
  <input type={type} value={value} onChange={onChange} placeholder={placeholder} maxLength={maxLength}
    min={min} max={max} step={step}
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
            <th key={c.key} style={{ padding: "8px 9px", textAlign: "left", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", fontSize:11, letterSpacing:0.4, whiteSpace: "nowrap" }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0
          ? <tr><td colSpan={cols.length} style={{ textAlign: "center", padding: 36, color: T.muted }}>{emptyMsg}</td></tr>
          : rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.border}`, background: i % 2 ? T.subtle : T.card }}>
              {cols.map(c => (
                <td key={c.key} style={{ padding: "7px 9px", ...c.style }}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))
        }
      </tbody>
    </table>
  </div>
);

// `color` is now honoured ONLY when it is one of the three state
// colours. Before, every caller passed a different decorative hue and
// the Dashboard rendered eight tiles in eight unrelated colours — the
// clearest instance of colour meaning nothing. A catalogue count is not
// a state, so it reads as plain ink; an out-of-stock count still shouts.
const STATE_COLORS = new Set([T.success, T.warn, T.danger]);

const StatCard = ({ label, value, color = T.accent, icon, onClick, title }) => {
  const isState = STATE_COLORS.has(color);
  const valueColor = isState ? color : T.text;
  return (
    <Card onClick={onClick} title={title}
      style={{ borderTop: `2px solid ${isState ? color : T.border}`, textAlign: "left", cursor: onClick ? "pointer" : undefined }}>
      <div style={{ ...TYPE.label, fontSize: 9.5, color: T.muted }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: valueColor, fontVariantNumeric: "tabular-nums", marginTop: 8 }}>{value}</div>
    </Card>
  );
};

const Toast = ({ msg }) => msg ? (
  <div role="status" style={{ position: "fixed", top: 20, right: 24, zIndex: 9999, background: msg.type === "ok" ? T.successBg : T.dangerBg, color: msg.type === "ok" ? T.success : T.danger, border: `1px solid ${msg.type === "ok" ? T.successBorder : T.dangerBorder}`, borderRadius: T.radiusLg, padding: "11px 16px", fontWeight: 600, fontSize: 13, boxShadow: T.shadow, display: "flex", alignItems: "center", gap: 8 }}>
    <Icon name={msg.type === "ok" ? "check" : "warning"} size={15} /> {msg.text}
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

const Modal = ({ title, onClose, children, maxWidth = 560 }) => (
  <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center" }}>
    <div style={{ background:T.card,borderRadius:10,padding:28,minWidth:420,maxWidth,width:"90%",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
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
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ maxWidth: 300, width: "auto" }} />
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
  const { categories, manufacturers, models, disciplines, funcGroups, dbReady, navigateTo } = data;

  const [totalParts,   setTotalParts]   = useState(0);
  const [catCounts,    setCatCounts]    = useState(categories.map(c=>({...c,count:0})));
  const [recentParts,  setRecentParts]  = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [partsInStock,  setPartsInStock]  = useState(null); // null while loading
  const [movementsThisMonth, setMovementsThisMonth] = useState(null);
  const alerts = useAlerts();

  useEffect(() => {
    if (!dbReady) { setPartsInStock(null); setMovementsThisMonth(null); return; }
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
    Promise.all([
      db.fetchPartsCount({ inStock: 'in' }),
      db.fetchStockTransactionsCount({ dateFrom: startOfMonth.toISOString() }),
    ]).then(([inStockRes, movementsRes]) => {
      setPartsInStock(inStockRes.count || 0);
      setMovementsThisMonth(movementsRes.count || 0);
    });
  }, [dbReady]);

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
        <StatCard label="Total Parts" value={loadingStats?"…":totalParts.toLocaleString()} color={T.accent} icon="" />
        <StatCard label="Categories" value={categories.length} color="#047857" icon="" />
        <StatCard label="Manufacturers" value={manufacturers.length} color="#b45309" icon="🏭" />
        <StatCard label="Models" value={models.length} color="#7c3aed" icon="📐" />
        <StatCard label="Functional Groups" value={funcGroups.length} color="#be123c" icon="" />
        <StatCard label="Disciplines" value={disciplines.length} color="#0e7490" icon="🔬" />
        <div onClick={()=>navigateTo && navigateTo('master', { inStock: 'in' })} style={{ cursor: navigateTo?"pointer":"default" }}>
          <StatCard label="Parts in Stock" value={partsInStock===null?"…":partsInStock.toLocaleString()} color="#0891b2" icon="📥" />
        </div>
        <div onClick={()=>navigateTo && navigateTo('movements')} style={{ cursor: navigateTo?"pointer":"default" }}>
          <StatCard label="Movements (30d)" value={movementsThisMonth===null?"…":movementsThisMonth.toLocaleString()} color="#7c3aed" icon="🚚" />
        </div>
      </div>

      {/* Stock Alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 24 }}>
        <div onClick={()=>navigateTo && navigateTo('alerts', { severity: ['out'] })} style={{ cursor: navigateTo?"pointer":"default" }}>
          <StatCard label="Out of Stock" value={alerts.loading?"…":alerts.counts.out.toLocaleString()} color={T.danger} />
        </div>
        <div onClick={()=>navigateTo && navigateTo('alerts', { severity: ['critical'] })} style={{ cursor: navigateTo?"pointer":"default" }}>
          <StatCard label="Critical" value={alerts.loading?"…":alerts.counts.critical.toLocaleString()} color={T.danger} />
        </div>
        <div onClick={()=>navigateTo && navigateTo('alerts', { severity: ['low'] })} style={{ cursor: navigateTo?"pointer":"default" }}>
          <StatCard label="Low Stock" value={alerts.loading?"…":alerts.counts.low.toLocaleString()} color={T.warn} />
        </div>
        <div onClick={()=>navigateTo && navigateTo('reorder', { filter:'unconfigured' })} style={{ cursor: navigateTo?"pointer":"default", opacity: alerts.unconfigured===0?0.6:1 }}>
          <StatCard label="No reorder point" title="These parts can never raise an alert" value={alerts.loading?"…":alerts.unconfigured.toLocaleString()} color={T.muted} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Hierarchy */}
        <Card>
          <SectionHeader>Equipment Hierarchy</SectionHeader>
          <div style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 2.2 }}>
            <div style={{ fontWeight: 800, color: T.accent }}>Engineering Spare Parts</div>
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
                {/* One series, one colour. Eight hues here encoded
                    nothing the category name did not already say, and
                    three zeroes rendered blue, red and purple. */}
                <span style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{c.label}</span>
                <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 600, color: T.text, fontVariantNumeric: "tabular-nums" }}>{loadingStats?"…":c.count}</span>
              </div>
              <div style={{ background: T.border, borderRadius: 2, height: 6 }}>
                <div style={{ background: T.accent, height: 6, borderRadius: 2, width: `${totalParts ? (c.count / totalParts) * 100 : 0}%`, transition: "width .5s" }} />
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
              { seg: "AA", name: "Category",   c: "#cbd5e1" },
              { seg: "BB", name: "Manufacturer",c: "#cbd5e1" },
              { seg: "CC", name: "Model",       c: "#cbd5e1" },
              { seg: "DD", name: "Discipline",  c: "#cbd5e1" },
              { seg: "EE", name: "Func. Group", c: "#cbd5e1" },
              { seg: "0001",name:"Sequence",    c: "#cbd5e1" },
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

const ICON_PRESETS = ["","🔧","🗄️","⛽","📡","🛢️","","","🏭","🔬","⚡","️","🔑","📋","💡","🧰","🔄","⚗️"];

function CategoriesPage({ data }) {
  const { categories, parts, ops } = data;

  const EMPTY = { code:"", label:"", icon:"", color:"#1d4ed8", bg:"#dbeafe" };
  const [form,        setForm]        = useState(EMPTY);
  const [editingCode, setEditingCode] = useState(null);
  const [showForm,    setShowForm]    = useState(false);
  const [deleteTarget,setDeleteTarget]= useState(null);
  const [toast,       setToast]       = useState(null);
  const [search,      setSearch]      = useState("");
  const [saving,      setSaving]      = useState(false);
  const [deleteCount, setDeleteCount] = useState(null); // live spare-part count for deleteTarget

  const flash = (text, type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const filtered = useMemo(()=>{
    if(!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories.filter(c=> c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q));
  },[categories, search]);

  // Live count of spare parts under whichever category is pending deletion.
  useEffect(() => {
    if (!deleteTarget) { setDeleteCount(null); return; }
    let cancelled = false;
    db.fetchPartsCount({ cat: deleteTarget.code }).then(({ count }) => {
      if (!cancelled) setDeleteCount(count ?? 0);
    });
    return () => { cancelled = true; };
  }, [deleteTarget]);

  // Live per-category spare-part counts for the "N parts" badges shown on
  // every card/row. Replaces reading the always-empty local `parts` array.
  const [catCounts, setCatCounts] = useState({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(categories.map(c => db.fetchPartsCount({ cat: c.code }).then(({ count }) => [c.code, count ?? 0])))
      .then(pairs => { if (!cancelled) setCatCounts(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [categories]);

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
    setSaving(true);
    const { error } = await ops.deleteCategory(cat.code);
    setSaving(false);
    if (error) return flash(`Error: ${error.message}`,"err");
    setDeleteTarget(null);
    flash(`Category "${cat.code}" and its spare parts were deleted`);
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
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search categories…" style={{ maxWidth:260,width:"auto" }} />
          <span style={{ fontSize:13,color:T.muted }}>{filtered.length} of {categories.length}</span>
          <div style={{ marginLeft:"auto" }}>
            <Btn onClick={openAdd}>Add Category</Btn>
          </div>
        </div>
      </Card>

      {/* Cards grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14, marginBottom:28 }}>
        {filtered.map(cat => {
          const partCount = catCounts[cat.code] ?? 0;
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
                <Btn small variant="secondary" onClick={()=>openEdit(cat)} style={{ flex:1 }}>Edit</Btn>
                <Btn small variant="danger" onClick={()=>setDeleteTarget(cat)} style={{ flex:1 }}>Delete</Btn>
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
          <span style={{ fontSize:32 }}></span>
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
                <th key={h} style={{ padding:"8px 9px",textAlign:"left",fontWeight:700,color:"#94a3b8",fontSize:11,textTransform:"uppercase",letterSpacing:0.4,whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((cat,i)=>{
              const pc = catCounts[cat.code] ?? 0;
              return (
                <tr key={cat.code} style={{ borderBottom:`1px solid ${T.border}`,background:i%2?T.subtle:T.card }}>
                  <td style={{ padding:"7px 9px" }}><Pill color={cat.color} bg={cat.bg}>{cat.code}</Pill></td>
                  <td style={{ padding:"7px 9px",fontWeight:700,color:T.text }}>{cat.label}</td>
                  <td style={{ padding:"7px 9px",fontSize:18 }}>{cat.icon}</td>
                  <td style={{ padding:"7px 9px" }}>
                    <span style={{ fontWeight:700,color:pc>0?T.accent:T.muted }}>{pc}</span>
                  </td>
                  <td style={{ padding:"7px 9px",fontFamily:"monospace",fontSize:12,color:T.muted }}>
                    <span style={{ color:cat.color,fontWeight:700 }}>{cat.code}</span>-BB-CC-DD-EE-0001
                  </td>
                  <td style={{ padding:"7px 9px" }}>
                    <div style={{ display:"flex",gap:6 }}>
                      <Btn small variant="secondary" onClick={()=>openEdit(cat)}>Edit</Btn>
                      <Btn small variant="danger" onClick={()=>setDeleteTarget(cat)}>Delete</Btn>
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
                  {form.icon||""}
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
              <Btn onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editingCode ? "Save Changes" : "Add Category"}</Btn>
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
                <div style={{ fontSize:12,color:T.muted,marginTop:2 }}>
                  {deleteCount===null ? "Checking spare parts…" : `${deleteCount} spare part(s) use this category`}
                </div>
              </div>
            </div>
            <p style={{ fontSize:13,color:T.text,lineHeight:1.6 }}>
              {deleteCount>0
                ? <><strong style={{ color:T.danger }}>This will also permanently delete all {deleteCount} spare part(s)</strong> filed under this category. This action cannot be undone.</>
                : "Are you sure you want to permanently delete this category? This action cannot be undone."
              }
            </p>
          </div>
          <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)} disabled={saving}>
              {saving ? "Deleting…" : deleteCount>0 ? `Delete Category + ${deleteCount} Part(s)` : "Delete Category"}
            </Btn>
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
  const [deleteCount, setDeleteCount] = useState(null);

  const flash = (text, type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };
  const filtered = useMemo(()=>{
    const q = search.toLowerCase();
    return !q ? manufacturers : manufacturers.filter(m=> m.code.toLowerCase().includes(q)||m.label.toLowerCase().includes(q));
  },[manufacturers,search]);

  // Live count of spare parts under whichever manufacturer is pending deletion.
  useEffect(() => {
    if (!deleteTarget) { setDeleteCount(null); return; }
    let cancelled = false;
    db.fetchPartsCount({ mfr: deleteTarget.code }).then(({ count }) => {
      if (!cancelled) setDeleteCount(count ?? 0);
    });
    return () => { cancelled = true; };
  }, [deleteTarget]);

  // Live per-manufacturer spare-part counts for the "N parts" badges.
  const [mfrCounts, setMfrCounts] = useState({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(manufacturers.map(m => db.fetchPartsCount({ mfr: m.code }).then(({ count }) => [m.code, count ?? 0])))
      .then(pairs => { if (!cancelled) setMfrCounts(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [manufacturers]);

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
    setSaving(true);
    const { error } = await ops.deleteManufacturer(mfr.code);
    setSaving(false);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDeleteTarget(null);
    flash(`Manufacturer "${mfr.code}" and its spare parts were deleted`);
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
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search manufacturers…" style={{maxWidth:260,width:"auto"}}/>
          <span style={{fontSize:13,color:T.muted}}>{filtered.length} of {manufacturers.length}</span>
          <div style={{marginLeft:"auto"}}><Btn onClick={openAdd}>Add Manufacturer</Btn></div>
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
                const pc = mfrCounts[mfr.code] ?? 0;
                return (
                  <Card key={mfr.code} style={{borderLeft:`4px solid ${cat.color}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:15,color:cat.color,background:cat.bg,padding:"2px 8px",borderRadius:4}}>{mfr.code}</span>
                      <span style={{fontSize:12,color:T.muted,background:T.subtle,padding:"2px 8px",borderRadius:4,fontWeight:600}}>{pc} part{pc!==1?"s":""}</span>
                    </div>
                    <div style={{fontWeight:700,fontSize:15,color:T.text,marginBottom:4}}>{mfr.label}</div>
                    <div style={{fontFamily:"monospace",fontSize:11,color:T.muted,marginBottom:12}}>{cat.code}-{mfr.code}-CC-DD-EE-0001</div>
                    <div style={{display:"flex",gap:8,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
                      <Btn small variant="secondary" onClick={()=>openEdit(mfr)} style={{flex:1}}>Edit</Btn>
                      <Btn small variant="danger" onClick={()=>setDeleteTarget(mfr)} style={{flex:1}}>Delete</Btn>
                    </div>
                  </Card>
                );
              })}
              {/* Add card */}
              <div onClick={()=>{setForm({...EMPTY,catCode:cat.code});setEditingCode(null);setShowForm(true);}}
                style={{border:`2px dashed ${T.border}`,borderRadius:8,padding:16,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",minHeight:120,color:T.muted,transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=cat.color;e.currentTarget.style.background=cat.bg+"44";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:26}}></span>
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
              <Btn onClick={handleSave}>{editingCode?"Save Changes":"Add Manufacturer"}</Btn>
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
              <div style={{fontSize:12,color:T.muted,marginTop:4}}>
                {deleteCount===null ? "Checking spare parts…" : `${deleteCount} spare part(s) use this manufacturer`}
              </div>
            </div>
            <p style={{fontSize:13,color:T.text,lineHeight:1.6}}>
              {deleteCount>0
                ?<><strong style={{color:T.danger}}>This will also permanently delete all {deleteCount} spare part(s)</strong> filed under this manufacturer. This action cannot be undone.</>
                :"Are you sure? This action cannot be undone."}
            </p>
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)} disabled={saving}>
              {saving ? "Deleting…" : deleteCount>0 ? `Delete Manufacturer + ${deleteCount} Part(s)` : "Delete"}
            </Btn>
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
  const [deleteCount, setDeleteCount] = useState(null); // live spare-part count for deleteTarget
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");

  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };
  const filtered = useMemo(()=>{
    const q=search.toLowerCase();
    return !q ? models : models.filter(m=>m.code.toLowerCase().includes(q)||m.label.toLowerCase().includes(q)||m.mfrCode.toLowerCase().includes(q));
  },[models,search]);

  // Fetch the real, live count of spare parts for whichever model is
  // pending deletion (the old code read this from a permanently-empty
  // local `parts` array and always showed 0).
  useEffect(() => {
    if (!deleteTarget) { setDeleteCount(null); return; }
    let cancelled = false;
    db.fetchPartsCount({ model: deleteTarget.code }).then(({ count }) => {
      if (!cancelled) setDeleteCount(count ?? 0);
    });
    return () => { cancelled = true; };
  }, [deleteTarget]);

  // Live per-model spare-part counts for the "N parts" badges.
  const [modelCounts, setModelCounts] = useState({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(models.map(m => db.fetchPartsCount({ model: m.code }).then(({ count }) => [m.code, count ?? 0])))
      .then(pairs => { if (!cancelled) setModelCounts(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [models]);

  const openAdd  = (mfrCode="") => { setForm({...EMPTY,mfrCode}); setEditingCode(null); setShowForm(true); };
  const openEdit = (m) => { setForm({...m}); setEditingCode(m.code); setShowForm(true); };
  const closeForm= () => { setShowForm(false); setEditingCode(null); setForm(EMPTY); };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if(!code||!form.label.trim()||!form.mfrCode) return flash("All fields are required","err");
    if(code.length<2||code.length>5) return flash("Model code must be 2–5 characters","err");
    if(editingCode===null && models.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
    if(editingCode!==null && code!==editingCode && models.find(m=>m.code===code)) return flash(`Code "${code}" already exists`,"err");
    setSaving(true);
    const record = { code, label:form.label.trim(), mfrCode:form.mfrCode };
    const { error } = await ops.saveModel(record, editingCode);
    setSaving(false);
    if(error) return flash(`Error: ${error.message}`,"err");
    flash(editingCode ? `Model "${code}" updated` : `Model "${code} — ${record.label}" added`);
    closeForm();
  };

  const handleDelete = async (model) => {
    setSaving(true);
    const { error } = await ops.deleteModel(model.code);
    setSaving(false);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDeleteTarget(null);
    flash(`Model "${model.code}" and its spare parts were deleted`);
  };

  const fStyle = { display:"flex",flexDirection:"column",gap:4 };
  const lStyle = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8 };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Equipment Models (CC)" sub="Add, edit, or remove models per manufacturer — third code segment"/>

      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search models…" style={{maxWidth:260,width:"auto"}}/>
          <span style={{fontSize:13,color:T.muted}}>{filtered.length} of {models.length}</span>
          <div style={{marginLeft:"auto"}}><Btn onClick={()=>openAdd()}>Add Model</Btn></div>
        </div>
      </Card>

      {/* Grouped by manufacturer */}
      {manufacturers.map(mfr=>{
        const mfrModels = filtered.filter(m=>m.mfrCode===mfr.code);
        if(mfrModels.length===0&&search) return null;
        const isEngine = (mfr.catCodes||[]).includes("EN");
        const color = isEngine?"#b45309":"#1d4ed8";
        const bg    = isEngine?"#fef3c7":"#dbeafe";
        const icon  = isEngine?"🔧":"";
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
                const pc = modelCounts[model.code] ?? 0;
                return (
                  <Card key={model.code} style={{borderLeft:`4px solid ${color}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:14,color,background:bg,padding:"2px 8px",borderRadius:4}}>{model.code}</span>
                      <span style={{fontSize:11,color:T.muted,background:T.subtle,padding:"2px 6px",borderRadius:4,fontWeight:600}}>{pc} part{pc!==1?"s":""}</span>
                    </div>
                    <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:4}}>{model.label}</div>
                    <div style={{fontFamily:"monospace",fontSize:10,color:T.muted,marginBottom:10}}> AA-{mfr.code}-<span style={{color,fontWeight:800}}>{model.code}</span>-DD-EE-0001
                    </div>
                    <div style={{display:"flex",gap:6,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                      <Btn small variant="secondary" onClick={()=>openEdit(model)} style={{flex:1}}>Edit</Btn>
                      <Btn small variant="danger" onClick={()=>setDeleteTarget(model)} style={{flex:1}}>Delete</Btn>
                    </div>
                  </Card>
                );
              })}
              {/* Add card for this manufacturer */}
              <div onClick={()=>openAdd(mfr.code)}
                style={{border:`2px dashed ${T.border}`,borderRadius:8,padding:14,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",minHeight:110,color:T.muted,transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=color;e.currentTarget.style.background=bg+"44";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:24}}></span>
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
              <div style={{fontFamily:"monospace",fontSize:11,color:T.muted,marginTop:6}}> AA-{form.mfrCode||"BB"}-<span style={{color:T.accent,fontWeight:700}}>{form.code||"CC"}</span>-DD-EE-0001
              </div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={closeForm}>Cancel</Btn>
              <Btn onClick={handleSave}>{editingCode?"Save Changes":"Add Model"}</Btn>
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
              <div style={{fontSize:12,color:T.muted,marginTop:4}}>
                {deleteCount===null ? "Checking spare parts…" : `${deleteCount} spare part(s) use this model`}
              </div>
            </div>
            <p style={{fontSize:13,color:T.text,lineHeight:1.6}}>
              {deleteCount>0
                ?<><strong style={{color:T.danger}}>This will also permanently delete all {deleteCount} spare part(s)</strong> filed under this model. This action cannot be undone.</>
                :"Are you sure? This action cannot be undone."}
            </p>
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)} disabled={saving}>
              {saving ? "Deleting…" : deleteCount>0 ? `Delete Model + ${deleteCount} Part(s)` : "Delete"}
            </Btn>
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

  const [delDCount, setDelDCount] = useState(null);
  const [delECount, setDelECount] = useState(null);

  // Live counts for whichever discipline / engine system is pending deletion.
  useEffect(() => {
    if (!delD) { setDelDCount(null); return; }
    let cancelled = false;
    db.fetchPartsCount({ disc: delD.code }).then(({ count }) => { if (!cancelled) setDelDCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [delD]);

  useEffect(() => {
    if (!delE) { setDelECount(null); return; }
    let cancelled = false;
    db.fetchPartsCount({ disc: delE.code }).then(({ count }) => { if (!cancelled) setDelECount(count ?? 0); });
    return () => { cancelled = true; };
  }, [delE]);

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
    const { error } = await ops.deleteDiscipline(d.code);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDelD(null); flash(`Discipline "${d.code}" and its spare parts were deleted`);
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
    const { error } = await ops.deleteEngineSystem(s.code);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDelE(null); flash(`Engine System "${s.code}" and its spare parts were deleted`);
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
        <Btn small onClick={()=>{setFormD(EMPTY_D);setEditD(null);setShowD(true);}}>Add Discipline</Btn>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14,marginBottom:28}}>
        {disciplines.map(d=>(
          <Card key={d.code} style={{borderTop:`4px solid ${d.color}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <Pill color={d.color} bg={d.bg} size={14}>{d.code}</Pill>
              <div style={{display:"flex",gap:6}}>
                <Btn small variant="secondary" onClick={()=>{setFormD({...d});setEditD(d.code);setShowD(true);}}></Btn>
                <Btn small variant="danger" onClick={()=>setDelD(d)}></Btn>
              </div>
            </div>
            <div style={{fontWeight:800,fontSize:17,color:T.text,marginBottom:4}}>{d.label}</div>
            <div style={{fontSize:13,color:T.muted,marginBottom:10}}>{d.desc}</div>
            <div style={{padding:"7px 10px",background:T.subtle,borderRadius:5,fontFamily:"monospace",fontSize:11,color:T.muted}}> AA-BB-CC-<span style={{color:d.color,fontWeight:800}}>{d.code}</span>-EE-0001
            </div>
          </Card>
        ))}
        {/* Add card */}
        <div onClick={()=>{setFormD(EMPTY_D);setEditD(null);setShowD(true);}}
          style={{border:`2px dashed ${T.border}`,borderRadius:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",minHeight:140,color:T.muted,transition:"all .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.background="#f0f9ff";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="transparent";}}>
          <span style={{fontSize:28}}></span><span style={{fontSize:13,fontWeight:700}}>Add Discipline</span>
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
          <Btn small onClick={()=>{setFormE(EMPTY_E);setEditE(null);setShowE(true);}}>Add System</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
          {engineSystems.map(s=>(
            <div key={s.code} style={{display:"flex",alignItems:"center",gap:10,background:s.bg,borderRadius:7,padding:"10px 14px",border:`1px solid ${s.color}22`}}>
              <div style={{flex:1}}>
                <div style={{fontFamily:"monospace",fontWeight:800,color:s.color,fontSize:13}}>{s.code}</div>
                <div style={{fontSize:13,fontWeight:600,color:s.color,marginTop:2}}>{s.label}</div>
              </div>
              <div style={{display:"flex",gap:4}}>
                <Btn small variant="secondary" onClick={()=>{setFormE({...s});setEditE(s.code);setShowE(true);}}></Btn>
                <Btn small variant="danger" onClick={()=>setDelE(s)}></Btn>
              </div>
            </div>
          ))}
          {/* Add engine system card */}
          <div onClick={()=>{setFormE(EMPTY_E);setEditE(null);setShowE(true);}}
            style={{border:`2px dashed #fbbf24`,borderRadius:7,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",minHeight:70,color:"#b45309",transition:"all .15s",padding:10}}
            onMouseEnter={e=>{e.currentTarget.style.background="#fef3c7";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
            <span style={{fontSize:22}}></span><span style={{fontSize:12,fontWeight:700}}>Add Engine System</span>
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
              <Btn onClick={saveD}>{editD?"Save Changes":"Add Discipline"}</Btn>
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
              <Btn onClick={saveE}>{editE?"Save Changes":"Add Engine System"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM — Discipline */}
      {delD&&(<Modal title="Delete Discipline" onClose={()=>setDelD(null)}>
        <div style={{padding:14,background:T.dangerBg,borderRadius:8,marginBottom:16}}>
          <div style={{fontWeight:800,color:T.danger}}>{delD.code} — {delD.label}</div>
          <div style={{fontSize:12,color:T.muted,marginTop:4}}>
            {delDCount===null ? "Checking spare parts…" : `${delDCount} spare part(s) use this discipline`}
          </div>
        </div>
        <p style={{fontSize:13,color:T.text,marginBottom:16,lineHeight:1.6}}>
          {delDCount>0
            ?<><strong style={{color:T.danger}}>This will also permanently delete all {delDCount} spare part(s)</strong> filed under this discipline.</>
            :"This action cannot be undone."}
        </p>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn variant="secondary" onClick={()=>setDelD(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={()=>deleteD(delD)}>{delDCount>0 ? `Delete + ${delDCount} Part(s)` : "Delete"}</Btn>
        </div>
      </Modal>)}

      {/* DELETE CONFIRM — Engine System */}
      {delE&&(<Modal title="Delete Engine System" onClose={()=>setDelE(null)}>
        <div style={{padding:14,background:T.dangerBg,borderRadius:8,marginBottom:16}}>
          <div style={{fontWeight:800,color:T.danger}}>{delE.code} — {delE.label}</div>
          <div style={{fontSize:12,color:T.muted,marginTop:4}}>
            {delECount===null ? "Checking spare parts…" : `${delECount} spare part(s) use this system`}
          </div>
        </div>
        <p style={{fontSize:13,color:T.text,marginBottom:16,lineHeight:1.6}}>
          {delECount>0
            ?<><strong style={{color:T.danger}}>This will also permanently delete all {delECount} spare part(s)</strong> filed under this system.</>
            :"This action cannot be undone."}
        </p>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn variant="secondary" onClick={()=>setDelE(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={()=>deleteE(delE)}>{delECount>0 ? `Delete + ${delECount} Part(s)` : "Delete"}</Btn>
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

  const [deleteCount, setDeleteCount] = useState(null);
  useEffect(() => {
    if (!deleteTarget) { setDeleteCount(null); return; }
    let cancelled = false;
    db.fetchPartsCount({ fg: deleteTarget.code }).then(({ count }) => { if (!cancelled) setDeleteCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [deleteTarget]);

  // Live per-functional-group spare-part counts for the "N parts" badges.
  const [fgCounts, setFgCounts] = useState({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(funcGroups.map(f => db.fetchPartsCount({ fg: f.code }).then(({ count }) => [f.code, count ?? 0])))
      .then(pairs => { if (!cancelled) setFgCounts(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [funcGroups]);

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
    setSaving(true);
    const { error } = await ops.deleteFuncGroup(fg.code);
    setSaving(false);
    if(error) return flash(`Error: ${error.message}`,"err");
    setDeleteTarget(null); flash(`"${fg.code}" and its spare parts were deleted`);
  };

  const fStyle = { display:"flex",flexDirection:"column",gap:4 };
  const lStyle = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8 };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Functional Groups (EE)" sub="Add, edit, or remove functional component groups — fifth code segment"/>

      <Card style={{marginBottom:20}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search functional groups…" style={{maxWidth:260,width:"auto"}}/>
          <span style={{fontSize:13,color:T.muted}}>{filtered.length} of {funcGroups.length}</span>
          <div style={{marginLeft:"auto"}}><Btn onClick={()=>openAdd()}>Add Functional Group</Btn></div>
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
              <Btn small onClick={()=>openAdd(disc.code)}>Add to {disc.label}</Btn>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
              {items.map(fg=>{
                const pc = fgCounts[fg.code] ?? 0;
                return (
                  <Card key={fg.code} style={{borderLeft:`3px solid ${disc.color}`,padding:14}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:disc.color,background:disc.bg,padding:"2px 8px",borderRadius:4}}>{fg.code}</span>
                      <span style={{fontSize:11,color:T.muted,fontWeight:600}}>{pc} part{pc!==1?"s":""}</span>
                    </div>
                    <div style={{fontWeight:600,fontSize:14,color:T.text,marginBottom:10}}>{fg.label}</div>
                    <div style={{display:"flex",gap:6}}>
                      <Btn small variant="secondary" onClick={()=>openEdit(fg)} style={{flex:1}}>Edit</Btn>
                      <Btn small variant="danger" onClick={()=>setDeleteTarget(fg)} style={{flex:1}}></Btn>
                    </div>
                  </Card>
                );
              })}
              {/* Add card */}
              <div onClick={()=>openAdd(disc.code)}
                style={{border:`2px dashed ${disc.color}44`,borderRadius:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",minHeight:100,color:disc.color,transition:"all .15s",padding:10}}
                onMouseEnter={e=>{e.currentTarget.style.background=disc.bg+"66";}}
                onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:24}}></span>
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
                <div style={{fontFamily:"monospace",fontSize:11,color:T.muted,marginTop:6}}> AA-BB-CC-{form.disc||"DD"}-<span style={{color:d?.color||T.muted,fontWeight:700}}>{form.code||"EE"}</span>-0001
                </div>
              </div>
            );})()}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={closeForm}>Cancel</Btn>
              <Btn onClick={handleSave}>{editingCode?"Save Changes":"Add Group"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM */}
      {deleteTarget&&(
        <Modal title="Delete Functional Group" onClose={()=>setDeleteTarget(null)}>
          <div style={{padding:14,background:T.dangerBg,borderRadius:8,marginBottom:16}}>
            <div style={{fontWeight:800,color:T.danger}}>{deleteTarget.code} — {deleteTarget.label}</div>
            <div style={{fontSize:12,color:T.muted,marginTop:4}}>
              {deleteCount===null ? "Checking spare parts…" : `${deleteCount} spare part(s) use this group`}
            </div>
          </div>
          <p style={{fontSize:13,color:T.text,marginBottom:16,lineHeight:1.6}}>
            {deleteCount>0
              ?<><strong style={{color:T.danger}}>This will also permanently delete all {deleteCount} spare part(s)</strong> filed under this group.</>
              :"Are you sure? This action cannot be undone."}
          </p>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(deleteTarget)} disabled={saving}>
              {saving ? "Deleting…" : deleteCount>0 ? `Delete + ${deleteCount} Part(s)` : "Delete"}
            </Btn>
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
  const [seqError,    setSeqError]    = useState(null);
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
    setSeqError(null);
    // Server-side (migration 036): the maximum is taken over every part
    // sharing this prefix, not a client-side page of 200.
    db.nextPartSequence({ cat: step.cat, mfr: step.mfr, model: step.model, disc: step.disc, fg: step.fg })
      .then(({ data, error }) => {
        if (error) { setSeqError(error.message); return; }
        setAutoSeq(data);
      })
      .finally(()=>setSeqLoading(false));
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
      partNo, oemPart, unit, loc, minStock:0, maxStock:0,
      remarks, status:"Active", imageUrl:imageUrl||null, datasheetUrl:null,
    };
    setSaving(true);
    const { error } = await ops.savePart(newPart, null);
    setSaving(false);
    if (error) { flash(`Error: ${error.message}`,"err"); return; }
    // Stock on hand starts unset (stock_source='none') — it's seeded by
    // the opening-balance estimator or confirmed on the Stock Count page,
    // never typed in here.
    setSaved(true);
    flash(`✅ Code ${generatedCode} saved to Master Table`);
  };

  const resetForm = () => {
    setStep({cat:"",mfr:"",model:"",disc:"",fg:""});
    setSeqMode("auto"); setManualSeq(""); setPartNo(""); setOemPart("");
    setUnit("EA"); setLoc(""); setRemarks(""); setImageUrl(null); setSaved(false);
  };

  const sStep  = { padding:"10px 16px", borderRadius:T.radiusLg, background:T.subtle, border:`1px solid ${T.border}`, marginBottom:12 };
  const sLabel = { ...TYPE.label, fontSize:11, color:T.textSecondary, marginBottom:6, display:"block" };

  // The whole step block used to be dimmed to opacity 0.4 while locked,
  // which put the step titles at roughly 2:1 against white — below the
  // 4.5:1 minimum, and it hid what the form was going to ask for next.
  // Now the label stays fully legible and only the control reads as
  // unavailable, with a line saying what unlocks it.
  const sStepLocked = { ...sStep, background:T.card, borderStyle:"dashed" };
  const stepBox  = enabled => (enabled ? sStep : sStepLocked);
  const LockHint = ({ enabled, needs }) => enabled ? null : (
    <span style={{ ...TYPE.helper, color:T.muted, display:"flex", alignItems:"center", gap:5, marginTop:6 }}>
      <Icon name="lock" size={11} /> Choose a {needs} first
    </span>
  );

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
          <div style={stepBox(!!step.cat)}>
            <span style={sLabel}>Step 2 — BB: Manufacturer</span>
            <Select value={step.mfr} onChange={e=>setStep(s=>({...s,mfr:e.target.value,model:"",disc:"",fg:""}))} disabled={!step.cat}>
              <option value="">Select Manufacturer…</option>
              {filteredMfrs.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
            </Select>
            <LockHint enabled={!!step.cat} needs="main category" />
          </div>

          {/* Step 3 */}
          <div style={stepBox(!!step.mfr)}>
            <span style={sLabel}>Step 3 — CC: Equipment Model</span>
            <Select value={step.model} onChange={e=>setStep(s=>({...s,model:e.target.value,disc:"",fg:""}))} disabled={!step.mfr}>
              <option value="">Select Model…</option>
              {filteredModels.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
            </Select>
            <LockHint enabled={!!step.mfr} needs="manufacturer" />
          </div>

          {/* Step 4 */}
          <div style={{...stepBox(!!step.model),...(isEngine?{borderColor:T.warnBorder,background:T.warnBg}:{})}}>
            <span style={sLabel}>Step 4 — DD: {isEngine?"Engine System":"Discipline"}</span>
            {isEngine&&<div style={{fontSize:11,color:"#b45309",marginBottom:6,fontWeight:600}}>🔧 Engine-specific system sections</div>}
            <Select value={step.disc} onChange={e=>setStep(s=>({...s,disc:e.target.value,fg:""}))} disabled={!step.model}>
              <option value="">{isEngine?"Select Engine System…":"Select Discipline…"}</option>
              {activeSections.map(d=><option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
            </Select>
            <LockHint enabled={!!step.model} needs="equipment model" />
          </div>

          {/* Step 5 */}
          <div style={stepBox(!!step.disc)}>
            <span style={sLabel}>Step 5 — EE: Functional Group</span>
            <Select value={step.fg} onChange={e=>setStep(s=>({...s,fg:e.target.value}))} disabled={!step.disc}>
              <option value="">Select Functional Group…</option>
              {filteredFG.map(f=><option key={f.code} value={f.code}>{f.code} — {f.label}</option>)}
            </Select>
            <LockHint enabled={!!step.disc} needs="discipline" />
          </div>

          {/* Step 6 — Sequence (auto + manual) */}
          <div style={{...stepBox(!!canGenerate),background:canGenerate?T.accentLight:T.card,borderColor:canGenerate?T.accent:T.border}}>
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
              <div style={{fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,marginBottom:10}}> Part Details (Optional)
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div><label style={sLabel}>Part No.</label><Input value={partNo} onChange={e=>setPartNo(e.target.value)} placeholder="e.g. AN-BRG-001"/></div>
                <div><label style={sLabel}>OEM Part No.</label><Input value={oemPart} onChange={e=>setOemPart(e.target.value)} placeholder="e.g. 1234567"/></div>
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
                  ? <div style={{textAlign:"center",color:T.muted,fontSize:12,marginBottom:10}}>Checking sequence…</div>
                  : seqError
                    ? <div style={{textAlign:"center",color:T.danger,fontSize:12,marginBottom:10}}>
                        ⚠️ Could not check the next sequence number: {seqError}. Save is disabled — reload and try again, or set the number manually.
                      </div>
                  : codeExists
                    ? <div style={{textAlign:"center",color:T.danger,fontWeight:700,fontSize:13,marginBottom:10}}>⚠️ This code already exists</div>
                    : <div style={{textAlign:"center",color:T.success,fontSize:12,marginBottom:10}}>✅ Valid 6-segment code</div>
                }
                {saved
                  ? <div style={{display:"flex",gap:8}}>
                      <div style={{flex:1,textAlign:"center",padding:"10px",background:"#d1fae5",borderRadius:6,color:"#047857",fontWeight:700,fontSize:13}}>✅ Saved!</div>
                      <Btn variant="secondary" onClick={resetForm} style={{flex:1}}>New Code</Btn>
                    </div>
                  : <Btn onClick={handleSave} style={{width:"100%"}} disabled={saving||codeExists||seqLoading||!!seqError}>
                      {saving?"Saving…":"Save to Master Table"}
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
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [quickActionType, setQuickActionType] = useState(null); // preset type for the quick-action buttons
  const [movements,       setMovements]       = useState([]);
  const [movLoading,      setMovLoading]      = useState(false);
  const [txnHistory,      setTxnHistory]      = useState([]); // up to 1000 non-void txns, for location + consumption math
  const [histLoading,     setHistLoading]     = useState(false);

  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const loadFullPart = useCallback(() => {
    if (!dbReady) return;
    setLoadingFull(true);
    return db.fetchParts({ search: part.code }, 0, 5).then(({ data: rows }) => {
      const match = (rows || []).find(r => r.code === part.code);
      if (match) {
        const full = mapPart(match);
        setFullPart(full);
        setForm(full);
        setImgUrl(full.imageUrl || null);
      }
    }).finally(() => setLoadingFull(false));
  }, [part.code, dbReady]);

  const loadMovements = useCallback(() => {
    if (!dbReady || !fullPart.id) return;
    setMovLoading(true);
    db.fetchStockTransactions({ partId: fullPart.id }, 0, 20)
      .then(({ data }) => setMovements(data || []))
      .finally(() => setMovLoading(false));
  }, [fullPart.id, dbReady]);

  // Broader (non-paginated-display) history used only to derive the
  // per-location breakdown and the 12-month consumption sparkline —
  // approximate for a part with an unusually long transaction history
  // (capped at 1000 rows), plenty for this catalogue's real volume.
  const loadTxnHistory = useCallback(() => {
    if (!dbReady || !fullPart.id) return;
    setHistLoading(true);
    db.fetchStockTransactions({ partId: fullPart.id }, 0, 1000)
      .then(({ data }) => setTxnHistory((data || []).filter(t => !t.is_void)))
      .finally(() => setHistLoading(false));
  }, [fullPart.id, dbReady]);

  // The Hierarchy Tree passes a lightweight part object (code, short_desc,
  // cat, mfr, model, disc, fg, image_url, status only — no part_no, qty,
  // location, etc). It's explicitly flagged with _isLightweight so we know
  // to fetch the full record here, regardless of default values mapPart()
  // fills in (e.g. partNo defaults to '' even when the column wasn't
  // fetched at all, so checking `=== undefined` doesn't work).
  useEffect(() => {
    if (!dbReady) return; // local mode already has the full object
    if (!part._isLightweight) return;
    let cancelled = false;
    loadFullPart().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [part.code, dbReady]);

  // Recent stock movements for this part (live DB only).
  useEffect(() => { loadMovements(); }, [loadMovements]);
  useEffect(() => { loadTxnHistory(); }, [loadTxnHistory]);

  // Per-location breakdown, derived from where each non-void movement
  // added to (location_to) or removed from (location_from). Not a true
  // per-location ledger table — an approximation from movement history.
  const locationBreakdown = useMemo(() => {
    const map = {};
    txnHistory.forEach(t => {
      const qty = Number(t.signed_qty) || 0;
      if (qty > 0 && t.location_to)   map[t.location_to]   = (map[t.location_to]   || 0) + qty;
      if (qty < 0 && t.location_from) map[t.location_from] = (map[t.location_from] || 0) + qty;
    });
    return Object.entries(map).map(([location, qty]) => ({ location, qty })).sort((a,b)=>b.qty-a.qty);
  }, [txnHistory]);

  // Which machines actually consumed this part, from the movements
  // that maintenance generated (migration 023 stamps asset_id on them).
  // Voided rows and their reversals are excluded — they cancel out, so
  // counting either would overstate how often the part was replaced.
  const assetConsumption = useMemo(() => {
    const map = {};
    txnHistory.forEach(t => {
      if (!t.asset_id || t.is_void || t.reverses_txn_id) return;
      const key = t.asset_tag || t.asset_id;
      if (!map[key]) map[key] = { assetTag: t.asset_tag, assetId: t.asset_id, times: 0, qty: 0, last: null };
      map[key].times += 1;
      map[key].qty += Math.abs(Number(t.signed_qty) || 0);
      if (!map[key].last || t.occurred_at > map[key].last) map[key].last = t.occurred_at;
    });
    return Object.values(map).sort((a,b) => b.times - a.times);
  }, [txnHistory]);

  // 12-month consumption: monthly issue totals for the sparkline, plus
  // rolling 30/90/365-day figures and an average monthly rate.
  const consumption = useMemo(() => {
    const issues = txnHistory.filter(t => t.txn_type === 'issue');
    const now = Date.now();
    const sumDays = (days) => issues
      .filter(t => now - new Date(t.occurred_at).getTime() <= days*86400000)
      .reduce((s,t) => s + Math.abs(Number(t.signed_qty)||0), 0);
    const base = new Date(); base.setDate(1); base.setHours(0,0,0,0);
    const monthKeys = [];
    for (let i=11; i>=0; i--) { const d=new Date(base); d.setMonth(d.getMonth()-i); monthKeys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); }
    const bucketMap = Object.fromEntries(monthKeys.map(k=>[k,0]));
    issues.forEach(t => {
      const d = new Date(t.occurred_at);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (k in bucketMap) bucketMap[k] += Math.abs(Number(t.signed_qty)||0);
    });
    const buckets = monthKeys.map(k => bucketMap[k]);
    const d365 = sumDays(365);
    return { d30: sumDays(30), d90: sumDays(90), d365, avgMonthly: Math.round((d365/12)*10)/10, buckets, monthKeys };
  }, [txnHistory]);

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
      unit:form.unit||'EA',
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
              <Btn small onClick={()=>setShowRecordModal(true)}>Record Movement</Btn>
              <Btn small variant="secondary" onClick={()=>setMode('edit')}>Edit</Btn>
              <OverflowMenu items={[
                { label:"Delete part", icon:"trash", danger:true, onClick:()=>setMode('confirm-delete') },
              ]}/>
              <span aria-hidden="true" style={{ width:1,height:20,background:T.border,margin:"0 2px" }}/>
            </>}
            <button onClick={onClose} aria-label="Close"
              style={{ background:"none",border:"none",cursor:"pointer",color:T.muted,padding:6,display:"flex",alignItems:"center" }}>
              <Icon name="close" size={16} />
            </button>
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
              <Btn variant="danger" onClick={handleDelete} disabled={saving}>{saving?"Deleting…":"Confirm Delete"}</Btn>
            </div>
          </div>
        )}

        {/* VIEW MODE */}
        {mode==='view' && (
          <div style={{ padding:"20px 24px" }}>
            {loadingFull && (
              <div style={{ textAlign:"center", padding:"10px 0", color:T.muted, fontSize:12 }}>Loading full part details…</div>
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
            {/* ═══ STOCK PANEL ═══ */}
            <div style={{ border:`1px solid ${T.border}`, borderRadius:8, padding:16, marginBottom:20, background:T.subtle }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div style={{ fontSize:12, fontWeight:800, color:T.text, textTransform:"uppercase", letterSpacing:0.6 }}>📊 Stock</div>
                {dbReady && (
                  <div style={{ display:"flex", gap:6 }}>
                    <Btn small variant="success" onClick={()=>{setQuickActionType('receipt'); setShowRecordModal(true);}}>+ Receive</Btn>
                    <Btn small variant="danger" onClick={()=>{setQuickActionType('issue'); setShowRecordModal(true);}}>− Issue</Btn>
                    <Btn small variant="secondary" onClick={()=>{setQuickActionType('adjustment_in'); setShowRecordModal(true);}}>± Adjust</Btn>
                  </div>
                )}
              </div>

              {/* On hand + qty/assembly */}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12 }}>
                <div style={{ background:T.card,borderRadius:6,padding:"9px 12px", border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,marginBottom:3 }}>Quantity on Hand</div>
                  <StockQtyDisplay qty={partView.qtyOnHand} unit={partView.unit} stockSource={partView.stockSource} />
                  <div style={{ fontSize:10, color:T.muted, marginTop:3 }}>
                    {partView.lastCountedAt ? `Last counted ${new Date(partView.lastCountedAt).toLocaleDateString()}` : 'Never physically counted'}
                  </div>
                </div>
                <div style={{ background:T.card,borderRadius:6,padding:"9px 12px", border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,marginBottom:3 }}>Qty per Assembly (catalogue)</div>
                  <div style={{ fontSize:13,fontWeight:600,color:T.text }}>{partView.qtyPerAssembly??0} {partView.unit||"EA"}</div>
                </div>
              </div>

              {/* Per-location breakdown */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,marginBottom:6 }}>By Location</div>
                {histLoading ? (
                  <div style={{ fontSize:12, color:T.muted }}>Loading…</div>
                ) : locationBreakdown.length === 0 ? (
                  <div style={{ fontSize:12, color:T.muted, background:T.card, border:`1px solid ${T.border}`, borderRadius:6, padding:"8px 12px" }}>No location data recorded in movement history.</div>
                ) : (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {locationBreakdown.map(l => (
                      <div key={l.location} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:6, padding:"6px 12px", fontSize:12 }}>
                        <span style={{ fontFamily:"monospace", fontWeight:700, color:T.text }}>{l.location}</span>
                        <span style={{ marginLeft:8, fontWeight:700, color:qtyStateColor(l.qty), fontVariantNumeric:"tabular-nums" }}>{l.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Which assets consumed this part */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,marginBottom:6 }}>Consumed By (Assets)</div>
                {assetConsumption.length === 0 ? (
                  <div style={{ fontSize:12, color:T.muted, background:T.card, border:`1px solid ${T.border}`, borderRadius:6, padding:"8px 12px" }}>Never logged against an asset's maintenance.</div>
                ) : (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {assetConsumption.map(a => (
                      <div key={a.assetId} onClick={()=>data.navigateTo && data.navigateTo('assetdetail',{ assetId:a.assetId })}
                        style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:6, padding:"6px 12px", fontSize:12, cursor:"pointer" }}
                        title={a.last ? `Last replaced ${new Date(a.last).toLocaleDateString()}` : ''}>
                        <span style={{ fontFamily:"monospace", fontWeight:700, color:T.accent }}>{a.assetTag}</span>
                        <span style={{ marginLeft:8, color:T.muted }}>×{a.times}</span>
                        <span style={{ marginLeft:6, fontWeight:700, color:T.text, fontVariantNumeric:"tabular-nums" }}>({a.qty})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 12-month consumption */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,marginBottom:6 }}>Consumption (Issues)</div>
                <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:36, marginBottom:8 }}>
                  {consumption.buckets.map((v,i) => {
                    const maxB = Math.max(1, ...consumption.buckets);
                    return <div key={i} title={`${consumption.monthKeys[i]}: ${v}`} style={{ flex:1, background:T.accent, opacity:0.65, height:`${Math.max(4,(v/maxB)*100)}%`, borderRadius:2 }}/>;
                  })}
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, fontSize:11 }}>
                  <div><div style={{ color:T.muted }}>Last 30d</div><div style={{ fontWeight:700, color:T.text, fontVariantNumeric:"tabular-nums" }}>{consumption.d30}</div></div>
                  <div><div style={{ color:T.muted }}>Last 90d</div><div style={{ fontWeight:700, color:T.text, fontVariantNumeric:"tabular-nums" }}>{consumption.d90}</div></div>
                  <div><div style={{ color:T.muted }}>Last 365d</div><div style={{ fontWeight:700, color:T.text, fontVariantNumeric:"tabular-nums" }}>{consumption.d365}</div></div>
                  <div><div style={{ color:T.muted }}>Avg/Month</div><div style={{ fontWeight:700, color:T.text, fontVariantNumeric:"tabular-nums" }}>{consumption.avgMonthly}</div></div>
                </div>
              </div>

              {/* Last 20 movements */}
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <div style={{ fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6 }}>Last 20 Movements</div>
                  {dbReady && (
                    <a href="#" onClick={e=>{e.preventDefault(); data.navigateTo && data.navigateTo('movements', { search: partView.code });}} style={{ fontSize:11, color:T.accent, fontWeight:700, textDecoration:"none" }}>View all movements →</a>
                  )}
                </div>
                {movLoading ? (
                  <div style={{ fontSize:12,color:T.muted,padding:"10px 0" }}>Loading…</div>
                ) : movements.length === 0 ? (
                  <div style={{ fontSize:12,color:T.muted,background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"10px 12px" }}>No movements recorded yet.</div>
                ) : (
                  <div style={{ overflowX:"auto", maxHeight:260, overflowY:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                      <thead>
                        <tr style={{ background:T.header }}>
                          {['Date','Type','Qty','Balance','Reference','User'].map(h=>(
                            <th key={h} style={{ padding:"6px 8px", textAlign:"left", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", fontSize:9, letterSpacing:0.4, position:"sticky", top:0 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m,i)=>(
                          <tr key={m.id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card, opacity:m.is_void?0.5:1 }}>
                            <td style={{ padding:"6px 8px", color:T.muted, whiteSpace:"nowrap", textDecoration:m.is_void?"line-through":"none" }}>{new Date(m.occurred_at).toLocaleDateString()}</td>
                            <td style={{ padding:"6px 8px", fontWeight:700, color:T.text, textDecoration:m.is_void?"line-through":"none" }}>{TXN_LABELS[m.txn_type]||m.txn_type}</td>
                            <td style={{ padding:"6px 8px", fontWeight:700, color:m.signed_qty>0?T.success:T.danger, fontVariantNumeric:"tabular-nums" }}>
                              {m.signed_qty>0?'+':''}{m.signed_qty}
                            </td>
                            <td style={{ padding:"6px 8px", fontWeight:700, color:T.text, fontVariantNumeric:"tabular-nums" }}>{m.balance_after}</td>
                            <td style={{ padding:"6px 8px", color:T.muted }}>{m.reference_no||'—'}</td>
                            <td style={{ padding:"6px 8px", color:T.muted }}>{m.user_full_name||m.user_email||'—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            {/* Details grid */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20 }}>
              {[
                {label:"Short Description", val:partView.shortDesc},
                {label:"Long Description",  val:partView.longDesc||"—"},
                {label:"Part Number",       val:partView.partNo||"—"},
                {label:"OEM Part Number",   val:partView.oemPart||"—"},
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
                <div>
                  <label style={sLabel}>Quantity on Hand</label>
                  <div style={{ padding:"8px 12px", borderRadius:6, border:`1px solid ${T.border}`, background:T.subtle, fontSize:14 }}>
                    <StockQtyDisplay qty={form.qtyOnHand} unit={form.unit} stockSource={form.stockSource} />
                    <span style={{ color:T.muted, marginLeft:8 }}>— use the Stock Count page to confirm or correct</span>
                  </div>
                </div>
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
                <Btn onClick={handleSave} disabled={saving}>{saving?"Saving…":"Save Changes"}</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
      {showRecordModal && (
        <RecordMovementModal
          part={partView}
          initialTxnType={quickActionType}
          onClose={()=>{setShowRecordModal(false); setQuickActionType(null);}}
          onSaved={({ newBalance })=>{ flash(`Movement recorded — now ${newBalance}`); loadMovements(); loadTxnHistory(); loadFullPart(); }}
        />
      )}
    </div>
  );
}


// The parts under one functional group. Mounted only when its node is
// expanded (Node renders children behind isOpen), so this is what makes
// the tree lazy: the page loads branch counts up front and never pulls
// a part row until someone opens the branch it belongs to.
function TreeLeafParts({ branch, total, dbReady, localParts, onSelect }) {
  const LIMIT = 100;
  const [rows,    setRows]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!dbReady) {
      setRows((localParts || []).filter(p =>
        p.cat===branch.cat && p.mfr===branch.mfr && p.model===branch.model &&
        p.disc===branch.disc && p.fg===branch.fg).slice(0, LIMIT));
      return;
    }
    let cancelled = false;
    setLoading(true); setError(null);
    db.fetchBranchParts(branch, LIMIT).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) { setError(err.message); return; }
      setRows((data || []).map(mapPart));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branch.cat, branch.mfr, branch.model, branch.disc, branch.fg, dbReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowStyle = { marginLeft:90,padding:"5px 10px",borderRadius:5,marginBottom:3,background:"#f8fafc",display:"flex",alignItems:"center",gap:8,cursor:"pointer",border:`1px solid transparent`,transition:"all .15s" };

  if (loading && !rows) return <div style={{ marginLeft:90, fontSize:11, color:T.muted, padding:"4px 0" }}>Loading parts…</div>;
  if (error)  return <div style={{ marginLeft:90, fontSize:11, color:T.danger, padding:"4px 0" }}>Could not load these parts: {error}</div>;
  if (!rows || rows.length === 0) return <div style={{ marginLeft:90, fontSize:11, color:T.muted, padding:"4px 0", fontStyle:"italic" }}>No parts coded yet</div>;

  return (
    <>
      {rows.map(p => (
        <div key={p.code} onClick={()=>onSelect(p)} style={rowStyle}
          onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.borderColor=T.accent;}}
          onMouseLeave={e=>{e.currentTarget.style.background="#f8fafc";e.currentTarget.style.borderColor="transparent";}}>
          <span style={{ fontSize:11,color:"#94a3b8" }}>—</span>
          <CodeTag code={p.code} />
          <span style={{ fontSize:12,color:T.muted,flex:1 }}>{p.shortDesc}</span>
          {p.imageUrl&&<span style={{ fontSize:11 }}>📷</span>}
          <span style={{ fontSize:11,color:T.accent,fontWeight:600 }}>View →</span>
        </div>
      ))}
      {total > rows.length && (
        <div style={{ marginLeft:90,fontSize:11,color:T.muted,padding:"4px 0",fontStyle:"italic" }}>
          …and {total - rows.length} more. Use Master Table to browse all.
        </div>
      )}
    </>
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

  // Counts come from v_parts_tree_counts (migration 035) — one row per
  // populated branch, ~172 rows against 5,868 parts. The tree used to
  // download every part just to count them; the individual parts under
  // a functional group are now fetched when that node is expanded.
  const [counts, setCounts] = useState([]);
  useEffect(() => {
    if (!dbReady) {
      // Offline/seed mode still has the whole array in memory, so roll
      // it up locally into the same shape the view returns.
      const local = {};
      (data.parts || []).forEach(p => {
        const k = `${p.cat}|${p.mfr}|${p.model}|${p.disc}|${p.fg}`;
        local[k] = local[k] || { cat:p.cat, mfr:p.mfr, model:p.model, disc:p.disc, fg:p.fg, part_count:0 };
        local[k].part_count += 1;
      });
      setCounts(Object.values(local));
      setTreeParts(data.parts || []);
      return;
    }
    let cancelled = false;
    setLoadingTree(true);
    setLoadError(null);
    db.fetchTreeCounts().then(({ data: rows, error }) => {
      if (cancelled) return;
      if (error) { setLoadError(error.message || 'Failed to load hierarchy data'); return; }
      setCounts(rows || []);
    }).finally(() => { if (!cancelled) setLoadingTree(false); });
    return () => { cancelled = true; };
  }, [dbReady]);

  // Roll the branch counts up once, into the shapes each tree level asks
  // for, instead of re-filtering a 5,868-row array at every node.
  const countIndex = useMemo(() => {
    const byCat = {}, byMfr = {}, byModel = {}, bySec = {}, byFg = {};
    let total = 0;
    (counts || []).forEach(r => {
      const n = Number(r.part_count) || 0;
      total += n;
      byCat[r.cat] = (byCat[r.cat] || 0) + n;
      const mfrKey   = `${r.cat}|${r.mfr}`;
      const modelKey = `${mfrKey}|${r.model}`;
      const secKey   = `${modelKey}|${r.disc}`;
      byMfr[mfrKey]     = (byMfr[mfrKey] || 0) + n;
      byModel[modelKey] = (byModel[modelKey] || 0) + n;
      bySec[secKey]     = (bySec[secKey] || 0) + n;
      byFg[`${secKey}|${r.fg}`] = n;
    });
    return { byCat, byMfr, byModel, bySec, byFg, total };
  }, [counts]);

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
      const secIdxKey = `${cat.code}|${mfr.code}|${mod.code}|${sec.code}`;
      const secCount  = countIndex.bySec[secIdxKey] || 0;
      const usedFGs = funcGroups.filter(fg => countIndex.byFg[`${secIdxKey}|${fg.code}`] > 0);
      return (
        <Node
          key={sec.code}
          label={sec.label}
          pill={sec.code}
          pillColor={sec.color}
          pillBg={sec.bg}
          nodeKey={secKey}
          depth={4}
          count={secCount}
          alwaysExpandable={true}
          tag={isEngine ? "Engine System" : null}
        >
          {usedFGs.map(fg=>{
            const fgCount = countIndex.byFg[`${secIdxKey}|${fg.code}`] || 0;
            const fgKey = `${secKey}-${fg.code}`;
            return (
              <Node key={fg.code} label={fg.label} pill={fg.code} pillColor="#6d28d9" pillBg="#f5f3ff" nodeKey={fgKey} depth={5} count={fgCount}>
                <TreeLeafParts
                  branch={{ cat:cat.code, mfr:mfr.code, model:mod.code, disc:sec.code, fg:fg.code }}
                  total={fgCount} dbReady={dbReady} localParts={parts}
                  onSelect={p=>setSelectedPart({ ...p, _isLightweight: true })}/>
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
          <div style={{ color:T.muted, fontSize:13 }}>Loading hierarchy…</div>
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
            <span style={{ fontSize:12, color:T.muted, marginLeft:"auto" }}>{countIndex.total.toLocaleString()} parts</span>
          </div>
          <Node label="Engineering Spare Parts" nodeKey="ROOT" depth={0} count={countIndex.total}>
            {categories.map(cat=>{
              const isEngine = cat.code === "EN";
              const catMfrs = manufacturers.filter(m=>(m.catCodes||[]).includes(cat.code));
              return (
                <Node key={cat.code} label={cat.label} pill={cat.code} pillColor={cat.color} pillBg={cat.bg} nodeKey={cat.code} depth={1} count={countIndex.byCat[cat.code] || 0}>
                  {catMfrs.map(mfr=>{
                    const mfrModels = models.filter(m=>m.mfrCode===mfr.code);
                    return (
                      <Node key={mfr.code} label={mfr.label} pill={mfr.code} pillColor="#b45309" pillBg="#fef3c7" nodeKey={`${cat.code}-${mfr.code}`} depth={2} count={countIndex.byMfr[`${cat.code}|${mfr.code}`] || 0}>
                        {mfrModels.map(mod=>{
                          const sections = isEngine ? engineSystems : disciplines;
                          return (
                            <Node key={mod.code} label={mod.label} pill={mod.code} pillColor="#047857" pillBg="#d1fae5" nodeKey={`${cat.code}-${mfr.code}-${mod.code}`} depth={3} count={countIndex.byModel[`${cat.code}|${mfr.code}|${mod.code}`] || 0} alwaysExpandable={true}>
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
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, ops, dbReady, navFilter, clearNavFilter } = data;
  const allSections = [...disciplines, ...engineSystems];

  // Filters
  const [search,   setSearch]   = useState("");
  const [fCat,     setFCat]     = useState("");
  const [fMfr,     setFMfr]     = useState("");
  const [fModel,   setFModel]   = useState("");
  const [fDisc,    setFDisc]    = useState("");
  const [fStatus,  setFStatus]  = useState("");
  const [fStock,   setFStock]   = useState("");  // '' | 'in' | 'out'
  const [fSource,  setFSource]  = useState("");  // '' | 'estimated' | 'counted' | 'none'

  // Pagination
  const [page,       setPage]       = useState(0);
  const [total,      setTotal]      = useState(0);
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [searchInput,setSearchInput]= useState("");

  // Part detail modal
  const [selectedPart, setSelectedPart] = useState(null);
  const [moveTarget,   setMoveTarget]   = useState(null); // part to record a movement for
  const [toast,        setToast]        = useState(null);
  const [importOpen,   setImportOpen]   = useState(false);
  const [exporting,    setExporting]    = useState(false);
  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const exportCsv = async () => {
    if (!dbReady) return flash('Requires a live database connection', 'err');
    setExporting(true);
    const { data: allRows, error } = await db.fetchParts(filters, 0, 5000);
    setExporting(false);
    if (error) return flash(`Error: ${error.message}`, 'err');
    const mapped = (allRows||[]).map(mapPart);
    const header = ['Code','Short Description','Long Description','Category','Manufacturer','Model','Discipline','Functional Group','Part No','OEM Part','Qty Per Assembly','Unit','Location','Status','Remarks'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const lines = [header.map(esc).join(',')];
    mapped.forEach(r => {
      lines.push([
        r.code, r.shortDesc, r.longDesc, r.cat, r.mfr, r.model, r.disc, r.fg,
        r.partNo, r.oemPart, r.qtyPerAssembly, r.unit, r.loc, r.status, r.remarks,
      ].map(esc).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `master-parts-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash(`Exported ${mapped.length} part(s)`);
  };

  // Consume a one-shot filter handed off by navigateTo() (e.g. the
  // Dashboard's "Parts in Stock" tile), then clear it so it doesn't
  // stick around on the next visit to this page.
  useEffect(() => {
    if (!navFilter) return;
    if (navFilter.inStock) setFStock(navFilter.inStock);
    if (navFilter.search) { setSearchInput(navFilter.search); setSearch(navFilter.search); }
    clearNavFilter();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = useMemo(()=>({
    search: search||undefined, cat: fCat||undefined, mfr: fMfr||undefined,
    model: fModel||undefined, disc: fDisc||undefined, status: fStatus||undefined,
    inStock: fStock||undefined, stockSource: fSource||undefined,
  }),[search, fCat, fMfr, fModel, fDisc, fStatus, fStock, fSource]);

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

  const selStyle = { padding:"0 10px", height:32, borderRadius:T.radius, border:`1px solid ${T.borderStrong}`, fontSize:13, color:T.text, background:T.card, fontFamily:"inherit" };

  return (
    <div>
      <PageHeader title="Master Parts Table" sub={`${total.toLocaleString()} coded parts`} />

      {/* Filters */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <input
            value={searchInput}
            onChange={e=>setSearchInput(e.target.value)}
            placeholder="Code, description, part no…"
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
          <select value={fStock} onChange={e=>setFStock(e.target.value)} style={selStyle} title="Filter by on-hand stock level">
            <option value="">All Stock</option>
            <option value="in">In Stock</option>
            <option value="out">Out of Stock</option>
          </select>
          <select value={fSource} onChange={e=>setFSource(e.target.value)} style={selStyle} title="Filter by how the on-hand figure was established">
            <option value="">Est. / Counted / Not Set</option>
            <option value="estimated">Estimated</option>
            <option value="counted">Counted</option>
            <option value="none">Not Set</option>
          </select>
          {(search||fCat||fMfr||fModel||fDisc||fStatus||fStock||fSource)&&(
            <button onClick={()=>{setSearchInput("");setSearch("");setFCat("");setFMfr("");setFModel("");setFDisc("");setFStatus("");setFStock("");setFSource("");}}
              style={{ padding:"7px 12px", borderRadius:5, border:"1px solid #fca5a5", background:"#fee2e2", color:T.danger, fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>
              ✕ Clear
            </button>
          )}
          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <Btn small variant="secondary" onClick={exportCsv} disabled={exporting}>{exporting?"Exporting…":"Export CSV"}</Btn>
            <Btn small variant="secondary" onClick={()=>setImportOpen(true)}>Import CSV</Btn>
          </div>
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

      <Card>
        <div style={TABLE_SCROLL}>
          {loading
            ? <div style={{ textAlign:"center", padding:40, color:T.muted }}>Loading parts…</div>
            : (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5 }}>
              <thead>
                {/* Was an inverted navy bar that competed with the dark
                    code pills beneath it. A light band with a strong
                    bottom rule reads as a header without shouting. */}
                <tr style={{ background:T.subtle }}>
                  {[["",""],["Code",""],["Short Description",""],["Cat",""],["Mfr",""],["Model",""],["System",""],["Func",""],["Part No",""],["Qty/Assy","right"],["On Hand","right"],["Loc",""],["Status",""],["Actions",""]].map(([h,align])=>(
                    <th key={h||'img'} style={{ padding:"9px 12px", textAlign:align||"left", ...TYPE.th, color:T.muted, whiteSpace:"nowrap", borderBottom:`1px solid ${T.borderStrong}`, position:"sticky", top:0, background:T.subtle, zIndex:1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length===0
                  ? <tr><td colSpan={14} style={{ textAlign:"center", padding:36, color:T.muted }}>No parts found.</td></tr>
                  : rows.map((r,i)=>{
                    const cat = categories.find(x=>x.code===r.cat);
                    const mdl = models.find(x=>x.code===r.model);
                    const sec = allSections.find(x=>x.code===r.disc);
                    const dc  = T.disc[r.disc]||{c:sec?.color||T.muted, b:sec?.bg||T.subtle};
                    return (
                      <tr key={r.code}
                        onClick={()=>setSelectedPart(r)}
                        onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); setSelectedPart(r); } }}
                        tabIndex={0}
                        title={`Open ${r.code}`}
                        // Zebra striping plus six coloured chips was two
                        // competing systems. Striping is gone; a single
                        // clear hover marks the row instead — which is
                        // also what removes the need for the "click any
                        // row" instruction that used to sit above.
                        style={{ borderBottom:`1px solid ${T.border}`, background:T.card, cursor:"pointer", transition:"background .12s" }}
                        onMouseEnter={e=>e.currentTarget.style.background="#f5f8fb"}
                        onMouseLeave={e=>e.currentTarget.style.background=T.card}>
                        <td style={{ padding:"0 12px", height:40, textAlign:"center", color:T.muted }}>
                          {r.imageUrl ? <Icon name="camera" size={13} title="Has image" style={{ margin:"0 auto" }}/> : <span style={{ color:T.border }}>—</span>}
                        </td>
                        <td style={{ padding:"0 12px", height:40 }}><CodeTag code={r.code}/></td>
                        <td style={{ padding:"0 12px", height:40, fontWeight:500, color:T.text, width:"100%", minWidth:150, whiteSpace:"normal", wordBreak:"break-word", lineHeight:1.35 }}>{r.shortDesc}</td>
                        <td style={{ padding:"0 12px", height:40 }}><Tag title={cat?.label}>{r.cat}</Tag></td>
                        <td style={{ padding:"0 12px", height:40 }}><Tag>{r.mfr}</Tag></td>
                        <td style={{ padding:"0 12px", height:40, color:T.textSecondary, maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={mdl?.label||r.model}>{mdl?.label||r.model}</td>
                        <td style={{ padding:"0 12px", height:40 }}><Tag title={sec?.label}>{r.disc}</Tag></td>
                        <td style={{ padding:"0 12px", height:40 }}><Tag>{r.fg}</Tag></td>
                        <td style={{ padding:"0 12px", height:40, fontFamily:T.mono, fontSize:11.5, color:T.muted, whiteSpace:"nowrap" }}>{r.partNo||"—"}</td>
                        <td style={{ padding:"0 12px", height:40, textAlign:"right", fontFamily:T.mono, color:T.muted, fontVariantNumeric:"tabular-nums" }} title="Quantity used per assembly — catalogue reference, not stock">{r.qtyPerAssembly}</td>
                        {/* The number this table exists to answer. Was
                            muted grey and left-aligned, quieter than a
                            two-letter category code. */}
                        <td style={{ padding:"0 12px", height:40, textAlign:"right", whiteSpace:"nowrap" }}><StockQtyDisplay qty={r.qtyOnHand} unit={r.unit} stockSource={r.stockSource} small/></td>
                        <td style={{ padding:"0 12px", height:40, fontFamily:T.mono, fontSize:11.5, color:T.muted, whiteSpace:"nowrap" }}>{r.loc||"—"}</td>
                        <td style={{ padding:"0 12px", height:40 }}>
                          {/* "Active" is the norm, not an exception —
                              21 green badges down a column is the same
                              decoration problem in a new colour. Only
                              the exception gets colour. */}
                          <StatusTag tone={r.status==="Active"?"neutral":"warn"}>{r.status}</StatusTag>
                        </td>
                        <td style={{ padding:"0 12px", height:40, whiteSpace:"nowrap" }} onClick={e=>e.stopPropagation()}>
                          <Btn small variant="secondary" onClick={()=>setMoveTarget(r)}>Move</Btn>
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
        {code:"Qty/Assy",label:"Quantity per Assembly (catalogue)"},{code:"On Hand",label:"Live Quantity on Hand"},{code:"Loc",label:"Storage Location"},
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

      {moveTarget && (
        <RecordMovementModal
          part={moveTarget}
          onClose={()=>setMoveTarget(null)}
          onSaved={({ part, newBalance })=>{
            flash(`Recorded — ${part.code} now ${newBalance}`);
            // Only the balance is known for certain here — stock_source is
            // server-managed (post_physical_count only) and isn't guessed client-side.
            setRows(r => r.map(p => p.id===part.id ? { ...p, qtyOnHand:newBalance } : p));
          }}
        />
      )}
      {importOpen && (
        <MasterImportModal
          onClose={()=>setImportOpen(false)}
          onDone={()=>{
            db.fetchPartsCount(filters).then(({count})=>setTotal(count??0));
            db.fetchParts(filters, page, PAGE_SIZE).then(({data})=>setRows((data??[]).map(mapPart)));
          }}
          flash={flash}
        />
      )}
      <Toast msg={toast}/>
    </div>
  );
}

// ─── ADMINISTRATION HUB ───────────────────────────────────────
function AdminPage({ data }) {
  const modules = [
    { id:"categories",    icon:"", title:"Main Categories",   desc:"Manage AA segment — equipment top-level classes", color:"#1d4ed8" },
    { id:"manufacturers", icon:"🏭", title:"Manufacturers",     desc:"Manage BB segment — equipment makers", color:"#b45309" },
    { id:"models",        icon:"📐", title:"Equipment Models",   desc:"Manage CC segment — machine model codes", color:"#047857" },
    { id:"disciplines",   icon:"🔬", title:"Disciplines",        desc:"View DD segment — ME / EL / AC", color:"#7c3aed" },
    { id:"funcgroups",    icon:"", title:"Functional Groups", desc:"Manage EE segment — component function codes", color:"#be123c" },
  ];

  return (
    <div>
      <PageHeader title="Administration" sub="Manage all master data modules for the coding framework" />
      <div style={{ padding:"14px 18px",background:"#0f172a",borderRadius:8,marginBottom:24,color:"#38bdf8",fontFamily:"monospace",fontWeight:700,fontSize:14 }}>
        ⚠️ All changes must preserve the mandatory format: AA – BB – CC – DD – EE – 0001
      </div>
      <NotificationSettingsCard />
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
// STOCK COUNT PAGE — turns seeded estimates into real, physically
// counted figures via post_physical_count(). Admin/storekeeper
// facing; this app has only admin/department_user roles, so
// "storekeeper" maps to department_user (both already have write
// access to spare_parts).
// ═══════════════════════════════════════════════════════════════

// Minimal CSV parser — handles quoted fields with embedded commas,
// good enough for a 3-column part_code,counted_quantity,location file.
// Shared low-level tokenizer — handles quoted fields with embedded commas.
function parseCsvRows(text) {
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cells.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length && /^part[_ ]?code$/i.test(rows[0][0] || "")) rows.shift(); // drop header row
  return rows
    .filter(r => r[0])
    .map(r => ({ code: r[0].toUpperCase(), counted: r[1], location: r[2] || "" }));
}

// Header-aware CSV parser — column order doesn't matter, matched by
// (case-insensitive) header name. Used by the Reorder Settings import,
// which has more columns than Stock Count's fixed 3-column format.
function parseCsvWithHeader(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return rows.slice(1).filter(r => r[0]).map(r => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i].trim() : ''; });
    return obj;
  });
}

function StockCountPage({ data }) {
  const { categories, manufacturers, models, funcGroups, dbReady } = data;
  const alerts = useAlerts();
  const PAGE_SIZE = 50;

  const [confidence,   setConfidence]   = useState(null); // rows from v_stock_confidence
  const [rows,         setRows]         = useState([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [toast,        setToast]        = useState(null);
  const [counted,      setCounted]      = useState({}); // { [partId]: inputValue }
  const [savingId,     setSavingId]     = useState(null);

  const [fCat, setFCat] = useState(""); const [fMfr, setFMfr] = useState("");
  const [fModel, setFModel] = useState(""); const [fFg, setFFg] = useState("");
  const [fLoc, setFLoc] = useState(""); const [fSource, setFSource] = useState("estimated");

  const [showImport, setShowImport] = useState(false);

  const flash = (text, type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const filters = useMemo(() => ({
    cat: fCat||undefined, mfr: fMfr||undefined, model: fModel||undefined,
    fg: fFg||undefined, location: fLoc||undefined, stockSource: fSource||undefined,
  }), [fCat, fMfr, fModel, fFg, fLoc, fSource]);

  useEffect(() => { setPage(0); }, [fCat, fMfr, fModel, fFg, fLoc, fSource]);

  const loadConfidence = () => {
    if (!dbReady) return;
    db.fetchStockConfidence().then(({ data: rows }) => setConfidence(rows || []));
  };

  const load = useCallback(() => {
    if (!dbReady) { setLoading(false); setRows([]); setTotal(0); return; }
    setLoading(true);
    Promise.all([
      db.fetchPartsCount(filters),
      db.fetchParts(filters, page, PAGE_SIZE),
    ]).then(([countRes, dataRes]) => {
      setTotal(countRes.count || 0);
      setRows((dataRes.data || []).map(mapPart));
    }).finally(() => setLoading(false));
  }, [filters.cat, filters.mfr, filters.model, filters.fg, filters.location, filters.stockSource, page, dbReady]);

  useEffect(() => { loadConfidence(); }, [dbReady]);
  useEffect(() => { load(); }, [load]);

  // Overall (cat IS NULL) rollup rows from v_stock_confidence.
  const overall = useMemo(() => {
    const o = { none: 0, estimated: 0, counted: 0 };
    (confidence || []).filter(r => r.cat === null).forEach(r => { o[r.stock_source] = r.part_count; });
    return o;
  }, [confidence]);
  const overallTotal = overall.none + overall.estimated + overall.counted;
  const pct = overallTotal ? Math.round((overall.counted / overallTotal) * 100) : 0;

  const handleConfirm = async (part, countedVal) => {
    const n = Number(countedVal);
    if (countedVal === "" || isNaN(n) || n < 0) return flash("Enter a valid non-negative quantity", "err");
    setSavingId(part.id);
    const { data: txn, error } = await db.postPhysicalCount(part.id, n, part.loc || null, null);
    setSavingId(null);
    if (error) return flash(`Error: ${error.message}`, "err");
    const diff = n - part.qtyOnHand;
    flash(diff === 0
      ? `Confirmed ${part.code} as-is (${n})`
      : `${part.code}: estimated ${part.qtyOnHand} → counted ${n}, adjustment ${diff>0?'+':''}${diff}`);
    setCounted(c => { const c2 = { ...c }; delete c2[part.id]; return c2; });
    load(); loadConfidence(); alerts.refreshAlerts();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const T_ = { padding:'8px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:11, letterSpacing:0.4, whiteSpace:'nowrap' };

  const printCountSheet = async () => {
    if (!dbReady) return flash("Requires a live database connection", "err");
    flash("Preparing count sheet…");
    const { data: allRows, error } = await db.fetchParts(filters, 0, 5000);
    if (error) return flash(`Error: ${error.message}`, "err");
    const list = (allRows || []).map(mapPart);
    const win = window.open("", "_blank");
    if (!win) return flash("Pop-up blocked — allow pop-ups to print", "err");
    win.document.write(`<!doctype html><html><head><title>Stock Count Sheet</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;padding:20px;}
      h1{font-size:16px;margin-bottom:4px;} p{color:#555;margin-top:0;margin-bottom:16px;}
      table{width:100%;border-collapse:collapse;} th,td{border:1px solid #999;padding:6px 8px;text-align:left;}
      th{background:#eee;} .blank{width:110px;}
    </style></head><body>
      <h1>Stock Count Sheet</h1>
      <p>Generated ${new Date().toLocaleString()} — ${list.length} part(s)</p>
      <table><thead><tr><th>Code</th><th>Description</th><th>Location</th><th class="blank">Counted Qty</th></tr></thead><tbody>
      ${list.map(p => `<tr><td>${p.code}</td><td>${(p.shortDesc||'').replace(/</g,'&lt;')}</td><td>${p.loc||''}</td><td></td></tr>`).join('')}
      </tbody></table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Stock Count" sub="Confirm or correct estimated opening balances, one shelf or one model at a time"/>

      {/* Progress header */}
      <Card style={{ marginBottom:20 }}>
        {!dbReady ? (
          <div style={{ color:T.muted, fontSize:13 }}>🟡 Requires a live database connection.</div>
        ) : confidence === null ? (
          <div style={{ color:T.muted, fontSize:13 }}>Loading…</div>
        ) : (
          <>
            <div style={{ fontSize:14, fontWeight:700, color:T.text, marginBottom:8 }}>
              {overall.counted.toLocaleString()} of {overallTotal.toLocaleString()} parts physically counted · {overall.estimated.toLocaleString()} still estimated
              {overall.none > 0 && ` · ${overall.none.toLocaleString()} never set`}
            </div>
            <div style={{ height:10, background:T.subtle, borderRadius:6, overflow:"hidden", border:`1px solid ${T.border}` }}>
              <div style={{ height:"100%", width:`${pct}%`, background:T.success, transition:"width .3s" }}/>
            </div>
            <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>{pct}% counted</div>
          </>
        )}
      </Card>

      {/* Filters + actions */}
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <Select value={fCat} onChange={e=>{setFCat(e.target.value);setFMfr("");setFModel("");}} style={{ width:"auto", minWidth:140 }}>
            <option value="">All Categories</option>
            {categories.map(c=><option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
          </Select>
          <Select value={fMfr} onChange={e=>setFMfr(e.target.value)} style={{ width:"auto", minWidth:140 }}>
            <option value="">All Manufacturers</option>
            {manufacturers.filter(m=>!fCat||(m.catCodes||[]).includes(fCat)).map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
          </Select>
          <Select value={fModel} onChange={e=>setFModel(e.target.value)} style={{ width:"auto", minWidth:120 }}>
            <option value="">All Models</option>
            {models.filter(m=>!fMfr||m.mfrCode===fMfr).map(m=><option key={m.code} value={m.code}>{m.code}</option>)}
          </Select>
          <Select value={fFg} onChange={e=>setFFg(e.target.value)} style={{ width:"auto", minWidth:140 }}>
            <option value="">All Functional Groups</option>
            {funcGroups.map(f=><option key={f.code} value={f.code}>{f.code} — {f.label}</option>)}
          </Select>
          <Input value={fLoc} onChange={e=>setFLoc(e.target.value)} placeholder="Location…" style={{ width:120 }}/>
          <Select value={fSource} onChange={e=>setFSource(e.target.value)} style={{ width:"auto", minWidth:150 }}>
            <option value="">All Stock Sources</option>
            <option value="estimated">Still Estimated</option>
            <option value="counted">Counted</option>
            <option value="none">Never Set</option>
          </Select>
          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <Btn small variant="secondary" onClick={printCountSheet}>🖨️ Print Count Sheet</Btn>
            <Btn small onClick={()=>setShowImport(true)}>Bulk CSV Import</Btn>
          </div>
        </div>
      </Card>

      <Card>
        {!dbReady ? (
          <div style={{ textAlign:"center", padding:40, color:T.muted }}>🟡 Requires a live database connection.</div>
        ) : loading ? (
          <div style={{ textAlign:"center", padding:40, color:T.muted }}>Loading parts…</div>
        ) : (
          <>
          <div style={TABLE_SCROLL}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.header }}>
                  {['Code','Description','Location','Current Qty','Counted Qty','Actions'].map(h=>(
                    <th key={h} style={T_}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0
                  ? <tr><td colSpan={6} style={{ textAlign:"center", padding:36, color:T.muted }}>No parts match these filters.</td></tr>
                  : rows.map((p,i) => (
                    <tr key={p.id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                      <td style={{ padding:"7px 9px" }}><CodeTag code={p.code}/></td>
                      <td style={{ padding:"7px 9px" }}>{p.shortDesc}</td>
                      <td style={{ padding:"7px 9px", color:T.muted, fontFamily:"monospace", fontSize:12 }}>{p.loc||"—"}</td>
                      <td style={{ padding:"7px 9px" }}><StockQtyDisplay qty={p.qtyOnHand} unit={p.unit} stockSource={p.stockSource} small/></td>
                      <td style={{ padding:"7px 9px" }}>
                        <Input type="number" value={counted[p.id] ?? ""} onChange={e=>setCounted(c=>({...c,[p.id]:e.target.value}))} placeholder="qty" style={{ width:90 }}/>
                      </td>
                      <td style={{ padding:"7px 9px", whiteSpace:"nowrap" }}>
                        <Btn small disabled={savingId===p.id} onClick={()=>handleConfirm(p, counted[p.id] ?? "")} style={{ marginRight:6 }}>
                          {savingId===p.id ? "…" : "Confirm"}
                        </Btn>
                        <Btn small variant="secondary" disabled={savingId===p.id} onClick={()=>handleConfirm(p, p.qtyOnHand)}>As-is</Btn>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, fontSize:13 }}>
            <span style={{ color:T.muted }}>Page {page+1} of {totalPages} ({total} parts)</span>
            <div style={{ display:"flex", gap:8 }}>
              <Btn small variant="secondary" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>← Prev</Btn>
              <Btn small variant="secondary" disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}>Next →</Btn>
            </div>
          </div>
          </>
        )}
      </Card>

      {showImport && (
        <BulkCountImportModal onClose={()=>setShowImport(false)} onDone={()=>{ load(); loadConfidence(); alerts.refreshAlerts(); }} flash={flash}/>
      )}
    </div>
  );
}

function BulkCountImportModal({ onClose, onDone, flash }) {
  const [fileName, setFileName] = useState("");
  const [parsed,   setParsed]   = useState([]);   // raw parsed rows
  const [matched,  setMatched]  = useState([]);   // { code, counted, location, part }
  const [unmatched,setUnmatched]= useState([]);   // codes not found
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState(null);

  const handleFile = async (file) => {
    setFileName(file.name);
    setLoadingPreview(true);
    const text = await file.text();
    const rows = parseCsv(text);
    setParsed(rows);
    const codes = [...new Set(rows.map(r=>r.code))];
    const { data: parts, error } = await db.fetchPartsByCodes(codes);
    setLoadingPreview(false);
    if (error) { flash(`Error looking up parts: ${error.message}`, "err"); return; }
    const byCode = {}; (parts||[]).forEach(p=>{ byCode[p.code] = p; });
    const m = [], um = [];
    rows.forEach(r => {
      const p = byCode[r.code];
      if (!p) { um.push(r.code); return; }
      m.push({ ...r, part: p });
    });
    setMatched(m);
    setUnmatched(um);
  };

  const totalAdjustment = matched.reduce((sum,r) => sum + (Number(r.counted) - (r.part.qty_on_hand ?? 0)), 0);

  const handleCommit = async () => {
    setCommitting(true);
    let done = 0, failed = 0;
    for (const r of matched) {
      const n = Number(r.counted);
      if (isNaN(n) || n < 0) { failed++; continue; }
      const { error } = await db.postPhysicalCount(r.part.id, n, r.location || r.part.location || null, 'Bulk CSV import');
      if (error) failed++; else done++;
      setProgress({ done: done+failed, total: matched.length });
    }
    setCommitting(false);
    flash(`Imported ${done} count(s)${failed?`, ${failed} failed`:''}`, failed ? "err" : "ok");
    onDone();
    onClose();
  };

  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };

  return (
    <Modal title="Bulk CSV Import — Physical Counts" onClose={onClose}>
      <div style={{ display:"flex", flexDirection:"column", gap:14, maxHeight:"70vh", overflowY:"auto" }}>
        <div style={{ fontSize:12, color:T.muted }}> Expects columns <code>part_code,counted_quantity,location</code> (header row optional; location optional).
        </div>
        <div>
          <label style={sLabel}>CSV File</label>
          <input type="file" accept=".csv,text/csv" onChange={e=>e.target.files[0] && handleFile(e.target.files[0])}/>
          {fileName && <div style={{ fontSize:12, color:T.muted, marginTop:4 }}>{fileName} — {parsed.length} row(s) parsed</div>}
        </div>

        {loadingPreview && <div style={{ color:T.muted, fontSize:12 }}>Matching part codes…</div>}

        {!loadingPreview && parsed.length > 0 && (
          <>
            <div style={{ display:"flex", gap:16, fontSize:12 }}>
              <span style={{ color:T.success, fontWeight:700 }}>{matched.length} matched</span>
              <span style={{ color:T.danger, fontWeight:700 }}>{unmatched.length} unmatched</span>
              <span style={{ color:T.text, fontWeight:700 }}>Net adjustment: {totalAdjustment>0?'+':''}{totalAdjustment}</span>
            </div>

            {unmatched.length > 0 && (
              <div style={{ background:T.dangerBg, borderRadius:6, padding:"8px 12px", fontSize:12, color:T.danger }}> Unmatched codes: {unmatched.join(', ')}
              </div>
            )}

            {matched.length > 0 && (
              <div style={{ overflowX:"auto", border:`1px solid ${T.border}`, borderRadius:6 }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:T.header }}>
                      {['Code','Current','Counted','Adjustment'].map(h=>(
                        <th key={h} style={{ padding:"6px 8px", textAlign:"left", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", fontSize:9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map((r,i) => {
                      const diff = Number(r.counted) - (r.part.qty_on_hand ?? 0);
                      return (
                        <tr key={r.code} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                          <td style={{ padding:"6px 8px", fontFamily:"monospace" }}>{r.code}</td>
                          <td style={{ padding:"6px 8px" }}>{r.part.qty_on_hand ?? 0}</td>
                          <td style={{ padding:"6px 8px" }}>{r.counted}</td>
                          <td style={{ padding:"6px 8px", fontWeight:700, color:diff===0?T.muted:(diff>0?T.success:T.danger) }}>{diff>0?'+':''}{diff}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {progress && <div style={{ fontSize:12, color:T.muted }}>Importing… {progress.done} / {progress.total}</div>}

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:`1px solid ${T.border}` }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleCommit} disabled={committing || matched.length===0}>
            {committing ? "Importing…" : `Commit ${matched.length} Count(s)`}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// STOCK MOVEMENTS PAGE — server-side paginated view of the real
// stock_transactions ledger (v_stock_transactions_detail), with
// filters, summary tiles, admin void, and CSV export.
// ═══════════════════════════════════════════════════════════════

const TXN_PILL = {
  opening_balance: { c:"#475569", b:"#f1f5f9" },
  receipt:         { c:T.success, b:T.successBg },
  return_to_store: { c:T.success, b:T.successBg },
  transfer_in:     { c:T.success, b:T.successBg },
  issue:           { c:T.warn,    b:T.warnBg },
  transfer_out:    { c:T.warn,    b:T.warnBg },
  scrap:           { c:"#475569", b:"#f1f5f9" },
  adjustment_in:   { c:"#475569", b:"#f1f5f9" },
  adjustment_out:  { c:"#475569", b:"#f1f5f9" },
};

function StockMovementsPage({ data }) {
  const { categories, manufacturers, dbReady, navigateTo, navFilter, clearNavFilter } = data;
  const { isAdmin } = useAuth();
  const PAGE_SIZE = 50;

  const [rows,      setRows]      = useState([]);
  const [reversals, setReversals] = useState({}); // { [originalId]: reversalRow }
  const [total,     setTotal]     = useState(0);
  const [summary,   setSummary]   = useState(null);
  const [page,      setPage]      = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);
  const [showRecord,setShowRecord]= useState(false);
  const [voidTarget,setVoidTarget]= useState(null); // row being voided
  const [voidReason,setVoidReason]= useState('');
  const [voidQty,   setVoidQty]   = useState('');
  const [voiding,   setVoiding]   = useState(false);

  // Pre-filtered arrival from e.g. Part Detail's "View all movements" link.
  const [searchInput, setSearchInput] = useState(navFilter?.search || '');
  const [search,   setSearch]   = useState(navFilter?.search || '');
  useEffect(() => { if (navFilter) clearNavFilter(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [fType,    setFType]    = useState('');
  const [fCat,     setFCat]     = useState('');
  const [fMfr,     setFMfr]     = useState('');
  const [fLoc,     setFLoc]     = useState('');
  const [fAsset,   setFAsset]   = useState('');
  const [assetOptions, setAssetOptions] = useState([]);

  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  useEffect(() => {
    if (!dbReady) return;
    db.fetchAssetOptions().then(({ data }) => setAssetOptions(data || []));  // filter list only; a failure just leaves it empty
  }, [dbReady]);

  useEffect(() => {
    const t = setTimeout(()=>setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo(() => ({
    search: search || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
    txnType: fType || undefined, cat: fCat || undefined, mfr: fMfr || undefined,
    location: fLoc || undefined, assetId: fAsset || undefined,
  }), [search, dateFrom, dateTo, fType, fCat, fMfr, fLoc, fAsset]);

  useEffect(() => { setPage(0); }, [filters.search, filters.dateFrom, filters.dateTo, filters.txnType, filters.cat, filters.mfr, filters.location, filters.assetId]);

  const load = useCallback(() => {
    if (!dbReady) { setLoading(false); setRows([]); setTotal(0); setSummary(null); return; }
    setLoading(true);
    Promise.all([
      db.fetchStockTransactionsCount(filters),
      db.fetchStockTransactions(filters, page, PAGE_SIZE),
      db.fetchStockTransactionsSummary(filters),
    ]).then(([countRes, rowsRes, summaryRes]) => {
      setTotal(countRes.count || 0);
      const list = rowsRes.data || [];
      setRows(list);
      setSummary(summaryRes.data);
      const voidedIds = list.filter(r=>r.is_void).map(r=>r.id);
      if (voidedIds.length) {
        db.fetchReversalsFor(voidedIds).then(({ data }) => {
          const map = {};
          (data||[]).forEach(r => { if (r.reverses_txn_id) map[r.reverses_txn_id] = r; });
          setReversals(map);
        });
      } else setReversals({});
    }).finally(()=>setLoading(false));
  }, [filters.search, filters.dateFrom, filters.dateTo, filters.txnType, filters.cat, filters.mfr, filters.location, page, dbReady]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selStyle = { padding:"0 10px", height:32, borderRadius:T.radius, border:`1px solid ${T.borderStrong}`, fontSize:13, color:T.text, background:T.card, fontFamily:"inherit" };

  const handleVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) return flash('A reason is required to void a transaction', 'err');
    const qty = voidQty === '' ? null : Number(voidQty);
    if (qty !== null && (!(qty > 0) || qty > Number(voidTarget.quantity))) {
      return flash(`Enter a quantity between 0 and ${voidTarget.quantity}`, 'err');
    }
    setVoiding(true);
    const { error } = await db.voidStockTransaction(voidTarget.id, voidReason.trim(), qty);
    setVoiding(false);
    if (error) return flash(`Error: ${error.message}`, 'err');
    flash(qty !== null && qty < Number(voidTarget.quantity)
      ? `Reversed ${qty} of ${voidTarget.quantity} for ${voidTarget.part_code}`
      : `Voided ${voidTarget.part_code} transaction — reversing entry posted`);
    setVoidTarget(null); setVoidReason(''); setVoidQty('');
    load();
  };

  const exportCsv = async () => {
    if (!dbReady) return flash('Requires a live database connection', 'err');
    flash('Preparing export…');
    const { data: allRows, error } = await db.fetchStockTransactions(filters, 0, 5000);
    if (error) return flash(`Error: ${error.message}`, 'err');
    const header = ['Date','Part Code','Description','Type','Quantity','Signed Qty','Balance After','Location From','Location To','Reference','Unit Cost','Asset','Maintenance','User','Voided'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const lines = [header.map(esc).join(',')];
    (allRows||[]).forEach(r => {
      lines.push([
        r.occurred_at, r.part_code, r.part_short_desc, r.txn_type, r.quantity, r.signed_qty, r.balance_after,
        r.location_from, r.location_to, r.reference_no, r.unit_cost, r.asset_tag, r.maintenance_title,
        r.user_full_name||r.user_email, r.is_void?'VOID':'',
      ].map(esc).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `stock-movements-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderRow = (r, i, nested=false) => {
    const pill = TXN_PILL[r.txn_type] || { c:T.muted, b:T.subtle };
    const dimmed = r.is_void;
    return (
      <tr key={r.id} style={{ borderBottom:`1px solid ${T.border}`, background: nested ? "#fafafa" : (i%2?T.subtle:T.card), opacity: dimmed?0.5:1 }}>
        <td style={{ padding:"7px 9px", color:T.muted, whiteSpace:"nowrap", fontSize:12, textDecoration:dimmed?"line-through":"none", paddingLeft: nested?28:10 }}>
          {nested && '↳ '}{new Date(r.occurred_at).toLocaleString()}
        </td>
        <td style={{ padding:"7px 9px", textDecoration:dimmed?"line-through":"none" }}><CodeTag code={r.part_code}/></td>
        <td style={{ padding:"7px 9px", fontSize:12, color:T.text, textDecoration:dimmed?"line-through":"none", maxWidth:160, whiteSpace:"normal", wordBreak:"break-word", lineHeight:1.35 }}>{r.part_short_desc}</td>
        <td style={{ padding:"7px 9px" }}>
          <span style={{ background:pill.b, color:pill.c, fontWeight:700, fontSize:10, padding:"2px 7px", borderRadius:4, textTransform:"uppercase", letterSpacing:0.3 }}>{TXN_LABELS[r.txn_type]||r.txn_type}</span>
        </td>
        <td style={{ padding:"7px 9px", fontWeight:700, color:r.signed_qty>0?T.success:T.danger, textDecoration:dimmed?"line-through":"none" }}>
          {r.signed_qty>0?'+':''}{r.signed_qty}
        </td>
        <td style={{ padding:"7px 9px", fontWeight:700, color:T.text }}>{r.balance_after}</td>
        <td style={{ padding:"7px 9px", fontSize:12, color:T.muted, fontFamily:"monospace" }}>{r.location_from||r.location_to ? `${r.location_from||'—'} → ${r.location_to||'—'}` : '—'}</td>
        <td style={{ padding:"7px 9px", fontSize:12, color:T.muted }}>{r.reference_no||'—'}</td>
        <td style={{ padding:"7px 9px", fontSize:12 }}>
          {r.asset_tag
            ? <span title={r.maintenance_title||''} onClick={()=>navigateTo && navigateTo('assetdetail',{ assetId:r.asset_id })}
                style={{ fontFamily:"monospace", fontWeight:700, color:T.accent, cursor:"pointer" }}>{r.asset_tag}</span>
            : <span style={{ color:"#d1d5db" }}>—</span>}
        </td>
        <td style={{ padding:"7px 9px", fontSize:12, color:T.text }}>{r.user_full_name||r.user_email||'—'}</td>
        <td style={{ padding:"7px 9px", whiteSpace:"nowrap" }}>
          {isAdmin && !r.is_void && !r.reverses_txn_id && (
            <Btn small variant="danger" onClick={()=>setVoidTarget(r)}>Void</Btn>
          )}
          {r.is_void && <span style={{ fontSize:10, color:T.danger, fontWeight:700 }}>VOIDED</span>}
        </td>
      </tr>
    );
  };

  // Build the render list: a voided row is immediately followed by its
  // reversal (if we found one), and that reversal is skipped at its own
  // natural chronological position further up the page to avoid a
  // duplicate row.
  const reversalIdsShownNested = new Set(Object.values(reversals).map(r=>r.id));
  const renderList = [];
  rows.forEach(r => {
    if (reversalIdsShownNested.has(r.id)) return; // shown nested elsewhere
    renderList.push(renderRow(r, renderList.length, false));
    if (r.is_void && reversals[r.id]) renderList.push(renderRow(reversals[r.id], renderList.length, true));
  });

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Stock Movements" sub="Every posted transaction against the real stock ledger, newest first"/>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16, gap:8 }}>
        <Btn variant="secondary" onClick={exportCsv}>Export CSV</Btn>
        <Btn onClick={()=>setShowRecord(true)}>Record Movement</Btn>
      </div>

      {/* Summary tiles */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:16 }}>
        <StatCard label="Total Received" value={summary?`+${summary.received}`:"…"} color={T.success} icon="📥"/>
        <StatCard label="Total Issued"   value={summary?`−${summary.issued}`:"…"}   color={T.warn}    icon="📤"/>
        <StatCard label="Net Change"     value={summary?`${summary.net>=0?'+':''}${summary.net}`:"…"} color={summary&&summary.net<0?T.danger:T.accent} icon="±"/>
        <StatCard label="Transactions"   value={summary?summary.count.toLocaleString():"…"} color="#7c3aed" icon="🧾"/>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <input value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Part code or reference…" style={{ ...selStyle, minWidth:200, flex:"1 1 180px" }}/>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={selStyle}/>
          <span style={{ fontSize:12, color:T.muted }}>to</span>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={selStyle}/>
          <select value={fType} onChange={e=>setFType(e.target.value)} style={selStyle}>
            <option value="">All Types</option>
            {db.ALL_TXN_TYPES.map(t=><option key={t} value={t}>{TXN_LABELS[t]}</option>)}
          </select>
          <select value={fCat} onChange={e=>setFCat(e.target.value)} style={selStyle}>
            <option value="">All Categories</option>
            {categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <select value={fMfr} onChange={e=>setFMfr(e.target.value)} style={selStyle}>
            <option value="">All Manufacturers</option>
            {manufacturers.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <input value={fLoc} onChange={e=>setFLoc(e.target.value)} placeholder="Location…" style={{ ...selStyle, width:120 }}/>
          <select value={fAsset} onChange={e=>setFAsset(e.target.value)} style={selStyle} title="Movements generated by maintenance on a specific asset">
            <option value="">All Assets</option>
            {assetOptions.map(a=><option key={a.id} value={a.id}>{a.asset_tag}</option>)}
          </select>
          {(search||dateFrom||dateTo||fType||fCat||fMfr||fLoc||fAsset) && (
            <button onClick={()=>{setSearchInput('');setSearch('');setDateFrom('');setDateTo('');setFType('');setFCat('');setFMfr('');setFLoc('');setFAsset('');}}
              style={{ padding:"7px 12px", borderRadius:5, border:"1px solid #fca5a5", background:"#fee2e2", color:T.danger, fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>
              ✕ Clear
            </button>
          )}
        </div>
      </Card>

      <Card>
        {!dbReady ? (
          <div style={{ textAlign:"center", padding:40, color:T.muted }}>🟡 Requires a live database connection.</div>
        ) : loading ? (
          <div style={{ textAlign:"center", padding:40, color:T.muted }}>Loading transactions…</div>
        ) : (
          <>
            <div style={TABLE_SCROLL}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr style={{ background:T.header }}>
                    {['Date','Part Code','Description','Type','Qty','Balance After','Location','Reference','Asset','User','Actions'].map(h=>(
                      <th key={h} style={{ padding:"8px 9px", textAlign:"left", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", fontSize:11, letterSpacing:0.4, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {renderList.length === 0
                    ? <tr><td colSpan={11} style={{ textAlign:"center", padding:36, color:T.muted }}>No transactions match these filters.</td></tr>
                    : renderList}
                </tbody>
              </table>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, fontSize:13 }}>
              <span style={{ color:T.muted }}>Page {page+1} of {totalPages} ({total.toLocaleString()} transactions)</span>
              <div style={{ display:"flex", gap:8 }}>
                <Btn small variant="secondary" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>← Prev</Btn>
                <Btn small variant="secondary" disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}>Next →</Btn>
              </div>
            </div>
          </>
        )}
      </Card>

      {showRecord && (
        <RecordMovementModal
          onClose={()=>setShowRecord(false)}
          onSaved={({ part, newBalance })=>{ flash(`Recorded — ${part.code} now ${newBalance}`); load(); }}
        />
      )}

      {voidTarget && (
        <Modal title="Void Transaction" onClose={()=>{ if(!voiding){ setVoidTarget(null); setVoidReason(''); setVoidQty(''); } }}>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div style={{ background:T.dangerBg, borderRadius:6, padding:"10px 14px", fontSize:13, color:T.danger }}> Voiding <strong>{TXN_LABELS[voidTarget.txn_type]}</strong> of <strong>{voidTarget.quantity}</strong> for <CodeTag code={voidTarget.part_code}/> posts a reversing entry — history is never edited.
            </div>
            <div>
              <label style={{ fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 }}>Quantity to reverse</label>
              <Input type="number" min="0" step="any" max={voidTarget.quantity} value={voidQty}
                onChange={e=>setVoidQty(e.target.value)} placeholder={`All ${voidTarget.quantity} (leave blank)`}/>
              <div style={{ fontSize:11, color:T.muted, marginTop:4 }}> Leave blank to reverse everything still outstanding and mark this entry void. A smaller number reverses only that many units and keeps the entry live so the rest can be reversed later.
              </div>
            </div>
            <div>
              <label style={{ fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 }}>Reason (required)</label>
              <Input value={voidReason} onChange={e=>setVoidReason(e.target.value)} placeholder="Why is this being voided?"/>
            </div>
            <div style={{ display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:`1px solid ${T.border}` }}>
              <Btn variant="secondary" onClick={()=>{setVoidTarget(null);setVoidReason('');setVoidQty('');}} disabled={voiding}>Cancel</Btn>
              <Btn variant="danger" onClick={handleVoid} disabled={voiding}>{voiding?"Voiding…":"Void with Reason"}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REORDER SETTINGS PAGE — bulk-editable min_stock/reorder_point/
// max_stock/lead_time_days/is_critical, backed by v_stock_status
// (migration 015_reorder_points.sql).
// ═══════════════════════════════════════════════════════════════

const STOCK_STATUS_META = {
  out:      { label: 'Out',      color: '#fff',    bg: T.danger },
  critical: { label: 'Critical', color: T.danger,  bg: T.dangerBg },
  low:      { label: 'Low',      color: T.warn,    bg: T.warnBg },
  ok:       { label: 'OK',       color: T.success, bg: T.successBg },
  unset:    { label: 'Unset',    color: T.muted,   bg: T.subtle },
};

function ReorderSettingsPage({ data }) {
  const { categories, manufacturers, models, funcGroups, dbReady, navFilter, clearNavFilter } = data;
  const alerts = useAlerts();
  const { isAdmin, isDeptUser } = useAuth();
  const canEdit = isAdmin || isDeptUser;
  const PAGE_SIZE = 50;

  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(0);
  const [loading, setLoading] = useState(true);
  const [unsetCount, setUnsetCount] = useState(null);
  const [toast,   setToast]   = useState(null);
  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const [searchInput, setSearchInput] = useState('');
  const [search,  setSearch]  = useState('');
  const [fCat,    setFCat]    = useState('');
  const [fMfr,    setFMfr]    = useState('');
  const [fModel,  setFModel]  = useState('');
  const [fFg,     setFFg]     = useState('');
  const [fStatus, setFStatus] = useState('');

  const [edits,  setEdits]  = useState({}); // { [id]: { minStock, reorderPoint, maxStock, leadTimeDays, isCritical } }
  const [saving, setSaving] = useState(false);
  const [showBulk,   setShowBulk]   = useState(false);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    const t = setTimeout(()=>setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Consume a one-shot filter handed off by navigateTo() (e.g. the
  // Dashboard's "Not Configured" tile).
  useEffect(() => {
    if (!navFilter) return;
    if (navFilter.filter === 'unconfigured') setFStatus('unset');
    clearNavFilter();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = useMemo(() => ({
    search: search||undefined, cat: fCat||undefined, mfr: fMfr||undefined,
    model: fModel||undefined, fg: fFg||undefined, status: fStatus||undefined,
  }), [search, fCat, fMfr, fModel, fFg, fStatus]);

  useEffect(() => { setPage(0); }, [filters.search, filters.cat, filters.mfr, filters.model, filters.fg, filters.status]);

  const load = useCallback(() => {
    if (!dbReady) { setLoading(false); setRows([]); setTotal(0); return; }
    setLoading(true);
    Promise.all([
      db.fetchStockStatusCount(filters),
      db.fetchStockStatus(filters, page, PAGE_SIZE),
    ]).then(([countRes, rowsRes]) => {
      setTotal(countRes.count || 0);
      setRows(rowsRes.data || []);
    }).finally(() => setLoading(false));
  }, [filters.search, filters.cat, filters.mfr, filters.model, filters.fg, filters.status, page, dbReady]);

  const loadUnsetCount = useCallback(() => {
    if (!dbReady) return;
    db.fetchStockStatusCount({ status: 'unset' }).then(({ count }) => setUnsetCount(count));
  }, [dbReady]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadUnsetCount(); }, [loadUnsetCount]);

  const editField = (row, field, value) => {
    setEdits(e => ({ ...e, [row.id]: { ...(e[row.id] || {}), [field]: value } }));
  };
  const valueFor = (row, field, rawField) => {
    const edited = edits[row.id];
    if (edited && field in edited) return edited[field];
    return row[rawField];
  };
  const editedCount = Object.keys(edits).length;

  const handleSaveAll = async () => {
    const entries = Object.entries(edits);
    if (entries.length === 0) return;
    setSaving(true);
    let ok = 0, failed = 0;
    for (const [id, fields] of entries) {
      const row = rows.find(r => r.id === id);
      if (!row) continue;
      const payload = {};
      if ('minStock' in fields)     payload.minStock = Number(fields.minStock) || 0;
      if ('reorderPoint' in fields) payload.reorderPoint = Number(fields.reorderPoint) || 0;
      if ('maxStock' in fields)     payload.maxStock = fields.maxStock === '' ? null : Number(fields.maxStock);
      if ('leadTimeDays' in fields) payload.leadTimeDays = fields.leadTimeDays === '' ? null : Number(fields.leadTimeDays);
      if ('isCritical' in fields)   payload.isCritical = !!fields.isCritical;
      const { error } = await db.updateReorderSettings(row.code, payload);
      if (error) failed++; else ok++;
    }
    setSaving(false);
    flash(`Saved ${ok} part(s)${failed ? `, ${failed} failed` : ''}`, failed ? 'err' : 'ok');
    setEdits({});
    load(); loadUnsetCount(); alerts.refreshAlerts();
  };

  const exportCsv = async () => {
    if (!dbReady) return flash('Requires a live database connection', 'err');
    flash('Preparing export…');
    const { data: allRows, error } = await db.fetchStockStatus(filters, 0, 6000);
    if (error) return flash(`Error: ${error.message}`, 'err');
    const header = ['part_code','description','status','qty_on_hand','min_stock','reorder_point','max_stock','lead_time_days','is_critical','preferred_supplier'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const lines = [header.map(esc).join(',')];
    (allRows||[]).forEach(r => {
      lines.push([r.code, r.short_desc, r.stock_status, r.qty_on_hand, r.min_stock, r.reorder_point, r.max_stock, r.lead_time_days, r.is_critical, r.preferred_supplier].map(esc).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `reorder-settings-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const selStyle = { padding:"0 10px", height:32, borderRadius:T.radius, border:`1px solid ${T.borderStrong}`, fontSize:13, color:T.text, background:T.card, fontFamily:"inherit" };
  const cellInputStyle = { width:72, padding:"5px 7px", borderRadius:4, border:`1px solid ${T.border}`, fontSize:12, fontFamily:"inherit", fontVariantNumeric:"tabular-nums" };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <Toast msg={toast}/>
      <PageHeader title="Reorder Settings" sub="Configure min stock, reorder point and max stock thresholds — bulk-editable for thousands of parts at once"/>

      {!canEdit && (
        <div style={{ background:T.warnBg, border:"1px solid #fbbf24", borderRadius:7, padding:"10px 14px", marginBottom:16, fontSize:12, color:"#92400e", fontWeight:600 }}>
          ⚠️ Your account doesn't have permission to change reorder settings. You can still view current thresholds below.
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:16 }}>
        <StatCard label="Parts Never Configured" value={unsetCount===null?"…":unsetCount.toLocaleString()} color={T.muted} icon=""/>
        <StatCard label="Matching Current Filter" value={total.toLocaleString()} color={T.accent} icon="🔎"/>
        <StatCard label="Pending Edits" value={editedCount} color={editedCount?T.warn:T.muted} icon=""/>
      </div>

      <Card style={{ marginBottom:16 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <input value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Part code…" style={{ ...selStyle, minWidth:180, flex:"1 1 160px" }}/>
          <select value={fCat} onChange={e=>{setFCat(e.target.value);setFMfr("");setFModel("");}} style={selStyle}>
            <option value="">All Categories</option>
            {categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <select value={fMfr} onChange={e=>{setFMfr(e.target.value);setFModel("");}} style={selStyle}>
            <option value="">All Manufacturers</option>
            {manufacturers.filter(m=>!fCat||(m.catCodes||[]).includes(fCat)).map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <select value={fModel} onChange={e=>setFModel(e.target.value)} style={selStyle}>
            <option value="">All Models</option>
            {models.filter(m=>!fMfr||m.mfrCode===fMfr).map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <select value={fFg} onChange={e=>setFFg(e.target.value)} style={selStyle}>
            <option value="">All Functional Groups</option>
            {funcGroups.map(f=><option key={f.code} value={f.code}>{f.code} — {f.label}</option>)}
          </select>
          <select value={fStatus} onChange={e=>setFStatus(e.target.value)} style={selStyle}>
            <option value="">All Statuses</option>
            {db.STOCK_STATUSES.map(s=><option key={s} value={s}>{STOCK_STATUS_META[s].label}</option>)}
          </select>
          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <Btn small variant="secondary" onClick={exportCsv}>Export CSV</Btn>
            {canEdit && <Btn small variant="secondary" onClick={()=>setShowImport(true)}>Import CSV</Btn>}
            {canEdit && <Btn small onClick={()=>setShowBulk(true)}>⚡ Set for Filtered Selection</Btn>}
          </div>
        </div>
      </Card>

      <Card>
        {!dbReady ? (
          <div style={{ textAlign:"center", padding:40, color:T.muted }}>🟡 Requires a live database connection.</div>
        ) : loading ? (
          <div style={{ textAlign:"center", padding:40, color:T.muted }}>Loading…</div>
        ) : (
          <>
          <div style={TABLE_SCROLL}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.header }}>
                  {['Code','Description','On Hand','Status','Min Stock','Reorder Point','Max Stock','Lead (d)','Critical'].map(h=>(
                    <th key={h} style={{ padding:"7px 9px", textAlign:"left", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", fontSize:11, letterSpacing:0.4, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0
                  ? <tr><td colSpan={9} style={{ textAlign:"center", padding:36, color:T.muted }}>No parts match these filters.</td></tr>
                  : rows.map((r,i) => {
                    const meta = STOCK_STATUS_META[r.stock_status] || STOCK_STATUS_META.unset;
                    const dirty = !!edits[r.id];
                    return (
                      <tr key={r.id} style={{ borderBottom:`1px solid ${T.border}`, background:dirty?'#fffbeb':(i%2?T.subtle:T.card) }}>
                        <td style={{ padding:"7px 9px" }}><CodeTag code={r.code}/></td>
                        <td style={{ padding:"7px 9px", maxWidth:180, whiteSpace:"normal", wordBreak:"break-word", lineHeight:1.35 }}>{r.short_desc}</td>
                        <td style={{ padding:"7px 9px", fontWeight:700, fontVariantNumeric:"tabular-nums", color:qtyStateColor(r.qty_on_hand) }}>{r.qty_on_hand}</td>
                        <td style={{ padding:"7px 9px" }}>
                          <span style={{ background:meta.bg, color:meta.color, fontWeight:700, fontSize:10, padding:"2px 8px", borderRadius:4, textTransform:"uppercase" }}>{meta.label}</span>
                        </td>
                        <td style={{ padding:"7px 9px" }}>
                          <input type="number" disabled={!canEdit} value={valueFor(r,'minStock','min_stock')} onChange={e=>editField(r,'minStock',e.target.value)} style={cellInputStyle}/>
                        </td>
                        <td style={{ padding:"7px 9px" }}>
                          <input type="number" disabled={!canEdit} value={valueFor(r,'reorderPoint','reorder_point')} onChange={e=>editField(r,'reorderPoint',e.target.value)} style={cellInputStyle}/>
                        </td>
                        <td style={{ padding:"7px 9px" }}>
                          <input type="number" disabled={!canEdit} value={valueFor(r,'maxStock','max_stock') ?? ''} onChange={e=>editField(r,'maxStock',e.target.value)} placeholder="—" style={cellInputStyle}/>
                        </td>
                        <td style={{ padding:"7px 9px" }}>
                          <input type="number" disabled={!canEdit} value={valueFor(r,'leadTimeDays','lead_time_days') ?? ''} onChange={e=>editField(r,'leadTimeDays',e.target.value)} style={{...cellInputStyle,width:56}}/>
                        </td>
                        <td style={{ padding:"7px 9px", textAlign:"center" }}>
                          <input type="checkbox" disabled={!canEdit} checked={!!valueFor(r,'isCritical','is_critical')} onChange={e=>editField(r,'isCritical',e.target.checked)}/>
                        </td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, fontSize:13 }}>
            <span style={{ color:T.muted }}>Page {page+1} of {totalPages} ({total.toLocaleString()} parts)</span>
            <div style={{ display:"flex", gap:8 }}>
              <Btn small variant="secondary" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>← Prev</Btn>
              <Btn small variant="secondary" disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}>Next →</Btn>
            </div>
          </div>
          </>
        )}
      </Card>

      {canEdit && editedCount > 0 && (
        <div style={{ position:"sticky", bottom:16, marginTop:16, display:"flex", justifyContent:"flex-end" }}>
          <Card style={{ display:"flex", alignItems:"center", gap:12, boxShadow:"0 8px 24px rgba(0,0,0,0.15)" }} pad={12}>
            <span style={{ fontSize:13, color:T.text, fontWeight:600 }}>{editedCount} unsaved change{editedCount===1?'':'s'}</span>
            <Btn small variant="secondary" onClick={()=>setEdits({})} disabled={saving}>Discard</Btn>
            <Btn small onClick={handleSaveAll} disabled={saving}>{saving?"Saving…":"Save Changes"}</Btn>
          </Card>
        </div>
      )}

      {showBulk && (
        <BulkReorderModal
          filters={filters} matchCount={total}
          onClose={()=>setShowBulk(false)}
          onApplied={(count)=>{ flash(`Updated ${count} part(s)`); load(); loadUnsetCount(); alerts.refreshAlerts(); }}
        />
      )}
      {showImport && (
        <ReorderImportModal onClose={()=>setShowImport(false)} onDone={()=>{ load(); loadUnsetCount(); alerts.refreshAlerts(); }} flash={flash}/>
      )}
    </div>
  );
}

function BulkReorderModal({ filters, matchCount, onClose, onApplied }) {
  const [minStock,     setMinStock]     = useState('');
  const [reorderPoint, setReorderPoint] = useState('');
  const [maxStock,     setMaxStock]     = useState('');
  const [clearMaxStock,setClearMaxStock]= useState(false);
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [criticalMode, setCriticalMode] = useState('unchanged'); // 'unchanged' | 'true' | 'false'
  const [confirming,   setConfirming]   = useState(false);
  const [applying,     setApplying]     = useState(false);
  const [error,        setError]        = useState('');

  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };

  const hasAnyValue = minStock!=='' || reorderPoint!=='' || maxStock!=='' || clearMaxStock || leadTimeDays!=='' || criticalMode!=='unchanged';

  const handleApply = async () => {
    if (!hasAnyValue) return setError('Set at least one field to apply.');
    setApplying(true); setError('');
    const { data: count, error: err } = await db.bulkSetReorderSettings(filters, {
      minStock: minStock===''?undefined:Number(minStock),
      reorderPoint: reorderPoint===''?undefined:Number(reorderPoint),
      maxStockSet: maxStock!=='' || clearMaxStock,
      maxStock: clearMaxStock ? null : (maxStock===''?undefined:Number(maxStock)),
      leadTimeDays: leadTimeDays===''?undefined:Number(leadTimeDays),
      isCritical: criticalMode==='unchanged'?undefined:(criticalMode==='true'),
    });
    setApplying(false);
    if (err) { setError(err.message); return; }
    onApplied(count);
    onClose();
  };

  return (
    <Modal title="Set for Filtered Selection" onClose={onClose}>
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {error && <div style={{ background:T.dangerBg, color:T.danger, borderRadius:6, padding:"8px 12px", fontSize:12, fontWeight:600 }}>⚠️ {error}</div>}
        <div style={{ background:T.warnBg, border:"1px solid #fbbf24", borderRadius:6, padding:"10px 14px", fontSize:13, color:"#92400e", fontWeight:600 }}> This applies to every part matching your current filters — <strong>{matchCount.toLocaleString()} part(s)</strong>. Leave a field blank to leave it unchanged.
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div><label style={sLabel}>Min Stock</label><Input type="number" value={minStock} onChange={e=>setMinStock(e.target.value)} placeholder="unchanged"/></div>
          <div><label style={sLabel}>Reorder Point</label><Input type="number" value={reorderPoint} onChange={e=>setReorderPoint(e.target.value)} placeholder="unchanged"/></div>
          <div>
            <label style={sLabel}>Max Stock</label>
            <Input type="number" value={maxStock} onChange={e=>{setMaxStock(e.target.value); if(e.target.value) setClearMaxStock(false);}} placeholder="unchanged" disabled={clearMaxStock}/>
            <label style={{ fontSize:11, color:T.muted, display:"flex", alignItems:"center", gap:5, marginTop:4 }}>
              <input type="checkbox" checked={clearMaxStock} onChange={e=>{setClearMaxStock(e.target.checked); if(e.target.checked) setMaxStock('');}}/> Clear (set to unset)
            </label>
          </div>
          <div><label style={sLabel}>Lead Time (days)</label><Input type="number" value={leadTimeDays} onChange={e=>setLeadTimeDays(e.target.value)} placeholder="unchanged"/></div>
        </div>
        <div>
          <label style={sLabel}>Critical Flag</label>
          <Select value={criticalMode} onChange={e=>setCriticalMode(e.target.value)}>
            <option value="unchanged">Leave unchanged</option>
            <option value="true">Mark Critical</option>
            <option value="false">Mark Not Critical</option>
          </Select>
        </div>
        <div style={{ display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:`1px solid ${T.border}` }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={handleApply} disabled={applying}>{applying?"Applying…":`Apply to ${matchCount.toLocaleString()} Part(s)`}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ReorderImportModal({ onClose, onDone, flash }) {
  const [fileName, setFileName] = useState('');
  const [matched,  setMatched]  = useState([]);
  const [unmatched,setUnmatched]= useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState(null);

  const handleFile = async (file) => {
    setFileName(file.name);
    setLoadingPreview(true);
    const text = await file.text();
    const parsed = parseCsvWithHeader(text)
      .map(r => ({
        code: (r.partcode || r.code || '').toUpperCase(),
        minStock: r.minstock, reorderPoint: r.reorderpoint, maxStock: r.maxstock,
        leadTimeDays: r.leadtimedays, isCritical: /^(true|1|yes)$/i.test(r.iscritical||''),
        preferredSupplier: r.preferredsupplier || '',
      }))
      .filter(r => r.code);
    const codes = [...new Set(parsed.map(r=>r.code))];
    const { data: parts, error } = await db.fetchReorderSettingsByCodes(codes);
    setLoadingPreview(false);
    if (error) { flash(`Error looking up parts: ${error.message}`, 'err'); return; }
    const byCode = {}; (parts||[]).forEach(p => { byCode[p.code] = p; });
    const m = [], um = [];
    parsed.forEach(r => { const p = byCode[r.code]; if (!p) um.push(r.code); else m.push({ ...r, part: p }); });
    setMatched(m); setUnmatched(um);
  };

  const handleCommit = async () => {
    setCommitting(true);
    let done = 0, failed = 0;
    for (const r of matched) {
      const payload = {};
      if (r.minStock !== undefined && r.minStock !== '') payload.minStock = Number(r.minStock);
      if (r.reorderPoint !== undefined && r.reorderPoint !== '') payload.reorderPoint = Number(r.reorderPoint);
      if (r.maxStock !== undefined && r.maxStock !== '') payload.maxStock = Number(r.maxStock);
      if (r.leadTimeDays !== undefined && r.leadTimeDays !== '') payload.leadTimeDays = Number(r.leadTimeDays);
      payload.isCritical = r.isCritical;
      if (r.preferredSupplier) payload.preferredSupplier = r.preferredSupplier;
      const { error } = await db.updateReorderSettings(r.code, payload);
      if (error) failed++; else done++;
      setProgress({ done: done+failed, total: matched.length });
    }
    setCommitting(false);
    flash(`Imported ${done} part(s)${failed?`, ${failed} failed`:''}`, failed ? 'err' : 'ok');
    onDone(); onClose();
  };

  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };

  return (
    <Modal title="Import Reorder Settings (CSV)" onClose={onClose} maxWidth={640}>
      <div style={{ display:"flex", flexDirection:"column", gap:14, maxHeight:"70vh", overflowY:"auto" }}>
        <div style={{ fontSize:12, color:T.muted }}> Columns (header row required, any order): <code>part_code, min_stock, reorder_point, max_stock, lead_time_days, is_critical, preferred_supplier</code>. Only columns present are applied.
        </div>
        <div>
          <label style={sLabel}>CSV File</label>
          <input type="file" accept=".csv,text/csv" onChange={e=>e.target.files[0] && handleFile(e.target.files[0])}/>
          {fileName && <div style={{ fontSize:12, color:T.muted, marginTop:4 }}>{fileName}</div>}
        </div>
        {loadingPreview && <div style={{ color:T.muted, fontSize:12 }}>Matching part codes…</div>}
        {!loadingPreview && (matched.length>0 || unmatched.length>0) && (
          <>
            <div style={{ display:"flex", gap:16, fontSize:12 }}>
              <span style={{ color:T.success, fontWeight:700 }}>{matched.length} matched</span>
              <span style={{ color:T.danger, fontWeight:700 }}>{unmatched.length} unmatched</span>
            </div>
            {unmatched.length > 0 && (
              <div style={{ background:T.dangerBg, borderRadius:6, padding:"8px 12px", fontSize:12, color:T.danger }}> Unmatched codes: {unmatched.join(', ')}
              </div>
            )}
          </>
        )}
        {progress && <div style={{ fontSize:12, color:T.muted }}>Importing… {progress.done} / {progress.total}</div>}
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:`1px solid ${T.border}` }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleCommit} disabled={committing || matched.length===0}>{committing?"Importing…":`Commit ${matched.length} Update(s)`}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// Update-only CSV import for the Master Parts Table. Deliberately scoped
// to descriptive/logistics fields only — code, category, manufacturer,
// model, discipline and functional group define the coding hierarchy
// (segments AA-BB-CC-DD-EE) and are never touched by a bulk CSV import;
// changing those belongs in the Part Detail edit form or Code Generator,
// which validate against the live hierarchy tables. This mirrors the
// existing Reorder Settings CSV import's update-only-by-code pattern.
function MasterImportModal({ onClose, onDone, flash }) {
  const [fileName, setFileName] = useState('');
  const [matched,  setMatched]  = useState([]);
  const [unmatched,setUnmatched]= useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState(null);

  const handleFile = async (file) => {
    setFileName(file.name);
    setLoadingPreview(true);
    const text = await file.text();
    const parsed = parseCsvWithHeader(text)
      .map(r => ({
        code: (r.code || '').toUpperCase(),
        shortDesc: r.shortdescription ?? r.shortdesc,
        longDesc: r.longdescription ?? r.longdesc,
        partNo: r.partno, oemPart: r.oempart, unit: r.unit,
        loc: r.location, status: r.status, remarks: r.remarks,
      }))
      .filter(r => r.code);
    const codes = [...new Set(parsed.map(r=>r.code))];
    const { data: parts, error } = await db.fetchPartsByCodes(codes);
    setLoadingPreview(false);
    if (error) { flash(`Error looking up parts: ${error.message}`, 'err'); return; }
    const byCode = {}; (parts||[]).forEach(p => { byCode[p.code] = p; });
    const m = [], um = [];
    parsed.forEach(r => { const p = byCode[r.code]; if (!p) um.push(r.code); else m.push({ ...r, part: p }); });
    setMatched(m); setUnmatched(um);
  };

  const handleCommit = async () => {
    setCommitting(true);
    let done = 0, failed = 0;
    for (const r of matched) {
      const payload = {};
      if (r.shortDesc !== undefined && r.shortDesc !== '') payload.short_desc = r.shortDesc;
      if (r.longDesc !== undefined && r.longDesc !== '')   payload.long_desc = r.longDesc;
      if (r.partNo !== undefined && r.partNo !== '')       payload.part_no = r.partNo;
      if (r.oemPart !== undefined && r.oemPart !== '')     payload.oem_part = r.oemPart;
      if (r.unit !== undefined && r.unit !== '')           payload.unit = r.unit;
      if (r.loc !== undefined && r.loc !== '')             payload.location = r.loc;
      if (r.status !== undefined && r.status !== '')       payload.status = r.status;
      if (r.remarks !== undefined && r.remarks !== '')     payload.remarks = r.remarks;
      if (Object.keys(payload).length === 0) { done++; setProgress({ done, total: matched.length }); continue; }
      const { error } = await db.updatePart(r.code, payload);
      if (error) failed++; else done++;
      setProgress({ done: done+failed, total: matched.length });
    }
    setCommitting(false);
    flash(`Imported ${done} part(s)${failed?`, ${failed} failed`:''}`, failed ? 'err' : 'ok');
    onDone(); onClose();
  };

  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };

  return (
    <Modal title="Import Master Parts (CSV)" onClose={onClose} maxWidth={640}>
      <div style={{ display:"flex", flexDirection:"column", gap:14, maxHeight:"70vh", overflowY:"auto" }}>
        <div style={{ fontSize:12, color:T.muted }}> Update-only by <code>code</code> — matches existing parts, never creates new ones. Columns (header row required, any order): <code>code, short_description, long_description, part_no, oem_part, unit, location, status, remarks</code>. Category, manufacturer, model, discipline and functional group cannot be changed via import — edit those from the part's detail view.
        </div>
        <div>
          <label style={sLabel}>CSV File</label>
          <input type="file" accept=".csv,text/csv" onChange={e=>e.target.files[0] && handleFile(e.target.files[0])}/>
          {fileName && <div style={{ fontSize:12, color:T.muted, marginTop:4 }}>{fileName}</div>}
        </div>
        {loadingPreview && <div style={{ color:T.muted, fontSize:12 }}>Matching part codes…</div>}
        {!loadingPreview && (matched.length>0 || unmatched.length>0) && (
          <>
            <div style={{ display:"flex", gap:16, fontSize:12 }}>
              <span style={{ color:T.success, fontWeight:700 }}>{matched.length} matched</span>
              <span style={{ color:T.danger, fontWeight:700 }}>{unmatched.length} unmatched</span>
            </div>
            {unmatched.length > 0 && (
              <div style={{ background:T.dangerBg, borderRadius:6, padding:"8px 12px", fontSize:12, color:T.danger }}> Unmatched codes: {unmatched.join(', ')}
              </div>
            )}
          </>
        )}
        {progress && <div style={{ fontSize:12, color:T.muted }}>Importing… {progress.done} / {progress.total}</div>}
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:`1px solid ${T.border}` }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleCommit} disabled={committing || matched.length===0}>{committing?"Importing…":`Commit ${matched.length} Update(s)`}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── PUSH NOTIFICATIONS ─────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

const PUSH_SUPPORTED = typeof window !== 'undefined' &&
  'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
const IS_STANDALONE = typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
const IS_IOS_SAFARI = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

// Permission is NEVER requested automatically — only in response to
// this card's own "Enable" button, per spec (a reflexive denial from
// requesting on load is permanent and can't be re-prompted).
function NotificationSettingsCard() {
  const [permission, setPermission] = useState(PUSH_SUPPORTED ? Notification.permission : 'unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  useEffect(() => {
    if (!PUSH_SUPPORTED || Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setSubscribed(!!sub));
  }, []);

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

  const handleEnable = async () => {
    if (!vapidKey) return flash('Push notifications are not configured yet (missing VAPID key)', 'err');
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') { setBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const { error } = await db.savePushSubscription(sub);
      if (error) { flash(`Error saving subscription: ${error.message}`, 'err'); setBusy(false); return; }
      setSubscribed(true);
      flash('Browser notifications enabled');
    } catch (e) {
      flash(`Error: ${e.message}`, 'err');
    }
    setBusy(false);
  };

  const handleTest = async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('⚠️ CarGas Stock Alert (test)', {
      body: 'This is a test notification — push delivery is working.',
      icon: '/logo.png',
    });
  };

  const handleUnsubscribe = async () => {
    setBusy(true);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await db.deletePushSubscriptionByEndpoint(sub.endpoint);
      await sub.unsubscribe();
    }
    setSubscribed(false);
    setBusy(false);
    flash('Unsubscribed from browser notifications');
  };

  if (IS_IOS_SAFARI && !IS_STANDALONE) {
    return (
      <Card style={{ marginBottom:16 }}>
        <SectionHeader>Enable Browser Notifications</SectionHeader>
        <div style={{ fontSize:13, color:T.muted }}> On iPhone/iPad, Web Push only works after adding this app to your Home Screen (Share → Add to Home Screen), then opening it from there.
        </div>
      </Card>
    );
  }

  if (!PUSH_SUPPORTED) {
    return (
      <Card style={{ marginBottom:16 }}>
        <SectionHeader>Enable Browser Notifications</SectionHeader>
        <div style={{ fontSize:13, color:T.muted }}>Not supported in this browser.</div>
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom:16 }}>
      <SectionHeader>Enable Browser Notifications</SectionHeader>
      {permission === 'denied' ? (
        <div style={{ fontSize:13, color:T.danger }}> Notifications are blocked for this site. Re-enable them from your browser's site settings, then reload this page.
        </div>
      ) : subscribed ? (
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:13, color:T.success, fontWeight:700 }}>✅ Enabled on this device</span>
          <Btn small variant="secondary" onClick={handleTest}>Send test notification</Btn>
          <Btn small variant="danger" onClick={handleUnsubscribe} disabled={busy}>Unsubscribe</Btn>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:13, color:T.muted }}>Get a browser notification when a part goes out of stock or critical, even when this tab is closed.</span>
          <Btn small onClick={handleEnable} disabled={busy}>{busy?"Enabling…":"Enable Notifications"}</Btn>
        </div>
      )}
      <Toast msg={toast}/>
    </Card>
  );
}

// ─── STOCK ALERTS PAGE ────────────────────────────────────────
const ALERTS_PAGE_SIZE = 50;

function StockAlertsPage({ data }) {
  const { categories, manufacturers, disciplines, dbReady, navFilter, clearNavFilter, navigateTo } = data;
  const alerts = useAlerts();

  const [severity, setSeverity] = useState([]); // [] = all
  const [fCat,  setFCat]  = useState('');
  const [fMfr,  setFMfr]  = useState('');
  const [fDisc, setFDisc] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [hideAck, setHideAck] = useState(true);

  const [page,    setPage]    = useState(0);
  const [total,   setTotal]   = useState(0);
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState({}); // { [part_id]: true }
  const [snoozeTarget, setSnoozeTarget] = useState(null); // { part_id, severity, code }
  const [toast, setToast] = useState(null);
  const [exporting, setExporting] = useState(false);
  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  useEffect(() => {
    if (!navFilter) return;
    if (navFilter.severity) setSeverity(navFilter.severity);
    clearNavFilter();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(()=>setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo(() => ({
    severity: severity.length ? severity : undefined,
    cat: fCat||undefined, mfr: fMfr||undefined, disc: fDisc||undefined,
    search: search||undefined, hideAcknowledged: hideAck,
  }), [severity, fCat, fMfr, fDisc, search, hideAck]);

  useEffect(() => { setPage(0); setSelected({}); }, [filters]);

  const load = useCallback(() => {
    if (!dbReady) { setLoading(false); setRows([]); setTotal(0); return; }
    setLoading(true);
    Promise.all([
      db.fetchActiveAlertsCount(filters),
      db.fetchActiveAlerts(filters, page, ALERTS_PAGE_SIZE),
    ]).then(([countRes, dataRes]) => {
      setTotal(countRes.count ?? 0);
      setRows(dataRes.data ?? []);
    }).finally(()=>setLoading(false));
  }, [dbReady, filters, page]);

  useEffect(() => { load(); }, [load]);

  const toggleSeverity = (s) => setSeverity(prev => prev.includes(s) ? prev.filter(x=>x!==s) : [...prev, s]);

  const doAcknowledge = async (row) => {
    const { error } = await db.acknowledgeAlert(row.part_id, row.stock_status);
    if (error) return flash(`Error: ${error.message}`, 'err');
    flash(`Acknowledged ${row.code}`);
    alerts.refreshAlerts();
    load();
  };

  const doBulkAcknowledge = async () => {
    const targets = rows.filter(r => selected[r.part_id]);
    let done = 0, failed = 0;
    for (const r of targets) {
      const { error } = await db.acknowledgeAlert(r.part_id, r.stock_status);
      if (error) failed++; else done++;
    }
    flash(`Acknowledged ${done} alert(s)${failed?`, ${failed} failed`:''}`, failed?'err':'ok');
    setSelected({});
    alerts.refreshAlerts();
    load();
  };

  const doSnooze = async (days) => {
    if (!snoozeTarget) return;
    const until = new Date(Date.now() + days*24*60*60*1000).toISOString();
    const { error } = await db.snoozeAlert(snoozeTarget.part_id, snoozeTarget.severity, until);
    setSnoozeTarget(null);
    if (error) return flash(`Error: ${error.message}`, 'err');
    flash(`Snoozed ${snoozeTarget.code} for ${days} day(s)`);
    alerts.refreshAlerts();
    load();
  };


  const exportAlertsCsv = async () => {
    if (!dbReady) return flash('Requires a live database connection', 'err');
    setExporting(true);
    const { data: allRows, error } = await db.fetchAllActiveAlerts(filters);
    setExporting(false);
    if (error) return flash(`Error: ${error.message}`, 'err');
    const header = ['Severity','Code','Short Description','Category','Manufacturer','Qty on Hand','Reorder Point','Min Stock','Shortage','UoM','Location','Acknowledged'];
    const lines = [header.map(csvEsc).join(',')];
    allRows.forEach(r => lines.push([
      r.stock_status, r.code, r.short_desc, r.cat, r.mfr, r.qty_on_hand, r.reorder_point, r.min_stock,
      r.shortage_qty, r.unit, r.location, r.is_acknowledged ? 'Yes' : 'No',
    ].map(csvEsc).join(',')));
    downloadCsv(lines, `stock-alerts-${new Date().toISOString().slice(0,10)}.csv`);
    flash(`Exported ${allRows.length} alert(s)`);
  };

  const exportReorderListCsv = async () => {
    if (!dbReady) return flash('Requires a live database connection', 'err');
    setExporting(true);
    const { data: allRows, error } = await db.fetchAllActiveAlerts(filters);
    setExporting(false);
    if (error) return flash(`Error: ${error.message}`, 'err');
    const header = ['Code','Description','Qty on Hand','Reorder Point','Shortage Qty','UoM','Manufacturer'];
    const lines = [header.map(csvEsc).join(',')];
    allRows.forEach(r => lines.push([
      r.code, r.short_desc, r.qty_on_hand, r.reorder_point, r.shortage_qty, r.unit, r.mfr,
    ].map(csvEsc).join(',')));
    downloadCsv(lines, `reorder-list-${new Date().toISOString().slice(0,10)}.csv`);
    flash(`Exported ${allRows.length} row(s) to reorder list`);
  };

  const totalPages = Math.ceil(total / ALERTS_PAGE_SIZE);
  const selStyle = { padding:"0 10px", height:32, borderRadius:T.radius, border:`1px solid ${T.borderStrong}`, fontSize:13, color:T.text, background:T.card, fontFamily:"inherit" };
  const allSelected = rows.length > 0 && rows.every(r => selected[r.part_id]);

  return (
    <div>
      <PageHeader title="Stock Alerts" sub={`${total.toLocaleString()} active alert(s)`} />

      <NotificationSettingsCard />

      <Card style={{ marginBottom:16 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          {Object.entries(ALERT_SEVERITY_META).map(([key, meta]) => (
            <button key={key} onClick={()=>toggleSeverity(key)}
              aria-pressed={severity.includes(key)}
              style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"0 12px", height:32, borderRadius:T.radius, border:`1px solid ${severity.includes(key)?meta.color:T.borderStrong}`, background: severity.includes(key)?meta.color:T.card, color: severity.includes(key)?'#fff':T.text, ...TYPE.button, cursor:"pointer", fontFamily:"inherit" }}>
              <SeverityDot color={severity.includes(key)?'#fff':meta.color} /> {meta.label}
            </button>
          ))}
          <input value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Code or description…" style={{ ...selStyle, minWidth:200, flex:"1 1 180px" }}/>
          <select value={fCat} onChange={e=>setFCat(e.target.value)} style={selStyle}>
            <option value="">All Categories</option>
            {categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <select value={fMfr} onChange={e=>setFMfr(e.target.value)} style={selStyle}>
            <option value="">All Manufacturers</option>
            {manufacturers.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <select value={fDisc} onChange={e=>setFDisc(e.target.value)} style={selStyle}>
            <option value="">All Disciplines</option>
            {disciplines.map(d=><option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
          <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:T.muted, cursor:"pointer" }}>
            <input type="checkbox" checked={hideAck} onChange={e=>setHideAck(e.target.checked)}/> Hide acknowledged
          </label>
          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <Btn small variant="secondary" onClick={exportAlertsCsv} disabled={exporting}>{exporting?"Exporting…":"Export CSV"}</Btn>
            <Btn small variant="secondary" onClick={exportReorderListCsv} disabled={exporting}>🛒 Export Reorder List</Btn>
          </div>
        </div>
      </Card>

      {Object.keys(selected).some(k=>selected[k]) && (
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <span style={{ fontSize:12, color:T.muted }}>{Object.values(selected).filter(Boolean).length} selected</span>
          <Btn small onClick={doBulkAcknowledge}>Acknowledge Selected</Btn>
        </div>
      )}

      <Card>
        <div style={TABLE_SCROLL}>
          {loading ? (
            <div style={{ textAlign:"center", padding:40, color:T.muted }}>Loading alerts…</div>
          ) : rows.length === 0 ? (
            <div style={{ textAlign:"center", padding:40, color:T.muted }}>No active alerts — all stock levels are healthy ✅</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.header }}>
                  <th style={{ padding:"7px 9px" }}>
                    <input type="checkbox" checked={allSelected} onChange={e=>{
                      const next = {};
                      if (e.target.checked) rows.forEach(r=>{ next[r.part_id]=true; });
                      setSelected(next);
                    }}/>
                  </th>
                  {["Severity","Code","Description","Category","Mfr","On Hand","Reorder Pt","Min Stock","Shortage","UoM","Location","Actions"].map(h=>(
                    <th key={h} style={{ padding:"7px 9px", textAlign:"left", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", fontSize:11, letterSpacing:0.4, lineHeight:1.25,
                      ...(h === "Actions" ? STICKY_ACTIONS_TH : null) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r,i) => {
                  const meta = ALERT_SEVERITY_META[r.stock_status] || { color:T.muted, label:r.stock_status, tone:'neutral' };
                  return (
                    <tr key={r.part_id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card, opacity:r.is_acknowledged?0.55:1 }}>
                      <td style={{ padding:"7px 9px" }}>
                        <input type="checkbox" checked={!!selected[r.part_id]} onChange={e=>setSelected(s=>({...s,[r.part_id]:e.target.checked}))}/>
                      </td>
                      <td style={{ padding:"7px 9px" }}><StatusTag tone={meta.tone||'neutral'}>{meta.label}</StatusTag></td>
                      <td style={{ padding:"7px 9px" }}><CodeTag code={r.code}/></td>
                      <td style={{ padding:"7px 9px", width:"100%", minWidth:150, whiteSpace:"normal", wordBreak:"break-word", lineHeight:1.35 }}>{r.short_desc}</td>
                      <td style={{ padding:"7px 9px" }}><Pill size={11}>{r.cat}</Pill></td>
                      <td style={{ padding:"7px 9px" }}><Pill color="#b45309" bg="#fef3c7" size={11}>{r.mfr}</Pill></td>
                      <td style={{ padding:"7px 9px", textAlign:"center", fontWeight:700, color:meta.color }}>{r.qty_on_hand}</td>
                      <td style={{ padding:"7px 9px", textAlign:"center" }}>{r.reorder_point}</td>
                      <td style={{ padding:"7px 9px", textAlign:"center" }}>{r.min_stock}</td>
                      <td style={{ padding:"7px 9px", textAlign:"center", fontWeight:700 }}>{r.shortage_qty}</td>
                      <td style={{ padding:"7px 9px", whiteSpace:"nowrap" }}>{r.unit||"—"}</td>
                      <td style={{ padding:"7px 9px", fontFamily:"monospace", fontSize:12, whiteSpace:"nowrap" }}>{r.location||"—"}</td>
                      <td style={{ padding:"7px 9px", whiteSpace:"nowrap", ...stickyActionsTd(i%2?T.subtle:T.card) }}>
                        {!r.is_acknowledged ? (
                          <>
                            <Btn small variant="success" onClick={()=>doAcknowledge(r)}>Ack</Btn>{' '}
                            <Btn small variant="secondary" title="Snooze this alert" onClick={()=>setSnoozeTarget({ part_id:r.part_id, severity:r.stock_status, code:r.code })}>💤</Btn>{' '}
                          </>
                        ) : <span style={{ fontSize:11, color:T.muted }}>Acknowledged</span>}
                        <Btn small variant="ghost" onClick={()=>navigateTo && navigateTo('master', { search: r.code })}>View</Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {totalPages > 1 && (
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:14 }}>
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
            style={{ padding:"5px 12px", borderRadius:5, border:`1px solid ${T.border}`, background:"#fff", cursor:page===0?"default":"pointer", fontSize:12, fontFamily:"inherit" }}>‹ Prev</button>
          <span style={{ fontSize:12, color:T.muted, alignSelf:"center" }}>Page {page+1} of {totalPages}</span>
          <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
            style={{ padding:"5px 12px", borderRadius:5, border:`1px solid ${T.border}`, background:"#fff", cursor:page>=totalPages-1?"default":"pointer", fontSize:12, fontFamily:"inherit" }}>Next ›</button>
        </div>
      )}

      {snoozeTarget && (
        <Modal title={`Snooze ${snoozeTarget.code}`} onClose={()=>setSnoozeTarget(null)} maxWidth={360}>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:13, color:T.muted }}>Hide this alert until it reappears, or for:</div>
            <div style={{ display:"flex", gap:8 }}>
              <Btn small onClick={()=>doSnooze(1)}>1 day</Btn>
              <Btn small onClick={()=>doSnooze(3)}>3 days</Btn>
              <Btn small onClick={()=>doSnooze(7)}>7 days</Btn>
            </div>
          </div>
        </Modal>
      )}
      <Toast msg={toast}/>
    </div>
  );
}

// ─── ASSET REGISTRY ───────────────────────────────────────────
const ASSET_STATUS_META = {
  active:        { label:'Active',        color:'#15803d', bg:'#dcfce7' },
  maintenance:   { label:'Maintenance',   color:'#b45309', bg:'#fef3c7' },
  down:          { label:'Down',          color:'#dc2626', bg:'#fee2e2' },
  standby:       { label:'Standby',       color:'#475569', bg:'#f1f5f9' },
  decommissioned:{ label:'Decommissioned',color:'#94a3b8', bg:'#f8fafc' },
};

function mapAsset(r) {
  return {
    id: r.id, assetTag: r.asset_tag, serialNumber: r.serial_number,
    cat: r.cat, mfr: r.mfr, model: r.model,
    catLabel: r.cat_label, mfrLabel: r.mfr_label, modelLabel: r.model_label,
    site: r.site, location: r.location, subLocation: r.sub_location, status: r.status,
    commissionedAt: r.commissioned_at, warrantyUntil: r.warranty_until,
    runningHours: r.running_hours, pmIntervalHours: r.pm_interval_hours,
    lastPmHours: r.last_pm_hours, lastPmDate: r.last_pm_date, pmIntervalDays: r.pm_interval_days,
    photoUrl: r.photo_url, notes: r.notes,
    eventCount: r.event_count, openEventCount: r.open_event_count, lastEventDate: r.last_event_date,
    hoursUntilPm: r.hours_until_pm, daysUntilPm: r.days_until_pm, pmDue: r.pm_due,
  };
}

const ASSETS_PAGE_SIZE = 50;

function AssetRegistryPage({ data }) {
  const { categories, manufacturers, models, dbReady, navigateTo } = data;
  const { isAdmin, isDeptUser } = useAuth();
  const canEdit = isAdmin || isDeptUser;

  const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'
  const [search,    setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fCat,   setFCat]   = useState('');
  const [fMfr,   setFMfr]   = useState('');
  const [fModel, setFModel] = useState('');
  const [fLoc,   setFLoc]   = useState('');
  const [fStatus,setFStatus]= useState('');

  const [page,    setPage]    = useState(0);
  const [total,   setTotal]   = useState(0);
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [kpis,    setKpis]    = useState(null);

  const [formTarget,   setFormTarget]   = useState(null); // 'new' | asset object | null
  const [exporting,    setExporting]    = useState(false);
  const [toast, setToast] = useState(null);
  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  useEffect(() => {
    const t = setTimeout(()=>setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useMemo(() => ({
    search: debouncedSearch||undefined, cat: fCat||undefined, mfr: fMfr||undefined,
    model: fModel||undefined, location: fLoc||undefined, status: fStatus||undefined,
  }), [debouncedSearch, fCat, fMfr, fModel, fLoc, fStatus]);

  useEffect(() => { setPage(0); }, [filters]);

  const loadKpis = useCallback(() => {
    if (!dbReady) { setKpis(null); return; }
    db.fetchAssetKpis().then(({ data, error }) => { if (!error) setKpis(data); });
  }, [dbReady]);

  const load = useCallback(() => {
    if (!dbReady) { setLoading(false); setRows([]); setTotal(0); return; }
    setLoading(true);
    Promise.all([
      db.fetchAssetsCount(filters),
      db.fetchAssets(filters, page, ASSETS_PAGE_SIZE),
    ]).then(([countRes, dataRes]) => {
      setTotal(countRes.count ?? 0);
      setRows((dataRes.data ?? []).map(mapAsset));
    }).finally(()=>setLoading(false));
  }, [dbReady, filters, page]);

  useEffect(() => { loadKpis(); }, [loadKpis]);
  useEffect(() => { load(); }, [load]);

  const refreshAll = () => { load(); loadKpis(); };

  const filteredMfrs   = manufacturers.filter(m => !fCat || (m.catCodes||[]).includes(fCat));
  const filteredModels = models.filter(m => !fMfr || m.mfrCode === fMfr);
  const totalPages = Math.ceil(total / ASSETS_PAGE_SIZE);
  const selStyle = { padding:"0 10px", height:32, borderRadius:T.radius, border:`1px solid ${T.borderStrong}`, fontSize:13, color:T.text, background:T.card, fontFamily:"inherit" };

  const exportCsv = async () => {
    if (!dbReady) return flash('Requires a live database connection', 'err');
    setExporting(true);
    const { data: allRows, error } = await db.fetchAllAssets(filters);
    setExporting(false);
    if (error) return flash(`Error: ${error.message}`, 'err');
    const header = ['Asset Tag','Serial Number','Category','Manufacturer','Model','Site','Location','Sub-Location','Status','Commissioned','Warranty Until','Running Hours','PM Interval (hrs)','Last PM Date','Last PM Hours','PM Interval (days)','Open Events','Notes'];
    const lines = [header.map(csvEsc).join(',')];
    allRows.forEach(r => lines.push([
      r.asset_tag, r.serial_number, r.cat_label, r.mfr_label, r.model_label, r.site, r.location, r.sub_location,
      r.status, r.commissioned_at, r.warranty_until, r.running_hours, r.pm_interval_hours, r.last_pm_date,
      r.last_pm_hours, r.pm_interval_days, r.open_event_count, r.notes,
    ].map(csvEsc).join(',')));
    const blob = new Blob(['﻿'+lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `assets-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash(`Exported ${allRows.length} asset(s)`);
  };

  const HoursBar = ({ asset }) => {
    if (!asset.pmIntervalHours) return <span style={{ fontVariantNumeric:'tabular-nums' }}>{asset.runningHours}</span>;
    const base = asset.lastPmHours || 0;
    const pos = Math.max(0, asset.runningHours - base);
    const pct = Math.min(100, (pos / asset.pmIntervalHours) * 100);
    const amber = pct >= 90;
    return (
      <div>
        <div style={{ fontSize:11, fontVariantNumeric:'tabular-nums', color:T.text, marginBottom:2 }}>{asset.runningHours} hrs</div>
        <div style={{ width:70, height:5, background:'#e2e8f0', borderRadius:3, overflow:'hidden' }}>
          <div style={{ width:`${pct}%`, height:'100%', background: amber ? '#d97706' : '#16a34a' }}/>
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="Asset Registry" sub={`${total.toLocaleString()} equipment asset(s)`} />

      {/* KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:20 }}>
        <StatCard label="Total Assets" value={kpis?kpis.total.toLocaleString():"…"} color={T.accent} icon="🏭"/>
        <StatCard label="Active" value={kpis?kpis.active.toLocaleString():"…"} color="#15803d" icon="🟢"/>
        <StatCard label="In Maintenance" value={kpis?kpis.in_maintenance.toLocaleString():"…"} color="#b45309" icon="🟠"/>
        <StatCard label="Down" value={kpis?kpis.down.toLocaleString():"…"} color="#dc2626" icon="🔴"/>
        <StatCard label="Due for PM (30d)" value={kpis?kpis.due_30.toLocaleString():"…"} color="#7c3aed" icon="️"/>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <input value={search} onChange={e=>setSearchInput(e.target.value)} placeholder="Asset tag, serial no, model…" style={{ ...selStyle, minWidth:200, flex:"1 1 200px" }}/>
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
          <input value={fLoc} onChange={e=>setFLoc(e.target.value)} placeholder="Site / location" style={{ ...selStyle, width:140 }}/>
          <select value={fStatus} onChange={e=>setFStatus(e.target.value)} style={selStyle}>
            <option value="">All Status</option>
            {Object.entries(ASSET_STATUS_META).map(([k,m])=><option key={k} value={k}>{m.label}</option>)}
          </select>
          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <div style={{ display:'flex', border:`1px solid ${T.border}`, borderRadius:6, overflow:'hidden' }}>
              <button onClick={()=>setViewMode('table')} style={{ padding:'6px 10px', border:'none', background:viewMode==='table'?T.accent:'#fff', color:viewMode==='table'?'#fff':T.muted, cursor:'pointer', fontSize:13 }}>☰</button>
              <button onClick={()=>setViewMode('grid')} style={{ padding:'6px 10px', border:'none', background:viewMode==='grid'?T.accent:'#fff', color:viewMode==='grid'?'#fff':T.muted, cursor:'pointer', fontSize:13 }}>▦</button>
            </div>
            <Btn small variant="secondary" onClick={exportCsv} disabled={exporting}>{exporting?"Exporting…":"Export CSV"}</Btn>
            {canEdit && <Btn small onClick={()=>setFormTarget('new')}>+ Add Asset</Btn>}
          </div>
        </div>
      </Card>

      {loading ? (
        <div style={{ textAlign:"center", padding:40, color:T.muted }}>Loading assets…</div>
      ) : rows.length === 0 ? (
        <Card><div style={{ textAlign:"center", padding:40, color:T.muted }}>No assets found.</div></Card>
      ) : viewMode === 'grid' ? (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14 }}>
          {rows.map(a => {
            const meta = ASSET_STATUS_META[a.status] || {};
            return (
              <Card key={a.id} style={{ cursor:'pointer', padding:0, overflow:'hidden' }} onClick={()=>navigateTo('assetdetail', { assetId:a.id })}>
                <div style={{ height:120, background:'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {a.photoUrl ? <img src={a.photoUrl} alt={a.assetTag} style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : <span style={{ fontSize:36 }}>🏭</span>}
                </div>
                <div style={{ padding:12 }}>
                  <div style={{ fontFamily:'monospace', fontWeight:800, fontSize:13, color:T.text }}>{a.assetTag}</div>
                  <div style={{ fontSize:12, color:T.muted, marginBottom:8 }}>{a.mfrLabel} {a.modelLabel}</div>
                  <Pill color={meta.color} bg={meta.bg} mono={false} size={11}>{meta.label}</Pill>
                  {a.pmDue && <span style={{ marginLeft:6, fontSize:11, color:'#b45309', fontWeight:700 }}>️ PM Due</span>}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <div style={TABLE_SCROLL}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.header }}>
                  {["","Asset Tag","Model / Mfr","Location","Status","Running Hours","Last Service","Open Items"].map(h=>(
                    <th key={h} style={{ padding:"7px 9px", textAlign:"left", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", fontSize:11, letterSpacing:0.4, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a,i) => {
                  const meta = ASSET_STATUS_META[a.status] || {};
                  return (
                    <tr key={a.id} onClick={()=>navigateTo('assetdetail', { assetId:a.id })}
                      style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card, cursor:"pointer" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#eff6ff"}
                      onMouseLeave={e=>e.currentTarget.style.background=i%2?T.subtle:T.card}>
                      <td style={{ padding:"7px 9px", textAlign:"center" }}>{a.photoUrl ? <span title="Has photo">📷</span> : <span style={{ color:"#d1d5db",fontSize:10 }}>—</span>}</td>
                      <td style={{ padding:"7px 9px" }}>
                        <div style={{ fontFamily:'monospace', fontWeight:800, color:T.text }}>{a.assetTag}</div>
                        <div style={{ fontSize:11, color:T.muted }}>{a.modelLabel}</div>
                      </td>
                      <td style={{ padding:"7px 9px" }}>{a.modelLabel} <span style={{ color:T.muted }}>· {a.mfrLabel}</span></td>
                      <td style={{ padding:"7px 9px", fontSize:12, color:T.muted }}>{a.location || "—"}{a.subLocation?` / ${a.subLocation}`:''}</td>
                      <td style={{ padding:"7px 9px" }}><Pill color={meta.color} bg={meta.bg} mono={false} size={11}>{meta.label}</Pill></td>
                      <td style={{ padding:"7px 9px" }}><HoursBar asset={a}/></td>
                      <td style={{ padding:"7px 9px", fontSize:12, color:T.muted }}>{a.lastPmDate || "—"}</td>
                      <td style={{ padding:"7px 9px" }}>
                        {a.pmDue
                          ? <Pill color="#b45309" bg="#fef3c7" mono={false} size={11}>️ PM Due</Pill>
                          : a.openEventCount > 0
                            ? <Pill color="#1d4ed8" bg="#dbeafe" mono={false} size={11}>{a.openEventCount} open</Pill>
                            : <span style={{ color:"#d1d5db" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {totalPages > 1 && (
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:14 }}>
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
            style={{ padding:"5px 12px", borderRadius:5, border:`1px solid ${T.border}`, background:"#fff", cursor:page===0?"default":"pointer", fontSize:12, fontFamily:"inherit" }}>‹ Prev</button>
          <span style={{ fontSize:12, color:T.muted, alignSelf:"center" }}>Page {page+1} of {totalPages}</span>
          <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
            style={{ padding:"5px 12px", borderRadius:5, border:`1px solid ${T.border}`, background:"#fff", cursor:page>=totalPages-1?"default":"pointer", fontSize:12, fontFamily:"inherit" }}>Next ›</button>
        </div>
      )}

      {formTarget && (
        <AssetFormModal
          data={data} asset={formTarget==='new'?null:formTarget}
          onClose={()=>setFormTarget(null)}
          onSaved={(saved)=>{ flash(`${saved.asset_tag} saved`); setFormTarget(null); refreshAll(); }}
        />
      )}

      <Toast msg={toast}/>
    </div>
  );
}

function AssetFormModal({ data, asset, onClose, onSaved }) {
  const { categories, manufacturers, models } = data;
  const isEdit = !!asset;
  const [cat,   setCat]   = useState(asset?.cat || '');
  const [mfr,   setMfr]   = useState(asset?.mfr || '');
  const [model, setModel] = useState(asset?.model || '');
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber || '');
  const [site,     setSite]     = useState(asset?.site || '');
  const [location, setLocation] = useState(asset?.location || '');
  const [subLocation, setSubLocation] = useState(asset?.subLocation || '');
  const [status,   setStatus]   = useState(asset?.status || 'active');
  const [commissionedAt, setCommissionedAt] = useState(asset?.commissionedAt || '');
  const [warrantyUntil,  setWarrantyUntil]  = useState(asset?.warrantyUntil || '');
  const [pmIntervalHours, setPmIntervalHours] = useState(asset?.pmIntervalHours ?? '');
  const [lastPmHours,     setLastPmHours]     = useState(asset?.lastPmHours ?? '');
  const [lastPmDate,      setLastPmDate]      = useState(asset?.lastPmDate || '');
  const [pmIntervalDays,  setPmIntervalDays]  = useState(asset?.pmIntervalDays ?? '');
  const [notes, setNotes] = useState(asset?.notes || '');
  const [photoUrl, setPhotoUrl] = useState(asset?.photoUrl || null);
  const [tagPreview, setTagPreview] = useState(asset?.assetTag || '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const filteredMfrs   = manufacturers.filter(m => !cat || (m.catCodes||[]).includes(cat));
  const filteredModels = models.filter(m => !mfr || m.mfrCode === mfr);

  // Client-side preview only — the authoritative tag is reserved by
  // next_asset_tag() at save time (same soft-race tolerance as the
  // existing part-code generator's own preview-then-insert pattern).
  useEffect(() => {
    if (isEdit || !cat || !mfr || !model) { if (!isEdit) setTagPreview(''); return; }
    const prefix = `${cat}-${mfr}-${model}-`;
    supabase.from('assets').select('asset_tag').ilike('asset_tag', `${prefix}%`).then(({ data: rows }) => {
      const nums = (rows||[]).map(r => parseInt(r.asset_tag.split('-').pop()||'0'));
      setTagPreview(prefix + String((nums.length?Math.max(...nums):0)+1).padStart(3,'0'));
    });
  }, [cat, mfr, model, isEdit]);

  const handleSave = async () => {
    setError('');
    if (!isEdit && (!cat || !mfr || !model)) return setError('Category, manufacturer and model are required.');
    const today = new Date().toISOString().slice(0,10);
    if (commissionedAt && commissionedAt > today) return setError('Commissioned date cannot be in the future.');
    if (warrantyUntil && commissionedAt && warrantyUntil < commissionedAt) return setError('Warranty until must be after the commissioned date.');
    setSaving(true);
    const payload = {
      cat, mfr, model, serialNumber, site, location, subLocation, status,
      commissionedAt: commissionedAt||null, warrantyUntil: warrantyUntil||null,
      pmIntervalHours: pmIntervalHours===''?null:Number(pmIntervalHours),
      lastPmHours: lastPmHours===''?null:Number(lastPmHours),
      lastPmDate: lastPmDate||null,
      pmIntervalDays: pmIntervalDays===''?null:Number(pmIntervalDays),
      notes, photoUrl,
    };
    const { data: saved, error: err } = isEdit
      ? await db.updateAsset(asset.id, payload)
      : await db.insertAsset(payload);
    setSaving(false);
    if (err) return setError(err.message);
    onSaved(saved);
  };

  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };
  const fieldStyle = { padding:"7px 10px", borderRadius:5, border:`1px solid ${T.border}`, fontSize:13, color:T.text, background:"#fff", fontFamily:"inherit", width:"100%", boxSizing:"border-box" };

  return (
    <Modal title={isEdit ? `Edit ${asset.assetTag}` : "Add Asset"} onClose={onClose} maxWidth={640}>
      <div style={{ display:"flex", flexDirection:"column", gap:14, maxHeight:"75vh", overflowY:"auto" }}>
        <div>
          <label style={sLabel}>Asset Tag</label>
          <div style={{ background:T.header, color:"#38bdf8", fontFamily:"monospace", fontWeight:800, fontSize:14, padding:"8px 12px", borderRadius:5 }}>
            {tagPreview || (isEdit ? asset.assetTag : "Select category, manufacturer & model…")}
          </div>
          <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>Format: Category-Manufacturer-Model-Sequence, generated automatically — same discipline as part codes.</div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          <div>
            <label style={sLabel}>Category</label>
            <select value={cat} disabled={isEdit} onChange={e=>{setCat(e.target.value);setMfr('');setModel('');}} style={fieldStyle}>
              <option value="">Select…</option>
              {categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={sLabel}>Manufacturer</label>
            <select value={mfr} disabled={isEdit} onChange={e=>{setMfr(e.target.value);setModel('');}} style={fieldStyle}>
              <option value="">Select…</option>
              {filteredMfrs.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={sLabel}>Model</label>
            <select value={model} disabled={isEdit} onChange={e=>setModel(e.target.value)} style={fieldStyle}>
              <option value="">Select…</option>
              {filteredModels.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={sLabel}>Serial Number</label><input value={serialNumber} onChange={e=>setSerialNumber(e.target.value)} style={fieldStyle}/></div>
          <div>
            <label style={sLabel}>Status</label>
            <select value={status} onChange={e=>setStatus(e.target.value)} style={fieldStyle}>
              {Object.entries(ASSET_STATUS_META).map(([k,m])=><option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          <div><label style={sLabel}>Site</label><input value={site} onChange={e=>setSite(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>Location</label><input value={location} onChange={e=>setLocation(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>Sub-Location</label><input value={subLocation} onChange={e=>setSubLocation(e.target.value)} style={fieldStyle}/></div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div><label style={sLabel}>Commissioned Date</label><input type="date" value={commissionedAt||''} onChange={e=>setCommissionedAt(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>Warranty Until</label><input type="date" value={warrantyUntil||''} onChange={e=>setWarrantyUntil(e.target.value)} style={fieldStyle}/></div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
          <div><label style={sLabel}>PM Interval (hrs)</label><input type="number" value={pmIntervalHours} onChange={e=>setPmIntervalHours(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>Last PM Hours</label><input type="number" value={lastPmHours} onChange={e=>setLastPmHours(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>Last PM Date</label><input type="date" value={lastPmDate||''} onChange={e=>setLastPmDate(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>PM Interval (days)</label><input type="number" value={pmIntervalDays} onChange={e=>setPmIntervalDays(e.target.value)} style={fieldStyle}/></div>
        </div>

        <div><label style={sLabel}>Notes</label><textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} style={{ ...fieldStyle, resize:"vertical" }}/></div>

        <FileUpload partCode={tagPreview || asset?.assetTag || 'pending'} bucket="asset-photos" label="Photo" currentUrl={photoUrl} onUploaded={setPhotoUrl}/>

        {error && <div style={{ fontSize:12, color:T.danger, background:T.dangerBg, padding:"8px 12px", borderRadius:6 }}>⚠️ {error}</div>}

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:`1px solid ${T.border}` }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSave} disabled={saving}>{saving?"Saving…":(isEdit?"Save Changes":"Create Asset")}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── ASSET DETAIL PAGE ────────────────────────────────────────
const MAINTENANCE_TYPE_META = {
  // Event TYPE is identity — what kind of job it was — not state. Six
  // hues here competed with the status colours elsewhere on the page.
  // Corrective keeps a warning tone because an unplanned repair IS the
  // exceptional case an engineer scans a timeline for.
  installation: { label:'Installation', color:T.textSecondary },
  preventive:   { label:'Preventive',   color:T.textSecondary },
  corrective:   { label:'Corrective',   color:T.warn },
  inspection:   { label:'Inspection',   color:T.textSecondary },
  overhaul:     { label:'Overhaul',     color:T.warn },
  modification: { label:'Modification', color:T.textSecondary },
};

// A logged part is "cancelled" exactly when the stock movement it
// posted has been voided — either from here, or from the Stock
// Movements page. There is no separate flag (migration 025);
// v_maintenance_parts_used exposes it as is_cancelled.
const isPartLineCancelled = (p) => p?.is_cancelled === true;

// What this line actually cost the asset: what was issued minus what
// came back (migration 026). A cancelled line counts as zero.
const partLineNetQty = (p) =>
  isPartLineCancelled(p) ? 0 : Number(p?.net_qty ?? p?.quantity ?? 0);

// Simple inline SVG line chart — no charting library, matching this
// app's existing sparkline (div-bar) approach for the same reason:
// avoid unnecessary dependencies for one small chart.
function HoursLogChart({ readings }) {
  if (readings.length < 2) return <div style={{ fontSize:12, color:T.muted, padding:20, textAlign:'center' }}>Need at least 2 readings to plot a trend.</div>;
  const W = 600, H = 160, PAD = 24;
  const xs = readings.map(r => new Date(r.read_at).getTime());
  const ys = readings.map(r => Number(r.reading_hours));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(0, ...ys), maxY = Math.max(...ys) || 1;
  const sx = x => PAD + (maxX>minX ? (x-minX)/(maxX-minX) : 0.5) * (W-2*PAD);
  const sy = y => H-PAD - ((y-minY)/(maxY-minY||1)) * (H-2*PAD);
  const points = readings.map(r => `${sx(new Date(r.read_at).getTime())},${sy(Number(r.reading_hours))}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:H }}>
      <line x1={PAD} y1={H-PAD} x2={W-PAD} y2={H-PAD} stroke={T.border} strokeWidth="1"/>
      <polyline points={points} fill="none" stroke={T.accent} strokeWidth="2"/>
      {readings.map((r,i) => (
        <circle key={i} cx={sx(new Date(r.read_at).getTime())} cy={sy(Number(r.reading_hours))} r="3" fill={r.is_counter_reset ? T.danger : T.accent}/>
      ))}
    </svg>
  );
}

function UpdateHoursModal({ asset, onClose, onSaved }) {
  const [reading, setReading] = useState(asset.runningHours ?? '');
  const [isReset, setIsReset] = useState(false);
  const [notes,   setNotes]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const handleSave = async () => {
    if (reading === '' || isNaN(Number(reading))) return setError('Enter a valid reading.');
    setSaving(true);
    const { error: err } = await db.insertAssetHoursReading(asset.id, Number(reading), { notes, isCounterReset: isReset });
    setSaving(false);
    if (err) return setError(err.message);
    onSaved();
  };

  const fieldStyle = { padding:"7px 10px", borderRadius:5, border:`1px solid ${T.border}`, fontSize:13, color:T.text, background:"#fff", fontFamily:"inherit", width:"100%", boxSizing:"border-box" };
  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };

  return (
    <Modal title="Update Hours Reading" onClose={onClose} maxWidth={380}>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ fontSize:12, color:T.muted }}>Current: {asset.runningHours} hrs</div>
        <div><label style={sLabel}>New Reading (hrs)</label><input type="number" value={reading} onChange={e=>setReading(e.target.value)} style={fieldStyle}/></div>
        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:T.muted, cursor:"pointer" }}>
          <input type="checkbox" checked={isReset} onChange={e=>setIsReset(e.target.checked)}/> Meter was reset/replaced (allow a lower reading)
        </label>
        <div><label style={sLabel}>Notes</label><input value={notes} onChange={e=>setNotes(e.target.value)} style={fieldStyle}/></div>
        {error && <div style={{ fontSize:12, color:T.danger, background:T.dangerBg, padding:"8px 12px", borderRadius:6 }}>⚠️ {error}</div>}
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSave} disabled={saving}>{saving?"Saving…":"Save Reading"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// One repeatable row inside the maintenance-event parts builder. Owns
// its own search state; reports the chosen part + quantity/cost up to
// the parent via onChange. Defaults to filtering candidates by the
// asset's model (its part code's model segment) with a toggle to
// search all parts, and flags inline (non-blocking) when the entered
// quantity exceeds what's on hand.
function PartPickerRow({ row, assetModel, onChange, onRemove }) {
  const [searchAll, setSearchAll] = useState(false);
  const [query, setQuery] = useState(row.code || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (row.partId || query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      db.fetchParts({ search: query.trim(), model: searchAll ? undefined : assetModel }, 0, 15)
        .then(({ data }) => { setResults(data || []); setOpen(true); });
    }, 300);
    return () => clearTimeout(t);
  }, [query, searchAll, assetModel, row.partId]);

  const pickPart = (p) => {
    onChange({ ...row, partId: p.id, code: p.code, shortDesc: p.short_desc, qtyOnHand: p.qty_on_hand });
    setQuery(p.code); setOpen(false);
  };

  const exceedsStock = row.partId && row.quantity && Number(row.quantity) > (row.qtyOnHand ?? 0);
  const fieldStyle = { padding:"6px 9px", borderRadius:5, border:`1px solid ${T.border}`, fontSize:12, color:T.text, background:"#fff", fontFamily:"inherit", width:"100%", boxSizing:"border-box" };

  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:6, padding:10, marginBottom:8 }}>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr auto", gap:8, alignItems:"start" }}>
        <div style={{ position:"relative" }}>
          <input value={query} placeholder="Search part code / description…"
            onChange={e=>{ setQuery(e.target.value); onChange({ ...row, partId:null, code:'', shortDesc:'' }); }}
            style={fieldStyle}/>
          {row.partId && <div style={{ fontSize:11, color:T.muted, marginTop:3 }}>{row.shortDesc} — on hand: <strong>{row.qtyOnHand}</strong></div>}
          {open && results.length > 0 && (
            <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#fff", border:`1px solid ${T.border}`, borderRadius:6, boxShadow:"0 6px 16px rgba(0,0,0,0.12)", zIndex:20, maxHeight:200, overflowY:"auto" }}>
              {results.map(p => (
                <div key={p.id} onClick={()=>pickPart(p)} style={{ padding:"6px 10px", cursor:"pointer", fontSize:12, borderBottom:`1px solid ${T.border}` }}
                  onMouseEnter={e=>e.currentTarget.style.background="#eff6ff"} onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                  <div style={{ fontFamily:"monospace", fontWeight:700 }}>{p.code}</div>
                  <div style={{ color:T.muted }}>{p.short_desc} — on hand: {p.qty_on_hand}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <input type="number" min="0" step="any" placeholder="Qty" value={row.quantity}
          onChange={e=>onChange({ ...row, quantity:e.target.value })} style={fieldStyle}/>
        <input type="number" min="0" step="any" placeholder="Unit cost" value={row.unitCost}
          onChange={e=>onChange({ ...row, unitCost:e.target.value })} style={fieldStyle}/>
        <button onClick={onRemove} style={{ background:"transparent", border:"none", color:T.danger, cursor:"pointer", fontSize:16, padding:"4px 6px" }}>✕</button>
      </div>
      {!searchAll && <div style={{ fontSize:10, color:T.muted, marginTop:4 }}>Filtered to this asset's model — <span onClick={()=>setSearchAll(true)} style={{ color:T.accent, cursor:"pointer", textDecoration:"underline" }}>search all parts</span></div>}
      {searchAll && <div style={{ fontSize:10, color:T.muted, marginTop:4 }}>Searching all parts — <span onClick={()=>setSearchAll(false)} style={{ color:T.accent, cursor:"pointer", textDecoration:"underline" }}>filter to this model</span></div>}
      {exceedsStock && <div style={{ fontSize:11, color:T.danger, marginTop:4 }}>⚠️ Quantity exceeds on-hand stock ({row.qtyOnHand}) — allowed, but double-check.</div>}
    </div>
  );
}

function MaintenanceEventModal({ asset, onClose, onSaved }) {
  const [eventType, setEventType] = useState('preventive');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0,10));
  const [runningHours, setRunningHours] = useState(asset.runningHours ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [downtimeHours, setDowntimeHours] = useState('');
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [performedBy, setPerformedBy] = useState('');
  const [status, setStatus] = useState('completed');
  const [failureMode, setFailureMode] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [vocab, setVocab] = useState({ failureModes:[], rootCauses:[] });
  const [parts, setParts] = useState([]); // { partId, code, shortDesc, qtyOnHand, quantity, unitCost }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { db.fetchMaintenanceVocabulary().then(setVocab); }, []);

  const addPartRow = () => setParts(p => [...p, { partId:null, code:'', shortDesc:'', qtyOnHand:0, quantity:'', unitCost:'' }]);
  const updatePartRow = (i, row) => setParts(p => p.map((r,idx)=>idx===i?row:r));
  const removePartRow = (i) => setParts(p => p.filter((_,idx)=>idx!==i));

  const handleSave = async () => {
    setError('');
    if (!title.trim()) return setError('Title is required.');
    if (!eventDate) return setError('Event date is required.');
    const validParts = parts.filter(p => p.partId && p.quantity !== '' && Number(p.quantity) > 0);
    if (parts.some(p => (p.code || p.quantity) && !(p.partId && p.quantity))) {
      return setError('Every parts row needs both a selected part and a quantity, or remove the row.');
    }
    setSaving(true);
    // One RPC, one transaction (migration 023): the event, its parts,
    // and the stock issues they post either all land or none do.
    const { error: err } = await db.logMaintenanceEvent({
      assetId: asset.id, eventType, eventDate, title: title.trim(), description,
      runningHoursAtEvent: runningHours, downtimeHours, workOrderNo, performedBy, status,
      failureMode: eventType==='corrective'?failureMode:null, rootCause: eventType==='corrective'?rootCause:null,
    }, validParts);
    setSaving(false);
    // Surfaces the database's own message — e.g. a part that is in the
    // Trash, or one that no longer exists.
    if (err) return setError(err.message);
    onSaved();
  };

  const fieldStyle = { padding:"7px 10px", borderRadius:5, border:`1px solid ${T.border}`, fontSize:13, color:T.text, background:"#fff", fontFamily:"inherit", width:"100%", boxSizing:"border-box" };
  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };

  return (
    <Modal title={`Log Maintenance — ${asset.assetTag}`} onClose={onClose} maxWidth={700}>
      <div style={{ display:"flex", flexDirection:"column", gap:14, maxHeight:"75vh", overflowY:"auto" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          <div>
            <label style={sLabel}>Event Type</label>
            <select value={eventType} onChange={e=>setEventType(e.target.value)} style={fieldStyle}>
              {Object.entries(MAINTENANCE_TYPE_META).map(([k,m])=><option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
          <div><label style={sLabel}>Date</label><input type="date" value={eventDate} onChange={e=>setEventDate(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>Running Hours at Event</label><input type="number" value={runningHours} onChange={e=>setRunningHours(e.target.value)} style={fieldStyle}/></div>
        </div>

        <div><label style={sLabel}>Title</label><input value={title} onChange={e=>setTitle(e.target.value)} style={fieldStyle}/></div>
        <div><label style={sLabel}>Description</label><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={2} style={{ ...fieldStyle, resize:"vertical" }}/></div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
          <div><label style={sLabel}>Downtime (hrs)</label><input type="number" value={downtimeHours} onChange={e=>setDowntimeHours(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>Work Order No.</label><input value={workOrderNo} onChange={e=>setWorkOrderNo(e.target.value)} style={fieldStyle}/></div>
          <div><label style={sLabel}>Performed By</label><input value={performedBy} onChange={e=>setPerformedBy(e.target.value)} style={fieldStyle}/></div>
          <div>
            <label style={sLabel}>Status</label>
            <select value={status} onChange={e=>setStatus(e.target.value)} style={fieldStyle}>
              <option value="open">Open</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {eventType === 'corrective' && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <label style={sLabel}>Failure Mode</label>
              <input list="failure-modes" value={failureMode} onChange={e=>setFailureMode(e.target.value)} style={fieldStyle}/>
              <datalist id="failure-modes">{vocab.failureModes.map(v=><option key={v} value={v}/>)}</datalist>
            </div>
            <div>
              <label style={sLabel}>Root Cause</label>
              <input list="root-causes" value={rootCause} onChange={e=>setRootCause(e.target.value)} style={fieldStyle}/>
              <datalist id="root-causes">{vocab.rootCauses.map(v=><option key={v} value={v}/>)}</datalist>
            </div>
          </div>
        )}

        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
            <label style={sLabel}>Parts Used</label>
            <Btn small variant="secondary" onClick={addPartRow}>+ Add Part</Btn>
          </div>
          {parts.length === 0 && <div style={{ fontSize:12, color:T.muted }}>No parts logged for this event.</div>}
          {parts.map((row,i) => (
            <PartPickerRow key={i} row={row} assetModel={asset.model} onChange={r=>updatePartRow(i,r)} onRemove={()=>removePartRow(i)}/>
          ))}
        </div>

        {error && <div style={{ fontSize:12, color:T.danger, background:T.dangerBg, padding:"8px 12px", borderRadius:6 }}>⚠️ {error}</div>}

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:`1px solid ${T.border}` }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSave} disabled={saving}>{saving?"Saving…":"Log Event"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// View / edit one maintenance event, and cancel the parts it logged.
// event_date and asset are intentionally not editable: the database
// locks them once stock has posted against them (migration 025), so
// offering the fields would only produce a rejected save.
function MaintenanceEventDetailModal({ event, parts, canEdit, onClose, onChanged, onError }) {
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [confirmCancel, setConfirmCancel] = useState(null); // part line pending cancel
  const [cancelReason,  setCancelReason]  = useState('');
  const [returnTarget,  setReturnTarget]  = useState(null); // part line being returned
  const [returnQty,     setReturnQty]     = useState('');
  const [returnReason,  setReturnReason]  = useState('');
  const [returning,     setReturning]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  const [form, setForm] = useState({
    title: event.title || '', description: event.description || '',
    eventType: event.event_type, status: event.status,
    runningHoursAtEvent: event.running_hours_at_event ?? '',
    downtimeHours: event.downtime_hours ?? '',
    workOrderNo: event.work_order_no || '', performedBy: event.performed_by || '',
    failureMode: event.failure_mode || '', rootCause: event.root_cause || '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) return setError('Title is required.');
    setSaving(true); setError('');
    const { error: err } = await db.updateMaintenanceEvent(event.id, { ...form, title: form.title.trim() });
    setSaving(false);
    if (err) return setError(err.message);
    onChanged('Maintenance event updated');
  };

  const handleCancelPart = async () => {
    const line = confirmCancel;
    setConfirmCancel(null);
    const { error: err } = await db.cancelMaintenancePart(line.id, cancelReason.trim() || null);
    setCancelReason('');
    if (err) return onError(err.message);
    onChanged(`${line.part?.code} cancelled — stock returned`);
  };

  // Partial return (migration 026): puts `qty` of an issued line back
  // into store as a movement linked to this event, so the record shows
  // only what was actually consumed. Returning everything outstanding
  // cancels the line.
  const handleReturnPart = async () => {
    const line = returnTarget;
    const outstanding = partLineNetQty(line);
    const qty = Number(returnQty);
    if (!qty || qty <= 0) return setError('Enter how many units are coming back.');
    if (qty > outstanding) return setError(`Only ${outstanding} of ${line.part?.code} are still issued on this event.`);
    setReturning(true); setError('');
    const { error: err } = await db.returnMaintenancePart(line.id, qty, returnReason.trim() || null);
    setReturning(false);
    if (err) return setError(err.message);
    setReturnTarget(null); setReturnQty(''); setReturnReason('');
    onChanged(`${qty} × ${line.part?.code} returned to store`);
  };

  const handleDeleteEvent = async () => {
    setDeleting(true);
    const { error: err } = await db.softDeleteMaintenanceEvent(event.id);
    setDeleting(false);
    if (err) { setConfirmDelete(false); return onError(err.message); }
    onChanged('Maintenance event removed — any issued parts were returned to stock');
  };

  const meta = MAINTENANCE_TYPE_META[event.event_type] || {};
  const fieldStyle = { padding:"7px 10px", borderRadius:5, border:`1px solid ${T.border}`, fontSize:13, color:T.text, background:"#fff", fontFamily:"inherit", width:"100%", boxSizing:"border-box" };
  const sLabel = { fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.8,display:"block",marginBottom:5 };
  const row = (label, value) => (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${T.border}`, fontSize:13, gap:12 }}>
      <span style={{ color:T.muted, whiteSpace:"nowrap" }}>{label}</span>
      <span style={{ color:T.text, fontWeight:600, textAlign:"right" }}>{value || "—"}</span>
    </div>
  );

  return (
    <Modal title={editing ? 'Edit Maintenance Event' : event.title} onClose={onClose} maxWidth={620}>
      <div style={{ display:"flex", flexDirection:"column", gap:14, maxHeight:"75vh", overflowY:"auto" }}>
        {!editing ? (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <SeverityDot color={meta.color} />
              <span style={{ color:meta.color, fontWeight:700, fontSize:13 }}>{meta.label}</span>
              {event.status !== 'completed' && (
                <Pill color={event.status==='cancelled'?T.danger:T.warn} bg={event.status==='cancelled'?T.dangerBg:T.warnBg} mono={false} size={11}>{event.status}</Pill>
              )}
              <span style={{ marginLeft:"auto", fontSize:12, color:T.muted }}>{event.event_date}</span>
            </div>
            {event.description && <div style={{ fontSize:13, color:T.text }}>{event.description}</div>}
            {row('Running hours at event', event.running_hours_at_event)}
            {row('Downtime (hrs)', event.downtime_hours)}
            {row('Work order', event.work_order_no)}
            {row('Performed by', event.performed_by)}
            {event.event_type === 'corrective' && row('Failure mode', event.failure_mode)}
            {event.event_type === 'corrective' && row('Root cause', event.root_cause)}

            <div>
              <div style={{ ...sLabel, marginTop:6 }}>Parts Used</div>
              {parts.length === 0 ? (
                <div style={{ fontSize:12, color:T.muted }}>No parts logged for this event.</div>
              ) : parts.map(p => {
                const cancelled = isPartLineCancelled(p);
                const returned  = Number(p.returned_qty) || 0;
                const net       = partLineNetQty(p);
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                    <span style={{ fontFamily:"monospace", fontWeight:700, color: cancelled?T.muted:T.text, textDecoration: cancelled?"line-through":"none" }}>{p.part?.code}</span>
                    <span style={{ flex:1, color:T.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.part?.short_desc}</span>
                    <span style={{ fontWeight:700, color: cancelled?T.muted:T.text, textDecoration: cancelled?"line-through":"none", whiteSpace:"nowrap" }}>
                      ×{cancelled ? p.quantity : net}
                    </span>
                    {!cancelled && returned > 0 && (
                      <span style={{ color:T.muted, whiteSpace:"nowrap" }} title={`${p.quantity} issued, ${returned} returned to store`}>
                        ({p.quantity} issued − {returned} returned)
                      </span>
                    )}
                    {cancelled
                      ? <Pill color={T.danger} bg={T.dangerBg} mono={false} size={10}>Cancelled</Pill>
                      : p.stock_transaction_id && (
                          <>
                            {net > 0 && (
                              <Btn small variant="secondary" onClick={()=>{ setReturnTarget(p); setReturnQty(String(net)); setReturnReason(''); setError(''); }}>Return</Btn>
                            )}
                            {isAdmin && <Btn small variant="danger" onClick={()=>setConfirmCancel(p)}>Cancel</Btn>}
                          </>
                        )}
                  </div>
                );
              })}
              {parts.some(isPartLineCancelled) && (
                <div style={{ fontSize:11, color:T.muted, marginTop:6 }}> Cancelled parts were returned to stock and are not counted against this asset.
                </div>
              )}
            </div>

            {canEdit && (
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:10, borderTop:`1px solid ${T.border}` }}>
                {isAdmin && <Btn variant="danger" onClick={()=>setConfirmDelete(true)}>Remove Event</Btn>}
                <Btn onClick={()=>setEditing(true)}>Edit</Btn>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize:11, color:T.muted, background:T.subtle, padding:"8px 12px", borderRadius:6 }}> Date ({event.event_date}) and asset cannot be changed once parts have been issued from stock against them.
            </div>
            <div><label style={sLabel}>Title</label><input value={form.title} onChange={e=>set('title', e.target.value)} style={fieldStyle}/></div>
            <div><label style={sLabel}>Description</label><textarea value={form.description} onChange={e=>set('description', e.target.value)} rows={3} style={{ ...fieldStyle, resize:"vertical" }}/></div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div>
                <label style={sLabel}>Event Type</label>
                <select value={form.eventType} onChange={e=>set('eventType', e.target.value)} style={fieldStyle}>
                  {Object.entries(MAINTENANCE_TYPE_META).map(([k,m])=><option key={k} value={k}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label style={sLabel}>Status</label>
                <select value={form.status} onChange={e=>set('status', e.target.value)} style={fieldStyle}>
                  <option value="open">Open</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            {form.status === 'cancelled' && event.status !== 'cancelled' && (
              <div style={{ fontSize:11, color:T.danger, background:T.dangerBg, padding:"8px 12px", borderRadius:6 }}> Saving as cancelled returns every part this event issued back to stock.
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
              <div><label style={sLabel}>Hours</label><input type="number" value={form.runningHoursAtEvent} onChange={e=>set('runningHoursAtEvent', e.target.value)} style={fieldStyle}/></div>
              <div><label style={sLabel}>Downtime</label><input type="number" value={form.downtimeHours} onChange={e=>set('downtimeHours', e.target.value)} style={fieldStyle}/></div>
              <div><label style={sLabel}>Work Order</label><input value={form.workOrderNo} onChange={e=>set('workOrderNo', e.target.value)} style={fieldStyle}/></div>
              <div><label style={sLabel}>Performed By</label><input value={form.performedBy} onChange={e=>set('performedBy', e.target.value)} style={fieldStyle}/></div>
            </div>
            {form.eventType === 'corrective' && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div><label style={sLabel}>Failure Mode</label><input value={form.failureMode} onChange={e=>set('failureMode', e.target.value)} style={fieldStyle}/></div>
                <div><label style={sLabel}>Root Cause</label><input value={form.rootCause} onChange={e=>set('rootCause', e.target.value)} style={fieldStyle}/></div>
              </div>
            )}
            {error && <div style={{ fontSize:12, color:T.danger, background:T.dangerBg, padding:"8px 12px", borderRadius:6 }}>⚠️ {error}</div>}
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:`1px solid ${T.border}` }}>
              <Btn variant="secondary" onClick={()=>{ setEditing(false); setError(''); }}>Cancel</Btn>
              <Btn onClick={handleSave} disabled={saving}>{saving?"Saving…":"Save Changes"}</Btn>
            </div>
          </>
        )}
      </div>

      {confirmCancel && (
        <Modal title="Cancel Logged Part" onClose={()=>{ setConfirmCancel(null); setCancelReason(''); }} maxWidth={420}>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ fontSize:13, color:T.text }}> Cancel <strong>{confirmCancel.part?.code} × {confirmCancel.quantity}</strong>? The quantity goes back into stock and the line stays on this record marked cancelled.
            </div>
            <div>
              <label style={sLabel}>Reason (optional)</label>
              <input value={cancelReason} onChange={e=>setCancelReason(e.target.value)} placeholder="e.g. logged by mistake" style={fieldStyle}/>
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <Btn variant="secondary" onClick={()=>{ setConfirmCancel(null); setCancelReason(''); }}>Back</Btn>
              <Btn variant="danger" onClick={handleCancelPart}>Cancel Part</Btn>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Remove Maintenance Event" onClose={()=>{ if(!deleting) setConfirmDelete(false); }} maxWidth={460}>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ fontSize:13, color:T.text }}> Remove <strong>{event.title}</strong>{event.work_order_no ? ` (${event.work_order_no})` : ''}?
              It moves to Trash, where an admin can restore it.
            </div>
            {(() => {
              // Removing the event reverses every stock movement it
              // posted, so say exactly what goes back on the shelf —
              // this is the part a storekeeper needs to see before
              // agreeing, not after.
              const returning = parts.filter(p => !isPartLineCancelled(p) && partLineNetQty(p) > 0);
              return returning.length === 0 ? (
                <div style={{ fontSize:12, color:T.muted }}>No parts are still issued against it, so stock is unaffected.</div>
              ) : (
                <div style={{ background:T.warnBg, border:`1px solid ${T.warn}`, borderRadius:6, padding:"10px 12px" }}>
                  <div style={{ fontSize:12, fontWeight:700, color:T.warn, marginBottom:6 }}>
                    ⚠️ This returns {returning.length} part line{returning.length>1?'s':''} to stock:
                  </div>
                  {returning.map(p => (
                    <div key={p.id} style={{ fontSize:12, color:T.text, display:"flex", gap:8, padding:"2px 0" }}>
                      <span style={{ fontFamily:"monospace", fontWeight:700 }}>{p.part?.code}</span>
                      <span style={{ color:T.muted, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.part?.short_desc}</span>
                      <span style={{ fontWeight:700, whiteSpace:"nowrap" }}>+{partLineNetQty(p)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", paddingTop:8, borderTop:`1px solid ${T.border}` }}>
              <Btn variant="secondary" onClick={()=>setConfirmDelete(false)} disabled={deleting}>Cancel</Btn>
              <Btn variant="danger" onClick={handleDeleteEvent} disabled={deleting}>
                {deleting ? 'Removing…' : 'Remove Event'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {returnTarget && (
        <Modal title="Return Part to Store" onClose={()=>{ if(!returning){ setReturnTarget(null); setReturnQty(''); setReturnReason(''); } }} maxWidth={420}>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ fontSize:13, color:T.text }}>
              <strong>{returnTarget.part?.code}</strong> — {partLineNetQty(returnTarget)} still issued against this event
              {Number(returnTarget.returned_qty) > 0 && ` (${returnTarget.quantity} issued, ${returnTarget.returned_qty} already returned)`}.
              Return only what came back; the rest stays counted against this asset.
            </div>
            <div>
              <label style={sLabel}>Quantity to return</label>
              <input type="number" min="0" step="any" max={partLineNetQty(returnTarget)}
                value={returnQty} onChange={e=>setReturnQty(e.target.value)} style={fieldStyle}/>
            </div>
            <div>
              <label style={sLabel}>Reason (optional)</label>
              <input value={returnReason} onChange={e=>setReturnReason(e.target.value)} placeholder="e.g. not needed after strip-down" style={fieldStyle}/>
            </div>
            {error && <div style={{ fontSize:12, color:T.danger }}>{error}</div>}
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <Btn variant="secondary" onClick={()=>{ setReturnTarget(null); setReturnQty(''); setReturnReason(''); }} disabled={returning}>Back</Btn>
              <Btn onClick={handleReturnPart} disabled={returning}>{returning ? 'Returning…' : 'Return to Store'}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function AssetDocumentsTab({ asset, flash }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = () => { setLoading(true); db.fetchAssetDocuments(asset.id).then(({ data }) => { setDocs(data||[]); setLoading(false); }); };
  useEffect(() => { load(); }, [asset.id]);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!label.trim()) return flash('Enter a label for this document first', 'err');
    setUploading(true);
    const { url, path, error } = await db.uploadFile('asset-documents', asset.assetTag, file);
    if (error) { setUploading(false); return flash(`Error: ${error.message}`, 'err'); }
    const { error: insErr } = await db.insertAssetDocument(asset.id, label.trim(), url, path);
    setUploading(false);
    if (insErr) return flash(`Error: ${insErr.message}`, 'err');
    setLabel(''); e.target.value = '';
    flash('Document uploaded'); load();
  };

  const handleDelete = async (doc) => {
    const { error } = await db.deleteAssetDocument(doc.id, doc.path);
    if (error) return flash(`Error: ${error.message}`, 'err');
    flash('Document removed'); load();
  };


  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center" }}>
        <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Label (e.g. Operator Manual)" style={{ padding:"7px 10px", borderRadius:5, border:`1px solid ${T.border}`, fontSize:13, flex:1 }}/>
        <input type="file" onChange={handleFile} disabled={uploading} style={{ fontSize:12 }}/>
      </div>
      {uploading && <div style={{ fontSize:12, color:T.accent, marginBottom:10 }}>Uploading…</div>}
      {loading ? <div style={{ color:T.muted, fontSize:13 }}>Loading…</div> : docs.length===0 ? (
        <div style={{ color:T.muted, fontSize:13 }}>No documents uploaded yet.</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {docs.map(d => (
            <div key={d.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", border:`1px solid ${T.border}`, borderRadius:6 }}>
              <span>📎</span>
              <span style={{ flex:1 }}>
                <StoredFileLink bucket="asset-documents" url={d.url} path={d.path} style={{ fontSize:13 }}>{d.label}</StoredFileLink>
              </span>
              <span style={{ fontSize:11, color:T.muted }}>{new Date(d.uploaded_at).toLocaleDateString()}</span>
              <button onClick={()=>handleDelete(d)} style={{ background:"transparent", border:"none", color:T.danger, cursor:"pointer" }}></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetDetailPage({ data }) {
  const { navFilter, clearNavFilter, navigateTo } = data;
  const { isAdmin, isDeptUser } = useAuth();
  const canEdit = isAdmin || isDeptUser;
  const assetId = navFilter?.assetId;

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [partsUsed, setPartsUsed] = useState([]); // flat, joined, across all events
  const [hoursLog, setHoursLog] = useState([]);
  const [tab, setTab] = useState('timeline');
  const [eventTarget, setEventTarget] = useState(null); // timeline event opened for detail/edit
  const [showLogModal, setShowLogModal] = useState(false);
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [partsSortDesc, setPartsSortDesc] = useState(true);
  const [toast, setToast] = useState(null);
  const flash = (text, type='ok') => { setToast({text,type}); setTimeout(()=>setToast(null),3200); };

  const load = useCallback(() => {
    if (!assetId) return;
    setLoading(true);
    db.fetchAssetById(assetId).then(({ data: a }) => {
      if (!a) { setLoading(false); return; }
      setAsset(mapAsset(a));
      return db.fetchMaintenanceEvents(assetId).then(({ data: ev }) => {
        setEvents(ev || []);
        return db.fetchMaintenancePartsUsedByEvents((ev||[]).map(e=>e.id));
      }).then(({ data: pu }) => setPartsUsed(pu || []));
    }).finally(()=>setLoading(false));
    db.fetchAssetHoursLog(assetId).then(({ data, error }) => {
      if (error) return flash(`Could not load the hours log: ${error.message}`, 'err');
      setHoursLog(data || []);
    });
  }, [assetId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (assetId) clearNavFilter(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!assetId) {
    return <Card><div style={{ padding:40, textAlign:"center", color:T.muted }}>No asset selected. <Btn small onClick={()=>navigateTo('assets')}>← Back to Asset Registry</Btn></div></Card>;
  }
  if (loading && !asset) return <div style={{ textAlign:"center", padding:60, color:T.muted }}>Loading asset…</div>;
  if (!asset) return <Card><div style={{ padding:40, textAlign:"center", color:T.muted }}>Asset not found. <Btn small onClick={()=>navigateTo('assets')}>← Back</Btn></div></Card>;

  const meta = ASSET_STATUS_META[asset.status] || {};
  const eventsById = Object.fromEntries(events.map(e=>[e.id, e]));
  const partsByEvent = {};
  partsUsed.forEach(p => { (partsByEvent[p.maintenance_event_id] ||= []).push(p); });

  const thisYear = new Date().getFullYear();
  const thisYearEvents = events.filter(e => new Date(e.event_date).getFullYear() === thisYear);
  // Cancelled lines are excluded everywhere they would otherwise be
  // counted against this machine — that is the point of cancelling.
  const thisYearPartsUsed = partsUsed.filter(p => {
    const ev = eventsById[p.maintenance_event_id];
    return ev && !isPartLineCancelled(p) && new Date(ev.event_date).getFullYear() === thisYear;
  });
  const totalDowntimeThisYear = thisYearEvents.reduce((s,e)=>s+(Number(e.downtime_hours)||0),0);
  const fgCounts = {};
  thisYearPartsUsed.forEach(p => { const fg = p.part?.fg; if (fg) fgCounts[fg] = (fgCounts[fg]||0) + partLineNetQty(p); });
  const topFg = Object.entries(fgCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

  // Parts Used tab aggregation across the asset's whole history.
  const partsAgg = aggregatePartsUsage(partsUsed, eventsById);

  const today = new Date().toISOString().slice(0,10);
  const warrantyExpired = asset.warrantyUntil && asset.warrantyUntil < today;

  const hoursBase = asset.lastPmHours || 0;
  const hoursPos = asset.pmIntervalHours ? Math.max(0, asset.runningHours - hoursBase) : 0;
  const hoursPct = asset.pmIntervalHours ? Math.min(100, (hoursPos / asset.pmIntervalHours) * 100) : 0;

  const handleDelete = async () => {
    const { error } = await db.softDeleteAsset(asset.id);
    setShowDeleteConfirm(false);
    if (error) return flash(`Error: ${error.message}`, 'err');
    navigateTo('assets');
  };

  const tabs = [
    { id:'timeline', label:'Timeline' },
    { id:'parts',    label:'Parts Used' },
    { id:'hours',    label:'Hours Log' },
    { id:'docs',     label:'Documents' },
  ];

  return (
    <div>
      <PageHeader title={asset.assetTag} sub={`${asset.mfrLabel} ${asset.modelLabel}`} />
      <Btn small variant="secondary" onClick={()=>navigateTo('assets')} style={{ marginBottom:16 }}>← Back to Asset Registry</Btn>

      <div style={{ display:"grid", gridTemplateColumns:"320px 1fr", gap:20, alignItems:"start" }}>
        {/* LEFT — sticky */}
        <div style={{ position:"sticky", top:0, display:"flex", flexDirection:"column", gap:14 }}>
          <Card style={{ padding:0, overflow:"hidden" }}>
            <div style={{ height:160, background:"#f1f5f9", display:"flex", alignItems:"center", justifyContent:"center" }}>
              {asset.photoUrl ? <img src={asset.photoUrl} alt={asset.assetTag} style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : <span style={{ fontSize:40 }}>🏭</span>}
            </div>
            <div style={{ padding:14 }}>
              <div style={{ fontFamily:"monospace", fontWeight:800, fontSize:15, color:T.text }}>{asset.assetTag}</div>
              <div style={{ fontSize:12, color:T.muted, marginBottom:8 }}>{asset.modelLabel}</div>
              <Pill color={meta.color} bg={meta.bg} mono={false}>{meta.label}</Pill>
              {canEdit && (
                <div style={{ display:"flex", gap:6, marginTop:10 }}>
                  <Btn small variant="secondary" onClick={()=>setShowEditModal(true)}>Edit</Btn>
                  {isAdmin && <Btn small variant="danger" onClick={()=>setShowDeleteConfirm(true)}>Trash</Btn>}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <SectionHeader>Identity</SectionHeader>
            {[
              ['Serial Number', asset.serialNumber],
              ['Manufacturer', asset.mfrLabel],
              ['Category', asset.catLabel],
              ['Site / Location', [asset.site, asset.location, asset.subLocation].filter(Boolean).join(' / ') || null],
              ['Commissioned', asset.commissionedAt],
            ].map(([label,val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                <span style={{ color:T.muted }}>{label}</span><span style={{ fontWeight:600, color:T.text }}>{val ?? "—"}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", fontSize:12 }}>
              <span style={{ color:T.muted }}>Warranty</span>
              <span style={{ fontWeight:700, color: warrantyExpired ? T.danger : (asset.warrantyUntil ? T.success : T.muted) }}>
                {asset.warrantyUntil ? (warrantyExpired ? `Expired ${asset.warrantyUntil}` : `Until ${asset.warrantyUntil}`) : "—"}
              </span>
            </div>
          </Card>

          <Card>
            <SectionHeader>Running Hours</SectionHeader>
            <div style={{ fontSize:22, fontWeight:800, color:T.text, marginBottom:6 }}>{asset.runningHours} <span style={{ fontSize:12, fontWeight:400, color:T.muted }}>hrs</span></div>
            {asset.pmIntervalHours ? (
              <>
                <div style={{ width:"100%", height:8, background:"#e2e8f0", borderRadius:4, overflow:"hidden", marginBottom:6 }}>
                  <div style={{ width:`${hoursPct}%`, height:"100%", background: hoursPct>=90?'#d97706':'#16a34a' }}/>
                </div>
                <div style={{ fontSize:11, color:T.muted }}>{Math.max(0, asset.pmIntervalHours - hoursPos)} hrs remaining to next PM ({asset.pmIntervalHours} hr interval)</div>
              </>
            ) : <div style={{ fontSize:11, color:T.muted }}>No hour-based PM interval configured.</div>}
            {canEdit && <Btn small variant="secondary" onClick={()=>setShowHoursModal(true)} style={{ marginTop:10, width:"100%" }}>Update Hours Reading</Btn>}
          </Card>

          <Card>
            <SectionHeader>{thisYear} Summary</SectionHeader>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, fontSize:12 }}>
              <div><div style={{ color:T.muted }}>Maintenance Events</div><div style={{ fontWeight:700, fontSize:16 }}>{thisYearEvents.length}</div></div>
              <div><div style={{ color:T.muted }}>Parts Consumed</div><div style={{ fontWeight:700, fontSize:16 }}>{thisYearPartsUsed.reduce((s,p)=>s+Number(p.quantity),0)}</div></div>
              <div><div style={{ color:T.muted }}>Downtime (hrs)</div><div style={{ fontWeight:700, fontSize:16 }}>{totalDowntimeThisYear}</div></div>
              <div><div style={{ color:T.muted }}>Top Functional Group</div><div style={{ fontWeight:700, fontSize:13 }}>{topFg || "—"}</div></div>
            </div>
          </Card>

          {canEdit && <Btn onClick={()=>setShowLogModal(true)} style={{ width:"100%" }}>+ Log Maintenance Event</Btn>}
        </div>

        {/* RIGHT — tabs */}
        <div>
          <div style={{ display:"flex", gap:4, borderBottom:`1px solid ${T.border}`, marginBottom:16 }}>
            {tabs.map(tItem => (
              <button key={tItem.id} onClick={()=>setTab(tItem.id)}
                style={{ padding:"9px 16px", border:"none", borderBottom: tab===tItem.id?`2px solid ${T.accent}`:"2px solid transparent", background:"transparent", color: tab===tItem.id?T.accent:T.muted, fontWeight: tab===tItem.id?700:500, cursor:"pointer", fontSize:13, fontFamily:"inherit" }}>
                {tItem.label}
              </button>
            ))}
          </div>

          {tab === 'timeline' && (
            events.length === 0 ? <Card><div style={{ padding:30, textAlign:"center", color:T.muted }}>No maintenance events logged yet.</div></Card> : (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {events.map(ev => {
                  const tmeta = MAINTENANCE_TYPE_META[ev.event_type] || {};
                  const evParts = partsByEvent[ev.id] || [];
                  return (
                    <Card key={ev.id} style={{ cursor:"pointer" }} onClick={()=>setEventTarget(ev)}>
                      <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                        <SeverityDot color={tmeta.color||T.muted} size={9} />
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                            <div style={{ fontWeight:700, color:T.text }}>{ev.title}</div>
                            <span style={{ fontSize:11, color:T.muted }}>{ev.event_date}</span>
                          </div>
                          <div style={{ fontSize:11, color:tmeta.color, fontWeight:700, marginBottom:4 }}>{tmeta.label}{ev.status!=='completed' && ` · ${ev.status}`}</div>
                          {ev.description && <div style={{ fontSize:12, color:T.muted, marginBottom:6 }}>{ev.description}</div>}
                          <div style={{ display:"flex", gap:14, flexWrap:"wrap", fontSize:11, color:T.muted, marginBottom:6 }}>
                            {ev.running_hours_at_event!=null && <span>⏱ {ev.running_hours_at_event} hrs</span>}
                            {ev.downtime_hours!=null && <span>⏸ {ev.downtime_hours}h downtime</span>}
                            {ev.work_order_no && <span>📋 {ev.work_order_no}</span>}
                            {ev.performed_by && <span>{ev.performed_by}</span>}
                          </div>
                          {ev.event_type==='corrective' && (ev.failure_mode || ev.root_cause) && (
                            <div style={{ fontSize:11, color:T.muted, marginBottom:6 }}>
                              {ev.failure_mode && <span>Failure: {ev.failure_mode}. </span>}
                              {ev.root_cause && <span>Root cause: {ev.root_cause}.</span>}
                            </div>
                          )}
                          {evParts.length > 0 && (
                            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                              {evParts.map(p => {
                                const cancelled = isPartLineCancelled(p);
                                return (
                                  <span key={p.id} onClick={e=>{ e.stopPropagation(); navigateTo('master',{ search:p.part?.code }); }}
                                    title={cancelled ? 'Cancelled — stock was returned, not counted against this asset'
                                      : (Number(p.returned_qty)>0 ? `${p.quantity} issued, ${p.returned_qty} returned to store` : '')}
                                    style={{ background: cancelled?T.dangerBg:T.subtle, color: cancelled?T.danger:T.text, fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:10, cursor:"pointer", fontFamily:"monospace", textDecoration: cancelled?"line-through":"none" }}>
                                    {p.part?.code} × {cancelled ? p.quantity : partLineNetQty(p)}
                                    {cancelled ? ' · cancelled' : (Number(p.returned_qty)>0 ? ` · ${p.returned_qty} returned` : '')}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {tab === 'parts' && (
            <Card>
              <div style={TABLE_SCROLL}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:T.header }}>
                      {['Code','Description','Func Group','Times Replaced','Total Qty','First','Last','Avg Days Between','Total Cost'].map((h,i)=>(
                        <th key={h} onClick={i===3?()=>setPartsSortDesc(s=>!s):undefined} style={{ padding:"7px 9px", textAlign:"left", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", fontSize:11, cursor:i===3?"pointer":"default" }}>
                          {h}{i===3?(partsSortDesc?' ↓':' ↑'):''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {partsAgg.length===0 ? (
                      <tr><td colSpan={9} style={{ textAlign:"center", padding:30, color:T.muted }}>No parts logged against this asset yet.</td></tr>
                    ) : [...partsAgg].sort((a,b)=>partsSortDesc?b.timesReplaced-a.timesReplaced:a.timesReplaced-b.timesReplaced).map(p => (
                      <tr key={p.code} style={{ borderBottom:`1px solid ${T.border}` }}>
                        <td style={{ padding:"7px 9px", fontFamily:"monospace", fontWeight:700 }}>{p.code}</td>
                        <td style={{ padding:"7px 9px" }}>{p.shortDesc}</td>
                        <td style={{ padding:"7px 9px" }}>{p.fg||"—"}</td>
                        <td style={{ padding:"7px 9px", textAlign:"center" }}>{p.timesReplaced}</td>
                        <td style={{ padding:"7px 9px", textAlign:"center" }}>{p.totalQty}</td>
                        <td style={{ padding:"7px 9px", fontSize:12, color:T.muted }}>{p.first}</td>
                        <td style={{ padding:"7px 9px", fontSize:12, color:T.muted }}>{p.last}</td>
                        <td style={{ padding:"7px 9px", textAlign:"center" }}>{p.avgDaysBetween ?? "—"}</td>
                        <td style={{ padding:"7px 9px", textAlign:"right" }}>{p.totalCost ? p.totalCost.toFixed(2) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {tab === 'hours' && (
            <Card>
              <HoursLogChart readings={hoursLog}/>
              <div style={{ marginTop:14, maxHeight:240, overflowY:"auto" }}>
                {[...hoursLog].reverse().map(r => (
                  <div key={r.id} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                    <span style={{ color:T.muted }}>{new Date(r.read_at).toLocaleString()}</span>
                    <span style={{ fontWeight:700 }}>{r.reading_hours} hrs{r.is_counter_reset?' (reset)':''}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === 'docs' && <Card><AssetDocumentsTab asset={asset} flash={flash}/></Card>}
        </div>
      </div>

      {showLogModal && (
        <MaintenanceEventModal asset={asset} onClose={()=>setShowLogModal(false)}
          onSaved={()=>{ setShowLogModal(false); flash('Maintenance event logged'); load(); }}/>
      )}
      {eventTarget && (
        <MaintenanceEventDetailModal
          event={eventTarget}
          parts={partsByEvent[eventTarget.id] || []}
          canEdit={canEdit}
          onClose={()=>setEventTarget(null)}
          onChanged={(msg)=>{ flash(msg); setEventTarget(null); load(); }}
          onError={(msg)=>flash(msg, 'err')}
        />
      )}
      {showHoursModal && (
        <UpdateHoursModal asset={asset} onClose={()=>setShowHoursModal(false)}
          onSaved={()=>{ setShowHoursModal(false); flash('Reading recorded'); load(); }}/>
      )}
      {showEditModal && (
        <AssetFormModal data={data} asset={asset} onClose={()=>setShowEditModal(false)}
          onSaved={()=>{ setShowEditModal(false); flash('Asset updated'); load(); }}/>
      )}
      {showDeleteConfirm && (
        <Modal title="Move to Trash" onClose={()=>setShowDeleteConfirm(false)} maxWidth={400}>
          <div style={{ fontSize:13, color:T.text, marginBottom:16 }}>Move <strong>{asset.assetTag}</strong> to Trash? It can be restored later from the Trash page.</div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="secondary" onClick={()=>setShowDeleteConfirm(false)}>Cancel</Btn>
            <Btn variant="danger" onClick={handleDelete}>Move to Trash</Btn>
          </div>
        </Modal>
      )}
      <Toast msg={toast}/>
    </div>
  );
}

// Parts Used tab aggregation — grouped by part across the asset's
// whole maintenance history. Kept as a plain function (not useMemo)
// called during render since its inputs are already stable arrays
// from state, and the asset detail page's dataset is always small.
function aggregatePartsUsage(partsUsed, eventsById) {
  const byPart = {};
  partsUsed.forEach(p => {
    const ev = eventsById[p.maintenance_event_id];
    if (!ev || !p.part || isPartLineCancelled(p)) return;
    const key = p.part.code;
    if (!byPart[key]) byPart[key] = { code:p.part.code, shortDesc:p.part.short_desc, fg:p.part.fg, dates:[], totalQty:0, totalCost:0 };
    const net = partLineNetQty(p);
    if (net <= 0) return; // fully returned — nothing was consumed here
    byPart[key].dates.push(ev.event_date);
    byPart[key].totalQty += net;
    byPart[key].totalCost += net * (Number(p.unit_cost)||0);
  });
  return Object.values(byPart).map(p => {
    const sorted = [...p.dates].sort();
    let avgDaysBetween = null;
    if (sorted.length > 1) {
      const diffs = [];
      for (let i=1;i<sorted.length;i++) diffs.push((new Date(sorted[i]) - new Date(sorted[i-1])) / 86400000);
      avgDaysBetween = Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length);
    }
    return {
      code:p.code, shortDesc:p.shortDesc, fg:p.fg, timesReplaced:sorted.length, totalQty:p.totalQty,
      first:sorted[0], last:sorted[sorted.length-1], avgDaysBetween, totalCost:p.totalCost,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// RELIABILITY INDICATORS (Reports page)
// Backed by migration 030_reliability_views.sql.
//
// Framing note, deliberate and load-bearing: nothing here predicts a
// failure. Every flag is a comparison against the asset's own fleet
// peers over a fixed window, and every row carries the sample size
// and the underlying events that produced it. An engineer decides
// what it means — the UI must never imply the system already has.
// ═══════════════════════════════════════════════════════════════

const REPORT_TABS = [
  { id:'fleet',       label:'Fleet Overview' },
  { id:'flags',       label:'Reliability Indicators' },
  { id:'consumption', label:'Consumption' },
  { id:'cost',        label:'Cost' },
];

const FLAG_SEVERITY_META = {
  critical:    { label:'Critical',    color:T.danger, bg:T.dangerBg, tone:'danger',
                 blurb:'5x or more than the fleet median' },
  investigate: { label:'Investigate', color:T.danger, bg:T.dangerBg, tone:'danger',
                 blurb:'3-5x the fleet median' },
  watch:       { label:'Watch',       color:T.warn,   bg:T.warnBg,   tone:'warn',
                 blurb:'2-3x the fleet median' },
};

// Horizontal bar chart — plain SVG, matching HoursLogChart's approach
// rather than adding a charting dependency. Horizontal because the
// labels here are part codes and model names, which do not fit under
// a vertical axis without rotating them.
function BarChart({ rows, valueKey, labelKey, unit = '', color = T.accent, max = 6, emptyMsg = 'No data for this selection.' }) {
  const data = rows.slice(0, max);
  if (data.length === 0) return <div style={{ fontSize:12, color:T.muted, padding:24, textAlign:'center' }}>{emptyMsg}</div>;
  const top = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1);
  const ROW_H = 30, LABEL_W = 180, PAD_R = 66;
  const W = 720, H = data.length * ROW_H + 34;
  const barW = W - LABEL_W - PAD_R;
  // Axis ticks at 0 / half / full so the bars can actually be read as
  // quantities rather than compared only against each other.
  const ticks = [0, top / 2, top];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:H }} role="img">
      {ticks.map((t,i) => {
        const x = LABEL_W + (t / top) * barW;
        return (
          <g key={i}>
            <line x1={x} y1={16} x2={x} y2={H-18} stroke={T.border} strokeWidth="1"/>
            <text x={x} y={H-6} fontSize="10" fill={T.muted} textAnchor="middle">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        );
      })}
      {data.map((d,i) => {
        const v = Number(d[valueKey]) || 0;
        const w = (v / top) * barW;
        const y = 20 + i * ROW_H;
        return (
          <g key={i}>
            <text x={LABEL_W - 8} y={y + 14} fontSize="11" fill={T.text} textAnchor="end">
              {String(d[labelKey] ?? '').slice(0, 26)}
            </text>
            <rect x={LABEL_W} y={y + 3} width={Math.max(w, 1)} height={ROW_H - 12} fill={color} rx="2"/>
            <text x={LABEL_W + w + 6} y={y + 14} fontSize="11" fill={T.text} fontWeight="700">
              {v.toLocaleString(undefined,{maximumFractionDigits:2})}{unit}
            </text>
          </g>
        );
      })}
      <text x={LABEL_W + barW/2} y={11} fontSize="10" fill={T.muted} textAnchor="middle">
        {unit ? `Value (${unit.trim()})` : 'Value'}
      </text>
    </svg>
  );
}

function ReportsPage({ data }) {
  const { dbReady, categories, models, funcGroups, navigateTo } = data;
  const [tab, setTab] = useState('fleet');

  return (
    <div>
      <PageHeader title="Reliability Indicators"
        sub="Maintenance history turned into comparable signals — evidence for an engineer to investigate, not automated conclusions"/>

      <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' }}>
        {REPORT_TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{ padding:'7px 14px', borderRadius:6, fontSize:13, fontWeight:700, cursor:'pointer',
              fontFamily:'inherit', border:`1px solid ${tab===t.id?T.accent:T.border}`,
              background: tab===t.id?T.accent:'#fff', color: tab===t.id?'#fff':T.text }}>
            {t.label}
          </button>
        ))}
      </div>

      {!dbReady
        ? <Card><div style={{ textAlign:'center', padding:40, color:T.muted }}>🟡 Requires a live database connection.</div></Card>
        : tab === 'fleet'       ? <FleetOverviewTab navigateTo={navigateTo}/>
        : tab === 'flags'       ? <ReliabilityFlagsTab models={models} navigateTo={navigateTo}/>
        : tab === 'consumption' ? <ConsumptionTab categories={categories} models={models} funcGroups={funcGroups}/>
        :                         <CostTab models={models}/>}
    </div>
  );
}

// ─── TAB 1: FLEET OVERVIEW ────────────────────────────────────────
function FleetOverviewTab({ navigateTo }) {
  const [statusCounts, setStatusCounts] = useState({});
  const [pmDue,   setPmDue]   = useState([]);
  const [totals,  setTotals]  = useState([]);
  const [year,    setYear]    = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      db.fetchAssetsByStatus(),
      db.fetchPmDueList(),
      db.fetchAssetYearTotals(year),
    ]).then(([sc, pm, tt]) => {
      setStatusCounts(sc.data || {});
      setPmDue(pm.data || []);
      setTotals(tt.data || []);
    }).finally(()=>setLoading(false));
  }, [year]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now, now-1, now-2, now-3];
  }, []);

  const topConsumption = [...totals]
    .filter(t => Number(t.parts_qty) > 0)
    .sort((a,b) => Number(b.parts_qty) - Number(a.parts_qty)).slice(0,10);
  const topDowntime = [...totals]
    .filter(t => Number(t.downtime_hours) > 0)
    .sort((a,b) => Number(b.downtime_hours) - Number(a.downtime_hours)).slice(0,10);

  const exportCsv = () => {
    const lines = [csvRow(['Section','Key','Value'])];
    Object.entries(statusCounts).forEach(([k,v]) => lines.push(csvRow(['Assets by status', ASSET_STATUS_META[k]?.label || k, v])));
    pmDue.forEach(a => lines.push(csvRow(['PM due', a.asset_tag, `${a.hours_until_pm ?? '—'} hrs until PM`])));
    topConsumption.forEach(a => lines.push(csvRow([`Top consumption ${year}`, a.asset_tag, a.parts_qty])));
    topDowntime.forEach(a => lines.push(csvRow([`Top downtime ${year}`, a.asset_tag, a.downtime_hours])));
    downloadCsv(lines, `fleet-overview-${year}.csv`);
  };

  if (loading) return <Card><div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading fleet overview…</div></Card>;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <Card>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <label style={{ fontSize:12, color:T.muted, fontWeight:700 }}>Year</label>
          <Select value={year} onChange={e=>setYear(Number(e.target.value))} style={{ width:'auto' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
          <div style={{ marginLeft:'auto' }}>
            <Btn small variant="secondary" onClick={exportCsv}>Export CSV</Btn>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Assets by status</SectionTitle>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {Object.keys(ASSET_STATUS_META).map(k => {
            const meta = ASSET_STATUS_META[k];
            const n = statusCounts[k] || 0;
            return (
              <div key={k} onClick={()=>navigateTo('assets')} title="Open the Asset Registry"
                style={{ border:`1px solid ${T.border}`, borderTop:`3px solid ${meta.color}`, borderRadius:8,
                  padding:'10px 18px', minWidth:120, cursor:'pointer', background:T.card }}>
                <div style={{ fontSize:24, fontWeight:800, color:meta.color }}>{n}</div>
                <div style={{ fontSize:11, color:T.muted, fontWeight:700 }}>{meta.label}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle>PM due ({pmDue.length})</SectionTitle>
        {pmDue.length === 0
          ? <div style={{ fontSize:12, color:T.muted, padding:16 }}>Nothing is due — every asset is inside its PM interval.</div>
          : (
          <div style={TABLE_SCROLL}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead><tr style={{ background:T.header }}>
                {['Asset','Model','Running Hours','Hours Until PM','Interval'].map(h=>(
                  <th key={h} style={{ padding:'7px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:11, letterSpacing:0.4 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {pmDue.map((a,i)=>(
                  <tr key={a.id||i} onClick={()=>navigateTo('assetdetail',{ assetId:a.id })}
                    style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card, cursor:'pointer' }}>
                    <td style={{ padding:'7px 9px', fontFamily:'monospace', fontWeight:800, whiteSpace:'nowrap' }}>{a.asset_tag}</td>
                    <td style={{ padding:'7px 9px', color:T.muted }}>{a.model_label || a.model}</td>
                    <td style={{ padding:'7px 9px', fontVariantNumeric:'tabular-nums' }}>{a.running_hours}</td>
                    <td style={{ padding:'7px 9px', fontWeight:700, color:T.warn, fontVariantNumeric:'tabular-nums' }}>{a.hours_until_pm ?? '—'}</td>
                    <td style={{ padding:'7px 9px', color:T.muted, fontVariantNumeric:'tabular-nums' }}>{a.pm_interval_hours ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))', gap:16 }}>
        <Card>
          <SectionTitle>Top 10 by parts consumed — {year}</SectionTitle>
          <BarChart rows={topConsumption} labelKey="asset_tag" valueKey="parts_qty" max={10}
            emptyMsg={`No parts were consumed in ${year}.`}/>
        </Card>
        <Card>
          <SectionTitle>Top 10 by downtime — {year}</SectionTitle>
          <BarChart rows={topDowntime} labelKey="asset_tag" valueKey="downtime_hours" unit=" h"
            color={T.danger} max={10} emptyMsg={`No downtime was recorded in ${year}.`}/>
        </Card>
      </div>
    </div>
  );
}

// A failed fetch and an empty result look identical unless you say so.
const LoadError = ({ error }) => error ? (
  <Card style={{ borderLeft:`3px solid ${T.danger}`, background:T.dangerBg }}>
    <div style={{ fontSize:13, color:T.danger, fontWeight:700 }}>Could not load this data</div>
    <div style={{ fontSize:12, color:T.text, marginTop:4 }}>{error}</div>
    <div style={{ fontSize:11, color:T.muted, marginTop:6 }}> This is a loading failure, not an empty result — the figures below are incomplete.
    </div>
  </Card>
) : null;

const SectionTitle = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:'uppercase',
    letterSpacing:0.8, marginBottom:12 }}>{children}</div>
);

// ─── TAB 2: RELIABILITY INDICATORS ────────────────────────────────
// Every row is expandable to the events that produced it. That is not
// a nicety: a flag an engineer cannot audit is a flag they will
// (rightly) ignore.
function ReliabilityFlagsTab({ models, navigateTo }) {
  const [flags,    setFlags]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [fSev,     setFSev]     = useState('');
  const [fModel,   setFModel]   = useState('');
  const [expanded, setExpanded] = useState(null);   // flag key
  const [evidence, setEvidence] = useState({});     // key -> rows
  const [loadingEv,setLoadingEv]= useState(false);

  const keyOf = f => `${f.asset_id}|${f.fg}`;

  useEffect(() => {
    setLoading(true);
    db.fetchReliabilityFlags({ severity:fSev||undefined, model:fModel||undefined })
      .then(({ data, error }) => { setError(error ? error.message : null); setFlags(data || []); })
      .finally(()=>setLoading(false));
  }, [fSev, fModel]);

  const toggle = async (f) => {
    const k = keyOf(f);
    if (expanded === k) return setExpanded(null);
    setExpanded(k);
    if (evidence[k]) return;
    setLoadingEv(true);
    const { data } = await db.fetchFlagEvidence(f.asset_id, f.fg);
    setEvidence(e => ({ ...e, [k]: data || [] }));
    setLoadingEv(false);
  };

  const exportCsv = () => {
    const lines = [csvRow(['Asset','Model','Functional Group','Replacements (12m)',
      'Fleet Median (12m)','Fleet Avg (12m)','Peer Assets','Ratio','Severity'])];
    flags.forEach(f => lines.push(csvRow([f.asset_tag, f.asset_model, f.fg_label || f.fg,
      f.asset_replacements_12m, f.fleet_median_12m, f.fleet_avg_12m,
      f.fleet_asset_count, f.ratio_to_fleet_median, f.severity])));
    downloadCsv(lines, `reliability-indicators-${new Date().toISOString().slice(0,10)}.csv`);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <LoadError error={error}/>
      <Card style={{ background:'#f8fafc', borderLeft:`3px solid ${T.accent}` }}>
        <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>
          <strong>How to read these.</strong> An asset is listed when it replaced a functional
          group at least twice as often as other assets of the same model, over the same rolling
          12 months. They are comparisons against peers, not predictions — a flag means
          “worth a look”, never “this will fail”.
          <div style={{ marginTop:8, color:T.muted, fontSize:12 }}> A group is only compared when there are at least 3 assets of the model and the typical
            asset replaced it at least once; below that there is no basis for a comparison, so
            nothing is shown rather than a guess. Expand any row for the events behind it.
            <div style={{ marginTop:6 }}> Peers counts only assets that are not in Trash — moving an asset to Trash removes its
              history from the comparison and can change, add or clear a flag on its sisters.
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <Select value={fSev} onChange={e=>setFSev(e.target.value)} style={{ width:'auto' }}>
            <option value="">All severities</option>
            {Object.entries(FLAG_SEVERITY_META).map(([k,m])=><option key={k} value={k}>{m.label}</option>)}
          </Select>
          <Select value={fModel} onChange={e=>setFModel(e.target.value)} style={{ width:'auto' }}>
            <option value="">All models</option>
            {(models||[]).map(m=><option key={m.code} value={m.code}>{m.label||m.code}</option>)}
          </Select>
          <span style={{ fontSize:12, color:T.muted }}>{flags.length} indicator(s)</span>
          <div style={{ marginLeft:'auto' }}>
            <Btn small variant="secondary" onClick={exportCsv} disabled={flags.length===0}>Export CSV</Btn>
          </div>
        </div>
      </Card>

      <Card>
        {loading ? <div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading…</div>
        : flags.length === 0 ? (
          <div style={{ textAlign:'center', padding:40, color:T.muted, fontSize:13 }}> No indicators. Either no asset is an outlier against its peers, or there is not yet
            enough history — a comparison needs at least 3 assets of a model with replacements
            recorded against them.
          </div>
        ) : (
          <div style={TABLE_SCROLL}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead><tr style={{ background:T.header }}>
                {['','Severity','Asset','Model','Functional Group','This Asset (12m)','Fleet Median','Peers','Ratio'].map(h=>(
                  <th key={h} style={{ padding:'7px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:11, letterSpacing:0.4, lineHeight:1.25 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {flags.map((f,i) => {
                  const k = keyOf(f);
                  const meta = FLAG_SEVERITY_META[f.severity] || {};
                  const open = expanded === k;
                  return (
                    <Fragment key={k}>
                      <tr onClick={()=>toggle(f)}
                        style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card, cursor:'pointer' }}>
                        <td style={{ padding:'7px 9px', color:T.muted, width:20 }}>{open?'▾':'▸'}</td>
                        <td style={{ padding:'7px 9px' }}>
                          <StatusTag tone={meta.tone||'neutral'}>{meta.label}</StatusTag>
                        </td>
                        <td style={{ padding:'7px 9px', fontFamily:'monospace', fontWeight:800, whiteSpace:'nowrap' }}>{f.asset_tag}</td>
                        <td style={{ padding:'7px 9px', color:T.muted }}>{f.asset_model}</td>
                        <td style={{ padding:'7px 9px' }}>
                          <Pill color="#6d28d9" bg="#f5f3ff" size={11}>{f.fg}</Pill>
                          {f.fg_label && <span style={{ color:T.muted, marginLeft:6, fontSize:12 }}>{f.fg_label}</span>}
                        </td>
                        <td style={{ padding:'7px 9px', textAlign:'center', fontWeight:800, color:meta.color, fontVariantNumeric:'tabular-nums' }}>{f.asset_replacements_12m}</td>
                        <td style={{ padding:'7px 9px', textAlign:'center', color:T.muted, fontVariantNumeric:'tabular-nums' }}>{f.fleet_median_12m}</td>
                        <td style={{ padding:'7px 9px', textAlign:'center', color:T.muted, fontVariantNumeric:'tabular-nums' }} title="Assets of this model the median is taken over">{f.fleet_asset_count}</td>
                        <td style={{ padding:'7px 9px', textAlign:'center', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{f.ratio_to_fleet_median}×</td>
                      </tr>
                      {open && (
                        <tr style={{ background:'#f8fafc' }}>
                          <td colSpan={9} style={{ padding:'12px 16px', borderBottom:`1px solid ${T.border}` }}>
                            <div style={{ fontSize:12, color:T.muted, marginBottom:8 }}> Why this fired: <strong style={{ color:T.text }}>{f.asset_tag}</strong> replaced{' '}
                              <strong style={{ color:T.text }}>{f.fg_label || f.fg}</strong> parts{' '}
                              <strong style={{ color:T.text }}>{f.asset_replacements_12m}</strong> times in the last 12 months,
                              against a median of <strong style={{ color:T.text }}>{f.fleet_median_12m}</strong> across{' '}
                              <strong style={{ color:T.text }}>{f.fleet_asset_count}</strong> assets of model{' '}
                              <strong style={{ color:T.text }}>{f.asset_model}</strong> — {f.ratio_to_fleet_median}× the median.
                            </div>
                            {loadingEv && !evidence[k]
                              ? <div style={{ fontSize:12, color:T.muted }}>Loading the underlying events…</div>
                              : (evidence[k] || []).length === 0
                                ? <div style={{ fontSize:12, color:T.muted }}>No individual events found.</div>
                                : (
                              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, background:T.card }}>
                                <thead><tr style={{ background:T.subtle }}>
                                  {['Date','Work Order','Event','Part','Qty','Failure Mode'].map(h=>(
                                    <th key={h} style={{ padding:'6px 8px', textAlign:'left', fontWeight:700, color:T.muted, fontSize:10, textTransform:'uppercase', letterSpacing:0.4 }}>{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody>
                                  {(evidence[k]||[]).map((e,j)=>(
                                    <tr key={j} style={{ borderBottom:`1px solid ${T.border}` }}>
                                      <td style={{ padding:'6px 8px', whiteSpace:'nowrap', color:T.muted }}>{e.event_date}</td>
                                      <td style={{ padding:'6px 8px', fontFamily:'monospace', fontSize:11 }}>{e.work_order_no||'—'}</td>
                                      <td style={{ padding:'6px 8px' }}>{e.event_title}</td>
                                      <td style={{ padding:'6px 8px', fontFamily:'monospace', fontSize:11 }}>{e.part_code}</td>
                                      <td style={{ padding:'6px 8px', textAlign:'center', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{e.net_qty}</td>
                                      <td style={{ padding:'6px 8px', color:T.muted }}>{e.failure_mode||'—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <div style={{ marginTop:10 }}>
                              <Btn small variant="secondary" onClick={(ev)=>{ ev.stopPropagation(); navigateTo('assetdetail',{ assetId:f.asset_id }); }}> Open {f.asset_tag} →
                              </Btn>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── TAB 3: CONSUMPTION ───────────────────────────────────────────
function ConsumptionTab({ categories, models, funcGroups }) {
  const today = new Date();
  const yearAgo = new Date(today.getTime() - 365*86400000);
  const [from,  setFrom]  = useState(yearAgo.toISOString().slice(0,10));
  const [to,    setTo]    = useState(today.toISOString().slice(0,10));
  const [groupBy, setGroupBy] = useState('fg');   // fg | part_cat | asset_model | part_code
  const [fModel, setFModel] = useState('');
  const [fCat,   setFCat]   = useState('');
  const [fFg,    setFFg]    = useState('');
  const [rows,   setRows]   = useState([]);
  const [loading,setLoading]= useState(true);
  const [error,  setError]  = useState(null);

  useEffect(() => {
    setLoading(true);
    db.fetchConsumption({ from, to, model:fModel||undefined, cat:fCat||undefined, fg:fFg||undefined })
      .then(({ data, error }) => { setError(error ? error.message : null); setRows(data || []); })
      .finally(()=>setLoading(false));
  }, [from, to, fModel, fCat, fFg]);

  const GROUPS = [
    { id:'fg',          label:'Functional Group' },
    { id:'part_cat',    label:'Category' },
    { id:'asset_model', label:'Equipment Model' },
    { id:'part_code',   label:'Part' },
  ];

  // Rolled up here rather than in SQL — see CONSUMPTION_ROW_CAP.
  const grouped = useMemo(() => {
    const by = {};
    rows.forEach(r => {
      const key = r[groupBy] || '—';
      if (!by[key]) by[key] = { key, qty:0, cost:0, lines:0, label:key };
      by[key].qty  += Number(r.net_qty) || 0;
      by[key].cost += Number(r.line_cost) || 0;
      by[key].lines += 1;
    });
    // Friendlier labels where the code alone is cryptic.
    Object.values(by).forEach(g => {
      if (groupBy === 'asset_model') g.label = models?.find(m=>m.code===g.key)?.label || g.key;
      if (groupBy === 'part_cat')    g.label = categories?.find(c=>c.code===g.key)?.label || g.key;
      if (groupBy === 'fg')          g.label = funcGroups?.find(f=>f.code===g.key)?.label || g.key;
    });
    return Object.values(by).sort((a,b)=>b.qty-a.qty);
  }, [rows, groupBy, models, categories, funcGroups]);

  const totalQty  = grouped.reduce((s,g)=>s+g.qty,0);
  const totalCost = grouped.reduce((s,g)=>s+g.cost,0);
  const capped = rows.length >= db.CONSUMPTION_ROW_CAP;

  const exportCsv = () => {
    const lines = [csvRow([GROUPS.find(g=>g.id===groupBy).label,'Code','Quantity','Cost','Lines'])];
    grouped.forEach(g => lines.push(csvRow([g.label, g.key, g.qty, g.cost.toFixed(2), g.lines])));
    downloadCsv(lines, `consumption-${groupBy}-${from}_to_${to}.csv`);
  };

  const selStyle = { width:'auto' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <LoadError error={error}/>
      <Card>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <label style={{ fontSize:12, color:T.muted, fontWeight:700 }}>From</label>
          <Input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{ width:'auto' }}/>
          <label style={{ fontSize:12, color:T.muted, fontWeight:700 }}>To</label>
          <Input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{ width:'auto' }}/>
          <Select value={groupBy} onChange={e=>setGroupBy(e.target.value)} style={selStyle}>
            {GROUPS.map(g=><option key={g.id} value={g.id}>Group by {g.label}</option>)}
          </Select>
          <Select value={fModel} onChange={e=>setFModel(e.target.value)} style={selStyle}>
            <option value="">All models</option>
            {(models||[]).map(m=><option key={m.code} value={m.code}>{m.label||m.code}</option>)}
          </Select>
          <Select value={fCat} onChange={e=>setFCat(e.target.value)} style={selStyle}>
            <option value="">All categories</option>
            {(categories||[]).map(c=><option key={c.code} value={c.code}>{c.label||c.code}</option>)}
          </Select>
          <Select value={fFg} onChange={e=>setFFg(e.target.value)} style={selStyle}>
            <option value="">All functional groups</option>
            {(funcGroups||[]).map(f=><option key={f.code} value={f.code}>{f.label||f.code}</option>)}
          </Select>
          <div style={{ marginLeft:'auto' }}>
            <Btn small variant="secondary" onClick={exportCsv} disabled={grouped.length===0}>Export CSV</Btn>
          </div>
        </div>
        {capped && (
          <div style={{ marginTop:10, fontSize:12, color:T.warn, background:T.warnBg, padding:'8px 12px', borderRadius:6 }}>
            ⚠️ This period returned the maximum of {db.CONSUMPTION_ROW_CAP.toLocaleString()} lines, so the
            totals below cover only part of it. Narrow the date range for an exact figure.
          </div>
        )}
      </Card>

      {loading ? <Card><div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading consumption…</div></Card> : (
      <>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:14 }}>
          <StatCard label="Parts consumed" value={totalQty.toLocaleString(undefined,{maximumFractionDigits:2})} icon=""/>
          <StatCard label="Total cost" value={totalCost.toLocaleString(undefined,{maximumFractionDigits:2})} icon="💰" color={T.success}/>
          <StatCard label="Distinct groups" value={grouped.length} icon="🧩" color="#6d28d9"/>
          <StatCard label="Job lines" value={rows.length} icon="🧾" color={T.muted}/>
        </div>

        <Card>
          <SectionTitle>Quantity consumed by {GROUPS.find(g=>g.id===groupBy).label.toLowerCase()} — top 6</SectionTitle>
          <BarChart rows={grouped} labelKey="label" valueKey="qty" max={6}
            emptyMsg="Nothing was consumed in this period."/>
        </Card>

        <Card>
          <SectionTitle>All groups ({grouped.length})</SectionTitle>
          <div style={TABLE_SCROLL}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead><tr style={{ background:T.header }}>
                {[GROUPS.find(g=>g.id===groupBy).label,'Code','Quantity','Cost','Job Lines','Share'].map(h=>(
                  <th key={h} style={{ padding:'7px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:11, letterSpacing:0.4 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {grouped.length===0
                  ? <tr><td colSpan={6} style={{ textAlign:'center', padding:36, color:T.muted }}>Nothing consumed in this period.</td></tr>
                  : grouped.map((g,i)=>(
                  <tr key={g.key} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                    <td style={{ padding:'7px 9px', fontWeight:600 }}>{g.label}</td>
                    <td style={{ padding:'7px 9px', fontFamily:'monospace', fontSize:12, color:T.muted }}>{g.key}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{g.qty.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{g.cost.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', color:T.muted, fontVariantNumeric:'tabular-nums' }}>{g.lines}</td>
                    <td style={{ padding:'7px 9px', color:T.muted, fontVariantNumeric:'tabular-nums' }}>
                      {totalQty ? `${((g.qty/totalQty)*100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>
      )}
    </div>
  );
}

// ─── TAB 4: COST ──────────────────────────────────────────────────
function CostTab({ models }) {
  const thisYear = new Date().getFullYear();
  const [year,   setYear]   = useState(thisYear);
  const [fModel, setFModel] = useState('');
  const [rows,   setRows]   = useState([]);
  const [loading,setLoading]= useState(true);
  const [error,  setError]  = useState(null);

  useEffect(() => {
    setLoading(true);
    db.fetchAssetYearTotals(null)
      .then(({ data, error }) => { setError(error ? error.message : null); setRows(data || []); })
      .finally(()=>setLoading(false));
  }, []);

  const years = useMemo(
    () => [...new Set(rows.map(r=>r.year))].sort((a,b)=>b-a),
    [rows]);

  const filtered = rows.filter(r => !fModel || r.asset_model === fModel);
  const cur  = filtered.filter(r => r.year === year);
  const prev = filtered.filter(r => r.year === year - 1);
  const prevByAsset = Object.fromEntries(prev.map(r => [r.asset_id, r]));

  const sum = (list, k) => list.reduce((s,r)=>s+(Number(r[k])||0),0);
  const curCost = sum(cur,'parts_cost'), prevCost = sum(prev,'parts_cost');
  const delta = prevCost ? ((curCost - prevCost) / prevCost) * 100 : null;

  const table = [...cur].sort((a,b)=>Number(b.parts_cost)-Number(a.parts_cost));

  const exportCsv = () => {
    const lines = [csvRow(['Asset','Model','Year','Parts Cost','Parts Qty','Events',
      'Downtime Hours','Hours Run','Cost / Running Hour',`Parts Cost ${year-1}`,'Change %'])];
    table.forEach(r => {
      const p = prevByAsset[r.asset_id];
      const pc = p ? Number(p.parts_cost) : null;
      const ch = pc ? (((Number(r.parts_cost)-pc)/pc)*100).toFixed(1) : '';
      lines.push(csvRow([r.asset_tag, r.asset_model, r.year, r.parts_cost, r.parts_qty,
        r.event_count, r.downtime_hours, r.hours_run ?? '', r.cost_per_running_hour ?? '',
        pc ?? '', ch]));
    });
    downloadCsv(lines, `cost-${year}.csv`);
  };

  if (loading) return <Card><div style={{ textAlign:'center', padding:40, color:T.muted }}>Loading cost data…</div></Card>;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <LoadError error={error}/>
      <Card>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <label style={{ fontSize:12, color:T.muted, fontWeight:700 }}>Year</label>
          <Select value={year} onChange={e=>setYear(Number(e.target.value))} style={{ width:'auto' }}>
            {(years.length?years:[thisYear]).map(y=><option key={y} value={y}>{y}</option>)}
          </Select>
          <Select value={fModel} onChange={e=>setFModel(e.target.value)} style={{ width:'auto' }}>
            <option value="">All models</option>
            {(models||[]).map(m=><option key={m.code} value={m.code}>{m.label||m.code}</option>)}
          </Select>
          <div style={{ marginLeft:'auto' }}>
            <Btn small variant="secondary" onClick={exportCsv} disabled={table.length===0}>Export CSV</Btn>
          </div>
        </div>
      </Card>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:14 }}>
        <StatCard label={`Parts cost ${year}`} value={curCost.toLocaleString(undefined,{maximumFractionDigits:2})} icon="💰"/>
        <StatCard label={`Parts cost ${year-1}`} value={prevCost.toLocaleString(undefined,{maximumFractionDigits:2})} icon="🗓️" color={T.muted}/>
        <StatCard label="Year over year"
          value={delta === null ? '—' : `${delta>0?'+':''}${delta.toFixed(1)}%`}
          icon={delta === null ? '➖' : delta > 0 ? '📈' : '📉'}
          color={delta === null ? T.muted : delta > 0 ? T.danger : T.success}/>
        <StatCard label={`Downtime ${year}`} value={`${sum(cur,'downtime_hours').toLocaleString(undefined,{maximumFractionDigits:1})} h`} icon="⏸" color={T.warn}/>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))', gap:16 }}>
        <Card>
          <SectionTitle>Parts cost by asset — {year}, top 6</SectionTitle>
          <BarChart rows={table} labelKey="asset_tag" valueKey="parts_cost" max={6}
            emptyMsg={`No parts cost recorded in ${year}.`}/>
        </Card>
        <Card>
          <SectionTitle>Cost per running hour — {year}, top 6</SectionTitle>
          <BarChart
            rows={table.filter(r=>r.cost_per_running_hour!=null)
                       .sort((a,b)=>Number(b.cost_per_running_hour)-Number(a.cost_per_running_hour))}
            labelKey="asset_tag" valueKey="cost_per_running_hour" unit=" /h" color="#6d28d9" max={6}
            emptyMsg={`No hours were logged in ${year}, so a per-hour rate cannot be computed.`}/>
        </Card>
      </div>

      <Card>
        <SectionTitle>Cost per asset — {year} vs {year-1}</SectionTitle>
        <div style={TABLE_SCROLL}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead><tr style={{ background:T.header }}>
              {['Asset','Model','Parts Cost','Qty','Events','Downtime','Hours Run','Cost / Hour',`${year-1} Cost`,'Change'].map(h=>(
                <th key={h} style={{ padding:'7px 9px', textAlign:'left', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', fontSize:11, letterSpacing:0.4, lineHeight:1.25 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {table.length===0
                ? <tr><td colSpan={10} style={{ textAlign:'center', padding:36, color:T.muted }}>Nothing recorded for {year}.</td></tr>
                : table.map((r,i)=>{
                const p = prevByAsset[r.asset_id];
                const pc = p ? Number(p.parts_cost) : null;
                const ch = pc ? ((Number(r.parts_cost)-pc)/pc)*100 : null;
                return (
                  <tr key={r.asset_id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2?T.subtle:T.card }}>
                    <td style={{ padding:'7px 9px', fontFamily:'monospace', fontWeight:800, whiteSpace:'nowrap' }}>{r.asset_tag}</td>
                    <td style={{ padding:'7px 9px', color:T.muted }}>{r.asset_model}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{Number(r.parts_cost).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{r.parts_qty}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{r.event_count}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{Number(r.downtime_hours).toLocaleString(undefined,{maximumFractionDigits:1})}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', color:T.muted, fontVariantNumeric:'tabular-nums' }}
                      title={r.hours_run==null?'No hours logged for this asset in this year':''}>
                      {r.hours_run==null?'—':Number(r.hours_run).toLocaleString(undefined,{maximumFractionDigits:1})}
                    </td>
                    <td style={{ padding:'7px 9px', textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{r.cost_per_running_hour ?? '—'}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', color:T.muted, fontVariantNumeric:'tabular-nums' }}>{pc==null?'—':pc.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                    <td style={{ padding:'7px 9px', textAlign:'center', fontWeight:700, fontVariantNumeric:'tabular-nums',
                      color: ch==null?T.muted: ch>0?T.danger:T.success }}>
                      {ch==null?'—':`${ch>0?'+':''}${ch.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const NAV = [
  { id:"dashboard",     labelKey:"nav_dashboard",     label:"Dashboard",           icon:"dashboard", group:"",            groupKey:"",            adminOnly:false },
  { id:"framework",     labelKey:"nav_framework",     label:"Coding Framework",    icon:"framework", group:"Reference",   groupKey:"group_Reference",   adminOnly:false },
  { id:"categories",    labelKey:"nav_categories",    label:"Main Categories",     icon:"category", group:"Reference",   groupKey:"group_Reference",   adminOnly:false },
  { id:"disciplines",   labelKey:"nav_disciplines",   label:"Disciplines",         icon:"discipline", group:"Reference",   groupKey:"group_Reference",   adminOnly:false },
  { id:"manufacturers", labelKey:"nav_manufacturers", label:"Manufacturers",       icon:"manufacturer", group:"Master Data", groupKey:"group_MasterData",  adminOnly:false },
  { id:"models",        labelKey:"nav_models",        label:"Equipment Models",    icon:"model", group:"Master Data", groupKey:"group_MasterData",  adminOnly:false },
  { id:"funcgroups",    labelKey:"nav_funcgroups",    label:"Functional Groups",   icon:"funcgroup", group:"Master Data", groupKey:"group_MasterData",  adminOnly:false },
  { id:"generator",     labelKey:"nav_generator",     label:"Code Generator",      icon:"generator", group:"Tools",       groupKey:"group_Tools",        adminOnly:false },
  { id:"tree",          labelKey:"nav_tree",          label:"Hierarchy Tree",      icon:"tree", group:"Tools",       groupKey:"group_Tools",        adminOnly:false },
  { id:"master",        labelKey:"nav_master",        label:"Master Parts Table",  icon:"master", group:"Inventory",   groupKey:"group_Inventory",    adminOnly:false },
  { id:"ledger",        labelKey:"nav_ledger",        label:"Stock Ledger",        icon:"ledger", group:"Inventory",   groupKey:"group_Inventory",    adminOnly:false },
  { id:"stockcount",    labelKey:"nav_stockcount",    label:"Stock Count",         icon:"stockcount", group:"Inventory",   groupKey:"group_Inventory",    adminOnly:false },
  { id:"movements",     labelKey:"nav_movements",     label:"Stock Movements",     icon:"movements", group:"Inventory",   groupKey:"group_Inventory",    adminOnly:false },
  { id:"reorder",       labelKey:"nav_reorder",       label:"Reorder Settings",    icon:"reorder", group:"Inventory",   groupKey:"group_Inventory",    adminOnly:false },
  { id:"alerts",        labelKey:"nav_alerts",        label:"Stock Alerts",        icon:"alerts", group:"Inventory",   groupKey:"group_Inventory",    adminOnly:false },
  { id:"assets",        labelKey:"nav_assets",        label:"Asset Registry",      icon:"assets", group:"Assets",      groupKey:"group_Assets",       adminOnly:false },
  { id:"reports",       labelKey:"nav_reports",       label:"Reliability Indicators", icon:"reports", group:"Assets",      groupKey:"group_Assets",       adminOnly:false },
  { id:"admin",         labelKey:"nav_admin",         label:"Administration",      icon:"admin", group:"System",      groupKey:"group_System",       adminOnly:true  },
  { id:"auditlog",      labelKey:"nav_auditlog",      label:"Audit Log",           icon:"auditlog", group:"System",      groupKey:"group_System",       adminOnly:true  },
  { id:"users",         labelKey:"nav_users",         label:"User Management",     icon:"users", group:"System",      groupKey:"group_System",       adminOnly:true  },
  { id:"trash",         labelKey:"nav_trash",         label:"Trash",                icon:"trash", group:"System",     groupKey:"group_System",       adminOnly:true  },
];

// Pages whose main content is a wide table, plus the Dashboard. The
// sidebar auto-collapses on these: its 228px is exactly the difference
// between all 14 Master Table columns fitting and the last two hiding
// behind a horizontal scrollbar on a 1366px screen. Every other page
// gets the labelled sidebar back.
const WIDE_PAGES = new Set([
  'dashboard', 'master', 'ledger', 'stockcount', 'movements', 'reorder',
  'alerts', 'assets', 'assetdetail', 'reports', 'auditlog', 'users', 'trash',
]);

// ═══════════════════════════════════════════════════════════════
// APP SHELL (rendered after auth check)
// ═══════════════════════════════════════════════════════════════

function AppShell() {
  const { profile, isAdmin, signOut } = useAuth();
  const { t, lang, toggleLang } = useLang();
  const [page,      setPage]      = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [navFilter, setNavFilter] = useState(null); // one-shot filter payload for the next page

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
    // Switches the active sidebar page, optionally carrying a one-shot
    // filter payload the destination page reads on mount then clears
    // via clearNavFilter() (e.g. Dashboard tiles, Part Detail's "View
    // all movements" link pre-filtering the Stock Movements page).
    navigateTo: (pageId, filter=null) => { setNavFilter(filter); setPage(pageId); },
    navFilter,
    clearNavFilter: () => setNavFilter(null),
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

  // Runs on navigation only — a manual collapse/expand stays put until
  // you move to another page.
  useEffect(() => { setCollapsed(WIDE_PAGES.has(effectivePage)); }, [effectivePage]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    ledger:        <StockLedgerPage data={data} />,
    stockcount:    <StockCountPage data={data} />,
    movements:     <StockMovementsPage data={data} />,
    reorder:       <ReorderSettingsPage data={data} />,
    alerts:        <StockAlertsPage data={data} />,
    assets:        <AssetRegistryPage data={data} />,
    assetdetail:   <AssetDetailPage data={data} />,
    reports:       <ReportsPage data={data} />,
    admin:         <AdminPage data={data} />,
    auditlog:      <AuditLogPage />,
    users:         <UsersPage />,
    trash:         <TrashPage />,
  };

  const roleColor = { admin:'#1d4ed8', department_user:'#047857' };
  const roleBg    = { admin:'#dbeafe', department_user:'#d1fae5' };

  return (
    <AlertsProvider dbReady={dbReady}>
    <div style={{ display:"flex",height:"100vh",fontFamily:T.sans,background:T.bg,overflow:"hidden" }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width:collapsed?56:224,background:T.sidebar,transition:"width .2s",flexShrink:0,display:"flex",flexDirection:"column",overflowY:"auto",overflowX:"hidden" }}>
        <div style={{ padding:"16px 14px",borderBottom:`1px solid ${T.sidebarBorder}`,display:"flex",alignItems:"center",gap:10,minHeight:60 }}>
          <img src="/logo.png" alt="CarGas" style={{ width:28,height:28,objectFit:"contain",flexShrink:0 }}/>
          {!collapsed&&(
            <div>
              <div style={{ color:T.sidebarTextActive,fontWeight:600,fontSize:13,lineHeight:1.2 }}>{t('appName')}</div>
              <div style={{ color:T.sidebarGroup,fontFamily:T.mono,fontSize:10 }}>{t('appVersion')}</div>
            </div>
          )}
        </div>

        <SidebarNav
          visibleNav={visibleNav} groups={groups} collapsed={collapsed}
          effectivePage={effectivePage} setPage={setPage} t={t}
        />

      </div>

      {/* ── MAIN ── */}
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
        <div style={{ background:T.card,borderBottom:`1px solid ${T.border}`,padding:"0 24px",minHeight:52,display:"flex",alignItems:"center",gap:16,flexShrink:0 }}>
          <button onClick={()=>setCollapsed(c=>!c)}
            title={`${collapsed?t('expand'):t('collapse')}  (Ctrl+B)`}
            aria-label={collapsed?t('expand'):t('collapse')}
            style={{ background:"transparent",border:`1px solid ${T.border}`,borderRadius:T.radius,padding:"6px 8px",lineHeight:0,color:T.text,cursor:"pointer",fontFamily:"inherit",flexShrink:0 }}>
            <Icon name="menu" size={16} />
          </button>
          {/* Breadcrumb replaces the constant strapline, which repeated
              the same sentence on all 22 pages while the page title was
              already restated as an H1 immediately below it. */}
          <div style={{ display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.muted,minWidth:0 }}>
            {(() => {
              const n = NAV.find(n=>n.id===effectivePage);
              const grp = n?.groupKey ? t(n.groupKey) : null;
              return (
                <>
                  {grp && <><span style={{ whiteSpace:"nowrap" }}>{grp}</span><span aria-hidden="true">/</span></>}
                  <span style={{ fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                    {(n?.labelKey && t(n.labelKey)) || n?.label}
                  </span>
                </>
              );
            })()}
          </div>
          <div style={{ marginLeft:"auto",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
            <button onClick={toggleLang} title="Switch language / تغيير اللغة"
              style={{ background:"transparent",border:`1px solid ${T.border}`,borderRadius:T.radius,padding:"5px 9px",...TYPE.button,color:T.text,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6 }}>
              <Icon name="globe" size={13} /> {lang === 'en' ? 'العربية' : 'English'}
            </button>
            {/* Connection state IS a state, so it keeps semantic colour. */}
            {dbReady
              ? <span style={{ ...TYPE.label,fontSize:9.5,background:T.successBg,color:T.success,padding:"4px 8px",borderRadius:T.radius,border:`1px solid ${T.successBorder}` }}>{t('liveDb')}</span>
              : <span style={{ ...TYPE.label,fontSize:9.5,background:T.warnBg,color:T.warn,padding:"4px 8px",borderRadius:T.radius,border:`1px solid ${T.warnBorder}` }}>{t('local')}</span>
            }
            <AlertBell navigateTo={data.navigateTo} />
            {/* Role is identity, not state — so it is neutral now, with
                the role spelled out rather than encoded as a colour. */}
            {profile && (
              <span style={{ background:T.subtle,border:`1px solid ${T.border}`,color:T.textSecondary,fontSize:11.5,padding:"4px 10px",borderRadius:T.radius,display:"flex",alignItems:"center",gap:6 }}>
                <Icon name={profile.role==='admin'?'admin':'users'} size={12} />
                <span style={{ fontWeight:600,color:T.text }}>{profile.full_name||profile.email?.split('@')[0]}</span>
                <span style={{ color:T.muted }}>· {profile.role==='admin'?'Admin':'Dept. user'}</span>
              </span>
            )}
            <button onClick={signOut}
              style={{ background:"transparent",border:`1px solid ${T.border}`,borderRadius:T.radius,padding:"5px 10px",...TYPE.button,fontWeight:400,color:T.muted,cursor:"pointer",fontFamily:"inherit" }}>
              {t('signOut')}
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ height:3,background:`linear-gradient(90deg,${T.accent},#38bdf8)`,flexShrink:0 }}/>
        )}

        <div style={{ flex:1,overflowY:"auto",padding:24 }}>
          {pageMap[effectivePage]}
        </div>
      </div>
    </div>
    </AlertsProvider>
  );
}

// ═══════════════════════════════════════════════════════════════
// APP ROOT — Auth gate
// ═══════════════════════════════════════════════════════════════

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </LanguageProvider>
  );
}

function AuthGate() {
  const { session } = useAuth();
  const { t } = useLang();
  const supabaseConfigured = !!(
    import.meta.env.VITE_SUPABASE_URL &&
    !import.meta.env.VITE_SUPABASE_URL.includes('your-project')
  );

  // Still loading session
  if (session === undefined) {
    return (
      <div style={{ minHeight:'100vh',background:'#0c1526',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter',system-ui,sans-serif" }}>
        <div style={{ color:'#475569',fontSize:14 }}>{t('loading')}</div>
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

// Split out of AppShell so it can read the alert count: AppShell
// renders AlertsProvider, so its own body sits outside that context.
function SidebarNav({ visibleNav, groups, collapsed, effectivePage, setPage, t }) {
  const alerts = useAlerts();
  const badgeFor = id => (id === 'alerts' ? (alerts?.badgeCount || 0) : 0);
  return (
    <nav aria-label="Main" style={{ flex:1,padding:"8px 0" }}>
      {[visibleNav[0]].map(n=>(
        <NavItem key={n.id} n={n} active={effectivePage===n.id} onClick={()=>setPage(n.id)} collapsed={collapsed} badge={badgeFor(n.id)} />
      ))}
      {groups.map(g=>(
        <div key={g}>
          {!collapsed&&(
            <div style={{ ...TYPE.label,fontSize:9.5,letterSpacing:"0.13em",color:T.sidebarGroup,padding:"16px 14px 6px" }}>
              {t('group_'+g.replace(/\s+/g,''))}
            </div>
          )}
          {visibleNav.filter(n=>n.group===g).map(n=>(
            <NavItem key={n.id} n={n} active={effectivePage===n.id} onClick={()=>setPage(n.id)} collapsed={collapsed} badge={badgeFor(n.id)} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function NavItem({ n, active, onClick, collapsed, badge = 0 }) {
  const { t } = useLang();
  const [hover, setHover] = useState(false);
  const label = n.labelKey ? t(n.labelKey) : n.label;
  const badgeLabel = badge > 99 ? '99+' : String(badge);
  return (
    <div
      onClick={onClick} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onClick(); } }}
      role="link" tabIndex={0}
      // The tooltip is always present, not only when collapsed: in the
      // 52px rail it is the only way to name the destination.
      title={collapsed ? (badge ? `${label} — ${badge} unacknowledged` : label) : ""}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"7px 14px", minHeight:34, cursor:"pointer",
        background: active ? T.sidebarActive : hover ? T.sidebarHover : "transparent",
        borderLeft: `2px solid ${active ? T.sidebarMarker : "transparent"}`,
        color: active ? T.sidebarTextActive : T.sidebarText,
        transition:"background .12s",
        position:"relative",
      }}>
      <Icon name={n.icon} size={15} />
      {!collapsed && <span style={{ fontSize:12.5,fontWeight:active?600:400,whiteSpace:"nowrap" }}>{label}</span>}
      {/* Alert count. Collapsed, it shrinks to a dot on the icon so the
          rail still signals that something needs attention. */}
      {badge > 0 && (collapsed ? (
        <span aria-hidden="true" style={{ position:"absolute",top:6,right:8,width:7,height:7,borderRadius:"50%",background:T.danger,border:`1px solid ${T.sidebar}` }}/>
      ) : (
        <span style={{ marginLeft:"auto",background:T.danger,color:"#fff",fontFamily:T.mono,fontSize:10,fontWeight:600,padding:"2px 5px",borderRadius:8,lineHeight:1 }}>
          {badgeLabel}
        </span>
      ))}
    </div>
  );
}

// Severity is the one place semantic colour is fully spent. The emoji
// dots rendered at a different size on every OS and carried no
// accessible name; a painted dot inherits the token colour and pairs
// with the label beside it, so severity never depends on colour alone.
const SeverityDot = ({ color, size = 8 }) => (
  <span aria-hidden="true" style={{ display:"inline-block",width:size,height:size,borderRadius:"50%",background:color,flexShrink:0 }}/>
);

const ALERT_SEVERITY_META = {
  out:      { label:'Out of Stock', color:T.danger,  tone:'danger' },
  critical: { label:'Critical',     color:T.danger,  tone:'danger' },
  low:      { label:'Low Stock',    color:T.warn,    tone:'warn' },
};

// Header bell — badge counts only unacknowledged out+critical (low is
// deliberately excluded from the badge per spec, so it stays a
// meaningful "needs action now" count), dropdown shows the top 10
// across all three severities.
function AlertBell({ navigateTo }) {
  const alerts = useAlerts();
  const [open, setOpen] = useState(false);
  const [top,  setTop]  = useState([]);
  const [loadingTop, setLoadingTop] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoadingTop(true);
    db.fetchActiveAlerts({}, 0, 10).then(({ data }) => setTop(data || [])).finally(()=>setLoadingTop(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEscape = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const badgeCount = alerts.badgeCount;
  const badgeLabel = badgeCount > 99 ? '99+' : String(badgeCount);

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button
        onClick={()=>setOpen(o=>!o)}
        aria-label={`Stock alerts${badgeCount?`, ${badgeCount} unacknowledged`:''}`}
        aria-haspopup="menu" aria-expanded={open}
        style={{ position:'relative', background:'transparent', border:`1px solid ${T.border}`, borderRadius:6, padding:'4px 9px', fontSize:14, cursor:'pointer', color: badgeCount ? T.text : T.muted }}>
        🔔
        {badgeCount > 0 && (
          <span style={{ position:'absolute', top:-6, right:-6, background:'#DC2626', color:'#fff', borderRadius:10, fontSize:10, fontWeight:800, padding:'1px 5px', minWidth:16, textAlign:'center', lineHeight:'14px' }}>
            {badgeLabel}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" style={{ position:'absolute', top:'calc(100% + 6px)', right:0, width:340, maxHeight:420, overflowY:'auto', background:T.card, border:`1px solid ${T.border}`, borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,0.15)', zIndex:50 }}>
          <div style={{ padding:'10px 14px', borderBottom:`1px solid ${T.border}`, fontWeight:700, fontSize:13, color:T.text }}>Stock Alerts</div>
          {loadingTop ? (
            <div style={{ padding:20, textAlign:'center', color:T.muted, fontSize:12 }}>Loading…</div>
          ) : top.length === 0 ? (
            <div style={{ padding:20, textAlign:'center', color:T.muted, fontSize:12 }}>No active alerts — all stock levels are healthy ✅</div>
          ) : (
            top.map(r => {
              const meta = ALERT_SEVERITY_META[r.stock_status] || { color:T.muted, tone:'neutral' };
              return (
                <div key={r.part_id} role="menuitem" style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12 }}>
                  <SeverityDot color={meta.color} />
                  <span style={{ fontFamily:'monospace', fontWeight:700, color:T.text }}>{r.code}</span>
                  <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:T.muted }}>{r.short_desc}</span>
                  <span style={{ fontVariantNumeric:'tabular-nums', color:meta.color, fontWeight:700 }}>{r.qty_on_hand}/{r.reorder_point}</span>
                </div>
              );
            })
          )}
          <div style={{ padding:10 }}>
            <Btn small onClick={()=>{ setOpen(false); navigateTo && navigateTo('alerts'); }} style={{ width:'100%' }}>View all alerts</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

