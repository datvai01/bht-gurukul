import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRecipientList,
  checkMessage,
  htmlToText,
  parseSelectedIds,
  renderEmailHtml,
  sanitizeEmailHtml,
  studentRecipientEmail,
} from "./bulk-email-content.ts";

test("recipients are deduplicated case-insensitively and records without a valid email are reported (AC06, AC07)", () => {
  const list = buildRecipientList([
    { id: 1, name: "Aarav", email: "Parent@Example.com" },
    { id: 2, name: "Diya", email: "parent@example.com " },
    { id: 3, name: "Kiran", email: null },
    { id: 4, name: "Meera", email: "not-an-email" },
    { id: 5, name: "Rohan", email: "other@example.com" },
  ]);
  assert.equal(list.selectedCount, 5);
  assert.deepEqual(list.recipients, [
    { email: "parent@example.com", names: ["Aarav", "Diya"] },
    { email: "other@example.com", names: ["Rohan"] },
  ]);
  assert.equal(list.duplicateCount, 1);
  assert.deepEqual(list.missing.map(m => m.id), [3, 4]);
});

test("a student's email is the primary parent's, falling back to the linked member (AC02)", () => {
  const base = { motherEmail: "mom@example.com", fatherEmail: "dad@example.com", memberEmail: "member@example.com" };
  assert.equal(studentRecipientEmail({ ...base, primaryMemberRole: "mother" }), "mom@example.com");
  assert.equal(studentRecipientEmail({ ...base, primaryMemberRole: "father" }), "dad@example.com");
  assert.equal(studentRecipientEmail({ ...base, primaryMemberRole: null }), "member@example.com");
  assert.equal(studentRecipientEmail({ ...base, primaryMemberRole: "mother", motherEmail: "" }), "member@example.com");
  assert.equal(studentRecipientEmail({ primaryMemberRole: "father", motherEmail: null, fatherEmail: null, memberEmail: null }), null);
});

test("subject and a non-empty message are required (AC08)", () => {
  assert.deepEqual(checkMessage("", "<p>Hello</p>"), { ok: false, error: "Enter a subject." });
  assert.deepEqual(checkMessage("   ", "<p>Hello</p>"), { ok: false, error: "Enter a subject." });
  assert.deepEqual(checkMessage("Hi", "<p><br></p>"), { ok: false, error: "Enter a message." });
  assert.deepEqual(checkMessage("Hi", "<script>alert(1)</script>"), { ok: false, error: "Enter a message." });
  assert.equal(checkMessage("x".repeat(201), "<p>Hi</p>").ok, false);
  const ok = checkMessage("Class update\r\nInjected: header", "<p>Hello <b>parents</b></p>");
  assert.equal(ok.ok, true);
  assert.equal(ok.subject, "Class update Injected: header");
});

test("message HTML keeps basic formatting and removes scripts, styles and unsafe links", () => {
  const clean = sanitizeEmailHtml(
    '<p onclick="x()">Hi <strong>all</strong> <em>parents</em> <u>today</u></p><ul><li>One</li></ul>' +
    '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a>' +
    '<a href="https://bhtohio.org">site</a><style>p{}</style>',
  );
  assert.ok(!/script|onerror|onclick|javascript:|<img|<style/i.test(clean), clean);
  assert.match(clean, /<strong>all<\/strong>/);
  assert.match(clean, /<ul><li>One<\/li><\/ul>/);
  assert.match(clean, /<a href="https:\/\/bhtohio.org" target="_blank" rel="noopener noreferrer">site<\/a>/);
  // A link written with its own target or rel still gets the safe values.
  assert.match(sanitizeEmailHtml('<a href="https://x.org" target="_top" rel="opener">x</a>'), /target="_blank" rel="noopener noreferrer"/);
});

test("plain-text version keeps line breaks, bullets and link targets", () => {
  const text = htmlToText('<p>Dear parents,</p><p>Class is on <b>Sunday</b> &amp; Monday.</p><ul><li>Bring books</li><li>Be on time</li></ul><p><a href="https://bhtohio.org">Details</a></p>');
  assert.equal(text, "Dear parents,\n\nClass is on Sunday & Monday.\n\n• Bring books\n• Be on time\n\nDetails (https://bhtohio.org)");
});

test("rendered email escapes the subject and includes the body", () => {
  const html = renderEmailHtml("A <b>subject</b>", "<p>Body</p>");
  assert.match(html, /<title>A &lt;b&gt;subject&lt;\/b&gt;<\/title>/);
  assert.match(html, /<p>Body<\/p>/);
});

test("selected ids must be positive integers and are deduplicated", () => {
  assert.deepEqual(parseSelectedIds([3, 1, 3]), [3, 1]);
  assert.equal(parseSelectedIds([]), null);
  assert.equal(parseSelectedIds(["1"]), null);
  assert.equal(parseSelectedIds([0]), null);
  assert.equal(parseSelectedIds("1,2"), null);
  assert.equal(parseSelectedIds(Array.from({ length: 10_001 }, (_, i) => i + 1)), null);
});
