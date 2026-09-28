# Gurukul Portal — Database DDL

This folder contains a schema-only PostgreSQL DDL snapshot of the Gurukul Portal **development** database. It contains no table data or credentials. The older, incomplete `database/schema.sql` snapshot was removed to avoid conflicting references.

## Files

| File | Description |
|------|-------------|
| `schema.sql` | Full database schema — all tables, sequences, indexes, and constraints |

## Tables (29 in this snapshot)

### Core Gurukul
| Table | Purpose |
|-------|---------|
| `courses` | Course catalogue (Hindi, Sanskrit, Dharma, Telugu, Tamil, Gujarati, Music) |
| `course_levels` | Levels within each course (Level 1–7) |
| `course_sections` | Class sections under each level (batches / time slots) |
| `students` | Student profiles |
| `enrollments` | Student → section enrolments |
| `teachers` | Teacher and teaching assistant profiles |
| `teacher_assignments` | Teacher → course assignments |
| `section_assignments` | Teacher → section assignments |

### Attendance & Updates
| Table | Purpose |
|-------|---------|
| `attendance_records` | Per-student, per-session attendance |
| `weekly_updates` | Teacher-published weekly class updates (shown on Parent Portal) |
| `teacher_notes` | Private sticky notes for teachers (visible only to the author) |
| `student_registrations` | Registration history for students |

### Portal & Auth
| Table | Purpose |
|-------|---------|
| `admin_users` | Super Admin accounts (email + bcrypt password) |
| `portal_users` | Teacher / Assistant portal accounts (phone + bcrypt PIN) |
| `portal_settings` | Global portal configuration key-value store |
| `member_access_challenges` | Temporary member-access verification challenges |
| `admin_tasks` | Admin tasks and reminders |
| `audit_logs` | Administrative activity history |

### Communication
| Table | Purpose |
|-------|---------|
| `announcements` | Admin announcements (shown on public site and teacher portal) |
| `events` | Gurukul events calendar |
| `admin_messages` | Messages sent by admin to teachers / parents |
| `parent_notifications` | Notification log for parent-facing communications |
| `email_logs` | SMTP email delivery log |
| `contacts` | Contact form submissions |

### Membership & Finance
| Table | Purpose |
|-------|---------|
| `members` | Temple membership records (used for Parent Portal phone verification) |
| `membership_payments` | Annual membership fee records |
| `payments` | Student fee payment records |
| `inventory` | Gurukul inventory / asset tracking |
| `testimonials` | Parent / student testimonials shown on public website |

## Regenerating the DDL

Run from the project root against the development database (not production):

```bash
PGPASSWORD=<password> pg_dump \
  --host=<host> \
  --username=<user> \
  --dbname=<dbname> \
  --schema-only \
  --no-owner \
  --no-privileges \
  -F p \
  > lib/db/ddl/schema.sql
```

Or use the `DATABASE_URL` environment variable directly:

```bash
pg_dump "$DATABASE_URL" --schema-only --no-owner --no-privileges > lib/db/ddl/schema.sql
```

## ORM

The database is managed via [Drizzle ORM](https://orm.drizzle.team/). Application schema definitions live in:

```
lib/db/src/schema/
```

This DDL is a reference snapshot, not an automatic migration or a command to run against a populated database. Review changes before applying any development schema change. Production schema updates for the managed database happen through Replit's Publish flow.
