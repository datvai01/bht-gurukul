# Gurukul Portal — Database DDL

This folder contains a schema-only PostgreSQL DDL snapshot of the Gurukul Portal database, generated
from the Drizzle schema in `lib/db/src/schema/`. It contains no table data or credentials.

## Files

| File | Description |
|------|-------------|
| `schema.sql` | Full database schema — enums, tables, foreign keys, unique constraints and indexes |

## Tables (33)

### Core Gurukul
| Table | Purpose |
|-------|---------|
| `courses` | Course catalogue; class timing (`schedule`) and fee are set per course |
| `course_levels` | Levels within each course (all levels share the course timing) |
| `course_sections` | Class sections under each level, assigned by administrators |
| `students` | Student profiles, including the primary parent (Mother or Father) |
| `student_registrations` | One registration per student per curriculum year |
| `enrollments` | Student → course level (and optional section) for a registration |
| `teachers` | Teacher and teaching assistant profiles |
| `teacher_assignments` | Teacher → course assignments |
| `section_assignments` | Teacher → section assignments |

### Attendance & Updates
| Table | Purpose |
|-------|---------|
| `attendance_records` | Per-student, per-session attendance |
| `weekly_updates` | Teacher-published weekly class updates (shown on Parent Portal) |
| `teacher_notes` | Private sticky notes for teachers (visible only to the author) |

### Portal & Auth
| Table | Purpose |
|-------|---------|
| `admin_users` | Super admin and admin accounts (password / PIN hashes) |
| `portal_users` | Teacher / Assistant portal accounts (phone + bcrypt PIN) |
| `portal_settings` | Global portal configuration key-value store |
| `member_access_challenges` | One-time codes: member email verification, admin sign-in codes, rate limits |
| `admin_tasks` | Admin tasks and reminders |
| `audit_logs` | Administrative activity history |

### Communication
| Table | Purpose |
|-------|---------|
| `announcements` | Admin announcements (shown on public site and teacher portal) |
| `events` | Gurukul events calendar |
| `admin_messages` | In-portal messages sent by admins to teachers / parents |
| `parent_notifications` | Notification log for parent-facing communications |
| `bulk_emails` | "Send Email" from Student / Member Management: one row per send (email audit log) |
| `bulk_email_recipients` | Per-address delivery status for each send (used to retry failures only) |
| `email_logs` | Legacy email log (no longer written by the application) |
| `contacts` | Contact form submissions |

### Membership & Finance
| Table | Purpose |
|-------|---------|
| `members` | Temple membership records (first/last name, address, spouse, validation) |
| `membership_tiers` | Membership types (annual and lifetime tiers) |
| `membership_payments` | One membership fee row per member per year (with discount) |
| `payments` | Student course fee records |
| `student_fees` | One-time student fees such as Bag & Supplies |
| `inventory` | Gurukul inventory / asset tracking |
| `testimonials` | Parent / student testimonials shown on public website |

## Regenerating the DDL

Run from `lib/db` after changing the Drizzle schema (no database connection is needed):

```bash
npx drizzle-kit export --dialect postgresql --schema ./src/schema/index.ts > ddl/schema.sql
```

Then put back the three header comment lines at the top of `schema.sql`.

## Applying schema changes

This DDL is a reference snapshot, not a migration. Apply schema changes to a database with:

```bash
pnpm --filter @workspace/db run push
```

On an existing database, answer **No** if it ever offers to truncate or delete data. See
`DEPLOYMENT.md` for the production (Azure) steps.
