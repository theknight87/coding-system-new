# Engineering Spare Parts Master Coding System

## Project Overview

This is a production application.

It is already deployed on Cloudflare Pages.

Do not redesign it.

Do not rewrite it.

Preserve the current architecture.

Only modify files required for the requested feature.

---

# Tech Stack

Frontend

- React
- Vite

Hosting

- Cloudflare Pages

Backend

- Supabase

Database

- PostgreSQL

Authentication

- Supabase Auth

Storage

- Supabase Storage

---

# Architecture Rules

Never change the project structure.

Never rename files.

Never move files.

Never remove existing features.

Never redesign UI.

Keep responsive layout.

Keep build working.

npm run build must always succeed.

---

# UI Rules

Keep existing colors.

Keep typography.

Keep layout.

Keep navigation.

Keep component names.

Only add UI when required.

---

# Coding Rules

Use React Functional Components.

Use Hooks.

Avoid duplicated code.

Reuse existing components.

Keep code clean.

Comment only when necessary.

---

# Database Rules

Use PostgreSQL.

Normalize database.

Use foreign keys.

Prevent duplicate spare part codes.

Use Soft Delete only.

Never permanently delete records.

---

# Authentication

Use Supabase Authentication.

Passwords must never be stored in plain text.

Use secure authentication.

---

# Authorization

Roles

Admin

Department User

Admin has full permissions.

Department User

Can create spare parts.

Can upload images.

Can edit only:

- Functional Group

- Sequential Number

- Description

Cannot delete anything.

Cannot edit master data.

---

# Storage

Use Supabase Storage.

Store only URLs in database.

Support:

Images

PDF Datasheets

PDF Manuals

Drawings

---

# Audit Log

Every operation must be logged.

Create

Update

Delete

Login

Logout

Export

Image Upload

---

# Reports

Support

Excel Export

PDF Export

Search

Filtering

---

# Cloudflare

Must remain compatible with Cloudflare Pages.

Do not introduce server-only code.

---

# Performance

Lazy loading where appropriate.

Optimize bundle.

Avoid unnecessary libraries.

---

# Security

Validate all inputs.

Never expose secrets.

Never hardcode API keys.

Never expose passwords.

Use Row Level Security.

---

# Git

Create logical commits.

Do not modify unrelated files.

Explain every modified file.

---

# Final Checklist

Before finishing:

✓ npm run build succeeds

✓ No existing feature is broken

✓ UI preserved

✓ Database migrations included

✓ SQL included

✓ Supabase policies included

✓ Storage policies included

✓ Authentication documented

✓ Explain every changed file

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
