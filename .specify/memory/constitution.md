<!--
Sync Impact Report
- Version change: [TEMPLATE] → 1.0.0 (initial ratification)
- Modified principles: n/a (first concrete adoption; all placeholders replaced)
- Added sections: Core Principles (I–V), Technology & Compatibility Constraints,
  Development Workflow & Quality Gates, Governance
- Removed sections: none
- Templates requiring follow-up: none — plan/spec/tasks templates read this file at
  runtime and need no edits for this ratification.
- Deferred/TODO items: RATIFICATION_DATE unknown (original adoption date of the
  governance rules in CLAUDE.md predates this file); marked TODO below.
-->

# Engineering Spare Parts Master Coding System Constitution

## Core Principles

### I. Preserve the Existing Architecture (NON-NEGOTIABLE)
This is a production application already deployed on Cloudflare Pages. Work MUST NOT
redesign or rewrite the application, change the project structure, rename or move
files, or remove existing features. Every change MUST modify only the files required
for the requested feature or fix. UI redesigns are prohibited; existing colors,
typography, layout, navigation, and component names MUST be kept unless a change is
explicitly requested. `npm run build` MUST always succeed after any change.
Rationale: the system is live and in active use; unreviewed structural or visual churn
risks breaking production workflows and user trust.

### II. Fixed Technology Stack & Cloudflare Compatibility
The stack is React + Vite on the frontend, Supabase (PostgreSQL, Auth, Storage) on the
backend, hosted on Cloudflare Pages. Implementations MUST use React functional
components and hooks, MUST remain compatible with Cloudflare Pages, and MUST NOT
introduce server-only code (e.g., Node-only runtime APIs) that Pages cannot serve.
New dependencies MUST be justified — avoid unnecessary libraries and prefer reusing
existing components over adding new ones. Duplicated code MUST be avoided.
Rationale: swapping infrastructure or adding incompatible runtime dependencies would
break deployment on the current hosting platform.

### III. Role-Based Authorization Is Enforced Everywhere
Two roles exist: Admin and Department User. Admin has full permissions. Department
User MAY create spare parts and upload images, MAY edit only Functional Group,
Sequential Number, and Description, and MUST NOT delete anything or edit master data.
Every feature touching spare parts, uploads, or edits MUST enforce this boundary at
both the UI and the database (Row Level Security) layers — UI-only restriction is
insufficient.
Rationale: the authorization model is a core business rule; enforcing it only in the
UI would allow privilege escalation via direct API/database access.

### IV. Data Integrity, Soft Delete, and No Duplicate Codes
The database MUST be normalized and use foreign keys. Spare part codes MUST be unique;
duplicate codes MUST be prevented at the database level (constraint), not only in the
UI. Deletion MUST always be soft delete — records MUST NOT be permanently removed by
any feature, migration, or maintenance script.
Rationale: spare parts data is master reference data; hard deletes or duplicate codes
corrupt downstream reports, audit history, and cross-references.

### V. Security, Auditability, and Input Validation
Passwords MUST never be stored in plain text; Supabase Auth MUST be used for all
authentication. Secrets and API keys MUST NOT be hardcoded or exposed to the client
beyond what Supabase's publishable keys are designed for. All user input MUST be
validated. Row Level Security MUST be used on all Supabase tables holding
application data. Every Create, Update, Delete, Login, Logout, Export, and Image
Upload operation MUST be recorded in the audit log.
Rationale: this system manages engineering master data across roles; without
enforced auth hygiene and a complete audit trail, incidents cannot be investigated
or attributed.

## Technology & Compatibility Constraints

Storage: Supabase Storage MUST be used for all binary assets (images, PDF
datasheets, PDF manuals, drawings); only their URLs are stored in the database,
never binary blobs in Postgres. Reporting: Excel export, PDF export, search, and
filtering are supported features and MUST continue to function after any change
that touches the data or reporting layers. Performance: use lazy loading where
appropriate and keep the production bundle optimized; avoid pulling in heavy
libraries for small gains.

## Development Workflow & Quality Gates

Every commit MUST be a logical, scoped commit that does not touch unrelated files,
and its description MUST explain every file it changes. Before any change is
considered complete, the following MUST all be verified: `npm run build` succeeds;
no existing feature is broken; the UI is visually unchanged except where the task
required a change; any database schema change ships with the accompanying SQL
migration; any new or changed Supabase Row Level Security policy is included; any
new or changed Storage policy is included; authentication-relevant changes are
documented. Feature work driven through Spec Kit (`/speckit-specify`,
`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`) MUST treat this
constitution as a hard constraint on generated specs and plans, not a suggestion.

## Governance

This constitution codifies the non-negotiable rules already established in
`CLAUDE.md` for this repository; where the two overlap, they MUST stay consistent,
and `CLAUDE.md` remains the authoritative day-to-day instruction set for coding
agents working in this repo. Amendments to this constitution require: (1) an
explicit description of the proposed change and its rationale, (2) a semantic
version bump — MAJOR for removing or redefining a principle, MINOR for adding a
principle or materially expanding guidance, PATCH for wording/clarification only —
and (3) updating `LAST_AMENDED_DATE` below. Any plan, spec, or task generated by
Spec Kit commands that conflicts with a principle here MUST be revised or must
document an explicit, justified exception before implementation proceeds. Reviewers
MUST treat a violation of Principle I, III, IV, or V as a blocking issue.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): original adoption date of the CLAUDE.md governance rules is not recorded | **Last Amended**: 2026-08-29
