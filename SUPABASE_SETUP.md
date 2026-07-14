# Supabase Setup Guide
## Engineering Spare Parts Master Coding System v3.0

---

## Step 1 — Create Supabase Project

1. Go to https://supabase.com and sign in
2. Click **New Project**
3. Choose your organisation, set a project name and a strong database password
4. Select the region closest to your team
5. Click **Create new project** and wait ~2 minutes

---

## Step 2 — Run SQL Migrations

Go to your Supabase project → **SQL Editor** → **New query**

Run each file in order:

### 001 — Initial Schema
Copy and paste the contents of:
```
supabase/migrations/001_initial_schema.sql
```
Click **Run**. You should see "Success. No rows returned."

### 002 — Seed Data
Copy and paste:
```
supabase/migrations/002_seed_data.sql
```
Click **Run**. This inserts all master data (categories, manufacturers, models, etc.)

### 003 — RLS Policies
Copy and paste:
```
supabase/migrations/003_rls_policies.sql
```
Click **Run**. This creates all Row Level Security policies and storage buckets.

### 004 — Audit Triggers
Copy and paste:
```
supabase/migrations/004_audit_triggers.sql
```
Click **Run**. This installs automatic audit logging on all core tables.

---

## Step 3 — Create Your First Admin User

1. Go to **Authentication** → **Users** → **Invite user**
2. Enter your email address
3. Check your email and click the invitation link to set your password
4. Go to **SQL Editor** and run:

```sql
UPDATE public.user_profiles
SET role = 'admin'
WHERE email = 'your-email@company.com';
```

---

## Step 4 — Get Your API Keys

Go to **Project Settings** → **API**

Copy:
- **Project URL** → this is your `VITE_SUPABASE_URL`
- **anon public** key → this is your `VITE_SUPABASE_ANON_KEY`

---

## Step 5 — Configure Cloudflare Pages

In your Cloudflare Pages project:

1. Go to **Settings** → **Environment Variables**
2. Add these two variables (for **Production** environment):

| Variable Name             | Value                              |
|---------------------------|------------------------------------|
| `VITE_SUPABASE_URL`       | `https://xxxx.supabase.co`         |
| `VITE_SUPABASE_ANON_KEY`  | `eyJhbGciOiJIUzI1NiIs...`         |

3. Also add them for the **Preview** environment if you use preview deployments
4. Trigger a new deployment (push any commit or click **Retry deployment**)

---

## Step 6 — Verify

After deployment:
1. Open your Cloudflare Pages URL
2. You should see the **Sign In** page
3. Sign in with the admin account you created in Step 3
4. The topbar should show **🟢 Live DB** and your name with **🔑 admin** badge
5. Go to Dashboard — you should see the seeded data

---

## Local Development

Create a `.env` file in the project root (copy from `.env.example`):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Then run:
```bash
npm install
npm run dev
```

If `.env` is missing or has placeholder values, the app runs in **Local mode**
(🟡 Local badge in topbar) using in-memory data — no login required.

---

## Role Permissions Summary

| Action                          | Admin | Department User | Viewer (no account) |
|---------------------------------|-------|-----------------|---------------------|
| View all pages                  | ✅    | ✅              | ❌ (login required) |
| View master data                | ✅    | ✅              | ❌                  |
| Create spare parts              | ✅    | ✅              | ❌                  |
| Upload images & documents       | ✅    | ✅              | ❌                  |
| Edit functional group, desc, qty| ✅    | ✅              | ❌                  |
| Edit code segments (cat/mfr/model/disc) | ✅ | ❌         | ❌                  |
| Edit master data (categories, manufacturers, etc.) | ✅ | ❌ | ❌          |
| Delete (soft delete)            | ✅    | ❌              | ❌                  |
| View audit log                  | ✅    | ❌              | ❌                  |
| Manage users                    | ✅    | ❌              | ❌                  |

---

## Storage Buckets

| Bucket            | Public | Usage             |
|-------------------|--------|-------------------|
| `part-images`     | Yes    | Part photos       |
| `part-datasheets` | No     | PDF datasheets    |
| `part-manuals`    | No     | PDF manuals       |
| `part-drawings`   | No     | Technical drawings|

Files are stored at path: `{part_code}/{timestamp}.{ext}`
Only the URL is stored in the database (`image_url`, `datasheet_url`, etc.)

---

## Security Notes

- Passwords are never stored in plain text (Supabase Auth handles this)
- API keys in `.env` are **never committed to git** (`.env` is in `.gitignore`)
- The `anon` key is safe to expose in the browser — RLS policies enforce access control at the database level
- Hard deletes are blocked by RLS — only soft deletes (setting `deleted_at`) are permitted
- All operations are logged in `audit_logs` table

---

## Files Changed in v3.0

| File                                          | Change          | Reason                                      |
|-----------------------------------------------|-----------------|---------------------------------------------|
| `src/App.jsx`                                 | Modified        | Auth, useDb, new pages, topbar, nav         |
| `src/lib/supabase.js`                         | **New**         | Supabase client singleton                   |
| `src/lib/db.js`                               | **New**         | All DB query functions (CRUD + audit)       |
| `package.json`                                | Modified        | Added `@supabase/supabase-js`               |
| `.env.example`                                | **New**         | Template for environment variables          |
| `supabase/migrations/001_initial_schema.sql`  | **New**         | Full PostgreSQL schema with soft delete     |
| `supabase/migrations/002_seed_data.sql`       | **New**         | All INIT_* data inserted into DB            |
| `supabase/migrations/003_rls_policies.sql`    | **New**         | Row Level Security + storage policies       |
| `supabase/migrations/004_audit_triggers.sql`  | **New**         | Auto-audit triggers on all core tables      |
| `SUPABASE_SETUP.md`                           | **New**         | This file — deployment guide                |
