/**
 * Deletes all transactional data (members, students, registrations, payments, staff, content
 * and logs) while keeping reference data: portal settings, courses, course levels and sections,
 * membership tiers, and the super admin account. IDs restart from 1.
 *
 *   pnpm --filter @workspace/scripts run reset-transactional -- --yes
 *
 * Refuses to run without --yes. When NODE_ENV=production it also requires --production.
 * Take a backup first; this cannot be undone.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

// Every table that holds transactional data. Reference tables are deliberately absent.
const TRANSACTIONAL_TABLES = [
  // Members and students
  "members", "membership_payments", "member_access_challenges",
  "students", "student_registrations", "enrollments", "payments", "student_fees", "attendance_records",
  // Staff
  "teachers", "teacher_assignments", "section_assignments", "portal_users", "teacher_notes",
  // Content and communication
  "announcements", "events", "testimonials", "weekly_updates", "parent_notifications",
  "admin_messages", "email_logs", "contacts", "admin_tasks",
  // Operations and logs
  "inventory", "audit_logs",
];

if (!process.argv.includes("--yes")) {
  console.error("This permanently deletes all transactional data. Re-run with --yes to confirm.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !process.argv.includes("--production")) {
  console.error("NODE_ENV is production. Re-run with --yes --production to confirm you mean this database.");
  process.exit(1);
}

try {
  const counts: string[] = [];
  for (const table of TRANSACTIONAL_TABLES) {
    const result = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM "${table}"`));
    const n = Number((result.rows[0] as { n: number }).n);
    if (n) counts.push(`${table}=${n}`);
  }
  console.log(counts.length ? `Deleting: ${counts.join(", ")}` : "No transactional rows found.");

  await db.transaction(async tx => {
    await tx.execute(sql.raw(`TRUNCATE ${TRANSACTIONAL_TABLES.map(t => `"${t}"`).join(", ")} RESTART IDENTITY`));
    // Staff and admin accounts other than the super admin are transactional too.
    await tx.execute(sql`DELETE FROM admin_users WHERE role <> 'super_admin'`);
    // Enrollment counters on the course catalogue start again from zero.
    await tx.execute(sql`UPDATE course_levels SET enrolled = 0`);
  });
  console.log("Transactional data removed. Reference data (settings, courses, levels, sections, tiers, super admin) kept.");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
