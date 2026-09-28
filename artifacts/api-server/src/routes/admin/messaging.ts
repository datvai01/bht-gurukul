import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { writeAudit } from "../../lib/audit";
import { db } from "@workspace/db";
import {
  studentsTable,
  enrollmentsTable,
  courseLevelsTable,
  coursesTable,
  adminMessagesTable,
  adminUsersTable,
  contactsTable,
  teachersTable,
} from "@workspace/db/schema";
import { eq, asc, isNotNull, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

const BROADCAST_SUPER_ADMIN_EMAIL = "admin@gurukul.org";

/**
 * Validates that the supplied credential+secret belong to a *different* active admin
 * with admin or super_admin privileges.
 *
 * Credential rules (mirrors /api/auth/admin-login):
 *   - "admin@gurukul.org"   → super admin  (email + password, bcrypt)
 *   - 10-digit phone number → regular admin (phone + 4-digit PIN, bcrypt)
 *
 * Returns true only if ALL of these hold:
 *   1. Account exists and is active
 *   2. Role is "admin" or "super_admin"
 *   3. Credential is NOT the same person as the current sender
 *   4. Secret passes bcrypt verification
 */
async function validateSecondaryAdmin(
  credential: string,
  secret: string,
  senderEmail: string,
  senderPhone: string,
): Promise<boolean> {
  try {
    const isSuperAdminAttempt = credential.toLowerCase().trim() === BROADCAST_SUPER_ADMIN_EMAIL;

    if (isSuperAdminAttempt) {
      // Prevent sender from being their own second approver
      if (senderEmail.toLowerCase().trim() === BROADCAST_SUPER_ADMIN_EMAIL) return false;

      const [sa] = await db
        .select()
        .from(adminUsersTable)
        .where(eq(adminUsersTable.role, "super_admin"))
        .limit(1);

      if (!sa || sa.status !== "active") return false;
      return await bcrypt.compare(secret, sa.pinHash);
    }

    // Regular admin: 10-digit phone + 4-digit PIN
    const cleanPhone = credential.replace(/\D/g, "");
    if (cleanPhone.length !== 10) return false;
    if (!/^\d{4}$/.test(secret)) return false;

    // Same-person check by phone
    if (cleanPhone === senderPhone.replace(/\D/g, "")) return false;

    const [admin] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.phone, cleanPhone))
      .limit(1);

    if (!admin) return false;
    if (admin.status !== "active") return false;
    if (admin.role !== "admin" && admin.role !== "super_admin") return false;

    // Same-person check by email (edge case: admin set email + phone)
    if (admin.email && admin.email.toLowerCase() === senderEmail.toLowerCase()) return false;

    return await bcrypt.compare(secret, admin.pinHash);
  } catch {
    return false;
  }
}

// ─── GET /api/admin/messaging/recipients ─────────────────────────────────────
// Returns filtered parent list with email AND phone

router.get("/recipients", async (req, res) => {
  const { course, curricYear, employer } = req.query as Record<string, string | undefined>;

  try {
    const rows = await db
      .select({
        studentCode:    studentsTable.studentCode,
        studentName:    studentsTable.name,
        curriculumYear: studentsTable.curriculumYear,
        motherName:     studentsTable.motherName,
        motherEmail:    studentsTable.motherEmail,
        motherPhone:    studentsTable.motherPhone,
        motherEmployer: studentsTable.motherEmployer,
        fatherName:     studentsTable.fatherName,
        fatherEmail:    studentsTable.fatherEmail,
        fatherPhone:    studentsTable.fatherPhone,
        fatherEmployer: studentsTable.fatherEmployer,
        courseName:     coursesTable.name,
      })
      .from(studentsTable)
      .leftJoin(enrollmentsTable, eq(enrollmentsTable.studentId, studentsTable.id))
      .leftJoin(courseLevelsTable, eq(courseLevelsTable.id, enrollmentsTable.courseLevelId))
      .leftJoin(coursesTable, eq(coursesTable.id, courseLevelsTable.courseId))
      .orderBy(asc(studentsTable.studentCode));

    const studentMap = new Map<string, {
      studentCode: string; studentName: string;
      curriculumYear: string | null;
      motherName: string | null; motherEmail: string | null; motherPhone: string | null; motherEmployer: string | null;
      fatherName: string | null; fatherEmail: string | null; fatherPhone: string | null; fatherEmployer: string | null;
      courses: string[];
    }>();

    for (const r of rows) {
      const key = r.studentCode ?? "";
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          studentCode: r.studentCode ?? "",
          studentName: r.studentName ?? "",
          curriculumYear: r.curriculumYear,
          motherName: r.motherName, motherEmail: r.motherEmail, motherPhone: r.motherPhone, motherEmployer: r.motherEmployer,
          fatherName: r.fatherName, fatherEmail: r.fatherEmail, fatherPhone: r.fatherPhone, fatherEmployer: r.fatherEmployer,
          courses: [],
        });
      }
      if (r.courseName) {
        const entry = studentMap.get(key)!;
        if (!entry.courses.includes(r.courseName)) entry.courses.push(r.courseName);
      }
    }

    let entries = Array.from(studentMap.values());

    if (course && course !== "All") {
      entries = entries.filter(e => e.courses.includes(course));
    }
    if (curricYear && curricYear !== "All") {
      entries = entries.filter(e => e.curriculumYear === curricYear);
    }
    if (employer && employer !== "All") {
      entries = entries.filter(e =>
        (e.motherEmployer ?? "").toLowerCase().includes(employer.toLowerCase()) ||
        (e.fatherEmployer ?? "").toLowerCase().includes(employer.toLowerCase())
      );
    }

    // Build recipient list — include parent even if no email (in-app messaging uses phone lookup too)
    const recipientSet = new Map<string, {
      name: string; email: string; phone: string; relation: string; studentName: string; studentCode: string;
    }>();

    for (const e of entries) {
      const key = (e.motherEmail ?? e.motherPhone ?? "").toLowerCase();
      if (key && (e.motherEmail?.trim() || e.motherPhone?.trim())) {
        recipientSet.set(key, {
          name: e.motherName ?? "Mother",
          email: e.motherEmail?.trim() ?? "",
          phone: e.motherPhone?.trim() ?? "",
          relation: "Mother",
          studentName: e.studentName,
          studentCode: e.studentCode,
        });
      }
      const key2 = (e.fatherEmail ?? e.fatherPhone ?? "").toLowerCase();
      if (key2 && (e.fatherEmail?.trim() || e.fatherPhone?.trim())) {
        recipientSet.set(key2, {
          name: e.fatherName ?? "Father",
          email: e.fatherEmail?.trim() ?? "",
          phone: e.fatherPhone?.trim() ?? "",
          relation: "Father",
          studentName: e.studentName,
          studentCode: e.studentCode,
        });
      }
    }

    return res.json(Array.from(recipientSet.values()));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch recipients");
    return res.status(500).json({ error: "Failed to fetch recipients" });
  }
});

// ─── GET /api/admin/messaging/employers ─────────────────────────────────────

router.get("/employers", async (_req, res) => {
  try {
    const rows = await db
      .selectDistinct({ employer: studentsTable.motherEmployer })
      .from(studentsTable)
      .where(isNotNull(studentsTable.motherEmployer));
    const rows2 = await db
      .selectDistinct({ employer: studentsTable.fatherEmployer })
      .from(studentsTable)
      .where(isNotNull(studentsTable.fatherEmployer));

    const set = new Set<string>();
    [...rows, ...rows2].forEach(r => { if (r.employer?.trim()) set.add(r.employer.trim()); });
    return res.json(Array.from(set).sort());
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch employers" });
  }
});

// ─── POST /api/admin/messaging/send ─────────────────────────────────────────
// In-app messaging: stores message to DB (no SMTP). Visible in teacher portal
// and parent portal once delivered.

router.post("/send", async (req, res) => {
  const senderRole = req.headers["x-user-role"] as string | undefined;
  if (senderRole === "assistant") {
    return res.status(403).json({ error: "Assistants do not have permission to send messages." });
  }
  const {
    subject, body, recipients, teacherEmails, audienceType,
    filterCourse, filterCurricYear, filterEmployer,
    parentRecipientCount,
    secondaryAdminCredential,
    secondaryAdminSecret,
  } = req.body as {
    subject: string;
    body: string;
    recipients: { name: string; email: string; phone?: string; studentName: string }[];
    teacherEmails?: string;          // comma-separated teacher emails when audience includes teachers
    audienceType?: string;           // "parents" | "teachers" | "both"
    filterCourse?: string;
    filterCurricYear?: string;
    filterEmployer?: string;
    parentRecipientCount?: number;   // explicit parent-only count, computed on the frontend
    secondaryAdminCredential?: string; // required when parentRecipientCount > 10
    secondaryAdminSecret?: string;
  };

  const sentBy      = (req.headers["x-user-email"] as string | undefined) || "admin";
  const senderPhone = (req.headers["x-user-phone"] as string | undefined) || "";

  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: "Subject and body are required." });
  }
  if (!recipients?.length) {
    return res.status(400).json({ error: "No recipients selected." });
  }

  const DAILY_LIMIT = 10;
  const TOTAL_CAP   = 100;

  try {
    const [{ todayCount, totalCount }] = await db
      .select({
        todayCount: sql<number>`COUNT(*) FILTER (WHERE ${adminMessagesTable.sentAt} >= NOW() - INTERVAL '24 hours')`,
        totalCount: sql<number>`COUNT(*)`,
      })
      .from(adminMessagesTable);

    // Hard cap — system must not exceed TOTAL_CAP messages at any time
    if (Number(totalCount) >= TOTAL_CAP) {
      return res.status(429).json({
        error: `Message cap reached — the system holds a maximum of ${TOTAL_CAP} messages. Please delete old messages from History before sending new ones.`,
      });
    }

    // Daily rate limit — max DAILY_LIMIT messages per rolling 24-hour window
    if (Number(todayCount) >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `Daily message limit reached (${DAILY_LIMIT} messages per 24 hours). Please wait before sending more.`,
      });
    }
  } catch {
    // Non-fatal — proceed even if count check fails
  }

  // ── Broadcast security check ─────────────────────────────────────────────────
  // If the message targets more than 10 parents a second admin must co-sign.
  const resolvedParentCount = typeof parentRecipientCount === "number"
    ? parentRecipientCount
    : (audienceType !== "teachers" ? recipients.length : 0);

  if (resolvedParentCount > 10) {
    if (!secondaryAdminCredential?.trim() || !secondaryAdminSecret?.trim()) {
      return res.status(403).json({
        error: "Additional admin verification required when sending to more than 10 parents.",
      });
    }
    const verified = await validateSecondaryAdmin(
      secondaryAdminCredential.trim(),
      secondaryAdminSecret.trim(),
      sentBy,
      senderPhone,
    );
    if (!verified) {
      return res.status(403).json({
        error: "Additional admin verification failed. Please enter valid credentials for another active admin.",
      });
    }
  }

  try {
    await db.insert(adminMessagesTable).values({
      subject:          subject.trim(),
      body:             body.trim(),
      audienceType:     audienceType || "parents",
      sentBy,
      recipientCount:   recipients.length,
      teacherEmails:    teacherEmails || null,
      filterCourse:     filterCourse || null,
      filterCurricYear: filterCurricYear || null,
      filterEmployer:   filterEmployer || null,
    });

    await writeAudit(req, {
      moduleName: "Communication Hub",
      actionType: "Add",
      entityName: subject.trim(),
      newValue:   { subject: subject.trim(), audienceType: audienceType || "parents", recipientCount: recipients.length, filterCourse, filterCurricYear },
    });
    return res.json({
      success: true,
      sent: recipients.length,
      failed: 0,
      smtpConfigured: false,
      message: `Message delivered to ${recipients.length} recipient${recipients.length !== 1 ? "s" : ""} in-portal.`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to save in-app message");
    return res.status(500).json({ error: "Failed to send message." });
  }
});

// ─── GET /api/admin/messaging/messages ───────────────────────────────────────
// Returns all sent in-app messages (admin history view)

router.get("/messages", async (_req, res) => {
  try {
    const msgs = await db
      .select()
      .from(adminMessagesTable)
      .orderBy(desc(adminMessagesTable.sentAt))
      .limit(100);
    return res.json(msgs);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// ─── GET /api/admin/messaging/daily-stats ────────────────────────────────────
// Returns today's send count, the daily cap, total stored count, and total cap.

router.get("/daily-stats", async (_req, res) => {
  const DAILY_LIMIT = 10;
  const TOTAL_CAP   = 100;
  try {
    const [{ todayCount, totalCount }] = await db
      .select({
        todayCount: sql<number>`COUNT(*) FILTER (WHERE ${adminMessagesTable.sentAt} >= NOW() - INTERVAL '24 hours')`,
        totalCount: sql<number>`COUNT(*)`,
      })
      .from(adminMessagesTable);
    return res.json({
      sentToday:     Number(todayCount),
      limit:         DAILY_LIMIT,
      totalMessages: Number(totalCount),
      totalLimit:    TOTAL_CAP,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch daily stats" });
  }
});

// ─── DELETE /api/admin/messaging/messages/:id ─────────────────────────────────
// Permanently removes a sent message from history. Admin/super_admin only.

router.delete("/messages/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const role = req.headers["x-user-role"] as string | undefined;
  if (role !== "admin" && role !== "super_admin") {
    return res.status(403).json({ error: "Only admins can delete sent messages." });
  }

  try {
    const [deleted] = await db
      .delete(adminMessagesTable)
      .where(eq(adminMessagesTable.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Message not found" });

    await writeAudit(req, {
      moduleName: "Communication Hub",
      actionType: "Delete",
      entityName: deleted.subject,
      entityId:   id,
      previousValue: { subject: deleted.subject, sentAt: deleted.sentAt, recipientCount: deleted.recipientCount },
    });
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete sent message");
    return res.status(500).json({ error: "Failed to delete message" });
  }
});

// ─── GET /api/admin/messaging/teacher-inbox ──────────────────────────────────
// Returns in-app messages for the authenticated teacher.
// Teacher identified via X-User-Phone (digits-only) matched to their email via
// the teachers table, OR directly by X-User-Email if admin is viewing.

router.get("/teacher-inbox", async (req, res) => {
  let userEmail = (req.headers["x-user-email"] as string | undefined)?.toLowerCase().trim();
  const userPhone = (req.headers["x-user-phone"] as string | undefined)?.replace(/\D/g, "");

  try {
    // If email is missing but phone is present, look up the teacher's email from the teachers table.
    // This handles teachers who logged in before the email was included in the login response.
    if (!userEmail && userPhone) {
      const [row] = await db
        .select({ email: teachersTable.email })
        .from(teachersTable)
        .where(eq(teachersTable.phone, userPhone))
        .limit(1);
      if (row?.email) userEmail = row.email.toLowerCase().trim();
    }

    const all = await db
      .select()
      .from(adminMessagesTable)
      .where(sql`${adminMessagesTable.audienceType} IN ('teachers', 'both')`)
      .orderBy(desc(adminMessagesTable.sentAt));

    // Filter to messages where this teacher's email appears in teacherEmails.
    // If teacherEmails is null the message was broadcast to all teachers.
    const filtered = all.filter(m => {
      if (!m.teacherEmails) return true;   // broadcast to all teachers
      if (!userEmail)        return false;  // can't identify teacher
      const list = m.teacherEmails.split(",").map(e => e.trim().toLowerCase());
      return list.includes(userEmail as string);
    });

    return res.json(filtered);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch teacher messages" });
  }
});

// ─── GET /api/admin/messaging/inbox ──────────────────────────────────────────
// Contact-form submissions from the public Contact Us page

router.get("/inbox", async (_req, res) => {
  try {
    const messages = await db
      .select({
        id:          contactsTable.id,
        senderName:  contactsTable.senderName,
        senderEmail: contactsTable.senderEmail,
        senderPhone: contactsTable.senderPhone,
        message:     contactsTable.message,
        isRead:      contactsTable.isRead,
        createdAt:   contactsTable.createdAt,
      })
      .from(contactsTable)
      .where(isNotNull(contactsTable.senderName))
      .orderBy(desc(contactsTable.createdAt))
      .limit(200);
    return res.json(messages);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch inbox" });
  }
});

// ─── PATCH /api/admin/messaging/inbox/:id/read ───────────────────────────────

router.patch("/inbox/:id/read", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.update(contactsTable).set({ isRead: true }).where(eq(contactsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to mark as read" });
  }
});

// ─── DELETE /api/admin/messaging/inbox/:id ────────────────────────────────────

router.delete("/inbox/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.delete(contactsTable).where(eq(contactsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete message" });
  }
});

export default router;
