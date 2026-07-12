import React, { useState, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// MASTER DATA STORE
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
  const { categories, manufacturers, models, disciplines, funcGroups, parts } = data;

  const catCounts = categories.map(c => ({
    ...c,
    count: parts.filter(p => p.cat === c.code).length,
  }));

  const recentParts = [...parts].slice(-6).reverse();

  return (
    <div>
      <PageHeader title="Dashboard" sub="Engineering Spare Parts Master Coding System — Overview" />

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Parts" value={parts.length} color={T.accent} icon="🔩" />
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
                <span style={{ fontSize: 13, fontWeight: 700, color: c.color }}>{c.count}</span>
              </div>
              <div style={{ background: "#e2e8f0", borderRadius: 4, height: 6 }}>
                <div style={{ background: c.color, height: 6, borderRadius: 4, width: `${parts.length ? (c.count / parts.length) * 100 : 0}%`, transition: "width .5s" }} />
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
function CategoriesPage({ data }) {
  const { categories, setCategories, parts } = data;
  const cols = [
    { key:"code", label:"Code", render: r=><Pill>{r.code}</Pill> },
    { key:"label", label:"Category Name", style:{fontWeight:600,color:T.text} },
    { key:"icon", label:"Icon" },
    { key:"parts", label:"Parts", render: r=><strong style={{color:T.accent}}>{parts.filter(p=>p.cat===r.code).length}</strong> },
    { key:"actions", label:"Actions", render:(r,edit,del)=>(
      <div style={{display:"flex",gap:6}}>
        <Btn small variant="secondary" onClick={()=>edit(r)}>Edit</Btn>
        <Btn small variant="danger" onClick={()=>del(r.code)}>Delete</Btn>
      </div>
    )},
  ];
  return (
    <CrudPage
      title="Main Categories (AA)" sub="Manage top-level equipment categories — first code segment"
      items={categories} setItems={setCategories}
      fields={[
        {key:"code",label:"Code (2 chars)",placeholder:"e.g. CP",maxLength:2},
        {key:"label",label:"Category Name",placeholder:"e.g. Compressors"},
        {key:"icon",label:"Icon Emoji",placeholder:"e.g. ⚙️"},
      ]}
      renderRow={(rows, edit, del) => (
        <Table cols={cols.map(c=>c.key==="actions"?{...c,render:r=>c.render(r,edit,del)}:c)} rows={rows} />
      )}
      newItemDefaults={{code:"",label:"",icon:"📦",color:T.accent,bg:T.accentLight}}
      validateFn={(f,items,editing)=>{
        if(!f.code||!f.label) return "Code and Name are required";
        if(f.code.length!==2) return "Code must be exactly 2 characters";
      }}
      legendItems={categories.map(c=>({code:c.code,label:c.label}))}
    />
  );
}

// ─── MANUFACTURERS ADMIN ──────────────────────────────────────
function ManufacturersPage({ data }) {
  const { manufacturers, setManufacturers, categories } = data;
  const cols = [
    { key:"code", label:"Code", render:r=><Pill>{r.code}</Pill> },
    { key:"label", label:"Manufacturer", style:{fontWeight:600,color:T.text} },
    { key:"catCodes", label:"Equipment Type", render:r=>(
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        {(r.catCodes||[]).map(c=>{const cat=categories.find(x=>x.code===c); return <Pill key={c} color={cat?.color||T.muted} bg={cat?.bg||T.subtle}>{c}</Pill>;})}
      </div>
    )},
    { key:"actions", label:"Actions", render:(r,edit,del)=>(
      <div style={{display:"flex",gap:6}}>
        <Btn small variant="secondary" onClick={()=>edit(r)}>Edit</Btn>
        <Btn small variant="danger" onClick={()=>del(r.code)}>Delete</Btn>
      </div>
    )},
  ];
  return (
    <CrudPage
      title="Manufacturers (BB)" sub="Equipment manufacturers — second code segment"
      items={manufacturers} setItems={setManufacturers}
      fields={[
        {key:"code",label:"Code (2 chars)",placeholder:"e.g. GA",maxLength:2},
        {key:"label",label:"Manufacturer Name",placeholder:"e.g. Galileo"},
        {key:"catCodes",label:"Primary Category Code",placeholder:"e.g. CP"},
      ]}
      renderRow={(rows,edit,del)=>(
        <Table cols={cols.map(c=>c.key==="actions"?{...c,render:r=>c.render(r,edit,del)}:c)} rows={rows} />
      )}
      newItemDefaults={{code:"",label:"",catCodes:[]}}
      validateFn={(f)=>{
        if(!f.code||!f.label) return "Code and Name are required";
        if(f.code.length!==2) return "Manufacturer code must be 2 characters";
      }}
      legendItems={manufacturers.map(m=>({code:m.code,label:m.label}))}
    />
  );
}

// ─── MODELS ADMIN ─────────────────────────────────────────────
function ModelsPage({ data }) {
  const { models, setModels, manufacturers, engineSystems } = data;

  const cols = [
    { key:"code",    label:"Code",         render:r=><Pill>{r.code}</Pill> },
    { key:"label",   label:"Model Name",   style:{fontWeight:700,color:T.text} },
    { key:"mfrCode", label:"Manufacturer", render:r=>{
      const m=manufacturers.find(x=>x.code===r.mfrCode);
      const isEng = m?.catCodes?.includes("EN");
      return <Pill color={isEng?"#b45309":"#1d4ed8"} bg={isEng?"#fef3c7":"#dbeafe"}>{r.mfrCode} — {m?.label||"?"}</Pill>;
    }},
    { key:"type", label:"Type", render:r=>{
      const m=manufacturers.find(x=>x.code===r.mfrCode);
      const isEng = m?.catCodes?.includes("EN");
      return isEng
        ? <span style={{fontSize:11,background:"#fef3c7",color:"#b45309",padding:"2px 8px",borderRadius:4,fontWeight:700}}>🔧 Engine</span>
        : <span style={{fontSize:11,background:"#dbeafe",color:"#1d4ed8",padding:"2px 8px",borderRadius:4,fontWeight:700}}>⚙️ Compressor</span>;
    }},
    { key:"actions", label:"Actions", render:(r,edit,del)=>(
      <div style={{display:"flex",gap:6}}>
        <Btn small variant="secondary" onClick={()=>edit(r)}>✏️ Edit</Btn>
        <Btn small variant="danger"    onClick={()=>del(r.code)}>🗑 Delete</Btn>
      </div>
    )},
  ];

  // Group by manufacturer for display
  const catMfrs = manufacturers.filter(m=>m.catCodes.includes("EN"));
  const engModelCodes = models.filter(m=>catMfrs.some(mfr=>mfr.code===m.mfrCode)).map(m=>m.code);

  return (
    <div>
      <CrudPage
        title="Equipment Models (CC)" sub="Machine models per manufacturer — third code segment. Full edit & delete supported."
        items={models} setItems={setModels}
        fields={[
          {key:"code",   label:"Model Code (2–5 chars)",    placeholder:"e.g. CA03",  maxLength:5},
          {key:"label",  label:"Model Description",          placeholder:"e.g. 3406 NA"},
          {key:"mfrCode",label:"Manufacturer",               type:"select", options:manufacturers.map(m=>({value:m.code,label:`${m.code} — ${m.label}`}))},
        ]}
        renderRow={(rows,edit,del)=>(
          <>
            {/* Caterpillar group highlight */}
            <div style={{ padding:"8px 12px",background:"#fffbeb",borderBottom:`1px solid ${T.border}`,fontSize:12,color:"#b45309",fontWeight:700 }}>
              🔧 Engine Models — use 10 System Sections (BAS / LUB / COL / AIR / FUE / ELS / OPS / ENC / GEN / SRV) as DD segment
            </div>
            <Table cols={cols.map(c=>c.key==="actions"?{...c,render:r=>c.render(r,edit,del)}:c)} rows={rows} />
          </>
        )}
        newItemDefaults={{code:"",label:"",mfrCode:""}}
        validateFn={(f)=>{
          if(!f.code||!f.label||!f.mfrCode) return "All fields are required";
          if(f.code.length<2||f.code.length>5) return "Model code must be 2–5 characters";
        }}
        legendItems={[
          ...manufacturers.filter(m=>m.catCodes.includes("EN")).map(m=>({code:m.code,label:`${m.label} (Engine)`})),
          ...engineSystems.map(s=>({code:s.code,label:s.label+" — Engine System Section"})),
        ]}
      />
    </div>
  );
}

// ─── DISCIPLINES ──────────────────────────────────────────────
function DisciplinesPage({ data }) {
  const { disciplines, engineSystems } = data;
  return (
    <div>
      <PageHeader title="Disciplines & System Sections (DD)" sub="Fourth code segment — Standard disciplines for all categories; Engine-specific system sections for EN" />

      {/* Standard Disciplines */}
      <div style={{ marginBottom:8 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
          <span style={{ fontSize:14,fontWeight:800,color:T.text }}>Standard Disciplines</span>
          <span style={{ fontSize:12,background:"#dbeafe",color:"#1d4ed8",padding:"2px 10px",borderRadius:4,fontWeight:700 }}>CP · ST · DI · IN · LC · TL · OT</span>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,marginBottom:24 }}>
          {disciplines.map(d => (
            <Card key={d.code} style={{ borderTop:`4px solid ${d.color}` }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 }}>
                <Pill color={d.color} bg={d.bg} size={14}>{d.code}</Pill>
              </div>
              <div style={{ fontWeight:800,fontSize:18,color:T.text,marginBottom:6 }}>{d.label}</div>
              <div style={{ fontSize:13,color:T.muted,marginBottom:12 }}>{d.desc}</div>
              <div style={{ padding:"8px 10px",background:T.subtle,borderRadius:6,fontFamily:"monospace",fontSize:12,color:T.muted }}>
                AA-BB-CC-<span style={{color:d.color,fontWeight:800}}>{d.code}</span>-EE-0001
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Engine System Sections */}
      <Card style={{ marginBottom:24,borderLeft:"4px solid #b45309" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
          <span style={{ fontSize:20 }}>🔧</span>
          <div>
            <div style={{ fontWeight:800,fontSize:15,color:T.text }}>Engine System Sections</div>
            <div style={{ fontSize:12,color:T.muted }}>Used exclusively for Engines (EN) category — replaces ME/EL/AC for Caterpillar & Waukesha models</div>
          </div>
          <span style={{ marginLeft:"auto",fontSize:12,background:"#fef3c7",color:"#b45309",padding:"2px 10px",borderRadius:4,fontWeight:700 }}>EN category only</span>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10 }}>
          {engineSystems.map((s,i) => (
            <div key={s.code} style={{ display:"flex",alignItems:"center",gap:10,background:s.bg,borderRadius:7,padding:"10px 14px",border:`1px solid ${s.color}22` }}>
              <span style={{ fontFamily:"monospace",fontWeight:800,color:s.color,fontSize:13,minWidth:36 }}>{s.code}</span>
              <div>
                <div style={{ fontSize:13,fontWeight:600,color:s.color }}>{s.label}</div>
                <div style={{ fontFamily:"monospace",fontSize:10,color:T.muted,marginTop:2 }}>EN-CA/WK-MODEL-{s.code}-EE-0001</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ marginBottom:24 }}>
        <SectionHeader>Auxiliary Circuits (AC) — Scope</SectionHeader>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8 }}>
          {["Lubrication Systems","Cooling Systems","P&ID Components","Pressure Gauges","Pressure Switches","Pressure Transmitters","Temperature Gauges","Temperature Switches","Temperature Transmitters","Level Gauges","Flow Meters","Relief Valves","Solenoid Valves","Hoses","Fittings","Lubricants","Coolants","Separators","Dryers","Auxiliary Valves"].map(item=>(
            <div key={item} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"#d1fae5",borderRadius:5 }}>
              <span style={{ color:"#047857",fontWeight:700 }}>✓</span>
              <span style={{ fontSize:13,color:"#065f46" }}>{item}</span>
            </div>
          ))}
        </div>
      </Card>

      <CodeLegend items={[
        ...disciplines.map(d=>({code:d.code,label:d.label+" (Standard)"})),
        ...engineSystems.map(s=>({code:s.code,label:s.label+" (Engine Only)"})),
      ]} />
    </div>
  );
}

// ─── FUNCTIONAL GROUPS ────────────────────────────────────────
function FunctionalGroupsPage({ data }) {
  const { funcGroups, setFuncGroups, disciplines } = data;
  const grouped = disciplines.map(d => ({
    ...d,
    items: funcGroups.filter(f=>f.disc===d.code),
  }));
  const cols = [
    { key:"code", label:"Code", render:r=><Pill>{r.code}</Pill> },
    { key:"label", label:"Functional Group", style:{fontWeight:600,color:T.text} },
    { key:"disc", label:"Discipline", render:r=>{const dsc=T.disc[r.disc]||{c:T.muted,b:T.subtle};return <Pill color={dsc.c} bg={dsc.b}>{r.disc}</Pill>;} },
    { key:"actions", label:"Actions", render:(r,edit,del)=>(
      <div style={{display:"flex",gap:6}}>
        <Btn small variant="secondary" onClick={()=>edit(r)}>Edit</Btn>
        <Btn small variant="danger" onClick={()=>del(r.code)}>Delete</Btn>
      </div>
    )},
  ];
  return (
    <div>
      <PageHeader title="Functional Groups (EE)" sub="Component function classification — fifth code segment" />
      {grouped.map(g => (
        <Card key={g.code} style={{ marginBottom:20,borderLeft:`4px solid ${g.color}` }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
            <Pill color={g.color} bg={g.bg} size={13}>{g.code}</Pill>
            <span style={{ fontWeight:700,fontSize:15,color:T.text }}>{g.label}</span>
            <span style={{ fontSize:12,color:T.muted }}>({g.items.length} groups)</span>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8 }}>
            {g.items.map(fg => (
              <div key={fg.code} style={{ display:"flex",alignItems:"center",gap:8,background:T.subtle,borderRadius:6,padding:"7px 12px",border:`1px solid ${T.border}` }}>
                <Pill color={g.color} bg={g.bg} size={11}>{fg.code}</Pill>
                <span style={{ fontSize:13,color:T.text }}>{fg.label}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
      <CodeLegend items={funcGroups.map(f=>({code:f.code,label:f.label}))} />
    </div>
  );
}

// ─── CODE GENERATOR ───────────────────────────────────────────
function CodeGeneratorPage({ data }) {
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, parts, setParts } = data;
  const [step, setStep] = useState({ cat:"",mfr:"",model:"",disc:"",fg:"" });
  const [toast, setToast] = useState(null);
  const flash = (text,type="ok") => { setToast({text,type}); setTimeout(()=>setToast(null),3000); };

  const isEngine = step.cat === "EN";
  const activeSections = isEngine ? engineSystems : disciplines;

  const filteredMfrs = manufacturers.filter(m => !step.cat || (m.catCodes||[]).includes(step.cat));
  const filteredModels = models.filter(m => !step.mfr || m.mfrCode === step.mfr);
  // For engines, all functional groups are available (no disc filter), for others filter by disc
  const filteredFG = isEngine
    ? funcGroups.filter(f => !step.disc || true) // all FGs available for engine systems
    : funcGroups.filter(f => !step.disc || f.disc === step.disc);

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
  const disc = isEngine
    ? engineSystems.find(s=>s.code===step.disc)
    : disciplines.find(d=>d.code===step.disc);
  const fg = funcGroups.find(f=>f.code===step.fg);

  const shortDesc = (mfr&&model&&fg) ? `${mfr.label} ${model.label.replace("Model ","")} ${fg.label}` : "—";
  const longDesc = (fg&&mfr&&cat&&model) ? `${fg.label} for ${mfr.label} ${cat.label} ${model.label}` : "—";

  const handleSave = () => {
    if(!canGenerate) return;
    const newPart = {
      code: generatedCode,
      shortDesc, longDesc,
      cat: step.cat, mfr: step.mfr, model: step.model,
      disc: step.disc, fg: step.fg,
      partNo:"", oemPart:"", qty:0, unit:"EA", loc:"",
      minStock:0, maxStock:0, remarks:"", status:"Active",
    };
    setParts(p=>[...p,newPart]);
    flash(`Code ${generatedCode} saved to Master Table`);
  };

  const sStep = { padding:"10px 16px", borderRadius:6, background:T.subtle, border:`1px solid ${T.border}`, marginBottom:14 };
  const sLabel = { fontSize:11, fontWeight:700, color:T.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:6, display:"block" };

  return (
    <div>
      <Toast msg={toast} />
      <PageHeader title="Code Generator" sub="Build a valid 6-segment spare part code step by step" />

      <div style={{ display:"grid",gridTemplateColumns:"1.1fr 1fr",gap:20 }}>
        {/* Steps */}
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
          <div style={{...sStep,opacity:step.cat?1:0.5}}>
            <span style={sLabel}>Step 2 — BB: Manufacturer</span>
            <Select value={step.mfr} onChange={e=>setStep(s=>({...s,mfr:e.target.value,model:"",disc:"",fg:""}))} disabled={!step.cat}>
              <option value="">Select Manufacturer…</option>
              {filteredMfrs.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
            </Select>
          </div>
          {/* Step 3 */}
          <div style={{...sStep,opacity:step.mfr?1:0.5}}>
            <span style={sLabel}>Step 3 — CC: Equipment Model</span>
            <Select value={step.model} onChange={e=>setStep(s=>({...s,model:e.target.value,disc:"",fg:""}))} disabled={!step.mfr}>
              <option value="">Select Model…</option>
              {filteredModels.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
            </Select>
          </div>
          {/* Step 4 */}
          <div style={{...sStep,opacity:step.model?1:0.5,borderColor:isEngine?"#fbbf24":"#e2e8f0",background:isEngine?"#fffbeb":T.subtle}}>
            <span style={sLabel}>Step 4 — DD: {isEngine ? "Engine System Section" : "Discipline"}</span>
            {isEngine && <div style={{ fontSize:11,color:"#b45309",marginBottom:6,fontWeight:600 }}>🔧 Engine-specific system sections</div>}
            <Select value={step.disc} onChange={e=>setStep(s=>({...s,disc:e.target.value,fg:""}))} disabled={!step.model}>
              <option value="">{isEngine ? "Select Engine System…" : "Select Discipline…"}</option>
              {activeSections.map(d=><option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
            </Select>
          </div>
          {/* Step 5 */}
          <div style={{...sStep,opacity:step.disc?1:0.5}}>
            <span style={sLabel}>Step 5 — EE: Functional Group</span>
            <Select value={step.fg} onChange={e=>setStep(s=>({...s,fg:e.target.value}))} disabled={!step.disc}>
              <option value="">Select Functional Group…</option>
              {filteredFG.map(f=><option key={f.code} value={f.code}>{f.code} — {f.label}</option>)}
            </Select>
          </div>
          {/* Step 6 */}
          <div style={{...sStep,background:"#f0f9ff",borderColor:"#bae6fd",opacity:canGenerate?1:0.5}}>
            <span style={sLabel}>Step 6 — NNNN: Auto Sequence</span>
            <div style={{ fontFamily:"monospace",fontWeight:800,fontSize:22,color:T.accent }}>{seqNum}</div>
            <div style={{ fontSize:11,color:T.muted,marginTop:4 }}>Auto-incremented from existing codes in this series</div>
          </div>
        </Card>

        {/* Output Panel */}
        <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
          {/* Generated Code */}
          <Card style={{ borderTop:`3px solid ${T.accent}` }}>
            <div style={{ fontSize:11,fontWeight:700,color:T.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:12 }}>Generated Code</div>
            {generatedCode
              ? <>
                  <div style={{ textAlign:"center",margin:"12px 0" }}>
                    <span style={{ background:T.header,color:"#38bdf8",fontFamily:"monospace",fontWeight:800,fontSize:24,padding:"12px 20px",borderRadius:8,letterSpacing:3,display:"inline-block" }}>
                      {generatedCode}
                    </span>
                  </div>
                  <div style={{ fontSize:12,color:T.success,textAlign:"center",marginBottom:12 }}>✅ Valid 6-segment code</div>
                  <Btn onClick={handleSave} style={{ width:"100%" }}>💾 Save to Master Table</Btn>
                </>
              : <div style={{ textAlign:"center",padding:"28px 0",color:T.muted,fontSize:13 }}>Complete all 5 selections to generate code</div>
            }
          </Card>

          {/* Interpretation Panel */}
          {generatedCode && (
            <Card>
              <div style={{ fontSize:11,fontWeight:700,color:T.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:12 }}>Code Interpretation</div>
              {[
                {seg:step.cat,name:"Main Category",val:cat?.label},
                {seg:step.mfr,name:"Manufacturer",val:mfr?.label},
                {seg:step.model,name:"Model",val:model?.label},
                {seg:step.disc,name:"Discipline",val:disc?.label},
                {seg:step.fg,name:"Functional Group",val:fg?.label},
                {seg:seqNum,name:"Sequence",val:`Item Number ${parseInt(seqNum)}`},
              ].map(b => (
                <div key={b.seg} style={{ display:"flex",alignItems:"center",gap:12,marginBottom:8,padding:"7px 10px",background:T.subtle,borderRadius:6 }}>
                  <Pill size={12}>{b.seg}</Pill>
                  <div>
                    <div style={{ fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase" }}>{b.name}</div>
                    <div style={{ fontSize:14,fontWeight:600,color:T.text }}>{b.val}</div>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {generatedCode && (
            <Card>
              <div style={{ fontSize:11,fontWeight:700,color:T.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:10 }}>Generated Descriptions</div>
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:11,color:T.muted,fontWeight:700,marginBottom:3 }}>SHORT DESCRIPTION</div>
                <div style={{ fontSize:14,fontWeight:700,color:T.text,padding:"7px 10px",background:"#f0f9ff",borderRadius:5 }}>{shortDesc}</div>
              </div>
              <div>
                <div style={{ fontSize:11,color:T.muted,fontWeight:700,marginBottom:3 }}>LONG DESCRIPTION</div>
                <div style={{ fontSize:14,color:T.text,padding:"7px 10px",background:"#f0f9ff",borderRadius:5 }}>{longDesc}</div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <CodeLegend items={[
        {code:"AA",label:"Main Category"},{code:"BB",label:"Manufacturer"},
        {code:"CC",label:"Model"},{code:"DD",label:"Discipline"},
        {code:"EE",label:"Functional Group"},{code:"NNNN",label:"Auto-Sequence Number"},
      ]} />
    </div>
  );
}

// ─── HIERARCHY TREE ───────────────────────────────────────────
function HierarchyTreePage({ data }) {
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, parts } = data;
  const [expanded, setExpanded] = useState({ ROOT:true });
  const toggle = k => setExpanded(e=>({...e,[k]:!e[k]}));

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

  // Render discipline/section level — shared logic
  const renderSectionLevel = (cat, mfr, mod, sections, isEngine) => {
    return sections.map(sec=>{
      const secKey = `${cat.code}-${mfr.code}-${mod.code}-${sec.code}`;
      const partsInSec = parts.filter(p=>p.cat===cat.code&&p.mfr===mfr.code&&p.model===mod.code&&p.disc===sec.code);
      const usedFGs = funcGroups.filter(fg=>
        parts.some(p=>p.cat===cat.code&&p.mfr===mfr.code&&p.model===mod.code&&p.disc===sec.code&&p.fg===fg.code)
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
            const fgParts = parts.filter(p=>p.cat===cat.code&&p.mfr===mfr.code&&p.model===mod.code&&p.disc===sec.code&&p.fg===fg.code);
            const fgKey = `${secKey}-${fg.code}`;
            return (
              <Node key={fg.code} label={fg.label} pill={fg.code} pillColor="#6d28d9" pillBg="#f5f3ff" nodeKey={fgKey} depth={5} count={fgParts.length}>
                {fgParts.map(p=>(
                  <div key={p.code} style={{ marginLeft:90,padding:"4px 8px",borderRadius:4,marginBottom:2,background:"#f8fafc",display:"flex",alignItems:"center",gap:8 }}>
                    <span style={{ fontSize:11,color:"#94a3b8" }}>—</span>
                    <CodeTag code={p.code} />
                    <span style={{ fontSize:12,color:T.muted }}>{p.shortDesc}</span>
                  </div>
                ))}
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

      {/* Legend box for Engine Systems */}
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

      <Card>
        <div style={{ display:"flex",gap:10,marginBottom:16 }}>
          <Btn small variant="secondary" onClick={()=>setExpanded({ROOT:true})}>Collapse All</Btn>
          <Btn small onClick={expandAll}>Expand All</Btn>
        </div>
        <Node label="Engineering Spare Parts" nodeKey="ROOT" depth={0} count={parts.length}>
          {categories.map(cat=>{
            const isEngine = cat.code === "EN";
            const catMfrs = manufacturers.filter(m=>(m.catCodes||[]).includes(cat.code));
            return (
              <Node key={cat.code} label={cat.label} pill={cat.code} pillColor={cat.color} pillBg={cat.bg} nodeKey={cat.code} depth={1} count={parts.filter(p=>p.cat===cat.code).length}>
                {catMfrs.map(mfr=>{
                  const mfrModels = models.filter(m=>m.mfrCode===mfr.code);
                  return (
                    <Node key={mfr.code} label={mfr.label} pill={mfr.code} pillColor="#b45309" pillBg="#fef3c7" nodeKey={`${cat.code}-${mfr.code}`} depth={2} count={parts.filter(p=>p.cat===cat.code&&p.mfr===mfr.code).length}>
                      {mfrModels.map(mod=>{
                        const modPartsCount = parts.filter(p=>p.model===mod.code).length;
                        const sections = isEngine ? engineSystems : disciplines;
                        return (
                          <Node key={mod.code} label={mod.label} pill={mod.code} pillColor="#047857" pillBg="#d1fae5" nodeKey={`${cat.code}-${mfr.code}-${mod.code}`} depth={3} count={modPartsCount} alwaysExpandable={true}>
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
      <CodeLegend items={[
        ...categories.map(c=>({code:c.code,label:c.label})),
        ...manufacturers.filter(m=>m.catCodes.includes("EN")).map(m=>({code:m.code,label:m.label+" (Engine)"})),
        ...engineSystems.map(s=>({code:s.code,label:s.label+" (Engine System)"})),
        ...disciplines.map(d=>({code:d.code,label:d.label+" (Other Categories)"})),
      ]} />
    </div>
  );
}

// ─── MASTER TABLE ─────────────────────────────────────────────
function MasterTablePage({ data }) {
  const { categories, manufacturers, models, disciplines, engineSystems, funcGroups, parts, setParts } = data;
  const allSections = [...disciplines, ...engineSystems];
  const [search, setSearch] = useState("");
  const [fCat, setFCat] = useState("");
  const [fDisc, setFDisc] = useState("");
  const [fStatus, setFStatus] = useState("");

  const filtered = useMemo(() => parts.filter(p => {
    const q = search.toLowerCase();
    const ms = !q || [p.code,p.shortDesc,p.longDesc,p.partNo,p.oemPart,p.loc].some(v=>v.toLowerCase().includes(q));
    return ms && (!fCat||p.cat===fCat) && (!fDisc||p.disc===fDisc) && (!fStatus||p.status===fStatus);
  }), [parts,search,fCat,fDisc,fStatus]);

  return (
    <div>
      <PageHeader title="Master Spare Parts Table" sub={`Complete coded parts inventory — ${parts.length} total records`} />
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:"flex",gap:12,flexWrap:"wrap",alignItems:"center" }}>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search code, description, part no, location…" style={{ maxWidth:320,width:"auto",flex:"1 1 220px" }} />
          <Select value={fCat} onChange={e=>setFCat(e.target.value)} style={{ width:"auto",flex:"0 0 160px" }}>
            <option value="">All Categories</option>
            {categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
          <Select value={fDisc} onChange={e=>setFDisc(e.target.value)} style={{ width:"auto",flex:"0 0 180px" }}>
            <option value="">All Disciplines / Systems</option>
            <optgroup label="Standard Disciplines">
              {disciplines.map(d=><option key={d.code} value={d.code}>{d.label}</option>)}
            </optgroup>
            <optgroup label="Engine System Sections">
              {engineSystems.map(s=><option key={s.code} value={s.code}>{s.label}</option>)}
            </optgroup>
          </Select>
          <Select value={fStatus} onChange={e=>setFStatus(e.target.value)} style={{ width:"auto",flex:"0 0 130px" }}>
            <option value="">All Status</option>
            {["Active","Inactive","Obsolete"].map(s=><option key={s}>{s}</option>)}
          </Select>
          {(search||fCat||fDisc||fStatus) && (
            <Btn small variant="danger" onClick={()=>{setSearch("");setFCat("");setFDisc("");setFStatus("");}}>✕ Clear</Btn>
          )}
          <span style={{ marginLeft:"auto",fontSize:13,color:T.muted }}>{filtered.length} results</span>
        </div>
      </Card>
      <Card>
        <Table
          cols={[
            { key:"code", label:"Spare Part Code", render:r=><CodeTag code={r.code}/> },
            { key:"shortDesc", label:"Short Description", style:{fontWeight:600,color:T.text,whiteSpace:"nowrap"} },
            { key:"cat", label:"Category", render:r=>{const c=categories.find(x=>x.code===r.cat);return <Pill color={c?.color} bg={c?.bg}>{r.cat}</Pill>;} },
            { key:"mfr", label:"Mfr.", render:r=><Pill color="#b45309" bg="#fef3c7">{r.mfr}</Pill> },
            { key:"model", label:"Model", render:r=>{const m=models.find(x=>x.code===r.model);return <span style={{fontSize:12,color:T.muted}}>{m?.label||r.model}</span>;} },
            { key:"disc", label:"System/Disc", render:r=>{
              const sec = allSections.find(s=>s.code===r.disc);
              const dc = T.disc[r.disc]||{c:sec?.color||T.muted,b:sec?.bg||T.subtle};
              return <Pill color={dc.c||sec?.color} bg={dc.b||sec?.bg}>{r.disc}</Pill>;
            }},
            { key:"fg", label:"Func. Group", render:r=>{const f=funcGroups.find(x=>x.code===r.fg);return <Pill color="#6d28d9" bg="#f5f3ff" size={11}>{r.fg}</Pill>;} },
            { key:"partNo", label:"Part No.", style:{fontFamily:"monospace",fontSize:12,color:T.muted,whiteSpace:"nowrap"} },
            { key:"qty", label:"Qty", style:{textAlign:"center",fontWeight:700} },
            { key:"unit", label:"Unit", style:{color:T.muted,fontSize:12} },
            { key:"loc", label:"Location", style:{fontFamily:"monospace",fontSize:12,color:T.muted} },
            { key:"minStock", label:"Min", style:{textAlign:"center",fontSize:12,color:T.warn} },
            { key:"maxStock", label:"Max", style:{textAlign:"center",fontSize:12,color:T.success} },
            { key:"status", label:"Status", render:r=><Pill color={r.status==="Active"?T.success:T.danger} bg={r.status==="Active"?T.successBg:T.dangerBg} mono={false} size={11}>{r.status}</Pill> },
          ]}
          rows={filtered}
        />
      </Card>
      <CodeLegend items={[
        ...categories.map(c=>({code:c.code,label:c.label})),
        ...disciplines.map(d=>({code:d.code,label:d.label})),
        {code:"Qty",label:"Quantity on Hand"},{code:"Min",label:"Minimum Stock Level"},
        {code:"Max",label:"Maximum Stock Level"},{code:"OEM",label:"Original Equipment Manufacturer"},
      ]} />
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
  { id:"dashboard",     label:"Dashboard",           icon:"🏠", group:"" },
  { id:"framework",     label:"Coding Framework",    icon:"📐", group:"Reference" },
  { id:"categories",    label:"Main Categories",     icon:"📦", group:"Reference" },
  { id:"disciplines",   label:"Disciplines",         icon:"🔬", group:"Reference" },
  { id:"manufacturers", label:"Manufacturers",       icon:"🏭", group:"Master Data" },
  { id:"models",        label:"Equipment Models",    icon:"📋", group:"Master Data" },
  { id:"funcgroups",    label:"Functional Groups",   icon:"⚙️", group:"Master Data" },
  { id:"generator",     label:"Code Generator",      icon:"✨", group:"Tools" },
  { id:"tree",          label:"Hierarchy Tree",      icon:"🌳", group:"Tools" },
  { id:"master",        label:"Master Parts Table",  icon:"📊", group:"Inventory" },
  { id:"admin",         label:"Administration",      icon:"🔑", group:"System" },
];

// ═══════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);

  const [categories,    setCategories]    = useState(INIT_CATEGORIES);
  const [manufacturers, setManufacturers] = useState(INIT_MANUFACTURERS);
  const [models,        setModels]        = useState(INIT_MODELS);
  const [disciplines]                     = useState(INIT_DISCIPLINES);
  const [engineSystems, setEngineSystems] = useState(ENGINE_SYSTEMS);
  const [funcGroups,    setFuncGroups]    = useState(INIT_FUNC_GROUPS);
  const [parts,         setParts]         = useState(INIT_PARTS);

  const data = { categories, setCategories, manufacturers, setManufacturers, models, setModels, disciplines, engineSystems, setEngineSystems, funcGroups, setFuncGroups, parts, setParts };

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
  };

  const groups = [...new Set(NAV.filter(n=>n.group).map(n=>n.group))];

  return (
    <div style={{ display:"flex",height:"100vh",fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",background:T.bg,overflow:"hidden" }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width:collapsed?52:228,background:T.sidebar,transition:"width .2s",flexShrink:0,display:"flex",flexDirection:"column",overflowY:"auto",overflowX:"hidden" }}>
        {/* Logo */}
        <div style={{ padding:"16px 14px",borderBottom:`1px solid ${T.sidebarBorder}`,display:"flex",alignItems:"center",gap:10,minHeight:60 }}>
          <div style={{ width:28,height:28,background:T.accent,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0 }}>⚙</div>
          {!collapsed&&(
            <div>
              <div style={{ color:"#f1f5f9",fontWeight:800,fontSize:12,lineHeight:1.2 }}>SP Coding System</div>
              <div style={{ color:"#475569",fontSize:10 }}>Master Data v2.0</div>
            </div>
          )}
        </div>

        {/* Dashboard standalone */}
        <nav style={{ flex:1,padding:"8px 0" }}>
          {[NAV[0]].map(n=>(
            <NavItem key={n.id} n={n} active={page===n.id} onClick={()=>setPage(n.id)} collapsed={collapsed} />
          ))}

          {groups.map(g=>(
            <div key={g}>
              {!collapsed&&<div style={{ fontSize:9,fontWeight:700,color:"#334155",letterSpacing:1.5,textTransform:"uppercase",padding:"10px 14px 4px" }}>{g}</div>}
              {NAV.filter(n=>n.group===g).map(n=>(
                <NavItem key={n.id} n={n} active={page===n.id} onClick={()=>setPage(n.id)} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div onClick={()=>setCollapsed(!collapsed)} style={{ padding:"10px 14px",borderTop:`1px solid ${T.sidebarBorder}`,cursor:"pointer",color:"#475569",fontSize:12,display:"flex",alignItems:"center",gap:8 }}>
          <span style={{ fontSize:14 }}>{collapsed?"▶":"◀"}</span>
          {!collapsed&&<span>Collapse</span>}
        </div>
      </div>

      {/* ── MAIN ── */}
      <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
        {/* Top bar */}
        <div style={{ background:T.card,borderBottom:`1px solid ${T.border}`,padding:"11px 28px",display:"flex",alignItems:"center",gap:16,flexShrink:0 }}>
          <div>
            <div style={{ fontWeight:700,fontSize:14,color:T.text }}>{NAV.find(n=>n.id===page)?.label}</div>
            <div style={{ fontSize:11,color:T.muted }}>Engineering Spare Parts Master Coding System</div>
          </div>
          <div style={{ marginLeft:"auto",display:"flex",gap:10,alignItems:"center" }}>
            <span style={{ background:T.header,color:"#38bdf8",fontFamily:"monospace",fontWeight:800,fontSize:12,padding:"4px 12px",borderRadius:5,letterSpacing:1.5 }}>AA-BB-CC-DD-EE-0001</span>
            <span style={{ background:"#dcfce7",color:"#15803d",fontWeight:700,fontSize:11,padding:"4px 10px",borderRadius:12 }}>v2.0</span>
          </div>
        </div>

        {/* Page */}
        <div style={{ flex:1,overflowY:"auto",padding:28 }}>
          {pageMap[page]}
        </div>
      </div>
    </div>
  );
}

function NavItem({ n, active, onClick, collapsed }) {
  return (
    <div onClick={onClick} title={collapsed?n.label:""} style={{ display:"flex",alignItems:"center",gap:10,padding:"9px 14px",cursor:"pointer",background:active?"#1a3460":"transparent",borderLeft:active?"3px solid #38bdf8":"3px solid transparent",transition:"background .12s" }}>
      <span style={{ fontSize:15,flexShrink:0 }}>{n.icon}</span>
      {!collapsed&&<span style={{ fontSize:13,color:active?"#f1f5f9":"#94a3b8",fontWeight:active?700:400,whiteSpace:"nowrap" }}>{n.label}</span>}
    </div>
  );
}
