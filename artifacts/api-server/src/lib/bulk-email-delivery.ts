/**
 * Background delivery for "Send Email". Each recipient row is claimed (pending → sending) before
 * its message goes out, so a message is never sent twice, even if delivery is started again.
 * Results are written per recipient; a retry resets only the failed rows.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bulkEmailRecipientsTable, bulkEmailsTable } from "@workspace/db/schema";
import { htmlToText, renderEmailHtml, renderEmailText } from "./bulk-email-content";
import { sendEmail, type EmailResult, type OutgoingEmail } from "./email";
import { logger } from "./logger";

const WORKERS = 3;
const running = new Set<number>();

type Sender = (message: OutgoingEmail) => Promise<EmailResult>;

async function claimNext(bulkEmailId: number): Promise<{ id: number; email: string } | null> {
  const result = await db.execute(sql`
    UPDATE bulk_email_recipients
    SET status = 'sending', attempts = attempts + 1
    WHERE id = (
      SELECT id FROM bulk_email_recipients
      WHERE bulk_email_id = ${bulkEmailId} AND status = 'pending'
      ORDER BY id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, email
  `);
  const row = result.rows[0] as { id: number; email: string } | undefined;
  return row ?? null;
}

/** Recounts the recipients and sets the send's final status. */
export async function finalizeBulkEmail(bulkEmailId: number): Promise<void> {
  const [counts] = await db.select({
    sent: sql<number>`COUNT(*) FILTER (WHERE ${bulkEmailRecipientsTable.status} = 'sent')::int`,
    failed: sql<number>`COUNT(*) FILTER (WHERE ${bulkEmailRecipientsTable.status} = 'failed')::int`,
    open: sql<number>`COUNT(*) FILTER (WHERE ${bulkEmailRecipientsTable.status} IN ('pending', 'sending'))::int`,
  }).from(bulkEmailRecipientsTable).where(eq(bulkEmailRecipientsTable.bulkEmailId, bulkEmailId));
  const done = counts.open === 0;
  await db.update(bulkEmailsTable).set({
    sentCount: counts.sent,
    failedCount: counts.failed,
    status: !done ? "sending" : counts.failed === 0 ? "sent" : counts.sent === 0 ? "failed" : "partial",
    completedAt: done ? new Date() : null,
  }).where(eq(bulkEmailsTable.id, bulkEmailId));
}

/** Sends every pending recipient of a send. Safe to call more than once. */
export async function deliverBulkEmail(bulkEmailId: number, send: Sender = sendEmail): Promise<void> {
  if (running.has(bulkEmailId)) return;
  running.add(bulkEmailId);
  try {
    const [bulkEmail] = await db.select().from(bulkEmailsTable).where(eq(bulkEmailsTable.id, bulkEmailId)).limit(1);
    if (!bulkEmail) return;
    const html = renderEmailHtml(bulkEmail.subject, bulkEmail.bodyHtml);
    const text = renderEmailText(htmlToText(bulkEmail.bodyHtml));
    const worker = async () => {
      for (let next = await claimNext(bulkEmailId); next; next = await claimNext(bulkEmailId)) {
        let result: EmailResult;
        try {
          result = await send({ to: next.email, subject: bulkEmail.subject, text, html, fromName: "BHT Gurukul" });
        } catch (err) {
          result = { ok: false, error: err instanceof Error ? err.message : "Send failed" };
        }
        await db.update(bulkEmailRecipientsTable).set(result.ok
          ? { status: "sent", error: null, sentAt: new Date() }
          : { status: "failed", error: result.error.slice(0, 300) },
        ).where(eq(bulkEmailRecipientsTable.id, next.id));
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    await finalizeBulkEmail(bulkEmailId);
  } catch (err) {
    logger.error({ err, bulkEmailId }, "Bulk email delivery failed");
  } finally {
    running.delete(bulkEmailId);
  }
}

/** Puts only the failed recipients back in the queue. Returns how many will be retried. */
export async function resetFailedRecipients(bulkEmailId: number): Promise<number> {
  const reset = await db.update(bulkEmailRecipientsTable)
    .set({ status: "pending", error: null })
    .where(and(eq(bulkEmailRecipientsTable.bulkEmailId, bulkEmailId), eq(bulkEmailRecipientsTable.status, "failed")))
    .returning({ id: bulkEmailRecipientsTable.id });
  if (reset.length) {
    await db.update(bulkEmailsTable).set({ status: "sending", completedAt: null }).where(eq(bulkEmailsTable.id, bulkEmailId));
  }
  return reset.length;
}

export function isDelivering(bulkEmailId: number): boolean {
  return running.has(bulkEmailId);
}

/**
 * At startup, finishes sends interrupted by a restart. A recipient that was mid-send is marked
 * failed (its delivery cannot be confirmed) so an administrator can decide whether to retry it.
 */
export async function resumeInterruptedBulkEmails(): Promise<void> {
  const open = await db.select({ id: bulkEmailsTable.id }).from(bulkEmailsTable).where(eq(bulkEmailsTable.status, "sending"));
  for (const { id } of open) {
    await db.update(bulkEmailRecipientsTable)
      .set({ status: "failed", error: "Interrupted by a server restart; delivery was not confirmed." })
      .where(and(eq(bulkEmailRecipientsTable.bulkEmailId, id), eq(bulkEmailRecipientsTable.status, "sending")));
    void deliverBulkEmail(id);
  }
}
