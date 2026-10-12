/**
 * Pure helpers for "Send Email" from Student and Member Management: message sanitizing and
 * rendering, and turning selected records into a deduplicated recipient list.
 */
import sanitizeHtml from "sanitize-html";
// @ts-expect-error Node's strip-types test runner requires explicit TS extensions.
import { isValidMemberEmail } from "./member-phone.ts";

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 100_000;
export const MAX_SELECTED_RECORDS = 10_000;

// Basic formatting only: paragraphs, emphasis, lists and links. Everything else is removed.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "div", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "blockquote", "h3"],
  // target and rel are always overwritten by the transform below.
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
  },
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS).trim();
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };

/** Plain-text alternative of a sanitized body (also used to check that the body is not empty). */
export function htmlToText(html: string): string {
  const marked = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h3|blockquote|ul|ol)>/gi, "\n\n")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, label: string) =>
      label.replace(/<[^>]+>/g, "").trim() === href ? href : `${label} (${href})`);
  const text = sanitizeHtml(marked, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, entity => ENTITIES[entity] ?? entity);
  return text.split("\n").map(line => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]!);
}

const FOOTER = "Sent by the Bhartiya Hindu Temple Gurukul administration.";

/** Full email document for a sanitized body; the preview shows exactly this. */
export function renderEmailHtml(subject: string, bodyHtml: string): string {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    `<title>${escapeHtml(subject)}</title></head>`,
    "<body style=\"margin:0;padding:24px;background:#f7f7f7\">",
    "<div style=\"max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;",
    "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222\">",
    bodyHtml,
    "<hr style=\"border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px\">",
    `<p style="font-size:12px;color:#777777;margin:0">${FOOTER}</p>`,
    "</div></body></html>",
  ].join("");
}

export function renderEmailText(bodyText: string): string {
  return `${bodyText}\n\n--\n${FOOTER}`;
}

export type MessageCheck =
  | { ok: true; subject: string; bodyHtml: string; bodyText: string }
  | { ok: false; error: string };

/** Subject and body are required; the body must contain text after sanitizing. */
export function checkMessage(subject: unknown, html: unknown): MessageCheck {
  const cleanSubject = typeof subject === "string" ? subject.replace(/[\r\n]+/g, " ").trim() : "";
  if (!cleanSubject) return { ok: false, error: "Enter a subject." };
  if (cleanSubject.length > MAX_SUBJECT_LENGTH) return { ok: false, error: `The subject must be ${MAX_SUBJECT_LENGTH} characters or fewer.` };
  if (typeof html !== "string" || html.length > MAX_BODY_LENGTH) {
    return { ok: false, error: "The message is missing or too long." };
  }
  const bodyHtml = sanitizeEmailHtml(html);
  const bodyText = htmlToText(bodyHtml);
  if (!bodyText) return { ok: false, error: "Enter a message." };
  return { ok: true, subject: cleanSubject, bodyHtml, bodyText };
}

export type SelectedRecord = { id: number; name: string; email: string | null };

export type RecipientList = {
  selectedCount: number;
  recipients: { email: string; names: string[] }[];
  duplicateCount: number; // selected records whose address was already on the list
  missing: { id: number; name: string }[]; // selected records without a valid email
};

/** Valid addresses only, deduplicated case-insensitively, in selection order. */
export function buildRecipientList(records: SelectedRecord[]): RecipientList {
  const byEmail = new Map<string, { email: string; names: string[] }>();
  const missing: { id: number; name: string }[] = [];
  let duplicateCount = 0;
  for (const record of records) {
    const email = record.email?.trim().toLowerCase() ?? "";
    if (!email || !isValidMemberEmail(email)) {
      missing.push({ id: record.id, name: record.name });
      continue;
    }
    const existing = byEmail.get(email);
    if (existing) {
      duplicateCount++;
      if (!existing.names.includes(record.name)) existing.names.push(record.name);
    } else {
      byEmail.set(email, { email, names: [record.name] });
    }
  }
  return { selectedCount: records.length, recipients: [...byEmail.values()], duplicateCount, missing };
}

/** Selected record ids from a request body: positive integers, deduplicated, bounded. */
export function parseSelectedIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SELECTED_RECORDS) return null;
  if (!value.every(id => Number.isSafeInteger(id) && id > 0)) return null;
  return [...new Set(value as number[])];
}

/** Email for a student: the primary parent's address, or the linked member's when it is missing. */
export function studentRecipientEmail(student: {
  primaryMemberRole: string | null;
  motherEmail: string | null;
  fatherEmail: string | null;
  memberEmail: string | null;
}): string | null {
  const parentEmail = student.primaryMemberRole === "mother" ? student.motherEmail
    : student.primaryMemberRole === "father" ? student.fatherEmail
      : null;
  if (parentEmail && isValidMemberEmail(parentEmail.trim().toLowerCase())) return parentEmail;
  return student.memberEmail;
}
