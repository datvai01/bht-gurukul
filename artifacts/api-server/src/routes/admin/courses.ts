import { Router, type IRouter } from "express";
import { writeAudit } from "../../lib/audit";
import { db } from "@workspace/db";
import {
  coursesTable,
  courseLevelsTable,
  courseSectionsTable,
  sectionAssignmentsTable,
  teacherAssignmentsTable,
  teachersTable,
  enrollmentsTable,
  studentsTable,
  paymentsTable,
  adminUsersTable,
} from "@workspace/db/schema";
import { eq, sql, isNull, and, inArray } from "drizzle-orm";

const router: IRouter = Router();

// ─── Scoping helpers ──────────────────────────────────────────────────────────

/**
 * Returns the single course ID assigned to the course_coordinator with the
 * given phone number, or null if not found / not assigned.
 */
async function getCoordinatorCourseId(phone: string): Promise<number | null> {
  const [admin] = await db
    .select({ assignedCourseId: adminUsersTable.assignedCourseId })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.phone, phone))
    .limit(1);
  return admin?.assignedCourseId ?? null;
}

/**
 * Returns the course IDs assigned to the teacher with the given email,
 * or null if the email doesn't match any teacher in the DB (fallback: show all).
 */
async function getTeacherCourseIds(email: string): Promise<number[] | null> {
  const [teacher] = await db
    .select({ id: teachersTable.id })
    .from(teachersTable)
    .where(eq(teachersTable.email, email));
  if (!teacher) return null;
  const rows = await db
    .select({ courseId: teacherAssignmentsTable.courseId })
    .from(teacherAssignmentsTable)
    .where(eq(teacherAssignmentsTable.teacherId, teacher.id));
  return rows.map((r) => r.courseId);
}

// ─── Build helpers ────────────────────────────────────────────────────────────

async function buildAdminCourses(includeArchived = false, teacherCourseIds?: number[]) {
  let courseRows = await db
    .select()
    .from(coursesTable)
    .where(includeArchived ? undefined : isNull(coursesTable.archivedAt))
    .orderBy(coursesTable.id);

  // Scope to teacher's assigned courses when filter is provided
  if (teacherCourseIds !== undefined) {
    courseRows = courseRows.filter((c) => teacherCourseIds.includes(c.id));
  }

  const levels = await db.select().from(courseLevelsTable).orderBy(courseLevelsTable.levelNumber);
  const sections = await db.select().from(courseSectionsTable).orderBy(courseSectionsTable.id);

  // Teacher → section assignments (granular)
  const sectionTeachers = await db
    .select({
      sectionId:   sectionAssignmentsTable.sectionId,
      teacherId:   teachersTable.id,
      teacherName: teachersTable.name,
      role:        sectionAssignmentsTable.role,
    })
    .from(sectionAssignmentsTable)
    .leftJoin(teachersTable, eq(sectionAssignmentsTable.teacherId, teachersTable.id));

  const assignments = await db
    .select({
      courseId: teacherAssignmentsTable.courseId,
      levelFrom: teacherAssignmentsTable.levelFrom,
      levelTo: teacherAssignmentsTable.levelTo,
      teacherName: teachersTable.name,
      teacherStatus: teachersTable.status,
    })
    .from(teacherAssignmentsTable)
    .leftJoin(teachersTable, eq(teacherAssignmentsTable.teacherId, teachersTable.id));

  const enrollmentCounts = await db
    .select({
      courseLevelId: enrollmentsTable.courseLevelId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(enrollmentsTable)
    .where(sql`${enrollmentsTable.status} = 'Enrolled'`)
    .groupBy(enrollmentsTable.courseLevelId);

  const countMap: Record<number, number> = {};
  for (const row of enrollmentCounts) countMap[row.courseLevelId] = row.count;

  return courseRows.map((course) => {
    const courseLevels = levels
      .filter((l) => l.courseId === course.id)
      .map((l) => {
        const teacherNames = assignments
          .filter(
            (a) =>
              a.courseId === course.id &&
              a.levelFrom <= l.levelNumber &&
              a.levelTo >= l.levelNumber &&
              a.teacherStatus === "Active",
          )
          .map((a) => a.teacherName)
          .filter(Boolean);

        const levelSections = sections
          .filter((s) => s.courseLevelId === l.id)
          .map((s) => ({
            id:          s.id,
            sectionName: s.sectionName,
            schedule:    s.schedule ?? "",
            capacity:    s.capacity,
            status:      s.status,
            teachers:    sectionTeachers
              .filter((t) => t.sectionId === s.id && t.teacherId != null)
              .map((t) => ({ id: t.teacherId!, name: t.teacherName!, role: t.role })),
          }));

        return {
          id:        l.id,
          level:     l.levelNumber,
          className: l.className,
          schedule:  l.schedule ?? "",
          teacher:   teacherNames.join(" / ") || "TBD",
          enrolled:  countMap[l.id] ?? 0,
          capacity:  l.capacity,
          status:    l.status,
          sections:  levelSections,
        };
      });

    return {
      id:             course.id,
      name:           course.name,
      icon:           course.icon,
      description:    course.description,
      schedule:       course.schedule,
      ageGroup:       course.ageGroup,
      instructor:     course.instructor,
      curriculumYear: course.curriculumYear ?? null,
      fee:            course.fee != null ? parseFloat(course.fee) : null,
      archivedAt:     course.archivedAt,
      levels:         courseLevels,
    };
  });
}

// ─── Course CRUD ──────────────────────────────────────────────────────────────

// GET /api/admin/courses?includeArchived=true
router.get("/", async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const role  = req.headers["x-user-role"]  as string | undefined;
    const email = req.headers["x-user-email"] as string | undefined;
    const phone = req.headers["x-user-phone"] as string | undefined;

    // Course coordinator — always scoped (never falls through to unscoped admin view)
    // Uses email→teacher lookup when available, plus phone→assignedCourse fallback.
    // If neither header is present, returns an empty list rather than all courses.
    if (role === "course_coordinator") {
      const ids: number[] = [];
      if (email) {
        const teacherIds = await getTeacherCourseIds(email);
        if (teacherIds !== null) ids.push(...teacherIds);
      }
      if (phone) {
        const assignedId = await getCoordinatorCourseId(phone);
        if (assignedId != null && !ids.includes(assignedId)) ids.push(assignedId);
      }
      return res.json(await buildAdminCourses(includeArchived, ids));
    }

    // Teacher / assistant — scoped to their teacher-assigned courses
    if ((role === "teacher" || role === "assistant") && email) {
      const teacherIds = await getTeacherCourseIds(email);
      const ids: number[] = teacherIds !== null ? [...teacherIds] : [];
      return res.json(await buildAdminCourses(includeArchived, ids));
    }

    res.json(await buildAdminCourses(includeArchived, undefined));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin courses");
    res.status(500).json({ error: "Failed to fetch admin courses" });
  }
});

// POST /api/admin/courses — create a new course with initial levels and sections
router.post("/", async (req, res) => {
  try {
    const {
      name, description, icon, ageGroup, schedule, instructor,
      numLevels, numSectionsPerLevel, curriculumYear,
    } = req.body as {
      name: string; description: string; icon: string; ageGroup: string;
      schedule: string; instructor: string; numLevels: number;
      numSectionsPerLevel?: number; curriculumYear?: string;
    };

    if (!name?.trim()) return res.status(400).json({ error: "Course name is required" });

    const existing = await db.select().from(coursesTable).where(eq(coursesTable.name, name.trim()));
    if (existing.length > 0) return res.status(409).json({ error: "A course with this name already exists" });

    const [course] = await db
      .insert(coursesTable)
      .values({
        name:           name.trim(),
        description:    description ?? "",
        icon:           icon ?? "📚",
        ageGroup:       ageGroup ?? "All Ages",
        level:          "Beginner to Advanced",
        schedule:       schedule ?? "",
        instructor:     instructor ?? "TBD",
        curriculumYear: curriculumYear?.trim() || null,
      })
      .returning();

    const sectionLabels = ["A", "B", "C", "D"];
    const levelCount    = Math.min(Math.max(1, numLevels ?? 6), 7);
    const sectionCount  = Math.min(Math.max(1, numSectionsPerLevel ?? 1), 4);

    for (let i = 1; i <= levelCount; i++) {
      const [level] = await db.insert(courseLevelsTable).values({
        courseId:    course.id,
        levelNumber: i,
        className:   `Level ${i}`,
        schedule:    schedule ?? "",
        capacity:    20,
        enrolled:    0,
      }).returning();

      for (let s = 0; s < sectionCount; s++) {
        await db.insert(courseSectionsTable).values({
          courseLevelId: level.id,
          sectionName:   sectionCount === 1 ? `Level ${i} – Section A` : `Level ${i} – Section ${sectionLabels[s]}`,
          schedule:      schedule ?? "",
          capacity:      20,
        });
      }
    }

    const created = (await buildAdminCourses(true)).find((c) => c.id === course.id);
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Add",
      entityName: name.trim(),
      entityId:   course.id,
      newValue:   { name: name.trim(), numLevels, numSectionsPerLevel, curriculumYear },
    });
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create course");
    res.status(500).json({ error: "Failed to create course" });
  }
});

// PUT /api/admin/courses/:id — update course metadata
router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, description, icon, ageGroup, schedule, instructor, curriculumYear, fee } = req.body;

    if (name) {
      const conflict = await db
        .select()
        .from(coursesTable)
        .where(and(eq(coursesTable.name, name.trim()), sql`id != ${id}`));
      if (conflict.length > 0) return res.status(409).json({ error: "A course with this name already exists" });
    }

    // Resolve fee: empty string or null clears it; a valid number sets it
    let feeValue: string | null | undefined = undefined;
    if (fee !== undefined) {
      const parsed = fee === "" || fee === null ? null : parseFloat(fee);
      feeValue = (parsed === null || isNaN(parsed)) ? null : String(parsed);
    }

    await db
      .update(coursesTable)
      .set({
        name:           name?.trim() || undefined,
        description:    description ?? undefined,
        icon:           icon ?? undefined,
        ageGroup:       ageGroup ?? undefined,
        schedule:       schedule ?? undefined,
        instructor:     instructor ?? undefined,
        curriculumYear: curriculumYear !== undefined ? (curriculumYear?.trim() || null) : undefined,
        fee:            feeValue,
      })
      .where(eq(coursesTable.id, id));

    const updated = (await buildAdminCourses(true)).find((c) => c.id === id);
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Edit",
      entityName: name?.trim() ?? String(id),
      entityId:   id,
      newValue:   { name, description, icon, ageGroup, schedule, instructor, curriculumYear, fee },
    });
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update course");
    res.status(500).json({ error: "Failed to update course" });
  }
});

// PATCH /api/admin/courses/:id/archive — toggle archive
router.patch("/:id/archive", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const course = await db.select().from(coursesTable).where(eq(coursesTable.id, id));
    if (!course[0]) return res.status(404).json({ error: "Course not found" });

    const isArchived = course[0].archivedAt !== null;
    await db
      .update(coursesTable)
      .set({ archivedAt: isArchived ? null : new Date() })
      .where(eq(coursesTable.id, id));
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Edit",
      entityName: course[0].name,
      entityId:   id,
      newValue:   { archived: !isArchived },
    });
    res.json({ archived: !isArchived });
  } catch (err) {
    req.log.error({ err }, "Failed to archive course");
    res.status(500).json({ error: "Failed to archive course" });
  }
});

// DELETE /api/admin/courses/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Check if any students are enrolled
    const levels = await db.select().from(courseLevelsTable).where(eq(courseLevelsTable.courseId, id));
    const levelIds = levels.map((l) => l.id);

    if (levelIds.length > 0) {
      const enrolled = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(enrollmentsTable)
        .where(sql`${enrollmentsTable.courseLevelId} = ANY(ARRAY[${sql.raw(levelIds.join(","))}]::int[]) AND ${enrollmentsTable.status} = 'Enrolled'`);
      if ((enrolled[0]?.count ?? 0) > 0) {
        return res.status(400).json({ error: `Cannot delete: ${enrolled[0].count} student(s) enrolled. Archive instead.` });
      }
    }

    const [courseRow] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, id));
    await db.delete(coursesTable).where(eq(coursesTable.id, id));
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Delete",
      entityName: courseRow?.name ?? String(id),
      entityId:   id,
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete course");
    res.status(500).json({ error: "Failed to delete course" });
  }
});

// ─── Level CRUD ───────────────────────────────────────────────────────────────

// POST /api/admin/courses/:id/levels — add a level
router.post("/:id/levels", async (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const { levelNumber, className, schedule, capacity } = req.body;

    const existing = await db
      .select()
      .from(courseLevelsTable)
      .where(and(eq(courseLevelsTable.courseId, courseId), eq(courseLevelsTable.levelNumber, levelNumber)));
    if (existing.length > 0) return res.status(409).json({ error: `Level ${levelNumber} already exists for this course` });

    const [level] = await db
      .insert(courseLevelsTable)
      .values({ courseId, levelNumber, className: className || `Level ${levelNumber}`, schedule: schedule || null, capacity: capacity || 20, enrolled: 0 })
      .returning();
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Add",
      entityName: className || `Level ${levelNumber}`,
      entityId:   level.id,
      newValue:   { courseId, levelNumber, className, schedule, capacity },
    });
    res.status(201).json(level);
  } catch (err) {
    req.log.error({ err }, "Failed to add level");
    res.status(500).json({ error: "Failed to add level" });
  }
});

// PUT /api/admin/courses/levels/:id
router.put("/levels/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { className, schedule, capacity, status } = req.body;
    const [level] = await db
      .update(courseLevelsTable)
      .set({
        className: className || undefined,
        schedule:  schedule  || undefined,
        capacity:  capacity !== undefined ? parseInt(capacity) : undefined,
        status:    status || undefined,
      })
      .where(eq(courseLevelsTable.id, id))
      .returning();
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Edit",
      entityName: className || `Level ${id}`,
      entityId:   id,
      newValue:   { className, schedule, capacity, status },
    });
    res.json(level);
  } catch (err) {
    req.log.error({ err }, "Failed to update course level");
    res.status(500).json({ error: "Failed to update course level" });
  }
});

// DELETE /api/admin/courses/levels/:id
router.delete("/levels/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const enrolled = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.courseLevelId, id), sql`${enrollmentsTable.status} = 'Enrolled'`));

    if ((enrolled[0]?.count ?? 0) > 0) {
      return res.status(400).json({ error: `Cannot delete: ${enrolled[0].count} student(s) enrolled in this level` });
    }

    await db.delete(courseLevelsTable).where(eq(courseLevelsTable.id, id));
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Delete",
      entityName: `Level ID ${id}`,
      entityId:   id,
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete level");
    res.status(500).json({ error: "Failed to delete level" });
  }
});

// ─── Section CRUD ─────────────────────────────────────────────────────────────

// GET /api/admin/courses/levels/:id/sections
router.get("/levels/:id/sections", async (req, res) => {
  try {
    const levelId = parseInt(req.params.id);
    const sectionRows = await db
      .select({
        id:          courseSectionsTable.id,
        sectionName: courseSectionsTable.sectionName,
        schedule:    courseSectionsTable.schedule,
        capacity:    courseSectionsTable.capacity,
        status:      courseSectionsTable.status,
        teachers: sql<string>`
          coalesce(
            (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'role', sa.role))
             FROM section_assignments sa
             JOIN teachers t ON t.id = sa.teacher_id
             WHERE sa.section_id = course_sections.id),
            '[]'::json
          )
        `,
      })
      .from(courseSectionsTable)
      .where(eq(courseSectionsTable.courseLevelId, levelId))
      .orderBy(courseSectionsTable.id);

    res.json(sectionRows);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch sections");
    res.status(500).json({ error: "Failed to fetch sections" });
  }
});

// POST /api/admin/courses/levels/:id/sections
router.post("/levels/:id/sections", async (req, res) => {
  try {
    const levelId = parseInt(req.params.id);
    const { sectionName, schedule, capacity } = req.body;
    if (!sectionName?.trim()) return res.status(400).json({ error: "Section name is required" });

    const [section] = await db
      .insert(courseSectionsTable)
      .values({ courseLevelId: levelId, sectionName: sectionName.trim(), schedule: schedule || null, capacity: capacity || 20 })
      .returning();
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Add",
      entityName: sectionName.trim(),
      entityId:   section.id,
      newValue:   { levelId, sectionName: sectionName.trim(), schedule, capacity },
    });
    res.status(201).json(section);
  } catch (err) {
    req.log.error({ err }, "Failed to create section");
    res.status(500).json({ error: "Failed to create section" });
  }
});

// PUT /api/admin/courses/sections/:id
router.put("/sections/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { sectionName, schedule, capacity, status } = req.body;
    const [section] = await db
      .update(courseSectionsTable)
      .set({
        sectionName: sectionName?.trim() || undefined,
        schedule:    schedule ?? undefined,
        capacity:    capacity !== undefined ? parseInt(capacity) : undefined,
        status:      status || undefined,
      })
      .where(eq(courseSectionsTable.id, id))
      .returning();
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Edit",
      entityName: sectionName?.trim() || `Section ${id}`,
      entityId:   id,
      newValue:   { sectionName, schedule, capacity, status },
    });
    res.json(section);
  } catch (err) {
    req.log.error({ err }, "Failed to update section");
    res.status(500).json({ error: "Failed to update section" });
  }
});

// DELETE /api/admin/courses/sections/:id
router.delete("/sections/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(courseSectionsTable).where(eq(courseSectionsTable.id, id));
    await writeAudit(req, {
      moduleName: "Course Management",
      actionType: "Delete",
      entityName: `Section ID ${id}`,
      entityId:   id,
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete section");
    res.status(500).json({ error: "Failed to delete section" });
  }
});

// ─── Section Teacher Assignments ──────────────────────────────────────────────

// ─── Schedule conflict helpers ────────────────────────────────────────────────

function parseTimeToMinutes(timeStr: string): number | null {
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const period = m[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function parseScheduleRange(schedule: string | null): { start: number; end: number } | null {
  if (!schedule) return null;
  const m = schedule.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[–\-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if (!m) return null;
  const start = parseTimeToMinutes(m[1]);
  const end   = parseTimeToMinutes(m[2]);
  if (start === null || end === null) return null;
  return { start, end };
}

function timesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

// POST /api/admin/courses/sections/:id/assign
router.post("/sections/:id/assign", async (req, res) => {
  try {
    const sectionId = parseInt(req.params.id);
    const { teacherId, role } = req.body;

    // ── Conflict check: one teacher, one place at a time ──────────────────────
    const [targetSection] = await db
      .select({ schedule: courseSectionsTable.schedule })
      .from(courseSectionsTable)
      .where(eq(courseSectionsTable.id, sectionId));

    const targetRange = parseScheduleRange(targetSection?.schedule ?? null);

    if (targetRange) {
      // Find all other sections this teacher is already assigned to
      const otherAssignments = await db
        .select({
          sectionName: courseSectionsTable.sectionName,
          schedule:    courseSectionsTable.schedule,
        })
        .from(sectionAssignmentsTable)
        .innerJoin(courseSectionsTable, eq(sectionAssignmentsTable.sectionId, courseSectionsTable.id))
        .where(
          and(
            eq(sectionAssignmentsTable.teacherId, teacherId),
            // exclude the section being assigned (for re-assigns/role updates)
            sql`${sectionAssignmentsTable.sectionId} != ${sectionId}`
          )
        );

      for (const other of otherAssignments) {
        const otherRange = parseScheduleRange(other.schedule);
        if (otherRange && timesOverlap(targetRange, otherRange)) {
          return res.status(409).json({
            error: `Schedule conflict: this teacher is already assigned to "${other.sectionName}" (${other.schedule}), which overlaps with this section's time.`,
          });
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const existing = await db
      .select()
      .from(sectionAssignmentsTable)
      .where(and(eq(sectionAssignmentsTable.sectionId, sectionId), eq(sectionAssignmentsTable.teacherId, teacherId)));

    if (existing.length > 0) {
      await db
        .update(sectionAssignmentsTable)
        .set({ role: role || "Teacher" })
        .where(and(eq(sectionAssignmentsTable.sectionId, sectionId), eq(sectionAssignmentsTable.teacherId, teacherId)));
    } else {
      await db.insert(sectionAssignmentsTable).values({ sectionId, teacherId, role: role || "Teacher" });
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to assign teacher to section");
    res.status(500).json({ error: "Failed to assign teacher" });
  }
});

// DELETE /api/admin/courses/sections/:sectionId/unassign/:teacherId
router.delete("/sections/:sectionId/unassign/:teacherId", async (req, res) => {
  try {
    const sectionId  = parseInt(req.params.sectionId);
    const teacherId  = parseInt(req.params.teacherId);
    await db
      .delete(sectionAssignmentsTable)
      .where(and(eq(sectionAssignmentsTable.sectionId, sectionId), eq(sectionAssignmentsTable.teacherId, teacherId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to unassign teacher");
    res.status(500).json({ error: "Failed to unassign teacher" });
  }
});

// ─── Level students (existing endpoint) ──────────────────────────────────────

router.get("/levels/:id/students", async (req, res) => {
  try {
    const levelId  = parseInt(req.params.id);
    const sectionId = req.query.sectionId ? parseInt(req.query.sectionId as string) : null;

    const whereClause = sectionId
      ? and(eq(enrollmentsTable.courseLevelId, levelId), eq(enrollmentsTable.sectionId, sectionId))
      : eq(enrollmentsTable.courseLevelId, levelId);

    const rows = await db
      .select({
        enrollmentId:  enrollmentsTable.id,
        enrollDate:    enrollmentsTable.enrollDate,
        enrollStatus:  enrollmentsTable.status,
        studentId:     studentsTable.id,
        studentCode:   studentsTable.studentCode,
        studentName:   studentsTable.name,
        motherName:    studentsTable.motherName,
        motherPhone:   studentsTable.motherPhone,
        motherEmail:   studentsTable.motherEmail,
        fatherName:    studentsTable.fatherName,
        fatherPhone:   studentsTable.fatherPhone,
        fatherEmail:   studentsTable.fatherEmail,
        sectionId:     enrollmentsTable.sectionId,
        sectionName:   courseSectionsTable.sectionName,
        paymentStatus: paymentsTable.paymentStatus,
        amountDue:     paymentsTable.amountDue,
        amountPaid:    paymentsTable.amountPaid,
        paymentDate:   paymentsTable.paymentDate,
      })
      .from(enrollmentsTable)
      .innerJoin(studentsTable, eq(enrollmentsTable.studentId, studentsTable.id))
      .leftJoin(courseSectionsTable, eq(courseSectionsTable.id, enrollmentsTable.sectionId))
      .leftJoin(paymentsTable, eq(paymentsTable.enrollmentId, enrollmentsTable.id))
      .where(whereClause)
      .orderBy(courseSectionsTable.sectionName, studentsTable.name);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch level students");
    res.status(500).json({ error: "Failed to fetch level students" });
  }
});

export default router;
