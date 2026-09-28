import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  studentsTable,
  studentRegistrationsTable,
  enrollmentsTable,
  courseLevelsTable,
  coursesTable,
  courseSectionsTable,
  paymentsTable,
  membersTable,
  membershipPaymentsTable,
  portalSettingsTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { eq, asc, and, desc, sql, inArray, isNull, count } from "drizzle-orm";
import { writeAudit } from "../../lib/audit";
import { isCompleteAddress } from "../../lib/address";
import { membershipStatus, templeDate } from "../../lib/membership";
import { allocateStudentCode, formatStudentCode } from "../../lib/student-code";
import { pgErrorInfo } from "../../lib/pg-error";
import {
  resolvePrimaryParentContacts,
  verifyNewMemberContextToken,
  verifyVerifiedMemberContextToken,
  type PrimaryMemberRole,
} from "../../lib/member-context";
import { getVerifiedAdmin, isSameOriginRequest } from "../../lib/admin-session";
import { verifyPublicMemberAccess } from "../../lib/public-member-access";

const router: IRouter = Router();
const highestStudentNumber = sql<number>`COALESCE(MAX(CASE WHEN ${studentsTable.studentCode} ~ '^GK-[0-9]+$' THEN substring(${studentsTable.studentCode} FROM '^GK-([0-9]+)$')::int END), 0)`;

function parseDateOfBirth(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && value <= templeDate()
    ? date
    : null;
}

function getAgeOnDate(dateOfBirth: Date, today = templeDate()): number {
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  let age = todayYear - dateOfBirth.getUTCFullYear();
  if (
    todayMonth - 1 < dateOfBirth.getUTCMonth()
    || (todayMonth - 1 === dateOfBirth.getUTCMonth() && todayDay < dateOfBirth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

function getMinimumCourseAge(ageGroup: string | null | undefined): number {
  if (!ageGroup) return 5;

  // Course Management publishes values such as "5+ years", "7+ years
  // (recommended)", and "Ages 5–18". Unknown labels retain the baseline age.
  const plusAge = ageGroup.match(/^\s*(?:ages?\s*)?(\d{1,2})\s*\+/i);
  if (plusAge) return Number(plusAge[1]);

  const rangeAge = ageGroup.match(/^\s*ages?\s*(\d{1,2})\s*(?:-|–|—|to)\s*\d{1,2}\b/i);
  if (rangeAge) return Number(rangeAge[1]);

  return 5;
}

function normalizeCurriculumYear(value: string | null | undefined): string {
  const match = value?.trim().match(/^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/);
  if (!match) return value?.trim() ?? "";
  const start = Number(match[1]);
  let end = match[2].length === 2
    ? Math.floor(start / 100) * 100 + Number(match[2])
    : Number(match[2]);
  if (match[2].length === 2 && end < start) end += 100;
  return `${start}-${end}`;
}

function curriculumYearAliases(value: string): string[] {
  const normalized = normalizeCurriculumYear(value);
  const match = normalized.match(/^(\d{4})-(\d{4})$/);
  const compact = match ? `${match[1]}-${match[2].slice(-2)}` : normalized;
  return Array.from(new Set([value.trim(), normalized, compact]));
}

function curriculumYearsClearlyMatch(studentYear: string | null | undefined, configuredYear: string): boolean {
  const studentKey = normalizeCurriculumYear(studentYear);
  const configuredKey = normalizeCurriculumYear(configuredYear);
  return /^\d{4}-\d{4}$/.test(configuredKey) && studentKey === configuredKey;
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

async function requireVerifiedAdmin(req: Request, res: Response): Promise<boolean> {
  try {
    if (await getVerifiedAdmin(req)) return true;
  } catch (err) {
    req.log.error({ err }, "Failed to verify admin session");
    res.status(500).json({ error: "Could not verify admin session." });
    return false;
  }
  res.status(401).json({ error: "An active admin session is required." });
  return false;
}

async function buildStudentList() {
  const [yearSetting] = await db.select({ value: portalSettingsTable.value })
    .from(portalSettingsTable).where(eq(portalSettingsTable.key, "registration_curriculum_year"));
  const activeYear = yearSetting?.value?.trim();
  const activeYearAliases = activeYear ? curriculumYearAliases(activeYear) : [];
  const sessionEnrollmentJoin = activeYear
    ? and(
      eq(enrollmentsTable.studentId, studentsTable.id),
      sql`EXISTS (
          SELECT 1 FROM student_registrations sr
          WHERE sr.id = ${enrollmentsTable.registrationId}
            AND sr.curriculum_year IN (${activeYearAliases[0]}, ${activeYearAliases[1] ?? activeYearAliases[0]}, ${activeYearAliases[2] ?? activeYearAliases[0]})
        )`,
    )
    : eq(enrollmentsTable.studentId, studentsTable.id);
  const rows = await db
    .select({
      // Student core
      studentId:      studentsTable.id,
      studentCode:    studentsTable.studentCode,
      studentName:    studentsTable.name,
      dob:            studentsTable.dob,
      grade:          studentsTable.grade,
      curriculumYear: studentsTable.curriculumYear,
      isNewStudent:   studentsTable.isNewStudent,
      isActive:       studentsTable.isActive,
      primaryMemberRole: studentsTable.primaryMemberRole,
      // Temple membership
      memberId:       studentsTable.memberId,
      memberName:     membersTable.name,
      memberPhone:    membersTable.phone,
      memberEmail:    membersTable.email,
       memFeeStatus:   sql<string | null>`(SELECT mp.payment_status FROM membership_payments mp WHERE mp.member_id = students.member_id AND mp.membership_year = EXTRACT(YEAR FROM NOW() AT TIME ZONE 'America/New_York')::int LIMIT 1)`.as("mem_fee_status"),
      // Parent contacts
      motherName:     studentsTable.motherName,
      motherPhone:    studentsTable.motherPhone,
      motherEmail:    studentsTable.motherEmail,
      fatherName:     studentsTable.fatherName,
      fatherPhone:    studentsTable.fatherPhone,
      fatherEmail:    studentsTable.fatherEmail,
      address:        studentsTable.address,
      createdAt:      studentsTable.createdAt,
      // Enrollment
      enrollmentId:   enrollmentsTable.id,
      enrollDate:     enrollmentsTable.enrollDate,
      enrollStatus:   enrollmentsTable.status,
      courseId:       courseLevelsTable.courseId,
      courseLevelId:  enrollmentsTable.courseLevelId,
      levelNumber:    courseLevelsTable.levelNumber,
      schedule:       courseLevelsTable.schedule,
      courseName:     coursesTable.name,
      courseIcon:     coursesTable.icon,
      sectionName:    courseSectionsTable.sectionName,
      sectionId:      courseSectionsTable.id,
      // Payment
      paymentId:      paymentsTable.id,
      paymentStatus:  paymentsTable.paymentStatus,
      amountDue:      paymentsTable.amountDue,
      amountPaid:     paymentsTable.amountPaid,
      paymentMethod:  paymentsTable.paymentMethod,
      receiptId:      paymentsTable.receiptId,
    })
    .from(studentsTable)
    .leftJoin(membersTable, eq(membersTable.id, studentsTable.memberId))
    .leftJoin(enrollmentsTable, sessionEnrollmentJoin)
    .leftJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
    .leftJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
    .leftJoin(courseSectionsTable, eq(courseSectionsTable.id, enrollmentsTable.sectionId))
    .leftJoin(paymentsTable, eq(paymentsTable.enrollmentId, enrollmentsTable.id))
    .orderBy(asc(studentsTable.studentCode), asc(enrollmentsTable.id));

  return rows.map((r) => ({
    id:             r.studentCode,
    studentDbId:    r.studentId,
    name:           r.studentName,
    dob:            r.dob ?? "",
    grade:          r.grade ?? "",
    curriculumYear: r.curriculumYear ?? "",
    isNewStudent:   r.isNewStudent ?? true,
    isActive:       r.isActive ?? true,
    primaryMemberRole: r.primaryMemberRole ?? null,
    memberId:       r.memberId ?? null,
    memberName:     r.memberName ?? null,
    memberPhone:    r.memberPhone ?? null,
    memberEmail:    r.memberEmail ?? null,
    memFeeStatus:   r.memFeeStatus ?? null,
    motherName:     r.motherName ?? "",
    motherPhone:    r.motherPhone ?? "",
    motherEmail:    r.motherEmail ?? "",
    fatherName:     r.fatherName ?? "",
    fatherPhone:    r.fatherPhone ?? "",
    fatherEmail:    r.fatherEmail ?? "",
    address:        r.address ?? "",
    enrollmentId:   r.enrollmentId ?? null,
    enrollDate:     r.enrollDate ?? "",
    enrollStatus:   r.enrollStatus ?? "Enrolled",
    courseId:       r.courseId ?? null,
    courseLevelId:  r.courseLevelId ?? null,
    sectionId:      r.sectionId ?? null,
    course:         r.courseName ?? "",
    courseIcon:     r.courseIcon ?? "",
    level:          r.levelNumber != null ? `Level ${r.levelNumber}` : "",
    levelNum:       r.levelNumber ?? 0,
    section:        r.sectionName ?? "",
    timing:         r.schedule ?? "",
    paymentId:      r.paymentId ?? null,
    paymentStatus:  (r.paymentStatus ?? "Pending") as "Paid" | "Pending" | "Overdue",
    amountDue:      parseFloat(r.amountDue ?? "0"),
    amountPaid:     parseFloat(r.amountPaid ?? "0"),
    paymentMethod:  r.paymentMethod ?? "-",
    receiptId:      r.receiptId ?? "-",
  }));
}

// GET /api/admin/students/meta
router.get("/meta", async (req, res) => {
  try {
    const [last] = await db.select({ number: highestStudentNumber }).from(studentsTable);
    const nextCode = formatStudentCode(last.number + 1);

    const rows = await db
      .select({
        courseId:    coursesTable.id,
        courseName:  coursesTable.name,
        courseIcon:  coursesTable.icon,
        courseFee:   coursesTable.fee,
        ageGroup:    coursesTable.ageGroup,
        levelId:     courseLevelsTable.id,
        levelNumber: courseLevelsTable.levelNumber,
        className:   courseLevelsTable.className,
        sectionId:   courseSectionsTable.id,
        sectionName: courseSectionsTable.sectionName,
        schedule:    courseSectionsTable.schedule,
      })
      .from(coursesTable)
      .innerJoin(courseLevelsTable, eq(courseLevelsTable.courseId, coursesTable.id))
      .leftJoin(courseSectionsTable, and(
        eq(courseSectionsTable.courseLevelId, courseLevelsTable.id),
        eq(courseSectionsTable.status, "Active"),
      ))
      .where(and(
        isNull(coursesTable.archivedAt),
        eq(courseLevelsTable.status, "Active"),
      ))
      .orderBy(asc(coursesTable.name), asc(courseLevelsTable.levelNumber), asc(courseSectionsTable.sectionName));

    const courseMap = new Map<number, { id: number; name: string; icon: string; fee: number | null; ageGroup: string; levels: Map<number, { id: number; levelNumber: number; className: string; sections: { id: number; sectionName: string; schedule: string }[] }> }>();
    for (const r of rows) {
      if (!courseMap.has(r.courseId)) {
        courseMap.set(r.courseId, { id: r.courseId, name: r.courseName, icon: r.courseIcon ?? "", fee: r.courseFee != null ? parseFloat(r.courseFee) : null, ageGroup: r.ageGroup, levels: new Map() });
      }
      const course = courseMap.get(r.courseId)!;
      if (!course.levels.has(r.levelId)) {
        course.levels.set(r.levelId, { id: r.levelId, levelNumber: r.levelNumber, className: r.className, sections: [] });
      }
      if (r.sectionId) {
        course.levels.get(r.levelId)!.sections.push({ id: r.sectionId, sectionName: r.sectionName!, schedule: r.schedule ?? "" });
      }
    }

    const courses = Array.from(courseMap.values()).map(c => ({
      ...c,
      levels: Array.from(c.levels.values()),
    }));

    res.json({ nextCode, courses });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch student meta");
    res.status(500).json({ error: "Failed to fetch student meta" });
  }
});

// GET /api/admin/students/unlinked-count — how many students have no member record
router.get("/unlinked-count", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const [{ value }] = await db
      .select({ value: count() })
      .from(studentsTable)
      .where(isNull(studentsTable.memberId));
    res.json({ unlinkedCount: Number(value) });
  } catch (err) {
    req.log.error({ err }, "Failed to count unlinked students");
    res.status(500).json({ error: "Failed to count" });
  }
});

// GET /api/admin/students
router.get("/", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    res.json(await buildStudentList());
  } catch (err) {
    req.log.error({ err }, "Failed to fetch students");
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// POST /api/admin/students — register new student
router.post("/", async (req, res) => {
  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ error: "Request origin could not be verified." });
  }
  try {
    const verifiedAdmin = await getVerifiedAdmin(req);
    const {
      studentCode, firstName, lastName, dob, grade, isNewStudent,
      curriculumYear, memberId, primaryMemberRole, memberContextToken,
      motherName, motherPhone, motherEmail, motherEmployer,
      fatherName, fatherPhone, fatherEmail, fatherEmployer,
      address, volunteerParent, volunteerArea,
      membershipFeeDecision,
      enrollments = [],
    } = req.body as {
      studentCode?: string;
      firstName: string; lastName: string;
      dob?: string; grade?: string; isNewStudent?: boolean;
      curriculumYear?: string; memberId?: number;
      primaryMemberRole?: string; memberContextToken?: string;
      motherName?: string; motherPhone?: string; motherEmail?: string; motherEmployer?: string;
      fatherName?: string; fatherPhone?: string; fatherEmail?: string; fatherEmployer?: string;
      address?: string; volunteerParent?: boolean; volunteerArea?: string;
      membershipFeeDecision?: string;
      enrollments: { courseLevelId: number; sectionId?: number | null; enrollDate?: string; amountDue?: string }[];
    };

    // The current curriculum year is server-owned for unauthenticated/public registrations.
    const [configuredYear] = await db
      .select({ value: portalSettingsTable.value })
      .from(portalSettingsTable)
      .where(eq(portalSettingsTable.key, "registration_curriculum_year"));
    const effectiveCurriculumYear = verifiedAdmin
      ? (curriculumYear?.trim() || configuredYear?.value?.trim() || "")
      : (configuredYear?.value?.trim() || "");
    if (!effectiveCurriculumYear) {
      return res.status(503).json({ error: "The current registration year is not configured." });
    }

    // ── Registration window validation for public submissions ────────────────
    if (!verifiedAdmin) {
      const [openRow] = await db
        .select()
        .from(portalSettingsTable)
        .where(eq(portalSettingsTable.key, "registration_open_date"));
      const [closeRow] = await db
        .select()
        .from(portalSettingsTable)
        .where(eq(portalSettingsTable.key, "registration_close_date"));
      const openDate  = openRow?.value  || "";
      const closeDate = closeRow?.value || "";

      if (!openDate || !closeDate) {
        return res.status(403).json({ error: "Registration is currently closed. Please contact the administration for assistance." });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (today < openDate || today > closeDate) {
        return res.status(403).json({ error: "Registration is currently closed. Please contact the administration for assistance." });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (!firstName?.trim() || !lastName?.trim()) {
      return res.status(400).json({ error: "First name and last name are required" });
    }
    const dateOfBirth = parseDateOfBirth(dob);
    if (!dateOfBirth) {
      return res.status(400).json({ error: "A valid date of birth in YYYY-MM-DD format is required." });
    }
    if (!Array.isArray(enrollments) || enrollments.some(enrollment =>
      !enrollment || !Number.isInteger(enrollment.courseLevelId) || enrollment.courseLevelId < 1
    )) {
      return res.status(400).json({ error: "Choose valid active course levels for all enrollments." });
    }

    const submittedLevelIds = enrollments.map(enrollment => enrollment.courseLevelId);
    const selectedCourses = submittedLevelIds.length
      ? await db
        .select({
          levelId: courseLevelsTable.id,
          courseId: coursesTable.id,
          ageGroup: coursesTable.ageGroup,
        })
        .from(courseLevelsTable)
        .innerJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
        .where(and(
          inArray(courseLevelsTable.id, submittedLevelIds),
          eq(courseLevelsTable.status, "Active"),
          isNull(coursesTable.archivedAt),
        ))
      : [];
    const courseByLevelId = new Map(selectedCourses.map(course => [course.levelId, course]));
    if (submittedLevelIds.some(levelId => !courseByLevelId.has(levelId))) {
      return res.status(400).json({ error: "One or more selected course levels are no longer active. Refresh the course list and try again." });
    }
    if (new Set(selectedCourses.map(course => course.courseId)).size !== submittedLevelIds.length) {
      return res.status(400).json({ error: "Choose only one level per course." });
    }
    const requestedSections = enrollments.filter(enrollment => enrollment.sectionId != null);
    const activeSections = requestedSections.length ? await db.select({
      id: courseSectionsTable.id, courseLevelId: courseSectionsTable.courseLevelId,
    }).from(courseSectionsTable).where(and(
      inArray(courseSectionsTable.id, requestedSections.map(enrollment => enrollment.sectionId!)),
      eq(courseSectionsTable.status, "Active"),
    )) : [];
    const activeSectionLevels = new Map(activeSections.map(section => [section.id, section.courseLevelId]));
    if (requestedSections.some(enrollment => activeSectionLevels.get(enrollment.sectionId!) !== enrollment.courseLevelId)) {
      return res.status(400).json({ error: "A selected section is unavailable or does not belong to its course level." });
    }

    const age = getAgeOnDate(dateOfBirth);
    if (age > 22) {
      return res.status(400).json({ error: "Students must be 22 years old or younger to register." });
    }
    for (const levelId of submittedLevelIds) {
      const ageGroup = courseByLevelId.get(levelId)!.ageGroup;
      const minimumAge = getMinimumCourseAge(ageGroup);
      if (age < minimumAge) {
        return res.status(400).json({
          error: `Student must be at least ${minimumAge} years old for this course (${ageGroup || "minimum age 5"}).`,
        });
      }
    }
    if (!memberId) {
      return res.status(400).json({ error: "A temple member record must be linked before registering a student." });
    }
    if (primaryMemberRole !== "mother" && primaryMemberRole !== "father") {
      return res.status(400).json({ error: "Choose whether the linked member is the mother or father." });
    }
    if (!verifiedAdmin) {
      const sessionSecret = process.env.SESSION_SECRET;
      if (!sessionSecret) {
        return res.status(500).json({ error: "Member context validation is unavailable because server configuration is incomplete." });
      }
      const validExistingMemberContext = verifyVerifiedMemberContextToken(memberContextToken, memberId, sessionSecret);
      const validNewMemberContext = verifyNewMemberContextToken(memberContextToken, memberId, sessionSecret);
      const hasVerifiedPublicMemberAccess = await verifyPublicMemberAccess(req, memberId);
      if (!(validNewMemberContext || validExistingMemberContext) || !hasVerifiedPublicMemberAccess) {
        return res.status(401).json({ error: "Member verification is required before registering a student." });
      }
    }
    if (!isCompleteAddress(address)) {
      return res.status(400).json({ error: "A complete confirmed or updated home address with street, city, state and ZIP is required before registering a student." });
    }
    // Verify the member exists
    const [memberCheck] = await db
      .select({
        id: membersTable.id,
        address: membersTable.address,
        createdAt: membersTable.createdAt,
        name: membersTable.name,
        phone: membersTable.phone,
        email: membersTable.email,
        employer: membersTable.employer,
      })
      .from(membersTable)
      .where(eq(membersTable.id, memberId));
    if (!memberCheck) {
      return res.status(400).json({ error: "The specified temple member record does not exist." });
    }
    if (!membershipStatus(memberCheck.createdAt).isActive) {
      return res.status(400).json({ error: "This membership expired on December 31. Renew it for the current calendar year before registering a student." });
    }
    if (!isCompleteAddress(memberCheck.address) || memberCheck.address.trim() !== address.trim()) {
      return res.status(400).json({ error: "The home address must match the address on the member record. Confirm or update the member address before registering." });
    }
    const primaryContacts = resolvePrimaryParentContacts(
      primaryMemberRole as PrimaryMemberRole,
      { motherName, motherPhone, motherEmail, motherEmployer, fatherName, fatherPhone, fatherEmail, fatherEmployer },
      memberCheck,
    );
    if (!primaryContacts.ok) {
      return res.status(400).json({
        error: `The selected primary parent's ${primaryContacts.field} must match the linked member record.`,
      });
    }

    // ── Smart dedup: reuse existing student profile under same member ─────────
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const identityName = fullName.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const effectiveDob = dob!.trim();
    const today = templeDate();
    const newRegistration = await db.transaction(async tx => {
      if (!verifiedAdmin) {
        const windowRows = await tx.select({
          key: portalSettingsTable.key,
          value: portalSettingsTable.value,
        }).from(portalSettingsTable)
          .where(inArray(portalSettingsTable.key, ["registration_open_date", "registration_close_date"]));
        const openDate = windowRows.find(row => row.key === "registration_open_date")?.value || "";
        const closeDate = windowRows.find(row => row.key === "registration_close_date")?.value || "";
        const transactionDate = templeDate();
        if (!openDate || !closeDate || transactionDate < openDate || transactionDate > closeDate) {
          throw new StudentSubjectsError(403, "Registration is currently closed. Please contact the administration for assistance.");
        }
      }
      // Serialize concurrent submissions for one member/identity, then lock the matched profile.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`gurukul-registration-member:${memberId}`}))`);
      let candidates;
      if (studentCode?.trim()) {
        candidates = await tx.select({
          id: studentsTable.id, studentCode: studentsTable.studentCode, name: studentsTable.name,
          curriculumYear: studentsTable.curriculumYear,
        }).from(studentsTable).where(and(
          eq(studentsTable.memberId, memberId),
          eq(studentsTable.studentCode, studentCode.trim()),
        )).for("update");
      } else {
        candidates = await tx.select({
          id: studentsTable.id, studentCode: studentsTable.studentCode, name: studentsTable.name,
          curriculumYear: studentsTable.curriculumYear,
        }).from(studentsTable).where(and(
          eq(studentsTable.memberId, memberId),
          sql`lower(regexp_replace(trim(${studentsTable.name}), '\\s+', ' ', 'g')) = ${identityName}`,
          eq(studentsTable.dob, effectiveDob),
        )).for("update");
      }
      if (candidates.length > 1) throw new StudentSubjectsError(409, "ambiguous-student-match");
      if (studentCode?.trim() && !candidates.length) throw new StudentSubjectsError(400, "The selected student ID does not belong to this member.");
      let student = candidates[0];
      if (student) {
        const registrations = await tx.select({
          id: studentRegistrationsTable.id,
          curriculumYear: studentRegistrationsTable.curriculumYear,
        })
          .from(studentRegistrationsTable)
          .where(eq(studentRegistrationsTable.studentId, student.id))
          .for("update");
        const currentYearKey = normalizeCurriculumYear(effectiveCurriculumYear);
        const existingRegistration = registrations.find(row =>
          normalizeCurriculumYear(row.curriculumYear) === currentYearKey,
        );
        if (existingRegistration) throw new StudentSubjectsError(409, "current-session-exists");
        const profileYearKey = normalizeCurriculumYear(student.curriculumYear);
        if (!profileYearKey || profileYearKey === currentYearKey) {
          const [legacyEnrollment] = await tx.select({ id: enrollmentsTable.id }).from(enrollmentsTable)
            .where(and(
              eq(enrollmentsTable.studentId, student.id),
              isNull(enrollmentsTable.registrationId),
            )).limit(1);
          if (legacyEnrollment) throw new StudentSubjectsError(409, "current-session-exists");
        }
        await tx.update(studentsTable).set({
          name: fullName,
          dob: effectiveDob,
          grade: grade || null,
          isNewStudent: isNewStudent ?? false,
          curriculumYear: effectiveCurriculumYear,
          memberId,
          primaryMemberRole: primaryMemberRole as PrimaryMemberRole,
          address: address.trim(),
          ...primaryContacts.fields,
        }).where(eq(studentsTable.id, student.id));
      } else {
        student = await allocateStudentCode(
          studentCode?.trim(),
          async () => { await tx.execute(sql`SELECT pg_advisory_xact_lock(74239, 1)`); },
          async () => {
            const [last] = await tx.select({ number: highestStudentNumber }).from(studentsTable);
            return last.number;
          },
          async code => {
            const [created] = await tx.insert(studentsTable).values({
              studentCode: code, name: fullName, dob: effectiveDob, grade: grade || null,
              isNewStudent: isNewStudent ?? true, curriculumYear: effectiveCurriculumYear,
              memberId, primaryMemberRole: primaryMemberRole as PrimaryMemberRole,
              motherName: motherName?.trim() || null, motherPhone: motherPhone?.trim() || null,
              motherEmail: motherEmail?.trim() || null, motherEmployer: motherEmployer?.trim() || null,
              fatherName: fatherName?.trim() || null, fatherPhone: fatherPhone?.trim() || null,
              fatherEmail: fatherEmail?.trim() || null, fatherEmployer: fatherEmployer?.trim() || null,
              ...primaryContacts.fields, address: address.trim(),
              volunteerParent: volunteerParent ?? false, volunteerArea: volunteerArea?.trim() || null,
              registrationSource: verifiedAdmin ? "admin" : "public",
              membershipFeeDecision: membershipFeeDecision?.trim() || null,
            }).returning({
              id: studentsTable.id,
              studentCode: studentsTable.studentCode,
              name: studentsTable.name,
              curriculumYear: studentsTable.curriculumYear,
            });
            return created;
          },
        );
      }
      const [registration] = await tx.insert(studentRegistrationsTable).values({
        studentId: student.id,
        curriculumYear: effectiveCurriculumYear,
        registeredAt: today,
        dateProvenance: "recorded",
        updatedAt: new Date(),
      }).returning({ id: studentRegistrationsTable.id });
      for (const enr of enrollments) {
        const [enrollment] = await tx.insert(enrollmentsTable).values({
          studentId: student.id, registrationId: registration.id,
          courseLevelId: enr.courseLevelId, sectionId: enr.sectionId ?? null, enrollDate: enr.enrollDate ?? today,
        }).returning({ id: enrollmentsTable.id });
        await tx.insert(paymentsTable).values({
          enrollmentId: enrollment.id, amountDue: enr.amountDue ?? "35.00",
          amountPaid: "0.00", paymentStatus: "Pending",
        });
      }
      return { ...student, registrationId: registration.id };
    });

    await writeAudit(req, {
      moduleName: "Student Registration",
      actionType: "Add",
      entityName: fullName,
      entityId: newRegistration.studentCode,
      newValue: { name: fullName, grade, curriculumYear: effectiveCurriculumYear, memberId },
    });
    res.status(201).json({ success: true, studentCode: newRegistration.studentCode, studentId: newRegistration.id });
  } catch (err: unknown) {
    if (err instanceof StudentSubjectsError) {
      if (err.message === "current-session-exists") {
        return res.status(409).json({ error: "current-session-exists", code: "current-session-exists" });
      }
      if (err.message === "ambiguous-student-match") {
        return res.status(409).json({ error: "More than one student matches this member, name, and date of birth. Contact the Gurukul office to resolve the records." });
      }
      return res.status(err.statusCode).json({ error: err.message });
    }
    const pg = pgErrorInfo(err);
    if (pg?.code === "23505") {
      req.log.warn({ constraint: pg.constraint }, "Student registration conflict");
      if (pg.constraint === "student_registrations_student_year_uniq") {
        return res.status(409).json({ error: "current-session-exists", code: "current-session-exists" });
      }
      if (pg.constraint === "students_student_code_unique") {
        return res.status(409).json({ error: "That student ID is already in use. Please try registering again to receive a new ID." });
      }
      return res.status(409).json({ error: "This student is already enrolled in one of the selected courses. Duplicate enrollments are not allowed." });
    }
    req.log.error({ err }, "Failed to register student");
    res.status(500).json({ error: "Registration could not be completed. Please try again or contact the Gurukul office." });
  }
});

// PATCH /api/admin/students/bulk/status — bulk activate/deactivate
router.patch("/bulk/status", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const { codes, isActive } = req.body as { codes: string[]; isActive: boolean };
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ error: "No student codes provided" });
    }
    await db
      .update(studentsTable)
      .set({ isActive })
      .where(inArray(studentsTable.studentCode, codes));
    await writeAudit(req, {
      moduleName: "Student Registration",
      actionType: "Edit",
      entityName: `Bulk ${isActive ? "Activate" : "Deactivate"} (${codes.length} students)`,
      entityId:   codes.join(", "),
      newValue:   { isActive, codes },
    });
    res.json({ success: true, updated: codes.length });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk update student status");
    res.status(500).json({ error: "Failed to update student status" });
  }
});

// DELETE /api/admin/students/bulk — bulk delete
router.delete("/bulk", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const { codes } = req.body as { codes: string[] };
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ error: "No student codes provided" });
    }
    await db
      .delete(studentsTable)
      .where(inArray(studentsTable.studentCode, codes));
    await writeAudit(req, {
      moduleName: "Student Registration",
      actionType: "Delete",
      entityName: `Bulk Delete (${codes.length} students)`,
      entityId:   codes.join(", "),
      previousValue: { codes },
    });
    res.json({ success: true, deleted: codes.length });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk delete students");
    res.status(500).json({ error: "Failed to delete students" });
  }
});

// GET /api/admin/students/duplicates — find duplicate student profiles under same member
router.get("/duplicates", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const rows = await db
      .select({
        studentCode:    studentsTable.studentCode,
        studentId:      studentsTable.id,
        name:           studentsTable.name,
        grade:          studentsTable.grade,
        memberId:       studentsTable.memberId,
        memberName:     membersTable.name,
        curriculumYear: studentsTable.curriculumYear,
        enrollCount:    count(enrollmentsTable.id),
      })
      .from(studentsTable)
      .leftJoin(membersTable,     eq(membersTable.id,      studentsTable.memberId))
      .leftJoin(enrollmentsTable, eq(enrollmentsTable.studentId, studentsTable.id))
      .groupBy(studentsTable.id, membersTable.id)
      .orderBy(asc(studentsTable.memberId), asc(studentsTable.name));

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.memberId ?? ""}|${r.name.toLowerCase().trim()}|${(r.grade || "").toLowerCase().trim()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const duplicates = Array.from(groups.values()).filter(g => g.length > 1);
    res.json(duplicates);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch duplicate students");
    res.status(500).json({ error: "Failed to fetch duplicates" });
  }
});

// POST /api/admin/students/merge — merge duplicate student records into one canonical record
router.post("/merge", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const { canonicalCode, duplicateCodes } = req.body as { canonicalCode: string; duplicateCodes: string[] };
    if (!canonicalCode || !Array.isArray(duplicateCodes) || duplicateCodes.length === 0) {
      return res.status(400).json({ error: "canonicalCode and duplicateCodes are required" });
    }

    const [canonical] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(eq(studentsTable.studentCode, canonicalCode));
    if (!canonical) return res.status(404).json({ error: "Canonical student not found" });

    const duplicates = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(inArray(studentsTable.studentCode, duplicateCodes));

    const dupIds = duplicates.map(d => d.id);
    if (dupIds.length > 0) {
      await db
        .update(enrollmentsTable)
        .set({ studentId: canonical.id })
        .where(inArray(enrollmentsTable.studentId, dupIds));
      await db
        .delete(studentsTable)
        .where(inArray(studentsTable.studentCode, duplicateCodes));
    }

    await writeAudit(req, {
      moduleName: "Student Management",
      actionType: "Edit",
      entityName: `Merge duplicates → ${canonicalCode}`,
      entityId:   canonicalCode,
      newValue:   { merged: duplicateCodes },
    });

    res.json({ success: true, merged: duplicateCodes.length });
  } catch (err) {
    req.log.error({ err }, "Failed to merge students");
    res.status(500).json({ error: "Failed to merge students" });
  }
});

class StudentSubjectsError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

async function publicRegistrationWindowOpen(): Promise<boolean> {
  const rows = await db.select({ key: portalSettingsTable.key, value: portalSettingsTable.value })
    .from(portalSettingsTable)
    .where(inArray(portalSettingsTable.key, ["registration_open_date", "registration_close_date"]));
  const openDate = rows.find(row => row.key === "registration_open_date")?.value || "";
  const closeDate = rows.find(row => row.key === "registration_close_date")?.value || "";
  const today = templeDate();
  return Boolean(openDate && closeDate && today >= openDate && today <= closeDate);
}

async function reconcileLegacyRegistration(studentCode: string, memberId: number, verifiedAdmin: boolean): Promise<void> {
  await db.transaction(async tx => {
    if (!verifiedAdmin) {
      const windowRows = await tx.select({
        key: portalSettingsTable.key,
        value: portalSettingsTable.value,
      }).from(portalSettingsTable)
        .where(inArray(portalSettingsTable.key, ["registration_open_date", "registration_close_date"]));
      const openDate = windowRows.find(row => row.key === "registration_open_date")?.value || "";
      const closeDate = windowRows.find(row => row.key === "registration_close_date")?.value || "";
      const today = templeDate();
      if (!openDate || !closeDate || today < openDate || today > closeDate) return;
    }
    const [student] = await tx.select({
      id: studentsTable.id,
      curriculumYear: studentsTable.curriculumYear,
    }).from(studentsTable).where(and(
      eq(studentsTable.studentCode, studentCode),
      eq(studentsTable.memberId, memberId),
    )).for("update");
    if (!student) return;
    const [yearSetting] = await tx.select({ value: portalSettingsTable.value })
      .from(portalSettingsTable).where(eq(portalSettingsTable.key, "registration_curriculum_year"));
    const configuredYear = yearSetting?.value?.trim();
    if (!configuredYear || !curriculumYearsClearlyMatch(student.curriculumYear, configuredYear)) return;

    const registrations = await tx.select({
      id: studentRegistrationsTable.id,
      curriculumYear: studentRegistrationsTable.curriculumYear,
    }).from(studentRegistrationsTable).where(eq(studentRegistrationsTable.studentId, student.id)).for("update");
    const currentYearKey = normalizeCurriculumYear(configuredYear);
    const existingRegistration = registrations.find(row =>
      normalizeCurriculumYear(row.curriculumYear) === currentYearKey,
    );

    const legacyRows = await tx.select({
      id: enrollmentsTable.id,
      enrollDate: enrollmentsTable.enrollDate,
      courseId: courseLevelsTable.courseId,
      courseLevelId: enrollmentsTable.courseLevelId,
      courseYear: coursesTable.curriculumYear,
    }).from(enrollmentsTable)
      .innerJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
      .innerJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
      .where(and(eq(enrollmentsTable.studentId, student.id), isNull(enrollmentsTable.registrationId)))
      .for("update");
    if (!legacyRows.length) return;

    const linkedLevels = existingRegistration ? await tx.select({
      courseId: courseLevelsTable.courseId,
    }).from(enrollmentsTable)
      .innerJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
      .where(eq(enrollmentsTable.registrationId, existingRegistration.id)) : [];
    const existingCourseIds = new Set(linkedLevels.map(row => row.courseId));
    const enrollmentDates = new Set(legacyRows.map(row => row.enrollDate));
    const onlyDate = enrollmentDates.size === 1 ? legacyRows[0]!.enrollDate : "";
    if (!isIsoCalendarDate(onlyDate) ||
        new Set(legacyRows.map(row => row.courseId)).size !== legacyRows.length ||
        new Set(legacyRows.map(row => row.courseLevelId)).size !== legacyRows.length ||
        legacyRows.some(row => !curriculumYearsClearlyMatch(row.courseYear, configuredYear)) ||
        legacyRows.some(row => existingCourseIds.has(row.courseId))) {
      throw new StudentSubjectsError(409, "Legacy enrollment dates or academic year cannot be confirmed from the course records. Please contact the Gurukul office to review these records.");
    }

    const registration = existingRegistration ?? (await tx.insert(studentRegistrationsTable).values({
      studentId: student.id,
      curriculumYear: configuredYear,
      registeredAt: onlyDate,
      dateProvenance: "first_enrollment",
      updatedAt: new Date(),
    }).returning({ id: studentRegistrationsTable.id }))[0]!;
    await tx.update(enrollmentsTable).set({ registrationId: registration.id })
      .where(and(
        eq(enrollmentsTable.studentId, student.id),
        isNull(enrollmentsTable.registrationId),
        inArray(enrollmentsTable.id, legacyRows.map(row => row.id)),
      ));
  });
}

async function currentRegistrationSummary(
  studentCode: string,
  memberId: number,
  reconcile = false,
  verifiedAdmin = false,
) {
  if (reconcile) await reconcileLegacyRegistration(studentCode, memberId, verifiedAdmin);
  const [currentYear] = await db.select({ value: portalSettingsTable.value })
    .from(portalSettingsTable).where(eq(portalSettingsTable.key, "registration_curriculum_year"));
  if (!currentYear?.value?.trim()) return null;
  const currentYearKey = normalizeCurriculumYear(currentYear.value);
  const registrations = await db
    .select({
      id: studentRegistrationsTable.id,
      studentId: studentsTable.id,
      studentCode: studentsTable.studentCode,
      studentName: studentsTable.name,
      memberId: studentsTable.memberId,
      curriculumYear: studentRegistrationsTable.curriculumYear,
      registeredAt: studentRegistrationsTable.registeredAt,
      dateProvenance: studentRegistrationsTable.dateProvenance,
      updatedAt: studentRegistrationsTable.updatedAt,
    })
    .from(studentRegistrationsTable)
    .innerJoin(studentsTable, eq(studentsTable.id, studentRegistrationsTable.studentId))
    .where(and(eq(studentsTable.studentCode, studentCode), eq(studentsTable.memberId, memberId)));
  const registration = registrations.find(row =>
    normalizeCurriculumYear(row.curriculumYear) === currentYearKey,
  );
  if (!registration) {
    const [student] = await db.select({
      id: studentsTable.id,
      name: studentsTable.name,
      curriculumYear: studentsTable.curriculumYear,
    }).from(studentsTable).where(and(
      eq(studentsTable.studentCode, studentCode),
      eq(studentsTable.memberId, memberId),
    ));
    if (!student ||
        !curriculumYearsClearlyMatch(student.curriculumYear, currentYear.value) ||
        await publicRegistrationWindowOpen()) return null;
    const legacyRows = await db.select({
      id: enrollmentsTable.id,
      enrollDate: enrollmentsTable.enrollDate,
      courseId: coursesTable.id,
      courseYear: coursesTable.curriculumYear,
      courseName: coursesTable.name,
      courseLevelId: courseLevelsTable.id,
      levelNumber: courseLevelsTable.levelNumber,
      className: courseLevelsTable.className,
      sectionId: courseSectionsTable.id,
      sectionName: courseSectionsTable.sectionName,
      status: enrollmentsTable.status,
    }).from(enrollmentsTable)
      .innerJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
      .innerJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
      .leftJoin(courseSectionsTable, eq(courseSectionsTable.id, enrollmentsTable.sectionId))
      .where(and(eq(enrollmentsTable.studentId, student.id), isNull(enrollmentsTable.registrationId)));
    if (!legacyRows.length) return null;
    const dates = new Set(legacyRows.map(row => row.enrollDate));
    if (dates.size !== 1 ||
        !isIsoCalendarDate(legacyRows[0]!.enrollDate) ||
        new Set(legacyRows.map(row => row.courseId)).size !== legacyRows.length ||
        legacyRows.some(row => !curriculumYearsClearlyMatch(row.courseYear, currentYear.value))) {
      throw new StudentSubjectsError(409, "Legacy enrollment dates or academic year cannot be confirmed from the course records. Please contact the Gurukul office to review these records.");
    }
    return {
      id: null,
      studentCode,
      studentName: student.name,
      curriculumYear: currentYear.value.trim(),
      registeredAt: legacyRows[0]!.enrollDate,
      dateSource: "first_enrollment" as const,
      updatedAt: null,
      subjects: legacyRows.map(row => ({
        enrollmentId: row.id,
        courseId: row.courseId,
        courseName: row.courseName,
        courseLevelId: row.courseLevelId,
        levelNumber: row.levelNumber,
        className: row.className,
        sectionId: row.sectionId,
        sectionName: row.sectionName,
        status: row.status,
      })),
    };
  }
  const subjects = await db
    .select({
      enrollmentId: enrollmentsTable.id,
      courseId: coursesTable.id,
      courseName: coursesTable.name,
      courseLevelId: courseLevelsTable.id,
      levelNumber: courseLevelsTable.levelNumber,
      className: courseLevelsTable.className,
      sectionId: courseSectionsTable.id,
      sectionName: courseSectionsTable.sectionName,
      status: enrollmentsTable.status,
    })
    .from(enrollmentsTable)
    .innerJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
    .innerJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
    .leftJoin(courseSectionsTable, eq(courseSectionsTable.id, enrollmentsTable.sectionId))
    .where(eq(enrollmentsTable.registrationId, registration.id))
    .orderBy(asc(coursesTable.name), asc(courseLevelsTable.levelNumber), asc(enrollmentsTable.id));
  const { memberId: _memberId, studentId: _studentId, ...publicRegistration } = registration;
  return {
    ...publicRegistration,
    dateSource: registration.dateProvenance === "first_enrollment" ? "first_enrollment" as const : "recorded" as const,
    subjects,
  };
}

async function publicOrAdminMemberAuthorized(req: Parameters<typeof verifyPublicMemberAccess>[0], memberId: number) {
  const admin = await getVerifiedAdmin(req);
  return Boolean(admin) || await verifyPublicMemberAccess(req, memberId);
}

// GET /api/admin/students/:code/current-registration?memberId=N
router.get("/:code/current-registration", async (req, res): Promise<void> => {
  const memberId = Number(req.query.memberId);
  if (!Number.isSafeInteger(memberId) || memberId < 1) {
    res.status(400).json({ error: "A valid memberId is required." });
    return;
  }
  try {
    if (!await publicOrAdminMemberAuthorized(req, memberId)) {
      res.status(401).json({ error: "Member access could not be verified." });
      return;
    }
    const admin = await getVerifiedAdmin(req);
    const canReconcile = Boolean(admin) || await publicRegistrationWindowOpen();
    const summary = await currentRegistrationSummary(req.params.code, memberId, canReconcile, Boolean(admin));
    if (!summary) {
      res.status(404).json({ error: "No registration was found for this student and member." });
      return;
    }
    res.json(summary);
  } catch (err) {
    if (err instanceof StudentSubjectsError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to fetch current student registration");
    res.status(500).json({ error: "Could not fetch the current student registration." });
  }
});

// PATCH /api/admin/students/:code/current-registration
router.patch("/:code/current-registration", async (req, res): Promise<void> => {
  if (!isSameOriginRequest(req)) {
    res.status(403).json({ error: "Request origin could not be verified." });
    return;
  }
  const { memberId, mode, subjects, expectedEnrollments } = (req.body ?? {}) as {
    memberId?: unknown;
    mode?: unknown;
    subjects?: unknown;
    expectedEnrollments?: unknown;
  };
  if (!Number.isSafeInteger(memberId) || Number(memberId) < 1 ||
      (mode !== "add" && mode !== "change") || !Array.isArray(subjects) ||
      (mode === "change" && !Array.isArray(expectedEnrollments))) {
    res.status(400).json({ error: "memberId, mode, and subjects are required; change mode also requires expectedEnrollments." });
    return;
  }
  const memberNumber = Number(memberId);
  try {
    if (!await publicOrAdminMemberAuthorized(req, memberNumber)) {
      res.status(401).json({ error: "Member access could not be verified." });
      return;
    }
    const admin = await getVerifiedAdmin(req);
    if (!admin && !await publicRegistrationWindowOpen()) {
      res.status(403).json({ error: "Registration is currently closed. Please contact the administration for assistance." });
      return;
    }
    const requested: { courseLevelId: number; sectionId: number | null }[] = [];
    for (const row of subjects) {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
          !Number.isSafeInteger((row as { courseLevelId?: unknown }).courseLevelId) ||
          (row as { courseLevelId: number }).courseLevelId < 1 ||
          !("sectionId" in row) ||
          ((row as { sectionId?: unknown }).sectionId !== null &&
            (!Number.isSafeInteger((row as { sectionId?: unknown }).sectionId) ||
             (row as { sectionId: number }).sectionId < 1))) {
        res.status(400).json({ error: "Each subject requires a positive courseLevelId and sectionId number or null." });
        return;
      }
      requested.push({
        courseLevelId: (row as { courseLevelId: number }).courseLevelId,
        sectionId: (row as { sectionId: number | null }).sectionId,
      });
    }
    if (new Set(requested.map(row => row.courseLevelId)).size !== requested.length) {
      res.status(400).json({ error: "A course level cannot be selected more than once." });
      return;
    }
    const expected = Array.isArray(expectedEnrollments) ? expectedEnrollments.map(row => row as {
      enrollmentId?: unknown; courseLevelId?: unknown; sectionId?: unknown;
    }) : [];
    if (mode === "change" && expected.some(row =>
      !row || typeof row !== "object" ||
      !Number.isSafeInteger(row.enrollmentId) || Number(row.enrollmentId) < 1 ||
      !Number.isSafeInteger(row.courseLevelId) || Number(row.courseLevelId) < 1 ||
      !(row.sectionId === null || (Number.isSafeInteger(row.sectionId) && Number(row.sectionId) > 0))
    )) {
      res.status(400).json({ error: "Expected enrollments contain invalid identifiers." });
      return;
    }
    if (mode === "change" && new Set(expected.map(row => row.enrollmentId)).size !== expected.length) {
      res.status(400).json({ error: "Expected enrollments cannot contain duplicate enrollment IDs." });
      return;
    }
    await db.transaction(async tx => {
      if (!admin) {
        const windowRows = await tx.select({
          key: portalSettingsTable.key,
          value: portalSettingsTable.value,
        }).from(portalSettingsTable)
          .where(inArray(portalSettingsTable.key, ["registration_open_date", "registration_close_date"]));
        const openDate = windowRows.find(row => row.key === "registration_open_date")?.value || "";
        const closeDate = windowRows.find(row => row.key === "registration_close_date")?.value || "";
        const today = templeDate();
        if (!openDate || !closeDate || today < openDate || today > closeDate) {
          throw new StudentSubjectsError(403, "Registration is currently closed. Please contact the administration for assistance.");
        }
      }
      const [configuredYear] = await tx.select({ value: portalSettingsTable.value })
        .from(portalSettingsTable).where(eq(portalSettingsTable.key, "registration_curriculum_year"));
      if (!configuredYear?.value?.trim()) throw new StudentSubjectsError(503, "The current registration year is not configured.");
      const [legacyStudent] = await tx.select({
        id: studentsTable.id,
        curriculumYear: studentsTable.curriculumYear,
      }).from(studentsTable).where(and(
        eq(studentsTable.studentCode, req.params.code),
        eq(studentsTable.memberId, memberNumber),
      )).for("update");
      if (!legacyStudent) throw new StudentSubjectsError(404, "No registration was found for this student and member.");
      const currentYearKey = normalizeCurriculumYear(configuredYear.value);
      const existingYearRegistrations = await tx.select({
        id: studentRegistrationsTable.id,
        curriculumYear: studentRegistrationsTable.curriculumYear,
      }).from(studentRegistrationsTable).where(eq(studentRegistrationsTable.studentId, legacyStudent.id)).for("update");
      const existingYearRegistration = existingYearRegistrations.find(row =>
        normalizeCurriculumYear(row.curriculumYear) === currentYearKey,
      );
      if (curriculumYearsClearlyMatch(legacyStudent.curriculumYear, configuredYear.value)) {
        const legacyEnrollments = await tx.select({
          id: enrollmentsTable.id,
          enrollDate: enrollmentsTable.enrollDate,
          courseId: courseLevelsTable.courseId,
          courseLevelId: enrollmentsTable.courseLevelId,
          courseYear: coursesTable.curriculumYear,
        }).from(enrollmentsTable)
          .innerJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
          .innerJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
          .where(and(
            eq(enrollmentsTable.studentId, legacyStudent.id),
            isNull(enrollmentsTable.registrationId),
          )).for("update");
        if (legacyEnrollments.length) {
          const existingRegistrationCourses = existingYearRegistration ? await tx.select({
            courseId: courseLevelsTable.courseId,
          }).from(enrollmentsTable)
            .innerJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
            .where(eq(enrollmentsTable.registrationId, existingYearRegistration.id)) : [];
          const linkedCourseIds = new Set(existingRegistrationCourses.map(row => row.courseId));
          const legacyDates = new Set(legacyEnrollments.map(row => row.enrollDate));
          const firstEnrollmentDate = legacyEnrollments[0]!.enrollDate;
          if (legacyDates.size !== 1 ||
              !isIsoCalendarDate(firstEnrollmentDate) ||
              new Set(legacyEnrollments.map(row => row.courseId)).size !== legacyEnrollments.length ||
              new Set(legacyEnrollments.map(row => row.courseLevelId)).size !== legacyEnrollments.length ||
              legacyEnrollments.some(row => !curriculumYearsClearlyMatch(row.courseYear, configuredYear.value)) ||
              legacyEnrollments.some(row => linkedCourseIds.has(row.courseId))) {
            throw new StudentSubjectsError(409, "Legacy enrollment dates or academic year cannot be confirmed from the course records. Please contact the Gurukul office to review these records.");
          }
          const registrationId = existingYearRegistration?.id ?? (await tx.insert(studentRegistrationsTable).values({
              studentId: legacyStudent.id,
              curriculumYear: configuredYear.value.trim(),
              registeredAt: firstEnrollmentDate,
              dateProvenance: "first_enrollment",
              updatedAt: new Date(),
            }).returning({ id: studentRegistrationsTable.id }))[0]!.id;
          await tx.update(enrollmentsTable).set({ registrationId })
            .where(and(
              eq(enrollmentsTable.studentId, legacyStudent.id),
              isNull(enrollmentsTable.registrationId),
              inArray(enrollmentsTable.id, legacyEnrollments.map(row => row.id)),
            ));
        }
      }
      const registrationRows = await tx.select({
        id: studentRegistrationsTable.id,
        studentId: studentsTable.id,
        name: studentsTable.name,
        dob: studentsTable.dob,
        memberId: studentsTable.memberId,
        curriculumYear: studentRegistrationsTable.curriculumYear,
      }).from(studentRegistrationsTable)
        .innerJoin(studentsTable, eq(studentsTable.id, studentRegistrationsTable.studentId))
        .where(and(
          eq(studentsTable.studentCode, req.params.code),
          eq(studentsTable.memberId, memberNumber),
        )).for("update");
      const activeYearKey = normalizeCurriculumYear(configuredYear.value);
      const registration = registrationRows.find(row =>
        normalizeCurriculumYear(row.curriculumYear) === activeYearKey,
      );
      if (!registration) throw new StudentSubjectsError(404, "No registration was found for this student and member.");
      const member = await tx.select({ id: membersTable.id }).from(membersTable)
        .where(eq(membersTable.id, memberNumber)).limit(1);
      if (!member.length) throw new StudentSubjectsError(404, "The linked member no longer exists.");
      const enrolledRows = await tx.select({
        id: enrollmentsTable.id, courseLevelId: enrollmentsTable.courseLevelId,
        sectionId: enrollmentsTable.sectionId, status: enrollmentsTable.status,
      }).from(enrollmentsTable).where(and(
        eq(enrollmentsTable.registrationId, registration.id),
        eq(enrollmentsTable.status, "Enrolled"),
      )).for("update");
      if (mode === "change") {
        const snapshot = enrolledRows.map(row => `${row.id}|${row.courseLevelId}|${row.sectionId ?? "null"}`).sort();
        const sent = expected.map(row => `${row.enrollmentId}|${row.courseLevelId}|${row.sectionId === null ? "null" : row.sectionId}`).sort();
        if (snapshot.length !== sent.length || snapshot.some((entry, index) => entry !== sent[index])) {
          throw new StudentSubjectsError(409, "Student registrations changed since this editor was opened. Refresh and try again.");
        }
      }
      const currentDesired = mode === "add"
        ? [...enrolledRows.map(row => ({ courseLevelId: row.courseLevelId, sectionId: row.sectionId })), ...requested]
        : requested;
      if (new Set(currentDesired.map(row => row.courseLevelId)).size !== currentDesired.length) {
        throw new StudentSubjectsError(400, "A course level cannot be selected more than once.");
      }
      const levelIds = currentDesired.map(row => row.courseLevelId);
      const levelRows = levelIds.length ? await tx.select({
        id: courseLevelsTable.id, courseId: courseLevelsTable.courseId,
        ageGroup: coursesTable.ageGroup, courseFee: coursesTable.fee,
      }).from(courseLevelsTable).innerJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
        .where(and(inArray(courseLevelsTable.id, levelIds), eq(courseLevelsTable.status, "Active"), isNull(coursesTable.archivedAt)))
        : [];
      if (levelRows.length !== levelIds.length || new Set(levelRows.map(row => row.courseId)).size !== levelRows.length) {
        throw new StudentSubjectsError(400, "Selected course levels are unavailable or include more than one level from a course.");
      }
      const dobDate = parseDateOfBirth(registration.dob);
      if (!dobDate) throw new StudentSubjectsError(400, "A valid student date of birth is required.");
      const age = getAgeOnDate(dobDate);
      if (age > 22) throw new StudentSubjectsError(400, "Students must be 22 years old or younger to register.");
      for (const level of levelRows) {
        const minimumAge = getMinimumCourseAge(level.ageGroup);
        if (age < minimumAge) throw new StudentSubjectsError(400, `Student must be at least ${minimumAge} years old for this course.`);
      }
      const withSection = currentDesired.filter(row => row.sectionId !== null);
      const sections = withSection.length ? await tx.select({
        id: courseSectionsTable.id, courseLevelId: courseSectionsTable.courseLevelId,
      }).from(courseSectionsTable).where(and(
        inArray(courseSectionsTable.id, withSection.map(row => row.sectionId!)),
        eq(courseSectionsTable.status, "Active"),
      )) : [];
      const sectionLevelMap = new Map(sections.map(row => [row.id, row.courseLevelId]));
      if (withSection.some(row => sectionLevelMap.get(row.sectionId!) !== row.courseLevelId)) {
        throw new StudentSubjectsError(400, "A selected section is inactive or does not belong to its course level.");
      }
      const existingByLevel = await tx.select({
        id: enrollmentsTable.id, courseLevelId: enrollmentsTable.courseLevelId,
        sectionId: enrollmentsTable.sectionId, status: enrollmentsTable.status, enrollDate: enrollmentsTable.enrollDate,
      }).from(enrollmentsTable).where(eq(enrollmentsTable.registrationId, registration.id)).for("update");
      const existingMap = new Map(existingByLevel.map(row => [row.courseLevelId, row]));
      if (currentDesired.some(row => existingMap.get(row.courseLevelId)?.status === "Completed")) {
        throw new StudentSubjectsError(409, "A completed course enrollment cannot be re-added.");
      }
      if (mode === "change") {
        for (const row of enrolledRows) {
          if (!currentDesired.some(subject => subject.courseLevelId === row.courseLevelId)) {
            await tx.update(enrollmentsTable).set({ status: "Withdrawn" }).where(eq(enrollmentsTable.id, row.id));
          }
        }
      }
      for (const subject of currentDesired) {
        const old = existingMap.get(subject.courseLevelId);
        if (old?.status === "Enrolled") {
          if (old.sectionId !== subject.sectionId) await tx.update(enrollmentsTable)
            .set({ sectionId: subject.sectionId }).where(eq(enrollmentsTable.id, old.id));
          continue;
        }
        if (old?.status === "Withdrawn") {
          await tx.update(enrollmentsTable).set({ status: "Enrolled", sectionId: subject.sectionId })
            .where(eq(enrollmentsTable.id, old.id));
          const [payment] = await tx.select({ id: paymentsTable.id }).from(paymentsTable)
            .where(eq(paymentsTable.enrollmentId, old.id)).limit(1);
          if (!payment) await tx.insert(paymentsTable).values({
            enrollmentId: old.id,
            amountDue: levelRows.find(level => level.id === subject.courseLevelId)?.courseFee ?? "35.00",
            amountPaid: "0.00", paymentStatus: "Pending",
          });
          continue;
        }
        const [enrollment] = await tx.insert(enrollmentsTable).values({
          studentId: registration.studentId, registrationId: registration.id,
          courseLevelId: subject.courseLevelId, sectionId: subject.sectionId, enrollDate: templeDate(),
        }).returning({ id: enrollmentsTable.id });
        await tx.insert(paymentsTable).values({
          enrollmentId: enrollment.id,
          amountDue: levelRows.find(level => level.id === subject.courseLevelId)?.courseFee ?? "35.00",
          amountPaid: "0.00", paymentStatus: "Pending",
        });
      }
      await tx.update(studentRegistrationsTable).set({ updatedAt: new Date() })
        .where(eq(studentRegistrationsTable.id, registration.id));
    });
    const fresh = await currentRegistrationSummary(req.params.code, memberNumber);
    if (!fresh) {
      res.status(404).json({ error: "Registration not found after update." });
      return;
    }
    res.json(fresh);
  } catch (err) {
    if (err instanceof StudentSubjectsError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to update current student registration");
    res.status(500).json({ error: "Student registrations could not be updated." });
  }
});

// PATCH /api/admin/students/:code/subjects — replace current course registrations.
router.patch("/:code/subjects", async (req, res): Promise<void> => {
  if (!isSameOriginRequest(req)) {
    res.status(403).json({ error: "Request origin could not be verified." });
    return;
  }

  let admin;
  try {
    admin = await getVerifiedAdmin(req);
  } catch (err) {
    req.log.error({ err }, "Failed to verify admin session");
    res.status(500).json({ error: "Could not verify admin session." });
    return;
  }
  if (!admin) {
    res.status(401).json({ error: "An active admin session is required." });
    return;
  }

  const { subjects, expectedEnrollments } = (req.body ?? {}) as {
    subjects?: unknown;
    expectedEnrollments?: unknown;
  };
  if (!Array.isArray(subjects) || !Array.isArray(expectedEnrollments)) {
    res.status(400).json({ error: "subjects and expectedEnrollments must be arrays." });
    return;
  }
  const expectedSnapshot: { enrollmentId: number; courseLevelId: number; sectionId: number | null }[] = [];
  for (const row of expectedEnrollments) {
    if (
      row == null ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      !Number.isSafeInteger((row as { enrollmentId?: unknown }).enrollmentId) ||
      (row as { enrollmentId: number }).enrollmentId < 1 ||
      !Number.isSafeInteger((row as { courseLevelId?: unknown }).courseLevelId) ||
      (row as { courseLevelId: number }).courseLevelId < 1 ||
      !("sectionId" in row) ||
      ((row as { sectionId?: unknown }).sectionId !== null &&
        (!Number.isSafeInteger((row as { sectionId?: unknown }).sectionId) ||
          (row as { sectionId: number }).sectionId < 1))
    ) {
      res.status(400).json({ error: "Each expected enrollment must include positive enrollmentId and courseLevelId values and a sectionId number or null." });
      return;
    }
    expectedSnapshot.push({
      enrollmentId: (row as { enrollmentId: number }).enrollmentId,
      courseLevelId: (row as { courseLevelId: number }).courseLevelId,
      sectionId: (row as { sectionId: number | null }).sectionId,
    });
  }
  if (new Set(expectedSnapshot.map(row => row.enrollmentId)).size !== expectedSnapshot.length) {
    res.status(400).json({ error: "expectedEnrollments cannot contain duplicate enrollment IDs." });
    return;
  }
  if (new Set(expectedSnapshot.map(row => row.courseLevelId)).size !== expectedSnapshot.length) {
    res.status(400).json({ error: "expectedEnrollments cannot contain duplicate course levels." });
    return;
  }

  const desiredSubjects: { courseLevelId: number; sectionId: number | null }[] = [];
  for (const subject of subjects) {
    if (
      subject == null ||
      typeof subject !== "object" ||
      !Number.isSafeInteger((subject as { courseLevelId?: unknown }).courseLevelId) ||
      (subject as { courseLevelId: number }).courseLevelId < 1 ||
      !("sectionId" in subject) ||
      ((subject as { sectionId?: unknown }).sectionId !== null &&
        (!Number.isSafeInteger((subject as { sectionId?: unknown }).sectionId) ||
          (subject as { sectionId: number }).sectionId < 1))
    ) {
      res.status(400).json({ error: "Each subject must include a positive courseLevelId and a sectionId number or null." });
      return;
    }
    desiredSubjects.push({
      courseLevelId: (subject as { courseLevelId: number }).courseLevelId,
      sectionId: (subject as { sectionId: number | null }).sectionId,
    });
  }
  const desiredLevelIds = desiredSubjects.map(subject => subject.courseLevelId);
  if (new Set(desiredLevelIds).size !== desiredLevelIds.length) {
    res.status(400).json({ error: "A course level cannot be selected more than once." });
    return;
  }

  try {
    const updated = await db.transaction(async tx => {
      const [student] = await tx
        .select({
          id: studentsTable.id,
          name: studentsTable.name,
          curriculumYear: studentsTable.curriculumYear,
        })
        .from(studentsTable)
        .where(eq(studentsTable.studentCode, req.params.code))
        .for("update");
      if (!student) throw new StudentSubjectsError(404, "Student not found.");

      const [yearSetting] = await tx.select({ value: portalSettingsTable.value })
        .from(portalSettingsTable).where(eq(portalSettingsTable.key, "registration_curriculum_year"));
      const activeYear = yearSetting?.value?.trim() || "";
      const currentYearAliases = activeYear ? curriculumYearAliases(activeYear) : [];
      const [currentRegistration] = activeYear ? await tx.select({ id: studentRegistrationsTable.id })
        .from(studentRegistrationsTable)
        .where(and(
          eq(studentRegistrationsTable.studentId, student.id),
          inArray(studentRegistrationsTable.curriculumYear, currentYearAliases),
        )).limit(1).for("update") : [];
      const sessionEnrollmentCondition = currentRegistration
        ? eq(enrollmentsTable.registrationId, currentRegistration.id)
        : normalizeCurriculumYear(student.curriculumYear) === normalizeCurriculumYear(activeYear)
          ? and(eq(enrollmentsTable.studentId, student.id), isNull(enrollmentsTable.registrationId))
          : eq(enrollmentsTable.id, -1);
      const enrollmentRows = await tx
        .select({
          id: enrollmentsTable.id,
          courseLevelId: enrollmentsTable.courseLevelId,
          sectionId: enrollmentsTable.sectionId,
          status: enrollmentsTable.status,
        })
        .from(enrollmentsTable)
        .where(currentRegistration
          ? sessionEnrollmentCondition
          : and(sessionEnrollmentCondition, eq(enrollmentsTable.studentId, student.id)));
      const currentEnrolled = enrollmentRows.filter(row => row.status === "Enrolled");
      const currentSnapshot = currentEnrolled
        .map(row => ({
          enrollmentId: row.id,
          courseLevelId: row.courseLevelId,
          sectionId: row.sectionId,
        }))
        .sort((a, b) => a.enrollmentId - b.enrollmentId);
      const expectedSorted = expectedSnapshot.slice().sort((a, b) => a.enrollmentId - b.enrollmentId);
      if (
        currentSnapshot.length !== expectedSorted.length ||
        currentSnapshot.some((row, i) =>
          row.enrollmentId !== expectedSorted[i].enrollmentId ||
          row.courseLevelId !== expectedSorted[i].courseLevelId ||
          row.sectionId !== expectedSorted[i].sectionId
        )
      ) {
        throw new StudentSubjectsError(409, "Student registrations changed since this editor was opened. Refresh and try again.");
      }

      const levelRows = desiredLevelIds.length
        ? await tx
          .select({
            id: courseLevelsTable.id,
            courseId: courseLevelsTable.courseId,
            courseFee: coursesTable.fee,
          })
          .from(courseLevelsTable)
          .innerJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
          .where(and(
            inArray(courseLevelsTable.id, desiredLevelIds),
            eq(courseLevelsTable.status, "Active"),
            isNull(coursesTable.archivedAt),
          ))
        : [];
      if (levelRows.length !== desiredLevelIds.length) {
        throw new StudentSubjectsError(400, "One or more selected course levels are archived or unavailable.");
      }
      if (new Set(levelRows.map(row => row.courseId)).size !== levelRows.length) {
        throw new StudentSubjectsError(400, "Only one level per course may be selected.");
      }

      const requestedSections = desiredSubjects.filter(subject => subject.sectionId !== null);
      if (requestedSections.length) {
        const sections = await tx
          .select({
            id: courseSectionsTable.id,
            courseLevelId: courseSectionsTable.courseLevelId,
          })
          .from(courseSectionsTable)
          .where(and(
            inArray(courseSectionsTable.id, requestedSections.map(subject => subject.sectionId!)),
            eq(courseSectionsTable.status, "Active"),
          ));
        const sectionLevels = new Map(sections.map(section => [section.id, section.courseLevelId]));
        for (const subject of requestedSections) {
          if (sectionLevels.get(subject.sectionId!) !== subject.courseLevelId) {
            throw new StudentSubjectsError(400, "A selected section is unavailable or does not belong to its course level.");
          }
        }
      }

      const existingByLevel = new Map(enrollmentRows.map(row => [row.courseLevelId, row]));
      for (const levelId of desiredLevelIds) {
        if (existingByLevel.get(levelId)?.status === "Completed") {
          throw new StudentSubjectsError(409, "A completed course enrollment cannot be re-added.");
        }
      }

      const unchanged = desiredSubjects.length === currentEnrolled.length &&
        desiredSubjects.every(subject => {
          const current = currentEnrolled.find(row => row.courseLevelId === subject.courseLevelId);
          return current?.sectionId === subject.sectionId;
        });
      if (unchanged) {
        return currentEnrolled.map(row => ({
          enrollmentId: row.id,
          courseLevelId: row.courseLevelId,
          sectionId: row.sectionId,
        }));
      }

      const desiredByLevel = new Map(desiredSubjects.map(subject => [subject.courseLevelId, subject]));
      for (const row of currentEnrolled) {
        if (desiredByLevel.has(row.courseLevelId)) continue;
        await tx.update(enrollmentsTable)
          .set({ status: "Withdrawn" })
          .where(eq(enrollmentsTable.id, row.id));
      }

      const withdrawnPaymentIds = enrollmentRows
        .filter(row => row.status === "Withdrawn" && desiredLevelIds.includes(row.courseLevelId))
        .map(row => row.id);
      const existingPayments = withdrawnPaymentIds.length
        ? await tx
          .select({
            enrollmentId: paymentsTable.enrollmentId,
          })
          .from(paymentsTable)
          .where(inArray(paymentsTable.enrollmentId, withdrawnPaymentIds))
        : [];
      const paymentEnrollmentIds = new Set(existingPayments.map(payment => payment.enrollmentId));
      const paymentNeededLevels = desiredSubjects.filter(subject => {
        const existing = existingByLevel.get(subject.courseLevelId);
        return !existing || (existing.status === "Withdrawn" && !paymentEnrollmentIds.has(existing.id));
      });
      let defaultCourseFee = "35.00";
      if (paymentNeededLevels.some(subject => levelRows.find(level => level.id === subject.courseLevelId)?.courseFee == null)) {
        const [feeSetting] = await tx
          .select({ value: portalSettingsTable.value })
          .from(portalSettingsTable)
          .where(eq(portalSettingsTable.key, "stripe_course_fee"))
          .limit(1);
        defaultCourseFee = feeSetting?.value?.trim() || "35.00";
        if (!Number.isFinite(Number(defaultCourseFee)) || Number(defaultCourseFee) < 0) {
          throw new StudentSubjectsError(500, "The configured course registration fee is invalid.");
        }
      }

      const feeForLevel = (levelId: number) => {
        const courseFee = levelRows.find(level => level.id === levelId)?.courseFee;
        return courseFee ?? defaultCourseFee;
      };
      const today = templeDate();
      for (const subject of desiredSubjects) {
        const existing = existingByLevel.get(subject.courseLevelId);
        if (existing?.status === "Enrolled") {
          if (existing.sectionId !== subject.sectionId) {
            await tx.update(enrollmentsTable)
              .set({ sectionId: subject.sectionId })
              .where(eq(enrollmentsTable.id, existing.id));
          }
          continue;
        }
        if (existing?.status === "Withdrawn") {
          await tx.update(enrollmentsTable)
            .set({ status: "Enrolled", sectionId: subject.sectionId })
            .where(eq(enrollmentsTable.id, existing.id));
          if (!paymentEnrollmentIds.has(existing.id)) {
            await tx.insert(paymentsTable).values({
              enrollmentId: existing.id,
              amountDue: feeForLevel(subject.courseLevelId),
              amountPaid: "0.00",
              paymentStatus: "Pending",
            });
          }
          continue;
        }

        const [enrollment] = await tx.insert(enrollmentsTable).values({
          studentId: student.id,
          registrationId: currentRegistration?.id ?? null,
          courseLevelId: subject.courseLevelId,
          sectionId: subject.sectionId,
          enrollDate: today,
        }).returning({ id: enrollmentsTable.id });
        await tx.insert(paymentsTable).values({
          enrollmentId: enrollment.id,
          amountDue: feeForLevel(subject.courseLevelId),
          amountPaid: "0.00",
          paymentStatus: "Pending",
        });
      }

      const after = await tx
        .select({
          id: enrollmentsTable.id,
          courseLevelId: enrollmentsTable.courseLevelId,
          sectionId: enrollmentsTable.sectionId,
        })
        .from(enrollmentsTable)
        .where(and(
          sessionEnrollmentCondition,
          ...(!currentRegistration ? [eq(enrollmentsTable.studentId, student.id)] : []),
          eq(enrollmentsTable.status, "Enrolled"),
        ));
      const beforeValue = currentEnrolled.map(row => ({
        enrollmentId: row.id,
        courseLevelId: row.courseLevelId,
        sectionId: row.sectionId,
      }));
      const afterValue = after.map(row => ({
        enrollmentId: row.id,
        courseLevelId: row.courseLevelId,
        sectionId: row.sectionId,
      }));
      await tx.insert(auditLogsTable).values({
        adminUserId: admin.id,
        adminName: admin.name,
        userRole: admin.role,
        moduleName: "Student Registration",
        actionType: "Edit",
        entityName: student.name,
        entityId: req.params.code,
        previousValue: JSON.stringify(beforeValue),
        newValue: JSON.stringify(afterValue),
        curriculumYear: currentRegistration ? activeYear : student.curriculumYear,
        ipAddress: req.socket?.remoteAddress ?? null,
        userAgent: req.get("user-agent") ?? null,
        createdAt: new Date(),
      });
      return afterValue;
    });

    res.json({ success: true, enrollments: updated });
  } catch (err) {
    if (err instanceof StudentSubjectsError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to update student subjects");
    res.status(500).json({ error: "Student registrations could not be updated. Please try again." });
  }
});

// PATCH /api/admin/students/:code — edit student details
router.patch("/:code", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const { code } = req.params;
    const {
      firstName, lastName, dob, grade, curriculumYear, isNewStudent,
      motherName, motherPhone, motherEmail,
      fatherName, fatherPhone, fatherEmail,
      address,
    } = req.body as {
      firstName?: string; lastName?: string;
      dob?: string; grade?: string; curriculumYear?: string; isNewStudent?: boolean;
      motherName?: string; motherPhone?: string; motherEmail?: string;
      fatherName?: string; fatherPhone?: string; fatherEmail?: string;
      address?: string;
    };

    const [existing] = await db
      .select({
        id: studentsTable.id, name: studentsTable.name,
        dob: studentsTable.dob, grade: studentsTable.grade,
        curriculumYear: studentsTable.curriculumYear, isNewStudent: studentsTable.isNewStudent,
        motherName: studentsTable.motherName, motherPhone: studentsTable.motherPhone, motherEmail: studentsTable.motherEmail,
        fatherName: studentsTable.fatherName, fatherPhone: studentsTable.fatherPhone, fatherEmail: studentsTable.fatherEmail,
        address: studentsTable.address,
      })
      .from(studentsTable)
      .where(eq(studentsTable.studentCode, code));

    if (!existing) return res.status(404).json({ error: "Student not found" });

    const updates: Record<string, unknown> = {};

    // Name update
    if (firstName !== undefined || lastName !== undefined) {
      const parts = existing.name.split(" ");
      const currentFirst = parts[0] ?? "";
      const currentLast  = parts.slice(1).join(" ");
      const newFirst = firstName?.trim() ?? currentFirst;
      const newLast  = lastName?.trim()  ?? currentLast;
      updates.name = `${newFirst} ${newLast}`.trim();
    }
    if (dob             !== undefined) updates.dob            = dob || null;
    if (grade           !== undefined) updates.grade          = grade || null;
    if (curriculumYear  !== undefined) updates.curriculumYear = curriculumYear || null;
    if (isNewStudent    !== undefined) updates.isNewStudent   = isNewStudent;
    if (motherName      !== undefined) updates.motherName     = motherName.trim() || null;
    if (motherPhone     !== undefined) updates.motherPhone    = motherPhone.trim() || null;
    if (motherEmail     !== undefined) updates.motherEmail    = motherEmail.trim() || null;
    if (fatherName      !== undefined) updates.fatherName     = fatherName.trim() || null;
    if (fatherPhone     !== undefined) updates.fatherPhone    = fatherPhone.trim() || null;
    if (fatherEmail     !== undefined) updates.fatherEmail    = fatherEmail.trim() || null;
    if (address         !== undefined) updates.address        = address.trim() || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // Build previousValue using only the fields that are being changed
    const previousValue: Record<string, unknown> = {};
    for (const key of Object.keys(updates)) {
      previousValue[key] = (existing as Record<string, unknown>)[key] ?? null;
    }

    await db.update(studentsTable).set(updates).where(eq(studentsTable.id, existing.id));
    await writeAudit(req, {
      moduleName:     "Student Registration",
      actionType:     "Edit",
      entityName:     existing.name,
      entityId:       code,
      previousValue,
      newValue:       updates,
      curriculumYear: (updates.curriculumYear ?? existing.curriculumYear) as string | null,
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update student");
    res.status(500).json({ error: "Failed to update student" });
  }
});

// PATCH /api/admin/students/:code/status — single activate/deactivate
router.patch("/:code/status", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const { isActive } = req.body as { isActive: boolean };
    const [existing] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(eq(studentsTable.studentCode, req.params.code));
    if (!existing) return res.status(404).json({ error: "Student not found" });
    await db.update(studentsTable).set({ isActive }).where(eq(studentsTable.id, existing.id));
    await writeAudit(req, {
      moduleName: "Student Registration",
      actionType: "Edit",
      entityName: req.params.code,
      entityId:   req.params.code,
      newValue:   { isActive },
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update student status");
    res.status(500).json({ error: "Failed to update status" });
  }
});

// DELETE /api/admin/students/:code
router.delete("/:code", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const [student] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(eq(studentsTable.studentCode, req.params.code));
    if (!student) return res.status(404).json({ error: "Student not found" });
    await db.delete(studentsTable).where(eq(studentsTable.id, student.id));
    await writeAudit(req, {
      moduleName: "Student Registration",
      actionType: "Delete",
      entityName: req.params.code,
      entityId:   req.params.code,
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete student");
    res.status(500).json({ error: "Failed to delete student" });
  }
});

// PATCH /api/admin/students/payments/:enrollmentId — update payment details
router.patch("/payments/:enrollmentId", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  try {
    const enrollmentId = parseInt(req.params.enrollmentId);
    if (isNaN(enrollmentId)) return res.status(400).json({ error: "Invalid enrollment ID" });

    const { amountDue, amountPaid, paymentStatus, paymentMethod, receiptId, paymentDate } = req.body as {
      amountDue?:     number;
      amountPaid?:    number;
      paymentStatus?: "Paid" | "Pending" | "Overdue";
      paymentMethod?: string | null;
      receiptId?:     string | null;
      paymentDate?:   string | null;
    };

    const [existing] = await db
      .select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(eq(paymentsTable.enrollmentId, enrollmentId));
    if (!existing) return res.status(404).json({ error: "Payment record not found" });

    const updates: Record<string, unknown> = {};
    if (amountDue     !== undefined) updates.amountDue     = String(amountDue);
    if (amountPaid    !== undefined) updates.amountPaid    = String(amountPaid);
    if (paymentStatus !== undefined) updates.paymentStatus = paymentStatus;
    if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod || null;
    if (receiptId     !== undefined) updates.receiptId     = receiptId     || null;
    if (paymentDate   !== undefined) updates.paymentDate   = paymentDate   || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    await db.update(paymentsTable).set(updates).where(eq(paymentsTable.id, existing.id));
    await writeAudit(req, {
      moduleName: "Student Registration",
      actionType: "Edit",
      entityName: `Payment — enrollment #${enrollmentId}`,
      entityId:   String(enrollmentId),
      newValue:   updates,
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update payment");
    res.status(500).json({ error: "Failed to update payment" });
  }
});

// PATCH /api/admin/students/enrollments/:id/section
router.patch("/enrollments/:id/section", async (req, res): Promise<void> => {
  if (!isSameOriginRequest(req)) {
    res.status(403).json({ error: "Request origin could not be verified." });
    return;
  }

  let admin;
  try {
    admin = await getVerifiedAdmin(req);
  } catch (err) {
    req.log.error({ err }, "Failed to verify admin session for section update");
    res.status(500).json({ error: "Could not verify admin session." });
    return;
  }
  if (!admin) {
    res.status(401).json({ error: "An active admin session is required." });
    return;
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!/^[1-9]\d*$/.test(rawId)) {
    res.status(400).json({ error: "Invalid enrollment ID." });
    return;
  }
  const enrollmentId = Number(rawId);
  if (!Number.isSafeInteger(enrollmentId)) {
    res.status(400).json({ error: "Invalid enrollment ID." });
    return;
  }

  const body = req.body ?? {};
  if (!Object.prototype.hasOwnProperty.call(body, "sectionId")) {
    res.status(400).json({ error: "sectionId must be a positive integer or null." });
    return;
  }
  const sectionIdValue: unknown = body.sectionId;
  if (
    sectionIdValue !== null &&
    (typeof sectionIdValue !== "number" || !Number.isSafeInteger(sectionIdValue) || sectionIdValue < 1)
  ) {
    res.status(400).json({ error: "sectionId must be a positive integer or null." });
    return;
  }
  const sectionId = sectionIdValue as number | null;

  try {
    const result = await db.transaction(async tx => {
      // Discover the parent first, then use the same student → enrollment lock order as subjects edits.
      const [initialEnrollment] = await tx
        .select({ studentId: enrollmentsTable.studentId })
        .from(enrollmentsTable)
        .where(eq(enrollmentsTable.id, enrollmentId));
      if (!initialEnrollment) throw new StudentSubjectsError(404, "Enrollment not found.");

      const [student] = await tx
        .select({ id: studentsTable.id })
        .from(studentsTable)
        .where(eq(studentsTable.id, initialEnrollment.studentId))
        .for("update");
      if (!student) throw new StudentSubjectsError(404, "Student not found.");

      const [enrollment] = await tx
        .select({
          studentId: enrollmentsTable.studentId,
          courseLevelId: enrollmentsTable.courseLevelId,
          status: enrollmentsTable.status,
          sectionId: enrollmentsTable.sectionId,
        })
        .from(enrollmentsTable)
        .where(eq(enrollmentsTable.id, enrollmentId))
        .for("update");
      if (!enrollment || enrollment.studentId !== student.id) {
        throw new StudentSubjectsError(404, "Enrollment not found.");
      }
      if (enrollment.status !== "Enrolled") {
        throw new StudentSubjectsError(409, "Only currently enrolled students can be assigned to a section.");
      }

      if (sectionId != null) {
        const [section] = await tx
          .select({
            courseLevelId: courseSectionsTable.courseLevelId,
            status: courseSectionsTable.status,
          })
          .from(courseSectionsTable)
          .where(eq(courseSectionsTable.id, sectionId));
        if (!section || section.status !== "Active") {
          throw new StudentSubjectsError(400, "Section is unavailable or inactive.");
        }
        if (section.courseLevelId !== enrollment.courseLevelId) {
          throw new StudentSubjectsError(400, "Section does not belong to this enrollment's level.");
        }
      }

      if (enrollment.sectionId === sectionId) {
        return { changed: false };
      }

      const [updated] = await tx.update(enrollmentsTable)
        .set({ sectionId: sectionId ?? null })
        .where(eq(enrollmentsTable.id, enrollmentId))
        .returning({
          id: enrollmentsTable.id,
          courseLevelId: enrollmentsTable.courseLevelId,
          sectionId: enrollmentsTable.sectionId,
          status: enrollmentsTable.status,
        });
      await tx.insert(auditLogsTable).values({
        adminUserId: admin.id,
        adminName: admin.name,
        userRole: admin.role,
        moduleName: "Student Registration",
        actionType: "Edit",
        entityName: `Enrollment #${enrollmentId}`,
        entityId: String(enrollmentId),
        previousValue: JSON.stringify({
          enrollmentId,
          courseLevelId: enrollment.courseLevelId,
          sectionId: enrollment.sectionId,
          status: enrollment.status,
        }),
        newValue: JSON.stringify({
          enrollmentId: updated.id,
          courseLevelId: updated.courseLevelId,
          sectionId: updated.sectionId,
          status: updated.status,
        }),
        ipAddress: req.socket?.remoteAddress ?? null,
        userAgent: req.get("user-agent") ?? null,
        createdAt: new Date(),
      });
      return { changed: true };
    });
    res.json({ success: true, changed: result.changed });
  } catch (err) {
    if (err instanceof StudentSubjectsError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to update enrollment section");
    res.status(500).json({ error: "Failed to update enrollment section" });
  }
});

export default router;
