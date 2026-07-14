-- ═══════════════════════════════════════════════════════════════
-- Migration 002 — Seed Data
-- Inserts all INIT_* constants from the React app into the DB.
-- Run once after 001_initial_schema.sql
-- ═══════════════════════════════════════════════════════════════

-- ─── CATEGORIES ───────────────────────────────────────────────
INSERT INTO public.categories (code, label, icon, color, bg) VALUES
  ('CP', 'Compressors',          '⚙️',  '#1d4ed8', '#dbeafe'),
  ('EN', 'Engines',              '🔧',  '#b45309', '#fef3c7'),
  ('ST', 'Storage',              '🗄️',  '#047857', '#d1fae5'),
  ('DI', 'Dispensers',           '⛽',  '#7c3aed', '#ede9fe'),
  ('IN', 'Instrumentation',      '📡',  '#be123c', '#ffe4e6'),
  ('LC', 'Lubricants & Coolants','🛢️',  '#0e7490', '#cffafe'),
  ('TL', 'Tools',                '🔩',  '#6d28d9', '#f5f3ff'),
  ('OT', 'Others',               '📦',  '#374151', '#f3f4f6')
ON CONFLICT (code) DO NOTHING;

-- ─── MANUFACTURERS ────────────────────────────────────────────
INSERT INTO public.manufacturers (code, label, cat_codes) VALUES
  ('GA', 'Galileo',     ARRAY['CP']),
  ('CU', 'Cubogas',     ARRAY['CP']),
  ('KW', 'Kwangshin',   ARRAY['CP']),
  ('IM', 'IMW',         ARRAY['CP']),
  ('FN', 'Fornovo',     ARRAY['CP']),
  ('AN', 'ANGI',        ARRAY['CP']),
  ('SF', 'SAFE',        ARRAY['CP']),
  ('CA', 'Caterpillar', ARRAY['EN']),
  ('WK', 'Waukesha',    ARRAY['EN'])
ON CONFLICT (code) DO NOTHING;

-- ─── MODELS ───────────────────────────────────────────────────
INSERT INTO public.models (code, label, mfr_code) VALUES
  ('A34',  'Model 3406',           'AN'),
  ('A38',  'Model 3408',           'AN'),
  ('A33',  'Model 3306',           'AN'),
  ('F03',  '3 Bar Suction',        'FN'),
  ('F30',  '30 Bar Suction',       'FN'),
  ('G01',  'Model G01',            'GA'),
  ('G02',  'Model G02',            'GA'),
  ('G03',  'Model G03',            'GA'),
  ('K01',  'HG-5',                 'KW'),
  ('K02',  'HG-7',                 'KW'),
  ('CA01', '3306 NA',              'CA'),
  ('CA02', '3306 TA',              'CA'),
  ('CA03', '3406 NA',              'CA'),
  ('CA04', '3406 TA',              'CA'),
  ('CA05', '3406 N90 (Standard)',  'CA'),
  ('CA06', '3408',                 'CA'),
  ('W01',  'VHP F18',              'WK'),
  ('W02',  'VHP L36',              'WK'),
  ('W03',  'VHP F35',              'WK'),
  ('W04',  'AT25GL',               'WK'),
  ('W05',  'AT27GL',               'WK')
ON CONFLICT (code) DO NOTHING;

-- ─── DISCIPLINES ──────────────────────────────────────────────
INSERT INTO public.disciplines
(code, label, description, color, bg) 
VALUES
  ('ME', 'Mechanical',         'Rotating & static mechanical components',          '#1d4ed8', '#dbeafe'),
  ('EL', 'Electrical',         'Electrical & electronic components',                '#b45309', '#fef3c7'),
  ('AC', 'Auxiliary Circuits', 'P&ID, instrumentation, fluid & auxiliary systems', '#047857', '#d1fae5')
ON CONFLICT (code) DO NOTHING;

-- ─── ENGINE SYSTEMS ───────────────────────────────────────────
INSERT INTO public.engine_systems (code, label, color, bg) VALUES
  ('BAS', 'Basic Engine',                   '#1d4ed8', '#dbeafe'),
  ('LUB', 'Lubrication System',             '#b45309', '#fef3c7'),
  ('COL', 'Cooling System',                 '#047857', '#d1fae5'),
  ('AIR', 'Air Inlet and Exhaust System',   '#7c3aed', '#ede9fe'),
  ('FUE', 'Fuel System',                    '#be123c', '#ffe4e6'),
  ('ELS', 'Electrical and Starting System', '#0e7490', '#cffafe'),
  ('OPS', 'Operator Station',               '#374151', '#f3f4f6'),
  ('ENC', 'Enclosures, Guards and Bases',   '#6d28d9', '#f5f3ff'),
  ('GEN', 'Generators',                     '#15803d', '#dcfce7'),
  ('SRV', 'Service Equipment and Supplies', '#9f1239', '#ffe4e6')
ON CONFLICT (code) DO NOTHING;

-- ─── FUNCTIONAL GROUPS ────────────────────────────────────────
INSERT INTO public.functional_groups (code, label, disc) VALUES
  -- Mechanical
  ('BRG', 'Bearing',              'ME'),
  ('SEA', 'Seal',                 'ME'),
  ('GSK', 'Gasket',               'ME'),
  ('FIL', 'Filter',               'ME'),
  ('VAL', 'Valve',                'ME'),
  ('PST', 'Piston',               'ME'),
  ('RNG', 'Ring',                 'ME'),
  ('CPL', 'Coupling',             'ME'),
  ('SHA', 'Shaft',                'ME'),
  ('CYL', 'Cylinder',             'ME'),
  ('BLK', 'Block',                'ME'),
  ('FAN', 'Fan',                  'ME'),
  ('PUL', 'Pulley',               'ME'),
  ('ROD', 'Connecting Rod',       'ME'),
  ('CRK', 'Crankshaft',           'ME'),
  -- Electrical
  ('STR', 'Starter',                   'EL'),
  ('ALT', 'Alternator',                'EL'),
  ('MOT', 'Motor',                     'EL'),
  ('PCB', 'PCB',                       'EL'),
  ('SEN', 'Sensor',                    'EL'),
  ('SWI', 'Switch',                    'EL'),
  ('REL', 'Relay',                     'EL'),
  ('SOL', 'Solenoid',                  'EL'),
  ('CAB', 'Cable',                     'EL'),
  ('BAT', 'Battery',                   'EL'),
  ('ECU', 'ECU',                       'EL'),
  ('VFD', 'Variable Frequency Drive',  'EL'),
  ('PSU', 'Power Supply',              'EL'),
  -- Auxiliary Circuits
  ('PGA', 'Pressure Gauge',            'AC'),
  ('PTS', 'Pressure Switch',           'AC'),
  ('PTT', 'Pressure Transmitter',      'AC'),
  ('TGA', 'Temperature Gauge',         'AC'),
  ('TTS', 'Temperature Switch',        'AC'),
  ('TTT', 'Temperature Transmitter',   'AC'),
  ('LGA', 'Level Gauge',               'AC'),
  ('FLM', 'Flow Meter',                'AC'),
  ('PRV', 'Pressure Relief Valve',     'AC'),
  ('SOV', 'Solenoid Valve',            'AC'),
  ('HOS', 'Hose',                      'AC'),
  ('FIT', 'Fitting',                   'AC'),
  ('OIL', 'Lubricant',                 'AC'),
  ('COL', 'Coolant',                   'AC'),
  ('SEP', 'Separator',                 'AC'),
  ('DRY', 'Dryer',                     'AC'),
  ('FLT', 'Filter Element',            'AC')
ON CONFLICT (code) DO NOTHING;

-- ─── SPARE PARTS (sample data) ────────────────────────────────
INSERT INTO public.spare_parts (code, short_desc, long_desc, cat, mfr, model, disc, fg, part_no, oem_part, qty, unit, location, min_stock, max_stock, remarks, status)
VALUES
  ('CP-AN-A34-ME-BRG-0001','ANGI 3406 Bearing',          'Bearing for ANGI Compressor Model 3406',                   'CP','AN','A34','ME','BRG','AN-BRG-001','1234567',4, 'EA', 'WH-A1',2,10,'Critical',     'Active'),
  ('CP-AN-A34-ME-SEA-0001','ANGI 3406 Seal Kit',          'Shaft Seal Kit for ANGI Compressor Model 3406',            'CP','AN','A34','ME','SEA','AN-SK-020', '2345678',6, 'KIT','WH-A1',2,8, '',             'Active'),
  ('CP-AN-A34-ME-GSK-0001','ANGI 3406 Head Gasket',       'Cylinder Head Gasket for ANGI Model 3406',                 'CP','AN','A34','ME','GSK','AN-HG-034', '3456789',3, 'EA', 'WH-A1',1,6, '',             'Active'),
  ('CP-AN-A34-ME-FIL-0001','ANGI 3406 Oil Filter',        'Lube Oil Filter for ANGI Compressor Model 3406',           'CP','AN','A34','ME','FIL','AN-OF-100', '4567890',12,'EA', 'WH-B1',4,20,'500hr interval','Active'),
  ('CP-AN-A34-EL-STR-0001','ANGI 3406 Starter',           'Electric Starter Motor for ANGI Model 3406',              'CP','AN','A34','EL','STR','AN-ST-001', '5678901',1, 'EA', 'WH-C1',1,2, '24V DC',        'Active'),
  ('CP-AN-A34-AC-PGA-0001','ANGI 3406 Pressure Gauge',    'Discharge Pressure Gauge for ANGI Model 3406 0-400bar',   'CP','AN','A34','AC','PGA','AN-PG-400', '6789012',3, 'EA', 'WH-D1',1,6, '0-400 bar',     'Active'),
  ('CP-GA-G01-ME-BRG-0001','Galileo G01 Bearing',         'Main Shaft Bearing for Galileo Compressor G01',           'CP','GA','G01','ME','BRG','GA-BRG-210','7890123',4, 'EA', 'WH-A2',2,8, '',             'Active'),
  ('CP-GA-G01-ME-SEA-0001','Galileo G01 Seal',            'Piston Seal for Galileo G01 Compressor',                  'CP','GA','G01','ME','SEA','GA-PS-011', '8901234',8, 'EA', 'WH-A2',2,12,'',             'Active'),
  ('CP-FN-F30-AC-PRV-0001','Fornovo 30bar Relief Valve',  'Safety Relief Valve for Fornovo 30 Bar Suction',          'CP','FN','F30','AC','PRV','FN-SRV-030','9012345',2, 'EA', 'WH-D2',1,4, 'Annual cal',    'Active'),
  ('EN-CA-CA03-BAS-BRG-0001','CAT 3406 NA Main Bearing',  'Main Crankshaft Bearing for Caterpillar 3406 NA',         'EN','CA','CA03','BAS','BRG','CAT-BRG-3406','0123456',4,'EA','WH-A3',2,8,'Critical',    'Active'),
  ('EN-CA-CA03-LUB-FIL-0001','CAT 3406 NA Oil Filter',    'Engine Lube Oil Filter for Caterpillar 3406 NA',          'EN','CA','CA03','LUB','FIL','CAT-OF-3406','2345601',10,'EA','WH-B3',4,20,'250hr change','Active'),
  ('EN-CA-CA03-ELS-ALT-0001','CAT 3406 NA Alternator',    '24V Alternator Assembly for Caterpillar 3406 NA',         'EN','CA','CA03','ELS','ALT','CAT-AL-3406','3456012',1,'EA','WH-C2',1,2,'24V',          'Active'),
  ('EN-WK-W01-BAS-BRG-0001','Waukesha VHP F18 Bearing',   'Main Bearing Set for Waukesha VHP F18 Engine',            'EN','WK','W01','BAS','BRG','WK-BRG-F18','4560123',3,'SET','WH-A4',1,6,'Critical',     'Active'),
  ('EN-WK-W01-ELS-ECU-0001','Waukesha F18 ECU',           'Engine Control Unit for Waukesha VHP F18',                'EN','WK','W01','ELS','ECU','WK-ECU-F18','5601234',1,'EA','WH-C3',1,2,'Critical',      'Active'),
  ('LC-GA-G01-AC-OIL-0001','Galileo Compressor Oil',      'Synthetic Compressor Lubricant for Galileo Units 5L',     'LC','GA','G01','AC','OIL','GA-OIL-CMP','6012345',50,'L','WH-F1',20,100,'ISO VG 100',   'Active')
ON CONFLICT (code) DO NOTHING;
