/**
 * "Send Email" from Student Management and Member Management.
 *
 *   POST /api/admin/bulk-email/recipients   resolve selected record ids to recipients (counts + list)
 *   POST /api/admin/bulk-email/preview      sanitized email exactly as recipients will see it
 *   POST /api/admin/bulk-email/send         create the send and start delivery (one email per address)
 *   GET  /api/admin/bulk-email/:id          progress and results
 *   POST /api/admin/bulk-email/:id/retry    resend failed recipients only
 *
 * Admin and super admin sessions only. Email addresses are always resolved here from record ids;
 * the browser never supplies addresses.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  bulkEmailRecipientsTable,
  bulkEmailsTable,
  membersTable,
  studentsTable,
} from "@workspace/db/schema";
import { getVerifiedAdmin, isSameOriginRequest, type VerifiedAdmin } from "../../lib/admin-session";
import { writeAudit } from "../../lib/audit";
import {
  buildRecipientList,
  checkMessage,
  parseSelectedIds,
  renderEmailHtml,
  studentRecipientEmail,
  type RecipientList,
  type SelectedRecord,
} from "../../lib/bulk-email-content";
import { deliverBulkEmail, isDelivering, resetFailedRecipients } from "../../lib/bulk-email-delivery";
import { pgErrorInfo } from "../../lib/pg-error";

const router: IRouter = Router();

type Source = "students" | "members";
const SOURCE_LABEL: Record<Source, string> = { students: "Student Management", members: "Member Management" };

async function requireAdmin(req: Request, res: Response): Promise<VerifiedAdmin | null> {
  if (req.method !== "GET" && !isSameOriginRequest(req)) {
    res.status(403).json({ error: "A same-origin request is required." });
    return null;
  }
  const admin = await getVerifiedAdmin(req);
  if (!admin) {
    res.status(401).json({ error: "An active admin session is required to send email." });
    return null;
  }
  return admin;
}

function parseSource(value: unknown): Source | null {
  return value === "students" || value === "members" ? value : null;
}

/** Loads the selected records (in selection order) with the address each one resolves to. */
async function loadSelectedRecords(source: Source, ids: number[]): Promise<{ records: SelectedRecord[]; notFound: number }> {
  let rows: SelectedRecord[];
  if (source === "students") {
    const students = await db.select({
      id: studentsTable.id,
      name: studentsTable.name,
      primaryMemberRole: studentsTable.primaryMemberRole,
      motherEmail: studentsTable.motherEmail,
      fatherEmail: studentsTable.fatherEmail,
      memberEmail: membersTable.email,
    }).from(studentsTable)
      .leftJoin(membersTable, eq(membersTable.id, studentsTable.memberId))
      .where(inArray(studentsTable.id, ids));
    rows = students.map(student => ({ id: student.id, name: student.name, email: studentRecipientEmail(student) }));
  } else {
    const members = await db.select({
      id: membersTable.id, name: membersTable.name, firstName: membersTable.firstName,
      lastName: membersTable.lastName, email: membersTable.email,
    }).from(membersTable).where(inArray(membersTable.id, ids));
    rows = members.map(member => ({
      id: member.id,
      name: member.name?.trim() || [member.firstName, member.lastName].filter(Boolean).join(" ") || `Member ${member.id}`,
      email: member.email,
    }));
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  const records = ids.map(id => byId.get(id)).filter((row): row is SelectedRecord => !!row);
  return { records, notFound: ids.length - records.length };
}

async function resolveSelection(req: Request, res: Response): Promise<{ source: Source; list: RecipientList; notFound: number } | null> {
  const body = req.body as { source?: unknown; ids?: unknown };
  const source = parseSource(body?.source);
  const ids = parseSelectedIds(body?.ids);
  if (!source || !ids) {
    res.status(400).json({ error: "Choose Student or Member Management and select at least one record." });
    return null;
  }
  const { records, notFound } = await loadSelectedRecords(source, ids);
  return { source, list: buildRecipientList(records), notFound };
}

function selectionSummary(list: RecipientList, notFound: number) {
  return {
    selectedCount: list.selectedCount,
    recipientCount: list.recipients.length,
    duplicateCount: list.duplicateCount,
    missingCount: list.missing.length,
    notFoundCount: notFound,
    recipients: list.recipients,
    missing: list.missing,
  };
}

async function bulkEmailSummary(id: number) {
  const [bulkEmail] = await db.select().from(bulkEmailsTable).where(eq(bulkEmailsTable.id, id)).limit(1);
  if (!bulkEmail) return null;
  const recipients = await db.select({
    email: bulkEmailRecipientsTable.email,
    names: bulkEmailRecipientsTable.names,
    status: bulkEmailRecipientsTable.status,
    error: bulkEmailRecipientsTable.error,
  }).from(bulkEmailRecipientsTable)
    .where(eq(bulkEmailRecipientsTable.bulkEmailId, id))
    .orderBy(asc(bulkEmailRecipientsTable.id));
  const count = (status: string) => recipients.filter(r => r.status === status).length;
  return {
    id: bulkEmail.id,
    source: bulkEmail.source,
    subject: bulkEmail.subject,
    status: bulkEmail.status,
    sentByName: bulkEmail.sentByName,
    createdAt: bulkEmail.createdAt,
    completedAt: bulkEmail.completedAt,
    selectedCount: bulkEmail.selectedCount,
    recipientCount: bulkEmail.recipientCount,
    duplicateCount: bulkEmail.duplicateCount,
    missingCount: bulkEmail.missingCount,
    skippedCount: bulkEmail.duplicateCount + bulkEmail.missingCount,
    sentCount: count("sent"),
    failedCount: count("failed"),
    pendingCount: count("pending") + count("sending"),
    failures: recipients
      .filter(r => r.status === "failed")
      .map(r => ({ email: r.email, names: r.names, error: r.error ?? "Send failed" })),
  };
}

// ── POST /recipients ──────────────────────────────────────────────────────────
router.post("/recipients", async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    const resolved = await resolveSelection(req, res);
    if (!resolved) return;
    res.json(selectionSummary(resolved.list, resolved.notFound));
  } catch (err) {
    req.log.error({ err }, "Failed to resolve email recipients");
    res.status(500).json({ error: "Could not load the recipients." });
  }
});

// ── POST /preview ─────────────────────────────────────────────────────────────
router.post("/preview", async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    const message = checkMessage(req.body?.subject, req.body?.html);
    if (!message.ok) return void res.status(400).json({ error: message.error });
    res.json({ subject: message.subject, html: renderEmailHtml(message.subject, message.bodyHtml), text: message.bodyText });
  } catch (err) {
    req.log.error({ err }, "Failed to render email preview");
    res.status(500).json({ error: "Could not render the preview." });
  }
});

// ── POST /send ────────────────────────────────────────────────────────────────
router.post("/send", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const requestId = (req.body as { requestId?: unknown })?.requestId;
    if (typeof requestId !== "string" || !/^[A-Za-z0-9-]{16,64}$/.test(requestId)) {
      return void res.status(400).json({ error: "The send request is missing its id. Reopen the email dialog and try again." });
    }
    // A repeated submission (double click, network retry) returns the original send.
    const [existing] = await db.select({ id: bulkEmailsTable.id }).from(bulkEmailsTable)
      .where(eq(bulkEmailsTable.requestId, requestId)).limit(1);
    if (existing) return void res.json(await bulkEmailSummary(existing.id));

    const message = checkMessage(req.body?.subject, req.body?.html);
    if (!message.ok) return void res.status(400).json({ error: message.error });
    const resolved = await resolveSelection(req, res);
    if (!resolved) return;
    const { source, list } = resolved;
    if (!list.recipients.length) {
      return void res.status(400).json({ error: "None of the selected records has a valid email address." });
    }

    let bulkEmailId: number;
    try {
      bulkEmailId = await db.transaction(async tx => {
        const [created] = await tx.insert(bulkEmailsTable).values({
          requestId,
          source,
          subject: message.subject,
          bodyHtml: message.bodyHtml,
          sentByAdminId: admin.id,
          sentByName: admin.name,
          selectedCount: list.selectedCount,
          recipientCount: list.recipients.length,
          duplicateCount: list.duplicateCount,
          missingCount: list.missing.length,
          status: "sending",
        }).returning({ id: bulkEmailsTable.id });
        await tx.insert(bulkEmailRecipientsTable).values(list.recipients.map(recipient => ({
          bulkEmailId: created.id,
          email: recipient.email,
          names: recipient.names.join(", ").slice(0, 1000),
        })));
        return created.id;
      });
    } catch (err) {
      // Two identical submissions at once: the unique request id lets only one through.
      if (pgErrorInfo(err)?.code === "23505") {
        const [winner] = await db.select({ id: bulkEmailsTable.id }).from(bulkEmailsTable)
          .where(eq(bulkEmailsTable.requestId, requestId)).limit(1);
        if (winner) return void res.json(await bulkEmailSummary(winner.id));
      }
      throw err;
    }

    await writeAudit(req, {
      moduleName: "Communication Hub",
      actionType: "Add",
      entityName: `Email: ${message.subject}`,
      entityId: bulkEmailId,
      newValue: {
        source: SOURCE_LABEL[source],
        sentBy: admin.name,
        recipientCount: list.recipients.length,
        selectedCount: list.selectedCount,
        duplicateCount: list.duplicateCount,
        missingCount: list.missing.length,
      },
    });
    void deliverBulkEmail(bulkEmailId);
    res.status(202).json(await bulkEmailSummary(bulkEmailId));
  } catch (err) {
    req.log.error({ err }, "Failed to send bulk email");
    res.status(500).json({ error: "Could not send the email." });
  }
});

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    if (!await requireAdmin(req, res)) return;
    const id = parseId(req.params.id);
    const summary = id ? await bulkEmailSummary(id) : null;
    if (!summary) return void res.status(404).json({ error: "Email not found." });
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "Failed to load bulk email");
    res.status(500).json({ error: "Could not load the email status." });
  }
});

// ── POST /:id/retry ───────────────────────────────────────────────────────────
router.post("/:id/retry", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const id = parseId(req.params.id);
    const summary = id ? await bulkEmailSummary(id) : null;
    if (!id || !summary) return void res.status(404).json({ error: "Email not found." });
    if (summary.status === "sending" || isDelivering(id)) {
      return void res.status(409).json({ error: "This email is still being sent. Wait for it to finish before retrying." });
    }
    const retried = await resetFailedRecipients(id);
    if (!retried) return void res.status(400).json({ error: "There are no failed recipients to retry." });
    await writeAudit(req, {
      moduleName: "Communication Hub",
      actionType: "Edit",
      entityName: `Email retry: ${summary.subject}`,
      entityId: id,
      newValue: { retriedRecipients: retried, retriedBy: admin.name },
    });
    void deliverBulkEmail(id);
    res.status(202).json(await bulkEmailSummary(id));
  } catch (err) {
    req.log.error({ err }, "Failed to retry bulk email");
    res.status(500).json({ error: "Could not retry the failed recipients." });
  }
});

export default router;
