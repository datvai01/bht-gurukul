import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { adminUsersTable } from "./gurukul";

// ─── Bulk Email (Student / Member Management "Send Email") ───────────────────
// One row per send: the email audit log. Each recipient has its own row so that delivery is
// tracked per address and a retry resends only the failures.

export const bulkEmailsTable = pgTable("bulk_emails", {
  id:              serial("id").primaryKey(),
  // Random id from the compose dialog; a repeated submission returns the original send.
  requestId:       text("request_id").notNull(),
  source:          text("source").notNull(),            // "students" | "members"
  subject:         text("subject").notNull(),
  bodyHtml:        text("body_html").notNull(),         // sanitized message body
  sentByAdminId:   integer("sent_by_admin_id").references(() => adminUsersTable.id, { onDelete: "set null" }),
  sentByName:      text("sent_by_name").notNull(),
  selectedCount:   integer("selected_count").notNull(), // records selected on the page
  recipientCount:  integer("recipient_count").notNull(), // unique valid email addresses
  duplicateCount:  integer("duplicate_count").notNull().default(0),
  missingCount:    integer("missing_count").notNull().default(0), // records without a valid email
  sentCount:       integer("sent_count").notNull().default(0),
  failedCount:     integer("failed_count").notNull().default(0),
  status:          text("status").notNull().default("sending"), // sending | sent | partial | failed
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  completedAt:     timestamp("completed_at"),
}, table => [
  uniqueIndex("bulk_emails_request_id_key").on(table.requestId),
]);

export const bulkEmailRecipientsTable = pgTable("bulk_email_recipients", {
  id:          serial("id").primaryKey(),
  bulkEmailId: integer("bulk_email_id").notNull().references(() => bulkEmailsTable.id, { onDelete: "cascade" }),
  email:       text("email").notNull(),           // lower-case
  names:       text("names").notNull().default(""), // the selected records this address covers
  status:      text("status").notNull().default("pending"), // pending | sending | sent | failed
  error:       text("error"),
  attempts:    integer("attempts").notNull().default(0),
  sentAt:      timestamp("sent_at"),
}, table => [
  uniqueIndex("bulk_email_recipients_email_key").on(table.bulkEmailId, table.email),
  index("bulk_email_recipients_status_idx").on(table.bulkEmailId, table.status),
]);

export type BulkEmail = typeof bulkEmailsTable.$inferSelect;
export type BulkEmailRecipient = typeof bulkEmailRecipientsTable.$inferSelect;
