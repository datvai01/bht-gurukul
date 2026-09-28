# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Gurukul Admin Portal

Accessible at `/admin`. Three roles with role-based access control.

**Login system:**
- **Admin**: email + password (local, hardcoded) → `admin@gurukul.org` / `Admin@123`
- **Teachers & Assistants**: phone number (10 digits) + 4-digit PIN (created by admin, stored hashed via bcryptjs in DB)
- Smart auto-detection on the login page: entering digits switches the UI to phone+PIN mode
- Legacy: `gurukuluser01` / `gurukuladmin` still works

**PIN auth features:**
- Admin creates users at `/admin/roles` (User Management) — system generates a random 4-digit PIN shown once
- Admin can reset any user's PIN (new PIN displayed once, old one instantly invalid)
- Max 5 failed attempts → 15-minute account lock
- Users can change their own PIN in Settings → Change PIN section
- PINs stored as bcrypt hashes in `portal_users` table

Auth is localStorage-based (structured for production backend integration). **All admin data is live from PostgreSQL.**

### RBAC Files
- `artifacts/gurukul/src/admin/rbac.ts` — role permissions model (admin/teacher/assistant)
- `artifacts/gurukul/src/admin/AuthContext.tsx` — React auth context (wraps AdminApp)
- `artifacts/gurukul/src/admin/auth.ts` — multi-user login + localStorage
- `artifacts/gurukul/src/admin/AdminApp.tsx` — ProtectedRoute with permission checks
- `artifacts/gurukul/src/admin/AdminLayout.tsx` — role-filtered sidebar + user badge in header
- `artifacts/gurukul/src/admin/components/AccessDenied.tsx` — shown for unauthorized routes

### Admin Pages
- Dashboard, Announcements, Calendar, **Course Management** (full CRUD), Teacher Assignment, Students & Payments, Inventory, Settings, Role Management — **Admin only**
- Course Documents, Attendance, Parent Notifications, **Courses & Classes (read-only)** — **Admin + Teacher + Assistant**
- Course Management features: create/edit/archive/delete courses; add/remove levels (up to 7); add/edit/delete sections per level; teacher-to-section assignment; section chips visible on level rows

### Curriculum Year Governance
All four core modules are tied to a curriculum year (filtered + stored per record):
- **Students**: `curriculum_year` (long format "2027-2028"); filter defaults to `activeCurriculumYearLong`
- **Courses**: `curriculum_year` (short format "2027-28"); filter defaults to `activeCurriculumYear`
- **Teachers**: `curriculum_year` (long format "2027-2028"); filter defaults to `activeCurriculumYearLong` ← added
- **Inventory**: `curriculum_year` (long format "2027-2028"); filter defaults to `activeCurriculumYearLong` ← added

Year filter on each page is a dropdown (with a calendar icon) that auto-selects the active curriculum year on load via `useEffect`. New records default to the page-level selected year. "All Years" option shows all records.

### Audit Log (`/admin/audit` — admin-only)
- DB: `audit_logs` table with columns: adminName, **userRole**, moduleName, actionType, entityName, entityId, previousValue, newValue, **curriculumYear**, ipAddress, userAgent, createdAt
- Retention: 7 days default (max 15); auto-purge scheduler runs every 6 h
- Modules tracked: Student Registration, Staff Management, Course Management, **Inventory** (new), Communication Hub, User Management, Member Management, Settings Management, Academic Management, Operations
- Actions: Add, Edit, Delete, **Validate**, **Status Change**, **Config Update**
- Filters: Module, Action, Role, Username (from /audit/users dropdown), Curriculum Year, Date range, Search
- Chart: Recharts BarChart (7-day activity per user, grouped bars, custom tooltip with module breakdown)
- Edit detail view: 3-column diff table (Field | Original | Updated) with changed fields highlighted in yellow
- API: GET /audit (list+filters), GET /audit/users, GET /audit/activity, POST /audit/purge, GET /audit/export (CSV)
- writeAudit now captures userRole from X-User-Role header + curriculumYear context
- Inventory ADD/EDIT/DELETE now emit audit records; teachers PUT + students PATCH now capture full previousValue before update

### DB Tables (PostgreSQL, managed by Drizzle ORM)
- `courses` — course master (`archivedAt` column for soft delete); has `curriculum_year`
- `course_levels` — levels 1-7 per course, with class name, schedule, capacity
- `course_sections` — sections within a level (Morning Batch, Section A, etc.); cascades on level delete
- `section_assignments` — teacher↔section assignment with role (Teacher/Assistant); cascades on section delete
- `teacher_assignments` — teacher↔course assignment with level range
- `enrollments` — includes nullable `section_id` FK → `course_sections.id` (onDelete: set null); a student is assigned to the full Course → Level → Section hierarchy
- `students` — extended fields: `dob`, `grade`, `is_new_student`, `mother_name/phone/email`, `father_name/phone/email`, `address`, `registration_source` ("public"|"admin"), `curriculum_year` (all nullable)
- `teachers` — has `curriculum_year` (long format); year-filtered in Staff Management page
- `inventory` — supplies/materials tracking; has `curriculum_year` (long format); year-filtered in Inventory page
- `members` — temple member records; includes validation columns: `validation_status` (default "Invalidated"), `validation_date`, `validated_by_admin_name`, `id_card_type_seen`, `id_card_number_last4`, `id_card_issuing_authority`, `validation_notes`
- `attendance_records` — per student per level per date attendance (Present/Absent/Late)
- `parent_notifications` — audience-targeted notifications with Draft/Published/Sent status

### Admin API Routes (`/api/admin/`)
- `GET/POST /teachers` — teacher list with course assignments; `PUT/DELETE /teachers/:id`
- `GET /students` — students joined with enrollments, courses, payments (1 row per enrollment)
- `GET/POST /inventory` — inventory items; `PUT/DELETE /inventory/:id`; `PATCH /inventory/:id/replenish`
- `GET/POST /announcements` — `PUT/DELETE /announcements/:id`; `PATCH /announcements/:id/toggle`
- `GET/POST /events` — `PUT/DELETE /events/:id`
- `GET /courses` — courses with levels, sections, and live enrollment counts (`?includeArchived=true` to include archived)
- `POST /courses` — create course with N levels (auto-generates level rows)
- `PUT /courses/:id` — update course metadata
- `PATCH /courses/:id/archive` — toggle archive (soft delete)
- `DELETE /courses/:id` — delete course (blocked if enrolled students exist)
- `POST /courses/:id/levels` — add a level; `PUT /courses/levels/:id` — update; `DELETE /courses/levels/:id` — remove
- `GET /courses/levels/:id/sections` — list sections; `POST /courses/levels/:id/sections` — add section
- `PUT /courses/sections/:id` — update section; `DELETE /courses/sections/:id` — remove section
- `POST /courses/sections/:id/assign` — assign teacher to section; `DELETE /courses/sections/:id/unassign/:teacherId`
- `GET /courses/levels/:id/students` — enrolled students for a level; supports `?sectionId=X` to filter to a specific section
- `GET /students` — all students with enrollment/payment details (flat rows)
- `GET /students/meta` — returns nextStudentCode + available courses/levels/sections for registration form
- `GET /members` — list all members with validation fields; default sort is overdue-first, then invalidated, then validated
- `PATCH /members/:id/validate` — (admin-only) mark member as identity-verified; body: `{ idCardTypeSeen, idCardNumberLast4?, idCardIssuingAuthority?, validationNotes? }`; writes audit log to "Member Management" module
- `POST /students` — register a new student; body includes `registrationSource?: "public"|"admin"`. Public submissions are validated against the registration window (403 if outside window or no window configured); admin submissions bypass the window check. Stores `registrationSource` on the student record.
- `DELETE /students/:code` — remove a student and all enrollments/payments (cascades)
- `PATCH /students/enrollments/:enrollmentId/section` — assign student to section
- `PATCH /students/payments/:enrollmentId` — (admin-only) update a payment record; body: `{ amountDue?, amountPaid?, paymentStatus?, paymentMethod?, receiptId?, paymentDate? }`; writes audit log. Online Stripe payments do NOT auto-update this table — admin must record manually.
- `GET /attendance/levels` — all course levels with course names (for Attendance dropdown)
- `GET /attendance?levelId&date` — records for one level+date
- `GET /attendance/history?levelId` — full history for a level
- `POST /attendance` — upsert attendance records (delete+insert for levelId+date)
- `GET/POST /notifications` — parent notifications
- `PATCH /notifications/:id/status` — update notification status

### DB Schema (`lib/db/src/schema/gurukul.ts`)
Tables: courses, course_levels, teachers, teacher_assignments, students, enrollments, payments, inventory, announcements, events, contacts, attendance_records, parent_notifications.
Enums: teacher_status, course_level_status, enrollment_status, payment_status, attendance_status, notification_status, notification_priority.

Push schema: `cd lib/db && pnpm run push-force`.

## Public Student Registration (`/register`)

Implements "BHT Gurukul Student Registration Flow & Validations" (v4/v6).

**Flow:** choose Existing BHT Member / New Member → email OTP (existing members see only a masked email
before OTP; new members' phone and email must not exist anywhere in BHT records) → new members complete
membership (first and last name stored separately) → student details, checked for age (≥ 6 on the Session
Start Date), duplicate student (member + first + last name + DOB) and duplicate current-year registration →
course selection (one level per course, course-specific fees) → policy acceptance → submit.

**Rules enforced on the server** (`routes/admin/students.ts`, `routes/admin/members.ts`, `routes/payments.ts`):
- One registration per student per curriculum year; parents cannot change subjects after submission
  (admins can, with a required reason recorded in the audit log).
- Fees come only from administrator configuration — nothing is hard-coded. A course with no fee cannot be
  selected, and new memberships are blocked if the membership fee is not configured.
- Membership ends December 31 of its year; a paid advance renewal (next year's `membership_payments` row
  marked Paid) extends it through December 31 of the following year (`members.membership_year`).
- Payment never blocks registration. Validated members choose Pay Online or Temple Desk; new/unvalidated
  members pay at the Temple Desk only. Unpaid rows carry `pending_reason`
  ("Temple Desk Payment" or "Temple Desk Validation/Payment").

**Admin configuration required before public registration opens** (Settings + Course Management):
Registration curriculum year, Registration Open/Close dates, **Session Start/End dates**, annual
membership fee, and a **fee on every course**. Missing values block registration with a clear message.

**Schema additions:** `members.first_name`, `members.last_name` (existing names are split automatically
at API startup), `payments.pending_reason`, `membership_payments.pending_reason`. Apply with
`pnpm --filter @workspace/db run push`.

**Local development (outside Replit):** the Vite dev server proxies `/api` when `API_PROXY_TARGET` is set,
e.g. `PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter @workspace/gurukul run dev`.
With `MEMBER_EMAIL_PROVIDER=console` (development only, ignored in production) verification codes are
written to the API log instead of being emailed.

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
