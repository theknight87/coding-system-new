-- ═══════════════════════════════════════════════════════════════
-- Migration 001 — Initial Schema
-- Engineering Spare Parts Master Coding System
-- ═══════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── USER PROFILES ────────────────────────────────────────────
-- Extends Supabase auth.users with application roles
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'department_user' CHECK (role IN ('admin','department_user')),
  department    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on first sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'department_user')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── CATEGORIES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.categories (
  code        TEXT PRIMARY KEY CHECK (length(code) = 2),
  label       TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '📦',
  color       TEXT NOT NULL DEFAULT '#374151',
  bg          TEXT NOT NULL DEFAULT '#f3f4f6',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id)
);

-- ─── MANUFACTURERS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manufacturers (
  code        TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 3),
  label       TEXT NOT NULL,
  cat_codes   TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id)
);

-- ─── MODELS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.models (
  code        TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 5),
  label       TEXT NOT NULL,
  mfr_code    TEXT NOT NULL REFERENCES public.manufacturers(code),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id)
);

-- ─── DISCIPLINES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.disciplines (
  code        TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 3),
  label       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#374151',
  bg          TEXT NOT NULL DEFAULT '#f3f4f6',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id)
);

-- ─── ENGINE SYSTEMS ───────────────────────────────────────────
-- Engine-specific system sections (replaces disciplines for EN category)
CREATE TABLE IF NOT EXISTS public.engine_systems (
  code        TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 4),
  label       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#374151',
  bg          TEXT NOT NULL DEFAULT '#f3f4f6',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id)
);

-- ─── FUNCTIONAL GROUPS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.functional_groups (
  code        TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 4),
  label       TEXT NOT NULL,
  disc        TEXT NOT NULL,  -- references discipline or engine_system code
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id)
);

-- ─── SPARE PARTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.spare_parts (
  -- Primary key: the 6-segment code is guaranteed unique
  code          TEXT PRIMARY KEY,
  -- Parsed segments (denormalised for fast filtering)
  cat           TEXT NOT NULL REFERENCES public.categories(code),
  mfr           TEXT NOT NULL REFERENCES public.manufacturers(code),
  model         TEXT NOT NULL REFERENCES public.models(code),
  disc          TEXT NOT NULL,  -- discipline OR engine_system code
  fg            TEXT NOT NULL REFERENCES public.functional_groups(code),
  -- Descriptions
  short_desc    TEXT NOT NULL DEFAULT '',
  long_desc     TEXT NOT NULL DEFAULT '',
  -- Part numbers
  part_no       TEXT NOT NULL DEFAULT '',
  oem_part      TEXT NOT NULL DEFAULT '',
  -- Inventory
  qty           INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  unit          TEXT NOT NULL DEFAULT 'EA',
  location      TEXT NOT NULL DEFAULT '',
  min_stock     INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  max_stock     INTEGER NOT NULL DEFAULT 0 CHECK (max_stock >= 0),
  -- Status
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Obsolete')),
  remarks       TEXT NOT NULL DEFAULT '',
  -- Attachments (store URLs only, files in Supabase Storage)
  image_url     TEXT,
  datasheet_url TEXT,
  manual_url    TEXT,
  drawing_url   TEXT,
  -- Audit fields
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  created_by    UUID REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id)
);

-- Prevent duplicate codes (also handles soft-deleted codes)
CREATE UNIQUE INDEX IF NOT EXISTS spare_parts_code_unique
  ON public.spare_parts(code) WHERE deleted_at IS NULL;

-- Indexes for common filter patterns
CREATE INDEX IF NOT EXISTS spare_parts_cat_idx    ON public.spare_parts(cat)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS spare_parts_mfr_idx    ON public.spare_parts(mfr)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS spare_parts_model_idx  ON public.spare_parts(model)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS spare_parts_disc_idx   ON public.spare_parts(disc)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS spare_parts_status_idx ON public.spare_parts(status) WHERE deleted_at IS NULL;

-- ─── AUDIT LOGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  action      TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','UPLOAD','EXPORT')),
  table_name  TEXT NOT NULL,
  record_id   TEXT,
  old_values  JSONB,
  new_values  JSONB,
  user_id     UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_user_idx      ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx    ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_table_idx     ON public.audit_logs(table_name);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx   ON public.audit_logs(created_at DESC);

-- ─── updated_at auto-update trigger ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['categories','manufacturers','models','disciplines','engine_systems','functional_groups','spare_parts','user_profiles']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', tbl);
  END LOOP;
END;
$$;
