import { Router, type IRouter, type Request, type Response } from "express";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import { membersTable, studentsTable, membershipPaymentsTable, portalSettingsTable, memberAccessChallengesTable } from "@workspace/db/schema";
import { or, eq, ilike, asc, desc, sql, and, count } from "drizzle-orm";
import { writeAudit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { isCompleteAddress } from "../../lib/address";
import { templeYear } from "../../lib/membership";
import { pgErrorInfo } from "../../lib/pg-error";
import { configuredFee, extendMembershipThrough } from "../../lib/registration-balance";
import { isValidMemberNamePart, memberNameParts } from "../../lib/member-name";
import {
  createMemberContextToken,
  createNewMemberContextToken,
  createVerifiedMemberContextToken,
} from "../../lib/member-context";
import { isValidMemberEmail, normalizeUsPhone } from "../../lib/member-phone";
import { getVerifiedAdmin, isSameOriginRequest } from "../../lib/admin-session";
import {
  clearPublicMemberAccessCookie,
  getVerifiedPublicIdentity,
  getVerifiedPublicPhone,
  setPublicMemberAccessCookie,
  verifyPublicMemberAccess,
} from "../../lib/public-member-access";
import {
  clearMemberOtpSessionCookie,
  hashMemberOtpSession,
  matchesMemberOtpSession,
  setMemberOtpSessionCookie,
} from "../../lib/member-otp-session";

const router: IRouter = Router();
const ACCESS_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_CODE_RESEND_INTERVAL_MS = 60 * 1000;
const ACCESS_CODE_RESEND_WINDOW_MS = 60 * 60 * 1000;
const ACCESS_CODE_MAX_RESENDS = 5;
const ACCESS_CODE_MAX_ATTEMPTS = 5;
const OTP_HOURLY_WINDOW_MS = 60 * 60 * 1000;
const OTP_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const OTP_GLOBAL_HOURLY_MAX_REQUESTS = 200;
const OTP_GLOBAL_DAILY_MAX_REQUESTS = 400;
const OTP_EMAIL_MAX_REQUESTS = 5;

function hashAccessCode(phoneHash: string, code: string, secret: string): string {
  return createHmac("sha256", secret)
    .update("gurukul-member-email-code-v3")
    .update(phoneHash)
    .update(code)
    .digest("hex");
}

function normalizeMemberEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return isValidMemberEmail(email) ? email : null;
}

function emailVerificationTtlMs(): number {
  const seconds = Number(process.env.MEMBER_EMAIL_OTP_TTL_SECONDS);
  return Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 30 * 60
    ? seconds * 1000
    : ACCESS_CODE_TTL_MS;
}

type EmailSendResult = { ok: true } | { ok: false };

async function sendEmailCode(email: string, code: string): Promise<EmailSendResult> {
  const provider = process.env.MEMBER_EMAIL_PROVIDER?.trim().toLowerCase();
  // Local development only: print the code to the API server log instead of emailing it.
  if (provider === "console" && process.env.NODE_ENV !== "production") {
    logger.warn({ email, code }, "DEV: member verification code (not emailed)");
    return { ok: true };
  }
  if (provider === "gmail") {
    const sender = normalizeMemberEmail(process.env.GMAIL_FROM_EMAIL);
    if (!sender) return { ok: false };
    const raw = Buffer.from([
      `From: Gurukul Registration <${sender}>`,
      `To: ${email}`,
      "Subject: Your Gurukul verification code",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      `Your verification code is ${code}. It expires soon. If you did not request it, ignore this email.`,
    ].join("\r\n"), "utf8").toString("base64url");
    try {
      const response = await new ReplitConnectors().proxy(
        "google-mail", "/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        },
      );
      if (!response.ok) return { ok: false };
      const result = await response.json() as { id?: unknown };
      return typeof result?.id === "string" && result.id.length > 0
        ? { ok: true } : { ok: false };
    } catch {
      return { ok: false };
    }
  }
  if (provider && provider !== "smtp" && provider !== "resend") return { ok: false };
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (provider !== "resend" && host && user && pass && from) {
    try {
      const port = Number(process.env.SMTP_PORT || 587);
      const transport = nodemailer.createTransport({
        host, port, secure: process.env.SMTP_SECURE === "true",
        auth: { user, pass },
      });
      await transport.sendMail({
        from, to: email, subject: "Your Gurukul verification code",
        text: `Your verification code is ${code}. It expires soon. If you did not request it, ignore this email.`,
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
  if (provider === "smtp") return { ok: false };
  const resendFrom = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendFrom) return { ok: false };
  try {
    const response = await new ReplitConnectors().proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: resendFrom,
        to: [email],
        subject: "Your Gurukul verification code",
        text: `Your verification code is ${code}. It expires soon. If you did not request it, ignore this email.`,
      }),
    });
    if (!response.ok) return { ok: false };
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      return { ok: false };
    }
    return result && typeof result === "object" &&
      "id" in result && typeof (result as { id?: unknown }).id === "string" &&
      Boolean((result as { id: string }).id.trim())
      ? { ok: true }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

function identityChallengeKey(phone: string, email: string, mode: "existing" | "new", secret: string): string {
  return createHmac("sha256", secret)
    .update("gurukul-member-email-challenge-v3")
    .update(phone).update("\0").update(email).update("\0").update(mode)
    .digest("hex");
}

function otpRateLimitKey(kind: "global-hourly" | "global-daily" | "email", value: string, secret: string): string {
  return `member-otp-rate:${createHmac("sha256", secret)
    .update("gurukul-member-otp-rate-v1")
    .update(kind).update("\0").update(value)
    .digest("hex")}`;
}

async function reserveOtpAggregateBudget(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    await tx.execute(sql`
      DELETE FROM member_access_challenges
      WHERE phone_hash LIKE 'member-otp-rate:%'
        AND request_window_started_at < NOW() - INTERVAL '24 hours'
    `);
    const now = new Date();
    const [budget] = await tx.select()
      .from(memberAccessChallengesTable)
      .where(eq(memberAccessChallengesTable.phoneHash, key))
      .for("update")
      .limit(1);
    if (budget && now.getTime() - budget.requestWindowStartedAt.getTime() < windowMs) {
      if (budget.resendCount >= limit) return false;
      await tx.update(memberAccessChallengesTable)
        .set({ resendCount: budget.resendCount + 1 })
        .where(eq(memberAccessChallengesTable.phoneHash, key));
      return true;
    }
    if (budget) {
      await tx.update(memberAccessChallengesTable)
        .set({
          requestWindowStartedAt: now,
          lastSentAt: now,
          resendCount: 1,
          expiresAt: new Date(now.getTime() + windowMs),
        })
        .where(eq(memberAccessChallengesTable.phoneHash, key));
    } else {
      await tx.insert(memberAccessChallengesTable).values({
        phoneHash: key,
        sessionHash: "",
        codeHash: "",
        expiresAt: new Date(now.getTime() + windowMs),
        attempts: 0,
        lastSentAt: now,
        requestWindowStartedAt: now,
        resendCount: 1,
      });
    }
    return true;
  });
}

async function hasIdentityCollision(executor: any, phone: string, email: string): Promise<boolean> {
  const result = await executor.execute(sql`
    SELECT 1 FROM (
      SELECT 1 FROM members WHERE
        REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${phone}
        OR LOWER(TRIM(COALESCE(email, ''))) = ${email}
      UNION ALL
      SELECT 1 FROM students WHERE
        REGEXP_REPLACE(COALESCE(mother_phone, ''), '[^0-9]', '', 'g') = ${phone}
        OR REGEXP_REPLACE(COALESCE(father_phone, ''), '[^0-9]', '', 'g') = ${phone}
        OR LOWER(TRIM(COALESCE(mother_email, ''))) = ${email}
        OR LOWER(TRIM(COALESCE(father_email, ''))) = ${email}
      UNION ALL
      SELECT 1 FROM teachers WHERE
        REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${phone}
        OR LOWER(TRIM(COALESCE(email, ''))) = ${email}
      UNION ALL
      SELECT 1 FROM admin_users WHERE
        REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${phone}
        OR LOWER(TRIM(COALESCE(email, ''))) = ${email}
      UNION ALL
      SELECT 1 FROM portal_users WHERE
        REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${phone}
      UNION ALL
      SELECT 1 FROM contacts WHERE
        REGEXP_REPLACE(COALESCE(mother_phone, ''), '[^0-9]', '', 'g') = ${phone}
        OR REGEXP_REPLACE(COALESCE(father_phone, ''), '[^0-9]', '', 'g') = ${phone}
        OR REGEXP_REPLACE(COALESCE(sender_phone, ''), '[^0-9]', '', 'g') = ${phone}
        OR LOWER(TRIM(COALESCE(mother_email, ''))) = ${email}
        OR LOWER(TRIM(COALESCE(father_email, ''))) = ${email}
        OR LOWER(TRIM(COALESCE(sender_email, ''))) = ${email}
    ) identity_matches LIMIT 1
  `);
  return result.rows.length > 0;
}

async function lockIdentity(executor: any, phone: string, email: string): Promise<void> {
  const keys = [phone, email].sort();
  for (const key of keys) {
    await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`member-identity:${key}`}))`);
  }
}
async function authorizeMemberMutation(
  req: Request,
  res: Response,
  memberId: number,
): Promise<boolean> {
  if (!isSameOriginRequest(req)) {
    res.status(403).json({ error: "A same-origin request is required." });
    return false;
  }
  if (await getVerifiedAdmin(req) || await verifyPublicMemberAccess(req, memberId)) return true;
  res.status(403).json({ error: "Verify member access before changing this member record." });
  return false;
}

async function requireVerifiedAdmin(
  req: Request,
  res: Response,
): Promise<boolean> {
  if (await getVerifiedAdmin(req)) return true;
  res.status(403).json({ error: "A verified administrator session is required." });
  return false;
}

// created_at is stored as a UTC timestamp without time zone. Interpret it in
// Eastern time before comparing calendar years, independent of the DB session TZ.
const currentTempleYear = sql`EXTRACT(YEAR FROM NOW() AT TIME ZONE 'America/New_York')`;
const memberTempleYear = sql`EXTRACT(YEAR FROM (${membersTable.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York'))`;
// A membership ends December 31 of its start year or of a later year already paid in advance.
const membershipEndYear = sql`GREATEST(${memberTempleYear}, COALESCE(${membersTable.membershipYear}, 0))`;
const activeMembership = sql`(${membersTable.createdAt} IS NOT NULL AND ${membersTable.createdAt} <= (NOW() AT TIME ZONE 'UTC') AND ${membershipEndYear} >= ${currentTempleYear})`;
const inFinalThirtyDays = sql`(NOW() >= (((date_trunc('year', NOW() AT TIME ZONE 'America/New_York') + INTERVAL '1 year') AT TIME ZONE 'America/New_York') - INTERVAL '30 days'))`;
const expiringMembership = sql`(${activeMembership} AND ${membershipEndYear} = ${currentTempleYear} AND ${inFinalThirtyDays})`;

// GET /api/admin/members — list all members with search, filter, pagination
router.get("/", async (req, res) => {
  try {
    if (!await requireVerifiedAdmin(req, res)) return;
    const {
      q        = "",
      employer = "",
      type     = "all",     // "all" | "temple" | "parent"
      policy   = "all",     // "all" | "agreed" | "not_agreed"
      year     = "",
      status   = "all",     // "all" | "active" | "expiring" | "expired"
      students = "all",     // "all" | "with" | "without"
      page     = "1",
      limit    = "100",
      sort     = "id",
      dir      = "desc",
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset   = (pageNum - 1) * pageSize;

    const conditions: ReturnType<typeof eq>[] = [];

    // Text search — name, email, phone
    if (q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(
        or(
          ilike(membersTable.name,  term),
          ilike(membersTable.email, term),
          ilike(membersTable.phone, term),
        ) as ReturnType<typeof eq>
      );
    }

    // Member type filter
    if (type === "temple") {
      conditions.push(eq(membersTable.isExistingMember, true));
    } else if (type === "parent") {
      conditions.push(eq(membersTable.isExistingMember, false));
    }

    // Policy agreed filter
    if (policy === "agreed") {
      conditions.push(eq(membersTable.policyAgreed, true));
    } else if (policy === "not_agreed") {
      conditions.push(eq(membersTable.policyAgreed, false));
    }

    // Membership year filter
    if (year && !isNaN(parseInt(year))) {
      conditions.push(eq(membersTable.membershipYear, parseInt(year)));
    }

    // Active and expiring memberships both end on December 31.
    if (status === "active") {
      conditions.push(sql`${activeMembership} AND NOT ${inFinalThirtyDays}` as ReturnType<typeof eq>);
    } else if (status === "expiring") {
      conditions.push(expiringMembership as ReturnType<typeof eq>);
    } else if (status === "expired") {
      conditions.push(sql`NOT ${activeMembership}` as ReturnType<typeof eq>);
    }

    // Employer filter — search across mother_employer and father_employer in linked students
    if (employer.trim()) {
      const empTerm = `%${employer.trim()}%`;
      conditions.push(
        sql`(members.employer ILIKE ${empTerm} OR EXISTS (SELECT 1 FROM students s WHERE s.member_id = members.id AND (s.mother_employer ILIKE ${empTerm} OR s.father_employer ILIKE ${empTerm})))` as ReturnType<typeof eq>
      );
    }

    // Students filter
    if (students === "with") {
      conditions.push(sql`(SELECT COUNT(*) FROM students WHERE students.member_id = members.id) > 0` as ReturnType<typeof eq>);
    } else if (students === "without") {
      conditions.push(sql`(SELECT COUNT(*) FROM students WHERE students.member_id = members.id) = 0` as ReturnType<typeof eq>);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Sort
    const sortCol  = sort === "name" ? membersTable.name
                   : sort === "email" ? membersTable.email
                   : sort === "createdAt" ? membersTable.createdAt
                   : membersTable.id;
    const orderFn  = dir === "asc" ? asc : desc;

    // Execute query with student count + isActive per row
    const rows = await db
      .select({
        id:                     membersTable.id,
        firstName:              membersTable.firstName,
        lastName:               membersTable.lastName,
        name:                   membersTable.name,
        email:                  membersTable.email,
        phone:                  membersTable.phone,
        isExistingMember:       membersTable.isExistingMember,
        policyAgreed:           membersTable.policyAgreed,
        membershipYear:         membersTable.membershipYear,
        createdAt:              membersTable.createdAt,
        address:                membersTable.address,
        validationStatus:       membersTable.validationStatus,
        validationDate:         membersTable.validationDate,
        validatedByAdminName:   membersTable.validatedByAdminName,
        idCardTypeSeen:         membersTable.idCardTypeSeen,
        idCardNumberLast4:      membersTable.idCardNumberLast4,
        validationNotes:        membersTable.validationNotes,
        memberCode:       membersTable.memberCode,
        studentCount:     sql<number>`(SELECT COUNT(*)::int FROM students WHERE students.member_id = members.id)`.as("student_count"),
        isActive:         sql<boolean>`${activeMembership}`.as("is_active"),
        expiringSoon:     sql<boolean>`${expiringMembership}`.as("expiring_soon"),
        employer:         sql<string | null>`COALESCE(NULLIF(TRIM(${membersTable.employer}), ''), (SELECT COALESCE(NULLIF(TRIM(s.mother_employer), ''), NULLIF(TRIM(s.father_employer), '')) FROM students s WHERE s.member_id = members.id LIMIT 1))`.as("employer"),
        memFeeStatus:          sql<string | null>`(SELECT payment_status       FROM membership_payments WHERE member_id = members.id AND membership_year = ${currentTempleYear}::int LIMIT 1)`.as("mem_fee_status"),
        memFeePaid:            sql<number>`COALESCE((SELECT amount_paid          FROM membership_payments WHERE member_id = members.id AND membership_year = ${currentTempleYear}::int LIMIT 1), 0)`.as("mem_fee_paid"),
        memFeeDue:             sql<number>`COALESCE((SELECT amount_due           FROM membership_payments WHERE member_id = members.id AND membership_year = ${currentTempleYear}::int LIMIT 1), 0)`.as("mem_fee_due"),
        feeUpdatedByAdminName: sql<string | null>`(SELECT updated_by_admin_name FROM membership_payments WHERE member_id = members.id AND membership_year = ${currentTempleYear}::int LIMIT 1)`.as("fee_updated_by_admin_name"),
      })
      .from(membersTable)
      .where(where)
      .orderBy(orderFn(sortCol))
      .limit(pageSize)
      .offset(offset);

    // Total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(membersTable)
      .where(where);

    // Stats — non-correlated subqueries so the counts are correct
    const curYear  = new Date().getFullYear();
    const curMonth = new Date().getMonth() + 1; // 1–12
    const [stats] = await db
      .select({
        totalMembers:    sql<number>`COUNT(*)`,
        activeCount:     sql<number>`SUM(CASE WHEN ${activeMembership} THEN 1 ELSE 0 END)`,
        expiredCount:    sql<number>`SUM(CASE WHEN NOT ${activeMembership} THEN 1 ELSE 0 END)`,
        withStudents:    sql<number>`(SELECT COUNT(DISTINCT member_id) FROM students WHERE member_id IS NOT NULL)`,
        withoutStudents: sql<number>`COUNT(*) - (SELECT COUNT(DISTINCT member_id) FROM students WHERE member_id IS NOT NULL)`,
        addedThisMonth:  sql<number>`SUM(CASE WHEN EXTRACT(YEAR FROM created_at) = ${curYear} AND EXTRACT(MONTH FROM created_at) = ${curMonth} THEN 1 ELSE 0 END)`,
      })
      .from(membersTable);

    res.json({
      data:    rows,
      total:   Number(total),
      page:    pageNum,
      limit:   pageSize,
      stats: {
        totalMembers:    Number(stats.totalMembers),
        activeCount:     Number(stats.activeCount  ?? 0),
        expiredCount:    Number(stats.expiredCount  ?? 0),
        withStudents:    Number(stats.withStudents  ?? 0),
        withoutStudents: Number(stats.withoutStudents ?? 0),
        addedThisMonth:  Number(stats.addedThisMonth ?? 0),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Members list failed");
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

// GET /api/admin/members/:id — single member with linked students
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });
    if (!await getVerifiedAdmin(req)) {
      return res.status(403).json({ error: "A verified administrator session is required." });
    }

    const [member] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, id))
      .limit(1);

    if (!member) return res.status(404).json({ error: "Member not found" });

    const [students, feeRow] = await Promise.all([
      db.select({
          id:          studentsTable.id,
          studentCode: studentsTable.studentCode,
          name:        studentsTable.name,
          dob:         studentsTable.dob,
          grade:       studentsTable.grade,
          isActive:    studentsTable.isActive,
        })
        .from(studentsTable)
        .where(eq(studentsTable.memberId, id))
        .orderBy(asc(studentsTable.studentCode)),
      db.select()
        .from(membershipPaymentsTable)
        .where(
          and(
            eq(membershipPaymentsTable.memberId, id),
            eq(membershipPaymentsTable.membershipYear, templeYear()),
          )
        )
        .limit(1),
    ]);

    const fee = feeRow[0] ?? null;
    res.json({
      ...member,
      students,
      memFeeStatus:            fee?.paymentStatus ?? null,
      memFeePaid:              fee ? parseFloat(fee.amountPaid ?? "0") : 0,
      memFeeDue:               fee ? parseFloat(fee.amountDue  ?? "0") : 0,
      feeUpdatedByAdminName:   fee?.updatedByAdminName ?? null,
      feeUpdatedAt:            fee?.updatedAt ? fee.updatedAt.toISOString() : null,
    });
  } catch (err) {
    req.log.error({ err }, "Member get failed");
    res.status(500).json({ error: "Failed to fetch member" });
  }
});

// Legacy compatibility paths remain closed; email-verification is the only OTP flow.
router.post("/access/request", (_req, res) => {
  clearPublicMemberAccessCookie(res);
  clearMemberOtpSessionCookie(res);
  return res.status(410).json({ error: "Use the email verification flow." });
});
router.post("/access/verify", (_req, res) => {
  clearPublicMemberAccessCookie(res);
  clearMemberOtpSessionCookie(res);
  return res.status(410).json({ error: "Use the email verification flow." });
});

const genericIdentityError = "We could not verify the information provided. Please check your email address and phone number, use the existing-member flow, or contact the temple office.";
const identityExistsError = "This mobile number or email address already exists in the BHT database, so a new membership cannot be created. Please use Existing Member, provide different contact information, or contact the Temple administrator.";
const missingExistingMemberError = "We couldn't find a membership associated with this mobile number. Please check the number and try again. If you're a new member, select New Member to continue.";

function maskMemberEmail(email: string): string {
  const at = email.indexOf("@");
  return `${email.slice(0, 1)}${"*".repeat(Math.max(1, at - 1))}${email.slice(at)}`;
}

async function resolveExistingMember(phone: string, identifier: unknown) {
  const candidates = await db.select({
    id: membersTable.id, email: membersTable.email, name: membersTable.name,
    lastName: membersTable.lastName, memberCode: membersTable.memberCode,
  }).from(membersTable)
    .where(sql`REGEXP_REPLACE(COALESCE(${membersTable.phone}, ''), '[^0-9]', '', 'g') = ${phone}`);
  if (!candidates.length) return { kind: "missing" as const };
  const entered = typeof identifier === "string" ? identifier.trim().toLowerCase() : "";
  const narrowed = candidates.length > 1 && entered
    ? candidates.filter(member =>
      (member.lastName ?? member.name?.trim().split(/\s+/).at(-1))?.trim().toLowerCase() === entered ||
      member.memberCode?.trim().toLowerCase() === entered ||
      String(member.id) === entered)
    : candidates;
  if (narrowed.length !== 1) return { kind: "ambiguous" as const };
  const email = normalizeMemberEmail(narrowed[0].email);
  if (!email) return { kind: "no-email" as const };
  return { kind: "found" as const, id: narrowed[0].id, email };
}

// Reveals only a masked address, never member details or the complete destination.
router.post("/existing-email-hint", async (req, res) => {
  try {
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "A same-origin request is required." });
    const phone = normalizeUsPhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "Enter a valid mobile phone number." });
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) return res.status(503).json({ error: "Email verification is unavailable." });
    if (!await reserveOtpAggregateBudget(otpRateLimitKey("global-hourly", "hints", sessionSecret), 200, OTP_HOURLY_WINDOW_MS)) {
      return res.status(429).json({ error: "Please wait before checking another number." });
    }
    if (!await reserveOtpAggregateBudget(otpRateLimitKey("email", `hint:${phone}`, sessionSecret), 20, OTP_HOURLY_WINDOW_MS)) {
      return res.status(429).json({ error: "Please wait before checking this number again." });
    }
    const match = await resolveExistingMember(phone, req.body?.identifier);
    if (match.kind === "missing") return res.status(404).json({ error: missingExistingMemberError });
    if (match.kind === "ambiguous") return res.status(409).json({ error: "More than one membership uses this number. Enter the registered last name or Member ID to continue." });
    if (match.kind === "no-email") return res.status(409).json({ error: "No email is available for this membership. Please contact the temple office to update it." });
    return res.json({ maskedEmail: maskMemberEmail(match.email) });
  } catch (err) {
    req.log.error({ err }, "Existing member hint failed");
    return res.status(500).json({ error: "Unable to check this mobile number." });
  }
});

router.post("/phone-verification/request", (_req, res) =>
  res.status(410).json({ error: "Phone verification is no longer supported. Use email verification." }));
router.post("/phone-verification/verify", (_req, res) =>
  res.status(410).json({ error: "Phone verification is no longer supported. Use email verification." }));

// POST /api/admin/members/email-verification/request
router.post("/email-verification/request", async (req, res) => {
  try {
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "A same-origin request is required." });
    clearPublicMemberAccessCookie(res);
    const body = req.body as { phone?: unknown; email?: unknown; memberType?: unknown; identifier?: unknown };
    const phone = normalizeUsPhone(body?.phone);
    const mode = body?.memberType;
    if (!phone || (mode !== "existing" && mode !== "new")) {
      return res.status(400).json({ error: "Enter a valid phone number and member type." });
    }
    const match = mode === "existing" ? await resolveExistingMember(phone, body.identifier) : null;
    if (match && match.kind !== "found") return res.status(409).json({ error: "Membership contact information could not be confirmed. Please check the phone number or contact the temple office." });
    const email = match?.kind === "found" ? match.email : normalizeMemberEmail(body?.email);
    if (!email) return res.status(400).json({ error: "Enter a valid email address." });
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      return res.status(503).json({ error: "Email verification is unavailable. Please contact the temple office." });
    }
    if (mode === "new") {
      const collision = await db.transaction(async tx => {
        await lockIdentity(tx, phone, email);
        return hasIdentityCollision(tx, phone, email);
      });
      if (collision) return res.status(409).json({ error: identityExistsError, code: "identity-exists" });
    }
    const hourlyBudget = await reserveOtpAggregateBudget(
      otpRateLimitKey("global-hourly", "all", sessionSecret),
      OTP_GLOBAL_HOURLY_MAX_REQUESTS,
      OTP_HOURLY_WINDOW_MS,
    );
    const dailyBudget = hourlyBudget && await reserveOtpAggregateBudget(
      otpRateLimitKey("global-daily", "all", sessionSecret),
      OTP_GLOBAL_DAILY_MAX_REQUESTS,
      OTP_DAILY_WINDOW_MS,
    );
    const emailBudget = dailyBudget && await reserveOtpAggregateBudget(
      otpRateLimitKey("email", email, sessionSecret),
      OTP_EMAIL_MAX_REQUESTS,
      OTP_HOURLY_WINDOW_MS,
    );
    if (!hourlyBudget || !dailyBudget || !emailBudget) {
      return res.status(429).json({ error: "Please wait before requesting another verification code." });
    }
    const challengeKey = identityChallengeKey(phone, email, mode, sessionSecret);
    const ttlMs = emailVerificationTtlMs();
    const challenge = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${challengeKey}))`);
      const now = new Date();
      const [existing] = await tx.select()
        .from(memberAccessChallengesTable)
        .where(eq(memberAccessChallengesTable.phoneHash, challengeKey))
        .for("update")
        .limit(1);
      let resendCount = 1;
      let requestWindowStartedAt = now;
      if (existing) {
        if (now.getTime() - existing.lastSentAt.getTime() < ACCESS_CODE_RESEND_INTERVAL_MS) {
          return { kind: "limited" as const };
        }
        if (now.getTime() - existing.requestWindowStartedAt.getTime() < ACCESS_CODE_RESEND_WINDOW_MS) {
          if (existing.resendCount >= ACCESS_CODE_MAX_RESENDS) return { kind: "limited" as const };
          resendCount = existing.resendCount + 1;
          requestWindowStartedAt = existing.requestWindowStartedAt;
        }
      }
      // Remove the prior proof before starting a resend. Keep the database lock
      // until delivery finishes so an overlapping resend cannot return success
      // while its code has already been replaced.
      if (existing) {
        await tx.delete(memberAccessChallengesTable)
          .where(eq(memberAccessChallengesTable.phoneHash, challengeKey));
      }
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const sessionToken = randomBytes(32).toString("base64url");
      const sessionHash = hashMemberOtpSession(challengeKey, sessionToken, sessionSecret);
      const codeHash = hashAccessCode(challengeKey, code, sessionSecret);
      const delivery = await sendEmailCode(email, code);
      if (!delivery.ok) {
        // Persist rate-limit state, but an already-expired challenge can never
        // verify. This also guarantees a failed resend cannot revive the prior
        // code or leave the just-failed code usable.
        await tx.insert(memberAccessChallengesTable).values({
          phoneHash: challengeKey,
          sessionHash,
          codeHash,
          expiresAt: now,
          attempts: 0,
          lastSentAt: now,
          requestWindowStartedAt,
          resendCount,
        });
        return { kind: "delivery-failed" as const };
      }
      const sentAt = new Date();
      const expiresAt = new Date(sentAt.getTime() + ttlMs);
      const values = {
        phoneHash: challengeKey,
        sessionHash,
        codeHash,
        expiresAt,
        attempts: 0,
        lastSentAt: sentAt,
        requestWindowStartedAt,
        resendCount,
      };
      await tx.insert(memberAccessChallengesTable).values(values);
      return { kind: "send" as const, sessionToken, expiresAt };
    });
    if (challenge.kind === "limited") {
      return res.status(429).json({ error: "Please wait before requesting another verification code." });
    }
    if (challenge.kind === "delivery-failed") {
      clearMemberOtpSessionCookie(res);
      req.log.error("Member email verification delivery failed");
      return res.status(503).json({ error: "Email verification is unavailable. Please contact the temple office." });
    }
    setMemberOtpSessionCookie(res, challenge.sessionToken, challenge.expiresAt);
    return res.json({ success: true, maskedEmail: maskMemberEmail(email) });
  } catch {
    req.log.error("Member email verification request failed");
    return res.status(500).json({ error: "Unable to request email verification." });
  }
});

router.post("/email-verification/verify", async (req, res) => {
  try {
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "A same-origin request is required." });
    clearPublicMemberAccessCookie(res);
    const body = req.body as { phone?: unknown; email?: unknown; code?: unknown; memberType?: unknown; identifier?: unknown };
    const phone = normalizeUsPhone(body?.phone);
    const mode = body?.memberType;
    if (!phone || (mode !== "existing" && mode !== "new")) {
      return res.status(400).json({ error: "Enter a valid phone number and member type." });
    }
    const match = mode === "existing" ? await resolveExistingMember(phone, body.identifier) : null;
    if (match && match.kind !== "found") return res.status(400).json({ error: "Membership contact information could not be confirmed." });
    const email = match?.kind === "found" ? match.email : normalizeMemberEmail(body?.email);
    if (!email) return res.status(400).json({ error: "Enter a valid email address." });
    const candidate = typeof body.code === "string" ? body.code.trim() : "";
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) return res.status(503).json({ error: "Email verification is unavailable. Please contact the temple office." });
    const challengeKey = identityChallengeKey(phone, email, mode, sessionSecret);
    const verified = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${challengeKey}))`);
      const [challenge] = await tx.select()
        .from(memberAccessChallengesTable)
        .where(eq(memberAccessChallengesTable.phoneHash, challengeKey))
        .for("update")
        .limit(1);
      if (!challenge || challenge.expiresAt.getTime() <= Date.now() ||
          challenge.attempts >= ACCESS_CODE_MAX_ATTEMPTS) return false;
      const expected = Buffer.from(challenge.codeHash, "hex");
      const supplied = Buffer.from(hashAccessCode(challengeKey, candidate, sessionSecret), "hex");
      const matches = /^\d{6}$/.test(candidate) &&
        expected.length === supplied.length && timingSafeEqual(expected, supplied) &&
        matchesMemberOtpSession(req, challengeKey, challenge.sessionHash, sessionSecret);
      if (matches) {
        if (mode === "existing") {
          const [member] = await tx.select({ id: membersTable.id })
            .from(membersTable)
            .where(and(eq(membersTable.id, match!.id), sql`
              REGEXP_REPLACE(COALESCE(${membersTable.phone}, ''), '[^0-9]', '', 'g') = ${phone}
              AND LOWER(TRIM(COALESCE(${membersTable.email}, ''))) = ${email}
            `)).limit(1);
          if (!member) {
            await tx.delete(memberAccessChallengesTable).where(eq(memberAccessChallengesTable.phoneHash, challengeKey));
            return false;
          }
        } else {
          await lockIdentity(tx, phone, email);
          if (await hasIdentityCollision(tx, phone, email)) {
            await tx.delete(memberAccessChallengesTable).where(eq(memberAccessChallengesTable.phoneHash, challengeKey));
            return false;
          }
        }
        await tx.delete(memberAccessChallengesTable)
          .where(eq(memberAccessChallengesTable.phoneHash, challengeKey));
        return true;
      }
      await tx.update(memberAccessChallengesTable)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(memberAccessChallengesTable.phoneHash, challengeKey));
      return false;
    });
    if (!verified) {
      return res.status(400).json({ error: "The verification code is invalid or expired, or the identity could not be verified. Request a new code." });
    }

    clearMemberOtpSessionCookie(res);
    setPublicMemberAccessCookie(res, phone, email, mode, match?.kind === "found" ? match.id : undefined);
    return res.json({ success: true, memberExists: mode === "existing" });
  } catch {
    req.log.error("Member email verification failed");
    return res.status(500).json({ error: "Unable to verify email access." });
  }
});

// POST /api/admin/members/lookup — find existing member by phone number only
router.post("/lookup", async (req, res) => {
  try {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "A same-origin request is required." });
    }
    const { phone } = req.body as { phone?: string };
    const digitsOnly = normalizeUsPhone(phone);
    if (!digitsOnly) {
      return res.status(400).json({ error: "A valid 10-digit phone number is required." });
    }
    const verifiedAdmin = await getVerifiedAdmin(req);
    if (!verifiedAdmin && getVerifiedPublicPhone(req) !== digitsOnly) {
      return res.status(403).json({ error: "Verify this phone number before looking up member details." });
    }
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      return res.status(500).json({ error: "Member context signing is unavailable because server configuration is incomplete." });
    }

    const identity = verifiedAdmin ? null : getVerifiedPublicIdentity(req);
    const matches = await db
      .select()
      .from(membersTable)
      .where(and(sql`REGEXP_REPLACE(${membersTable.phone}, '[^0-9]', '', 'g') = ${digitsOnly}`,
        identity?.memberId ? eq(membersTable.id, identity.memberId) : sql`TRUE`))
      .limit(2);

    if (matches.length > 1) {
      return res.status(409).json({ error: "More than one member matches this phone number. Ask an administrator to resolve the duplicate records before continuing." });
    }
    const member = matches[0];
    if (!member) return res.status(404).json({ error: "No member found with that phone number." });
    if (!verifiedAdmin && !await verifyPublicMemberAccess(req, member.id)) {
      return res.status(403).json({ error: "Verify this member's current phone number before looking up details." });
    }

    // Also fetch membership fee status for the current calendar year
    const currentYear = templeYear();
    const [memPayment] = await db
      .select({
        paymentStatus: membershipPaymentsTable.paymentStatus,
        amountPaid:    membershipPaymentsTable.amountPaid,
        amountDue:     membershipPaymentsTable.amountDue,
      })
      .from(membershipPaymentsTable)
      .where(
        and(
          eq(membershipPaymentsTable.memberId, member.id),
          eq(membershipPaymentsTable.membershipYear, currentYear)
        )
      )
      .limit(1);

    res.json({
      id: member.id,
      memberCode: member.memberCode,
      firstName: member.firstName,
      lastName: member.lastName,
      name: member.name,
      email: member.email,
      phone: member.phone,
      employer: member.employer,
      address: member.address,
      membershipYear: member.membershipYear,
      createdAt: member.createdAt,
      validationStatus: member.validationStatus,
      memberContextToken: verifiedAdmin
        ? createMemberContextToken(member.id, sessionSecret)
        : createVerifiedMemberContextToken(member.id, sessionSecret),
      memFeeStatus: memPayment?.paymentStatus ?? null,
      memFeePaid:   memPayment ? parseFloat(memPayment.amountPaid) : 0,
      memFeeDue:    memPayment ? parseFloat(memPayment.amountDue)  : 0,
    });
  } catch (err) {
    req.log.error({ err }, "Member lookup failed");
    res.status(500).json({ error: "Member lookup failed" });
  }
});

// POST /api/admin/members — create a new member
router.post("/", async (req, res) => {
  try {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "A same-origin request is required." });
    }
    const { firstName, lastName, name, email, phone, address, employer, isExistingMember, policyAgreed, membershipYear } = req.body as {
      firstName?: string; lastName?: string; name?: string; email?: string; phone?: string;
      address?: string; employer?: string;
      isExistingMember?: boolean; policyAgreed?: boolean; membershipYear?: number;
    };
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      res.status(500).json({ error: "Member context signing is unavailable because server configuration is incomplete." });
      return;
    }
    if (address != null && !isCompleteAddress(address)) {
      return res.status(400).json({ error: "A complete address with street, city, 2-letter state and ZIP is required." });
    }
    const nameParts = memberNameParts({ firstName, lastName, name });
    if (!nameParts || !isValidMemberNamePart(nameParts.firstName) || !isValidMemberNamePart(nameParts.lastName)) {
      return res.status(400).json({ error: "Enter the member's first name and last name." });
    }
    const normalizedPhone = normalizeUsPhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: "Enter a valid 10-digit US phone number (formatting such as parentheses and dashes is allowed)." });
    }
    const verifiedAdmin = await getVerifiedAdmin(req);
    if (!verifiedAdmin && getVerifiedPublicPhone(req) !== normalizedPhone) {
      return res.status(403).json({ error: "Verify the phone number before creating a member." });
    }
    const normalizedEmail = normalizeMemberEmail(email);
    if (!normalizedEmail) {
      return res.status(400).json({ error: "Enter a valid email address for the member." });
    }

    if (!verifiedAdmin) {
      const identity = getVerifiedPublicIdentity(req);
      if (!identity || identity.mode !== "new" || identity.phone !== normalizedPhone || identity.email !== normalizedEmail ||
          (req.body as { memberType?: unknown }).memberType !== "new") {
        return res.status(403).json({ error: "Verify this email address and phone number for new-member registration first." });
      }
    }

    const created = await db.transaction(async tx => {
      await lockIdentity(tx, normalizedPhone, normalizedEmail);
      const [existingPhone] = verifiedAdmin ? await tx.select({ id: membersTable.id })
        .from(membersTable)
        .where(sql`REGEXP_REPLACE(COALESCE(${membersTable.phone}, ''), '[^0-9]', '', 'g') = ${normalizedPhone}`)
        .limit(1) : [];
      if (verifiedAdmin ? Boolean(existingPhone) : await hasIdentityCollision(tx, normalizedPhone, normalizedEmail)) {
        throw Object.assign(new Error("identity_collision"), { code: "IDENTITY_COLLISION" });
      }
      const [row] = await tx.insert(membersTable)
        .values({
          firstName:        nameParts.firstName,
          lastName:         nameParts.lastName,
          name:             nameParts.name,
          email:            normalizedEmail,
          phone:            normalizedPhone,
          address:          address?.trim() || null,
          employer:          employer?.trim() || null,
          isExistingMember: verifiedAdmin ? (isExistingMember ?? false) : false,
          policyAgreed:     policyAgreed ?? false,
          membershipYear:   membershipYear ?? null,
          createdAt:        sql`NOW() AT TIME ZONE 'UTC'`,
        })
        .returning();
      return row;
    });

    // Generate stable member code: MEM-{year}-{id padded to 4}
    const year = templeYear(created.createdAt!);
    const code = `MEM-${year}-${String(created.id).padStart(4, "0")}`;

    const [member] = await db
      .update(membersTable)
      .set({ memberCode: code })
      .where(eq(membersTable.id, created.id))
      .returning();

    if (!verifiedAdmin) {
      setPublicMemberAccessCookie(res, normalizedPhone, normalizedEmail, "new", member.id);
    }
    res.status(201).json({
      ...member,
      memberContextToken: createNewMemberContextToken(member.id, sessionSecret),
    });
  } catch (err: unknown) {
    const pg = pgErrorInfo(err);
    if ((err as { code?: string })?.code === "IDENTITY_COLLISION") {
      return res.status(409).json({ error: genericIdentityError });
    }
    if (pg?.code === "23505") {
      return res.status(409).json({ error: genericIdentityError });
    }
    req.log.error({ err }, "Member creation failed");
    res.status(500).json({ error: "Member creation failed" });
  }
});

// PUT /api/admin/members/:id — full update
router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "A same-origin request is required." });
    }

    const { firstName, lastName, name, email, phone, isExistingMember, policyAgreed, membershipYear, address } = req.body as {
      firstName?: string; lastName?: string; name?: string; email?: string | null; phone?: string | null;
      isExistingMember?: boolean; policyAgreed?: boolean; membershipYear?: number | null;
      address?: string | null;
    };

    const [current] = await db
      .select({ email: membersTable.email, phone: membersTable.phone })
      .from(membersTable)
      .where(eq(membersTable.id, id))
      .limit(1);
    const verifiedAdmin = await getVerifiedAdmin(req);
    if (!verifiedAdmin && !await verifyPublicMemberAccess(req, id)) {
      return res.status(403).json({ error: "Verify member access before changing this member record." });
    }
    if (!current) return res.status(404).json({ error: "Member not found" });
    if (!verifiedAdmin &&
        (isExistingMember !== undefined || policyAgreed !== undefined || membershipYear !== undefined)) {
      return res.status(403).json({ error: "A verified administrator session is required to change membership settings." });
    }

    const updateData: Partial<typeof membersTable.$inferInsert> = {};
    if (firstName !== undefined || lastName !== undefined || name !== undefined) {
      const nameParts = memberNameParts({ firstName, lastName, name });
      if (!nameParts || !isValidMemberNamePart(nameParts.firstName) || !isValidMemberNamePart(nameParts.lastName)) {
        return res.status(400).json({ error: "Enter the member's first name and last name." });
      }
      Object.assign(updateData, nameParts);
    }
    if (email !== undefined) {
      const normalizedEmail = normalizeMemberEmail(email);
      if (!isValidMemberEmail(normalizedEmail)) {
        return res.status(400).json({ error: "Enter a valid email address. Member email cannot be cleared." });
      }
      updateData.email = normalizedEmail;
    }
    if (phone !== undefined) {
      const normalizedPhone = normalizeUsPhone(phone);
      if (!normalizedPhone) {
        return res.status(400).json({ error: "Enter a valid 10-digit US phone number. Member phone cannot be cleared." });
      }
      updateData.phone = normalizedPhone;
    }
    const emailChanged = email !== undefined &&
      (!normalizeMemberEmail(current.email) || normalizeMemberEmail(email) !== normalizeMemberEmail(current.email));
    const phoneChanged = phone !== undefined &&
      (!normalizeUsPhone(current.phone) || normalizeUsPhone(phone) !== normalizeUsPhone(current.phone));
    if (!verifiedAdmin && (emailChanged || phoneChanged)) {
      return res.status(403).json({ error: "A verified administrator session is required to change member contact information." });
    }
    if (isExistingMember !== undefined) updateData.isExistingMember = isExistingMember;
    if (policyAgreed !== undefined) updateData.policyAgreed = policyAgreed;
    if (membershipYear !== undefined) updateData.membershipYear = membershipYear;
    if (address !== undefined) updateData.address = address?.trim() || null;
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "Provide at least one member field to update." });
    }

    const [member] = await db
      .update(membersTable)
      .set(updateData)
      .where(and(
        eq(membersTable.id, id),
        sql`${membersTable.email} IS NOT DISTINCT FROM ${current.email}`,
        sql`${membersTable.phone} IS NOT DISTINCT FROM ${current.phone}`,
      ))
      .returning();

    if (!member) return res.status(409).json({ error: "Member contact information changed. Reload the record and try again." });

    if (normalizeUsPhone(current.phone) !== normalizeUsPhone(member.phone)) {
      clearPublicMemberAccessCookie(res);
    }
    res.json(member);
  } catch (err: unknown) {
    const pg = pgErrorInfo(err);
    if (pg?.code === "23505") {
      return res.status(409).json({ error: "A member already uses this phone number. Use the existing member record or ask an administrator to resolve the duplicate." });
    }
    req.log.error({ err }, "Member update failed");
    res.status(500).json({ error: "Member update failed" });
  }
});

// PATCH /api/admin/members/:id/validate — mark member identity as verified
router.patch("/:id/validate", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });

    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "A same-origin request is required." });
    }
    if (!await requireVerifiedAdmin(req, res)) return;

    const {
      idCardTypeSeen,
      idCardNumberLast4,
      idCardIssuingAuthority,
      validationNotes,
    } = req.body as {
      idCardTypeSeen?: string;
      idCardNumberLast4?: string;
      idCardIssuingAuthority?: string;
      validationNotes?: string;
    };

    if (!idCardTypeSeen?.trim()) {
      return res.status(400).json({ error: "ID card type is required" });
    }

    const adminName =
      (req.headers["x-user-name"]  as string | undefined) ||
      (req.headers["x-user-email"] as string | undefined) ||
      "Admin";

    const [prev] = await db
      .select({ validationStatus: membersTable.validationStatus })
      .from(membersTable)
      .where(eq(membersTable.id, id))
      .limit(1);

    if (!prev) return res.status(404).json({ error: "Member not found" });

    const [member] = await db
      .update(membersTable)
      .set({
        validationStatus:       "Validated",
        validationDate:         sql`NOW()`,
        validatedByAdminName:   adminName,
        idCardTypeSeen:         idCardTypeSeen.trim(),
        idCardNumberLast4:      idCardNumberLast4?.trim() || null,
        idCardIssuingAuthority: idCardIssuingAuthority?.trim() || null,
        validationNotes:        validationNotes?.trim() || null,
      })
      .where(eq(membersTable.id, id))
      .returning();

    await writeAudit(req, {
      moduleName:    "Member Management",
      actionType:    "Edit",
      entityName:    member.name ?? `Member #${id}`,
      entityId:      id,
      previousValue: { validationStatus: prev.validationStatus },
      newValue: {
        validationStatus: "Validated",
        idCardTypeSeen:   idCardTypeSeen.trim(),
        verifiedBy:       adminName,
      },
    });

    res.json(member);
  } catch (err) {
    req.log.error({ err }, "Member validation failed");
    res.status(500).json({ error: "Member validation failed" });
  }
});

// PATCH /api/admin/members/:id/renew — start a current-calendar-year term and ensure its payment record
router.patch("/:id/renew", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });
    if (!await authorizeMemberMutation(req, res, id)) return;

    const {
      amountDue,
      amountPaid,
      paymentStatus,
      paymentMethod,
      receiptId,
      paymentDate,
      notes,
    } = req.body as {
      amountDue?:     number;
      amountPaid?:    number;
      paymentStatus?: "Paid" | "Pending" | "Overdue";
      paymentMethod?: string;
      receiptId?:     string;
      paymentDate?:   string;
      notes?:         string;
    };
    const verifiedAdmin = await getVerifiedAdmin(req);
    if (!verifiedAdmin &&
        [amountPaid, amountDue, paymentStatus, paymentMethod, receiptId, notes, paymentDate]
          .some(value => value !== undefined)) {
      return res.status(403).json({ error: "Only an administrator can update membership payment details." });
    }

    const curYear = templeYear();

    // Read configured membership fee from portal settings for default amountDue
    const [mfRow] = await db
      .select({ value: portalSettingsTable.value })
      .from(portalSettingsTable)
      .where(eq(portalSettingsTable.key, "stripe_membership_fee"))
      .limit(1);
    const configuredDue = configuredFee(mfRow?.value);
    if (configuredDue === null && amountDue === undefined) {
      return res.status(503).json({ error: "The annual membership fee is not configured. Please contact the administration." });
    }
    const defaultDue = configuredDue ?? 0;

    const [member] = await db
      .update(membersTable)
      .set({ createdAt: sql`NOW() AT TIME ZONE 'UTC'`, membershipYear: curYear })
      .where(eq(membersTable.id, id))
      .returning();

    if (!member) return res.status(404).json({ error: "Member not found" });

    const hasPaymentData = [amountPaid, amountDue, paymentStatus, paymentMethod, receiptId, notes, paymentDate]
      .some(v => v !== undefined);

    if (hasPaymentData) {
      // Full upsert when payment details are provided
      await db
        .insert(membershipPaymentsTable)
        .values({
          memberId:       id,
          membershipYear: curYear,
          amountDue:      String(amountDue ?? defaultDue),
          amountPaid:     String(amountPaid ?? 0),
          paymentStatus:  paymentStatus ?? "Pending",
          paymentMethod:  paymentMethod ?? null,
          receiptId:      receiptId ?? null,
          paymentDate:    paymentDate ?? null,
          notes:          notes ?? null,
        })
        .onConflictDoUpdate({
          target: [membershipPaymentsTable.memberId, membershipPaymentsTable.membershipYear],
          set: {
            amountDue:     String(amountDue ?? defaultDue),
            amountPaid:    String(amountPaid ?? 0),
            paymentStatus: paymentStatus ?? "Pending",
            paymentMethod: paymentMethod ?? null,
            receiptId:     receiptId ?? null,
            paymentDate:   paymentDate ?? null,
            notes:         notes ?? null,
            ...(paymentStatus === "Paid" ? { pendingReason: null } : {}),
          },
        });
      if (paymentStatus === "Paid") await extendMembershipThrough(db, id, curYear);
    } else {
      // No payment details — ensure a default Pending record exists for this year
      // (ON CONFLICT DO NOTHING preserves an existing Paid record unchanged)
      await db
        .insert(membershipPaymentsTable)
        .values({
          memberId:       id,
          membershipYear: curYear,
          amountDue:      String(defaultDue),
          amountPaid:     "0.00",
          paymentStatus:  "Pending",
          paymentMethod:  null,
          receiptId:      null,
          paymentDate:    null,
          notes:          "Created on membership renewal",
        })
        .onConflictDoNothing();
    }

    res.json(member);
  } catch (err) {
    req.log.error({ err }, "Member renew failed");
    res.status(500).json({ error: "Member renewal failed" });
  }
});

// GET /api/admin/members/:id/membership-payment — fetch current-year payment record
router.get("/:id/membership-payment", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });
    if (!await getVerifiedAdmin(req) && !await verifyPublicMemberAccess(req, id)) {
      return res.status(403).json({ error: "Verify member access before viewing membership payment details." });
    }

    const curYear = templeYear();
    const [payment] = await db
      .select()
      .from(membershipPaymentsTable)
      .where(and(eq(membershipPaymentsTable.memberId, id), eq(membershipPaymentsTable.membershipYear, curYear)))
      .limit(1);

    res.json(payment ?? null);
  } catch (err) {
    req.log.error({ err }, "Membership payment fetch failed");
    res.status(500).json({ error: "Failed to fetch membership payment" });
  }
});

// POST /api/admin/members/:id/membership-payment — upsert payment record for given year
router.post("/:id/membership-payment", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "A same-origin request is required." });
    if (!await requireVerifiedAdmin(req, res)) return;

    const {
      membershipYear,
      amountDue,
      amountPaid,
      paymentStatus,
      paymentMethod,
      receiptId,
      paymentDate,
      notes,
    } = req.body as {
      membershipYear?: number;
      amountDue?:     number;
      amountPaid?:    number;
      paymentStatus?: "Paid" | "Pending" | "Overdue";
      paymentMethod?: string | null;
      receiptId?:     string | null;
      paymentDate?:   string | null;
      notes?:         string | null;
    };

    const year = membershipYear ?? templeYear();
    const adminName =
      (req.headers["x-user-name"]  as string | undefined) ||
      (req.headers["x-user-email"] as string | undefined) ||
      "Admin";

    const [payment] = await db
      .insert(membershipPaymentsTable)
      .values({
        memberId:           id,
        membershipYear:     year,
        amountDue:          String(amountDue ?? 150),
        amountPaid:         String(amountPaid ?? 0),
        paymentStatus:      paymentStatus ?? "Pending",
        paymentMethod:      paymentMethod ?? null,
        receiptId:          receiptId ?? null,
        paymentDate:        paymentDate ?? null,
        notes:              notes ?? null,
        updatedByAdminName: adminName,
        updatedAt:          new Date(),
      })
      .onConflictDoUpdate({
        target: [membershipPaymentsTable.memberId, membershipPaymentsTable.membershipYear],
        set: {
          amountDue:          String(amountDue ?? 150),
          amountPaid:         String(amountPaid ?? 0),
          paymentStatus:      paymentStatus ?? "Pending",
          paymentMethod:      paymentMethod ?? null,
          receiptId:          receiptId ?? null,
          paymentDate:        paymentDate ?? null,
          notes:              notes ?? null,
          updatedByAdminName: adminName,
          updatedAt:          new Date(),
          ...(paymentStatus === "Paid" ? { pendingReason: null } : {}),
        },
      })
      .returning();
    // Paying a year (including next year, in advance) extends membership through its December 31.
    if (paymentStatus === "Paid") await extendMembershipThrough(db, id, year);

    await writeAudit(req, {
      moduleName: "Member Management",
      actionType: "Edit",
      entityName: `Member #${id}`,
      entityId:   id,
      previousValue: null,
      newValue: { membershipYear: year, paymentStatus, amountPaid },
    });

    res.json(payment);
  } catch (err) {
    req.log.error({ err }, "Membership payment upsert failed");
    res.status(500).json({ error: "Failed to save membership payment" });
  }
});

// PATCH /api/admin/members/:id — partial update (policyAgreed, membershipYear, address)
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });
    if (!await authorizeMemberMutation(req, res, id)) return;
    const { policyAgreed, membershipYear, address } = req.body as { policyAgreed?: boolean; membershipYear?: number; address?: string };
    const verifiedAdmin = await getVerifiedAdmin(req);
    if (!verifiedAdmin && (membershipYear !== undefined || (policyAgreed !== undefined && policyAgreed !== true))) {
      return res.status(403).json({ error: "Only an administrator can change the membership year or revoke policy agreement." });
    }
    const identity = verifiedAdmin ? null : getVerifiedPublicIdentity(req);
    if (!verifiedAdmin && !identity) {
      return res.status(403).json({ error: "Verify member access before changing this member record." });
    }

    const updateData: Record<string, unknown> = {};
    if (policyAgreed  !== undefined) updateData.policyAgreed  = policyAgreed;
    if (membershipYear !== undefined) updateData.membershipYear = membershipYear;
    if (address !== undefined) {
      if (!isCompleteAddress(address)) return res.status(400).json({ error: "A complete address with street, city, 2-letter state and ZIP is required." });
      updateData.address = address.trim();
    }
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "Provide a member field to update." });
    }

    const [member] = await db
      .update(membersTable)
      .set(updateData)
      .where(and(
        eq(membersTable.id, id),
        verifiedAdmin ? sql`TRUE` : sql`
          REGEXP_REPLACE(COALESCE(${membersTable.phone}, ''), '[^0-9]', '', 'g') = ${identity!.phone}
          AND LOWER(TRIM(COALESCE(${membersTable.email}, ''))) = ${identity!.email}
        `,
      ))
      .returning();

    if (!member) return res.status(409).json({ error: "Member access changed. Reload and verify again." });
    res.json(member);
  } catch (err) {
    req.log.error({ err }, "Member patch failed");
    res.status(500).json({ error: "Member update failed" });
  }
});

// DELETE /api/admin/members/:id — only allowed if no linked students
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "A same-origin request is required." });
    if (!await requireVerifiedAdmin(req, res)) return;

    const [{ linkedCount }] = await db
      .select({ linkedCount: count() })
      .from(studentsTable)
      .where(eq(studentsTable.memberId, id));

    if (Number(linkedCount) > 0) {
      return res.status(409).json({
        error: `Cannot delete — this member has ${linkedCount} linked student(s). Unlink or delete the students first.`,
      });
    }

    await db.delete(membersTable).where(eq(membersTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Member delete failed");
    res.status(500).json({ error: "Member delete failed" });
  }
});

// GET /api/admin/members/:id/students — fetch all students linked to a member
router.get("/:id/students", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });
    const verifiedAdmin = await getVerifiedAdmin(req);
    if (!verifiedAdmin && !await verifyPublicMemberAccess(req, id)) {
      return res.status(403).json({ error: "Verify member access before viewing linked students." });
    }

    const students = await db
      .select({
        id:              studentsTable.id,
        studentCode:     studentsTable.studentCode,
        name:            studentsTable.name,
        dob:             studentsTable.dob,
        grade:           studentsTable.grade,
        curriculumYear:  studentsTable.curriculumYear,
        motherName:      studentsTable.motherName,
        motherPhone:     studentsTable.motherPhone,
        motherEmail:     studentsTable.motherEmail,
        motherEmployer:  studentsTable.motherEmployer,
        fatherName:      studentsTable.fatherName,
        fatherPhone:     studentsTable.fatherPhone,
        fatherEmail:     studentsTable.fatherEmail,
        fatherEmployer:  studentsTable.fatherEmployer,
        address:         studentsTable.address,
        volunteerParent: studentsTable.volunteerParent,
        volunteerArea:   studentsTable.volunteerArea,
        primaryMemberRole: studentsTable.primaryMemberRole,
      })
      .from(studentsTable)
      .where(eq(studentsTable.memberId, id))
      .orderBy(asc(studentsTable.studentCode));

    res.json(students);
  } catch (err) {
    req.log.error({ err }, "Member students lookup failed");
    res.status(500).json({ error: "Failed to fetch students for member" });
  }
});

export default router;
