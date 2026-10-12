/**
 * Integration tests for "Send Email" (Student / Member Management) against a running API that
 * uses the console email provider (MEMBER_EMAIL_PROVIDER=console, NODE_ENV not production).
 * In console mode, addresses ending in ".invalid" fail, which exercises partial failures.
 *
 *   DATABASE_URL=… TEST_BASE_URL=http://localhost:3001 API_LOG_FILE=../../../api-dev.log \
 *     node --test artifacts/api-server/test/bulk-email.integration.mjs
 *
 * The admin sign-in code is read from the API log. Test records are created and removed.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const pg = require("pg");

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3001";
const LOG = process.env.API_LOG_FILE ?? new URL("../../../../api-dev.log", import.meta.url).pathname;
const ADMIN_EMAIL = "admin@gurukul.org";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "JaiHanuman2026$"; // local development default
const TAG = `bulktest${Date.now().toString(36)}`;

const db = new pg.Client(process.env.DATABASE_URL);
const q = async (sql, params) => (await db.query(sql, params)).rows;

function client() {
  const cookies = {};
  return async function call(method, path, body, { origin = BASE } = {}) {
    const response = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
        Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      if (/Max-Age=0/.test(header)) delete cookies[name]; else cookies[name] = pair.slice(index + 1);
    }
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
}

function latestAdminCode() {
  const lines = readFileSync(LOG, "utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("DEV: admin login verification code")) {
      return lines.slice(i, i + 4).join("\n").match(/code[^:]*:\s*\S*"(\d{6})"/)?.[1];
    }
  }
  return undefined;
}

const admin = client();
const anonymous = client();
const ids = { members: {}, students: {} };

async function waitForDelivery(id) {
  for (let i = 0; i < 40; i++) {
    const { body } = await admin("GET", `/api/admin/bulk-email/${id}`);
    if (body.status !== "sending") return body;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error("Delivery did not finish in time");
}

const send = (overrides = {}) => admin("POST", "/api/admin/bulk-email/send", {
  source: "members",
  ids: [ids.members.shared1],
  subject: `[${TAG}] Test`,
  html: "<p>Hello</p>",
  requestId: randomUUID(),
  ...overrides,
});

before(async () => {
  await db.connect();
  // Fixtures: members (shared email in two cases, missing email, failing address) and students.
  const member = async (key, n, email) => {
    const [row] = await q(
      `INSERT INTO members (first_name, last_name, name, email, phone, created_at, membership_year)
       VALUES ($1, 'Bulk', $1 || ' Bulk', $2, $3, NOW(), 2026) RETURNING id`,
      [`${TAG}${key}`, email, `7405559${String(n).padStart(3, "0")}`],
    );
    ids.members[key] = row.id;
  };
  await member("shared1", 101, `Shared.${TAG}@Example.com`);
  await member("shared2", 102, `shared.${TAG}@example.com`);
  await member("noemail", 103, null);
  await member("failing", 104, `fail.${TAG}@test.invalid`);
  await member("other", 105, `other.${TAG}@example.com`);
  const student = async (key, n, values) => {
    const [row] = await q(
      `INSERT INTO students (student_code, name, member_id, primary_member_role, mother_email, father_email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [`${TAG}-${n}`, `${TAG} Student ${key}`, values.memberId ?? null, values.role ?? null, values.mother ?? null, values.father ?? null],
    );
    ids.students[key] = row.id;
  };
  await student("siblingA", 1, { memberId: ids.members.other, role: "mother", mother: `mom.${TAG}@example.com`, father: `dad.${TAG}@example.com` });
  await student("siblingB", 2, { memberId: ids.members.other, role: "mother", mother: `MOM.${TAG}@example.com` });
  await student("fatherPrimary", 3, { memberId: ids.members.other, role: "father", mother: `mom.${TAG}@example.com`, father: `dad.${TAG}@example.com` });
  await student("memberFallback", 4, { memberId: ids.members.shared1, role: "mother" });
  await student("noEmail", 5, { role: "mother" });

  // Admin sign-in: password, then the emailed (logged) code.
  await q("DELETE FROM member_access_challenges WHERE phone_hash LIKE 'admin-login:%'");
  const login = await admin("POST", "/api/auth/admin-login", { credential: ADMIN_EMAIL, secret: ADMIN_PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  await new Promise(r => setTimeout(r, 800));
  const verify = await admin("POST", "/api/auth/admin-login/verify", { code: latestAdminCode() });
  assert.equal(verify.status, 200, JSON.stringify(verify.body));
});

after(async () => {
  await admin("POST", "/api/auth/admin-logout");
  await q("DELETE FROM bulk_emails WHERE subject LIKE $1", [`%[${TAG}]%`]);
  await q("DELETE FROM audit_logs WHERE entity_name LIKE $1", [`%[${TAG}]%`]);
  await q("DELETE FROM students WHERE student_code LIKE $1", [`${TAG}-%`]);
  await q("DELETE FROM members WHERE first_name LIKE $1", [`${TAG}%`]);
  await db.end();
});

test("AC11: requests without an admin session or from another origin are denied", async () => {
  const body = { source: "members", ids: [ids.members.shared1] };
  assert.equal((await anonymous("POST", "/api/admin/bulk-email/recipients", body)).status, 401);
  assert.equal((await anonymous("POST", "/api/admin/bulk-email/send", { ...body, subject: "x", html: "<p>x</p>", requestId: randomUUID() })).status, 401);
  assert.equal((await anonymous("POST", "/api/admin/bulk-email/preview", { subject: "x", html: "<p>x</p>" })).status, 401);
  assert.equal((await anonymous("GET", "/api/admin/bulk-email/1")).status, 401);
  assert.equal((await anonymous("POST", "/api/admin/bulk-email/1/retry", {})).status, 401);
  assert.equal((await admin("POST", "/api/admin/bulk-email/recipients", body, { origin: "https://evil.example" })).status, 403);
});

test("AC02 + AC06: students resolve to their primary parent's email, one copy per parent", async () => {
  const { status, body } = await admin("POST", "/api/admin/bulk-email/recipients", {
    source: "students",
    ids: [ids.students.siblingA, ids.students.siblingB, ids.students.fatherPrimary, ids.students.memberFallback],
  });
  assert.equal(status, 200);
  assert.deepEqual(body.recipients.map(r => r.email), [
    `mom.${TAG}@example.com`,   // both siblings (mother is primary), sent once
    `dad.${TAG}@example.com`,   // father is primary
    `shared.${TAG}@example.com`, // no parent email on the student → linked member's email
  ]);
  assert.equal(body.recipients[0].names.length, 2);
  assert.equal(body.duplicateCount, 1);
  assert.equal(body.recipientCount, 3);
});

test("AC07: records without a valid email are excluded and reported; members dedupe case-insensitively", async () => {
  const { body } = await admin("POST", "/api/admin/bulk-email/recipients", {
    source: "members", ids: [ids.members.shared1, ids.members.shared2, ids.members.noemail, 999999999],
  });
  assert.equal(body.selectedCount, 3);
  assert.equal(body.recipientCount, 1);
  assert.equal(body.duplicateCount, 1);
  assert.equal(body.missingCount, 1);
  assert.equal(body.notFoundCount, 1);
  assert.equal(body.missing[0].id, ids.members.noemail);
  const students = await admin("POST", "/api/admin/bulk-email/recipients", { source: "students", ids: [ids.students.noEmail] });
  assert.equal(students.body.recipientCount, 0);
  assert.equal(students.body.missingCount, 1);
});

test("AC03 + AC04: only the submitted record ids are used (filtered or all-filtered selections)", async () => {
  const subset = await admin("POST", "/api/admin/bulk-email/recipients", { source: "members", ids: [ids.members.other] });
  assert.deepEqual(subset.body.recipients.map(r => r.email), [`other.${TAG}@example.com`]);
  const invalid = await admin("POST", "/api/admin/bulk-email/recipients", { source: "members", ids: [] });
  assert.equal(invalid.status, 400);
  const badSource = await admin("POST", "/api/admin/bulk-email/recipients", { source: "teachers", ids: [1] });
  assert.equal(badSource.status, 400);
});

test("AC08: subject and message are required; no valid recipients prevents sending", async () => {
  assert.equal((await send({ subject: "  " })).status, 400);
  assert.equal((await send({ html: "<p> </p>" })).status, 400);
  const none = await send({ ids: [ids.members.noemail] });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /valid email/);
});

test("preview returns the sanitized email", async () => {
  const { status, body } = await admin("POST", "/api/admin/bulk-email/preview", {
    subject: "Hello", html: '<p>Hi <b>all</b></p><script>alert(1)</script><a href="javascript:x()">x</a>',
  });
  assert.equal(status, 200);
  assert.match(body.html, /<b>all<\/b>/);
  assert.doesNotMatch(body.html, /script|javascript:/);
});

test("AC09 + audit: each unique recipient gets one private email and the send is logged", async () => {
  const sent = await send({
    ids: [ids.members.shared1, ids.members.shared2, ids.members.other, ids.members.noemail],
    html: "<p>Dear member</p><script>alert(1)</script>",
  });
  assert.equal(sent.status, 202);
  const done = await waitForDelivery(sent.body.id);
  assert.equal(done.status, "sent");
  assert.equal(done.sentCount, 2);
  assert.equal(done.failedCount, 0);
  assert.equal(done.skippedCount, 2); // one duplicate + one without email
  const [log] = await q("SELECT * FROM bulk_emails WHERE id = $1", [sent.body.id]);
  assert.equal(log.source, "members");
  assert.equal(log.sent_by_name, "Super Admin");
  assert.equal(log.recipient_count, 2);
  assert.doesNotMatch(log.body_html, /script/);
  const rows = await q("SELECT email, status, attempts FROM bulk_email_recipients WHERE bulk_email_id = $1 ORDER BY id", [sent.body.id]);
  assert.deepEqual(rows.map(r => [r.email, r.status, r.attempts]), [
    [`shared.${TAG}@example.com`, "sent", 1],
    [`other.${TAG}@example.com`, "sent", 1],
  ]);
  const audit = await q("SELECT new_value FROM audit_logs WHERE entity_id = $1 AND module_name = 'Communication Hub'", [String(sent.body.id)]);
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].new_value).source, "Member Management");
});

test("double submission with the same request id sends only once", async () => {
  const requestId = randomUUID();
  const [first, second] = await Promise.all([send({ requestId }), send({ requestId })]);
  assert.equal(first.body.id, second.body.id);
  await waitForDelivery(first.body.id);
  const [{ count }] = await q("SELECT COUNT(*)::int AS count FROM bulk_emails WHERE request_id = $1", [requestId]);
  assert.equal(count, 1);
});

test("AC10: partial failures keep successful sends; retry resends failed recipients only", async () => {
  const sent = await send({ ids: [ids.members.other, ids.members.failing] });
  const done = await waitForDelivery(sent.body.id);
  assert.equal(done.status, "partial");
  assert.equal(done.sentCount, 1);
  assert.equal(done.failedCount, 1);
  assert.equal(done.failures[0].email, `fail.${TAG}@test.invalid`);

  const retry = await admin("POST", `/api/admin/bulk-email/${sent.body.id}/retry`, {});
  assert.equal(retry.status, 202);
  const after = await waitForDelivery(sent.body.id);
  assert.equal(after.sentCount, 1);
  assert.equal(after.failedCount, 1);
  const rows = await q("SELECT email, status, attempts FROM bulk_email_recipients WHERE bulk_email_id = $1 ORDER BY id", [sent.body.id]);
  assert.deepEqual(rows.map(r => [r.status, r.attempts]), [["sent", 1], ["failed", 2]]); // the sent one was not resent

  // A send with no failures has nothing to retry.
  const clean = await send({ ids: [ids.members.other] });
  await waitForDelivery(clean.body.id);
  const noFailures = await admin("POST", `/api/admin/bulk-email/${clean.body.id}/retry`, {});
  assert.equal(noFailures.status, 400);
});
