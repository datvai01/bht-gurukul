/**
 * Loads the reference data a fresh BHT Gurukul database needs: portal settings, the course
 * catalogue with its levels, membership tiers, and the super admin account.
 *
 * Safe to run more than once: existing rows are kept, and only missing ones are added.
 *   pnpm --filter @workspace/scripts run bootstrap
 *   pnpm --filter @workspace/scripts run bootstrap -- --overwrite-settings --update-courses
 *
 * Environment:
 *   DATABASE_URL                   target database (required)
 *   SUPER_ADMIN_INITIAL_PASSWORD   password for the super admin, used only when the account
 *                                  does not exist yet (at least 12 characters)
 *
 * Reference data lives in scripts/reference-data/*.json; edit those files to change it.
 */
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  adminUsersTable,
  courseLevelsTable,
  coursesTable,
  membershipTiersTable,
  portalSettingsTable,
} from "@workspace/db/schema";

// Must match SUPER_ADMIN_EMAIL in artifacts/api-server/src/routes/auth.ts.
const SUPER_ADMIN_EMAIL = "admin@gurukul.org";

const overwriteSettings = process.argv.includes("--overwrite-settings");
const updateCourses = process.argv.includes("--update-courses");

type CourseData = {
  // previousNames: earlier names of the same course, so a rename updates it instead of adding a duplicate.
  name: string; previousNames?: string[]; icon: string; description: string; ageGroup: string; level: string;
  schedule: string; instructor: string; learningAreas: unknown; levelsDetail: unknown;
  outcome: string | null; curriculumYear: string | null; fee: number | null;
  levels: { levelNumber: number; className: string; capacity: number; status: "Active" | "Inactive" }[];
};
type TierData = { name: string; category: "annual" | "lifetime"; fee: number | null; sortOrder: number };

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(`../reference-data/${file}`, import.meta.url), "utf8")) as T;
}

async function bootstrapSettings() {
  const { settings } = readJson<{ settings: Record<string, string> }>("settings.json");
  let added = 0, updated = 0;
  for (const [key, value] of Object.entries(settings)) {
    const [existing] = await db.select().from(portalSettingsTable).where(eq(portalSettingsTable.key, key));
    if (!existing) {
      await db.insert(portalSettingsTable).values({ key, value });
      added++;
    } else if (overwriteSettings && existing.value !== value) {
      await db.update(portalSettingsTable).set({ value, updatedAt: new Date() }).where(eq(portalSettingsTable.key, key));
      updated++;
    }
  }
  console.log(`Settings: ${added} added, ${updated} updated${overwriteSettings ? "" : " (existing values kept)"}`);
}

async function bootstrapCourses() {
  const courses = readJson<CourseData[]>("courses.json");
  let coursesAdded = 0, coursesUpdated = 0, levelsAdded = 0;
  for (const course of courses) {
    const fields = {
      name: course.name,
      icon: course.icon,
      description: course.description,
      ageGroup: course.ageGroup,
      level: course.level,
      schedule: course.schedule,
      instructor: course.instructor,
      learningAreas: course.learningAreas == null ? null : JSON.stringify(course.learningAreas),
      levelsDetail: course.levelsDetail == null ? null : JSON.stringify(course.levelsDetail),
      outcome: course.outcome,
      curriculumYear: course.curriculumYear,
    };
    let [row] = await db.select().from(coursesTable).where(eq(coursesTable.name, course.name));
    for (const previous of course.previousNames ?? []) {
      if (row) break;
      [row] = await db.select().from(coursesTable).where(eq(coursesTable.name, previous));
    }
    if (!row) {
      [row] = await db.insert(coursesTable)
        .values({ ...fields, fee: course.fee == null ? null : course.fee.toFixed(2) })
        .returning();
      coursesAdded++;
    } else if (updateCourses) {
      // A fee already set by the administrator is kept unless the file provides one.
      await db.update(coursesTable)
        .set({ ...fields, ...(course.fee != null ? { fee: course.fee.toFixed(2) } : {}) })
        .where(eq(coursesTable.id, row.id));
      coursesUpdated++;
    }
    for (const level of course.levels) {
      const [existing] = await db.select({ id: courseLevelsTable.id }).from(courseLevelsTable)
        .where(and(eq(courseLevelsTable.courseId, row.id), eq(courseLevelsTable.levelNumber, level.levelNumber)));
      if (existing) continue;
      // Levels have no timing of their own; class timing is set on the course.
      await db.insert(courseLevelsTable).values({
        courseId: row.id,
        levelNumber: level.levelNumber,
        className: level.className,
        capacity: level.capacity,
        status: level.status,
        enrolled: 0,
      });
      levelsAdded++;
    }
  }
  console.log(`Courses: ${coursesAdded} added, ${coursesUpdated} updated; levels: ${levelsAdded} added`);
}

async function bootstrapTiers() {
  const { tiers } = readJson<{ tiers: TierData[] }>("membership-tiers.json");
  let added = 0;
  for (const tier of tiers) {
    const inserted = await db.insert(membershipTiersTable).values({
      name: tier.name,
      category: tier.category,
      fee: tier.fee == null ? null : tier.fee.toFixed(2),
      sortOrder: tier.sortOrder,
    }).onConflictDoNothing({ target: membershipTiersTable.name }).returning({ id: membershipTiersTable.id });
    added += inserted.length;
  }
  console.log(`Membership tiers: ${added} added`);
}

async function bootstrapSuperAdmin() {
  const [existing] = await db.select({ id: adminUsersTable.id }).from(adminUsersTable)
    .where(eq(adminUsersTable.role, "super_admin")).limit(1);
  if (existing) {
    console.log("Super admin: already exists (unchanged)");
    return;
  }
  const password = process.env.SUPER_ADMIN_INITIAL_PASSWORD ?? "";
  if (password.length < 12) {
    throw new Error("Set SUPER_ADMIN_INITIAL_PASSWORD (at least 12 characters) to create the super admin account.");
  }
  await db.insert(adminUsersTable).values({
    name: "Super Admin",
    email: SUPER_ADMIN_EMAIL,
    phone: null,
    pinHash: await bcrypt.hash(password, 10),
    role: "super_admin",
    status: "active",
    pinChanged: false,
  });
  console.log(`Super admin: created (${SUPER_ADMIN_EMAIL}); change the password after first login`);
}

try {
  await bootstrapSettings();
  await bootstrapCourses();
  await bootstrapTiers();
  await bootstrapSuperAdmin();
  console.log("Reference data bootstrap complete.");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
