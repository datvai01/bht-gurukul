/**
 * Second step of admin sign-in: after the password or PIN is accepted, a 6-digit code is
 * emailed to the admin and must be entered before the admin session cookie is issued.
 *
 * Challenges are stored in member_access_challenges under the key "admin-login:<adminId>"
 * (the table is a generic one-time-code store). The browser that passed step one holds an
 * HttpOnly cookie with a random token; the code only works together with that token.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { memberAccessChallengesTable } from "@workspace/db/schema";
import { sendVerificationEmail } from "./verification-email";

const COOKIE_NAME = "admin_login_challenge";
export const ADMIN_CODE_TTL_SECONDS = 10 * 60;
const RESEND_INTERVAL_MS = 60 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

type Failure = { ok: false; status: number; error: string };

function challengeKey(adminId: number): string {
  return `admin-login:${adminId}`;
}

function hmac(secret: string, purpose: string, ...parts: string[]): string {
  const mac = createHmac("sha256", secret).update(purpose);
  for (const part of parts) mac.update("\0").update(part);
  return mac.digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieSuffix(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

function readCookie(req: Request): { adminId: number; token: string } | null {
  const entry = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE_NAME}=`));
  const match = entry?.slice(COOKIE_NAME.length + 1).match(/^(\d{1,9})\.([A-Za-z0-9_-]{40,})$/);
  return match ? { adminId: Number(match[1]), token: match[2] } : null;
}

export function clearAdminLoginChallengeCookie(res: Response): void {
  res.append("Set-Cookie", `${COOKIE_NAME}=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0${cookieSuffix()}`);
}

/** "vaibhav@example.com" → "va*****@example.com", so the admin knows which inbox to check. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/** Creates a new code for the admin, emails it, and sets the challenge cookie. */
export async function startAdminLoginChallenge(
  res: Response,
  adminId: number,
  email: string,
): Promise<{ ok: true } | Failure> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return { ok: false, status: 500, error: "Admin sign-in is unavailable because server configuration is incomplete." };

  const key = challengeKey(adminId);
  const token = randomBytes(32).toString("base64url");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const now = new Date();

  const reserved = await db.transaction(async tx => {
    const [existing] = await tx.select().from(memberAccessChallengesTable)
      .where(eq(memberAccessChallengesTable.phoneHash, key)).for("update").limit(1);
    const windowOpen = existing && now.getTime() - existing.requestWindowStartedAt.getTime() < SEND_WINDOW_MS;
    if (existing && now.getTime() - existing.lastSentAt.getTime() < RESEND_INTERVAL_MS) {
      return "too-soon" as const;
    }
    if (windowOpen && existing.resendCount >= MAX_SENDS_PER_WINDOW) return "limit" as const;
    const values = {
      sessionHash: hmac(secret, "gurukul-admin-login-session-v1", key, token),
      codeHash: hmac(secret, "gurukul-admin-login-code-v1", key, token, code),
      expiresAt: new Date(now.getTime() + ADMIN_CODE_TTL_SECONDS * 1000),
      attempts: 0,
      lastSentAt: now,
      requestWindowStartedAt: windowOpen ? existing.requestWindowStartedAt : now,
      resendCount: windowOpen ? existing.resendCount + 1 : 1,
    };
    if (existing) {
      await tx.update(memberAccessChallengesTable).set(values).where(eq(memberAccessChallengesTable.phoneHash, key));
    } else {
      await tx.insert(memberAccessChallengesTable).values({ phoneHash: key, ...values });
    }
    return "ok" as const;
  });
  if (reserved === "too-soon") {
    return { ok: false, status: 429, error: "A code was just sent. Please wait a minute before requesting another." };
  }
  if (reserved === "limit") {
    return { ok: false, status: 429, error: "Too many sign-in codes requested. Please try again in an hour." };
  }

  const delivery = await sendVerificationEmail(email, code, "admin login");
  if (!delivery.ok) {
    await db.delete(memberAccessChallengesTable).where(eq(memberAccessChallengesTable.phoneHash, key));
    return { ok: false, status: 503, error: "The sign-in code could not be emailed. Please try again later." };
  }
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${adminId}.${token}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_CODE_TTL_SECONDS}${cookieSuffix()}`,
  );
  return { ok: true };
}

/** Checks the emailed code. On success the challenge is consumed and the admin's id returned. */
export async function verifyAdminLoginChallenge(
  req: Request,
  res: Response,
  code: unknown,
): Promise<{ ok: true; adminId: number } | Failure> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return { ok: false, status: 500, error: "Admin sign-in is unavailable because server configuration is incomplete." };
  const restart: Failure = { ok: false, status: 401, error: "Your sign-in code has expired. Please sign in again." };

  const cookie = readCookie(req);
  if (!cookie) return restart;
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
    return { ok: false, status: 400, error: "Enter the 6-digit code from your email." };
  }
  const key = challengeKey(cookie.adminId);

  const result = await db.transaction(async tx => {
    const [challenge] = await tx.select().from(memberAccessChallengesTable)
      .where(eq(memberAccessChallengesTable.phoneHash, key)).for("update").limit(1);
    // A missing, expired or newer challenge (sign-in started again elsewhere) means start over.
    if (
      !challenge ||
      challenge.expiresAt <= new Date() ||
      !sameHex(challenge.sessionHash, hmac(secret, "gurukul-admin-login-session-v1", key, cookie.token))
    ) return restart;

    if (sameHex(challenge.codeHash, hmac(secret, "gurukul-admin-login-code-v1", key, cookie.token, code.trim()))) {
      await tx.delete(memberAccessChallengesTable).where(eq(memberAccessChallengesTable.phoneHash, key));
      return { ok: true as const, adminId: cookie.adminId };
    }

    const attempts = challenge.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // Keep the row so the hourly send limit still applies, but make the code unusable.
      await tx.update(memberAccessChallengesTable)
        .set({ attempts, expiresAt: new Date(0) })
        .where(eq(memberAccessChallengesTable.phoneHash, key));
      return { ok: false as const, status: 429, error: "Too many incorrect codes. Please sign in again." };
    }
    await tx.update(memberAccessChallengesTable).set({ attempts }).where(eq(memberAccessChallengesTable.phoneHash, key));
    const remaining = MAX_ATTEMPTS - attempts;
    return { ok: false as const, status: 401, error: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` };
  });

  if (result.ok || result.status === 429 || result === restart) clearAdminLoginChallengeCookie(res);
  return result;
}
