import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
// Keep the identity proof module runnable without loading the DB schema under
// Node's strip-types test runner, which does not support directory imports.
// @ts-expect-error Node's strip-types test runner requires explicit TS extensions.
import { isValidMemberEmail, normalizeUsPhone } from "./member-phone.ts";

const COOKIE_NAME = "public_member_access";
export const PUBLIC_MEMBER_ACCESS_TTL_SECONDS = 15 * 60;

function secret(): string | null {
  return process.env.SESSION_SECRET || null;
}

function signature(payload: string, key: string): string {
  return createHmac("sha256", key)
    .update("gurukul-public-member-access-v3")
    .update(payload)
    .digest("base64url");
}

function getCookie(req: Request): string | null {
  const entry = req.headers.cookie
    ?.split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(`${COOKIE_NAME}=`));
  return entry ? entry.slice(COOKIE_NAME.length + 1) : null;
}

export function clearPublicMemberAccessCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

export type PublicMemberIdentity = {
  phone: string;
  email: string;
  mode: "existing" | "new";
  memberId?: number;
};

export function setPublicMemberAccessCookie(
  res: Response,
  phone: string,
  email: string,
  mode: "existing" | "new",
  memberId?: number,
): void {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not configured");
  if (memberId !== undefined && (!Number.isSafeInteger(memberId) || memberId <= 0)) {
    throw new Error("A valid member ID is required to bind a member access proof");
  }
  const payload = Buffer.from(JSON.stringify({
    phone,
    email,
    mode,
    ...(memberId === undefined ? {} : { memberId }),
    expiresAt: Math.floor(Date.now() / 1000) + PUBLIC_MEMBER_ACCESS_TTL_SECONDS,
  })).toString("base64url");
  const token = `${payload}.${signature(payload, key)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${PUBLIC_MEMBER_ACCESS_TTL_SECONDS}${secure}`,
  );
}

export function getVerifiedPublicIdentity(req: Request): PublicMemberIdentity | null {
  const key = secret();
  const token = getCookie(req);
  if (!key || !token) return null;

  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload, key));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const claims: {
      phone?: unknown;
      email?: unknown;
      mode?: unknown;
      memberId?: unknown;
      expiresAt?: unknown;
    } =
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const phone = normalizeUsPhone(claims.phone);
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    const memberIdValid = claims.memberId === undefined ||
      (Number.isSafeInteger(claims.memberId) && (claims.memberId as number) > 0);
    return phone && claims.phone === phone && isValidMemberEmail(email) && claims.email === email &&
      (claims.mode === "existing" || claims.mode === "new") &&
      memberIdValid &&
      Number.isSafeInteger(claims.expiresAt) &&
      (claims.expiresAt as number) > Math.floor(Date.now() / 1000)
      ? {
          phone,
          email,
          mode: claims.mode,
          ...(claims.memberId === undefined ? {} : { memberId: claims.memberId as number }),
        }
      : null;
  } catch {
    return null;
  }
}

export function getVerifiedPublicPhone(req: Request): string | null {
  return getVerifiedPublicIdentity(req)?.phone ?? null;
}

export async function verifyPublicMemberAccess(req: Request, memberId: number): Promise<boolean> {
  if (!Number.isSafeInteger(memberId) || memberId <= 0) return false;
  const identity = getVerifiedPublicIdentity(req);
  if (!identity) return false;
  if (identity.memberId !== undefined && identity.memberId !== memberId) return false;
  const [{ db }, { membersTable }, { eq }] = await Promise.all([
    import("@workspace/db"),
    import("@workspace/db/schema"),
    import("drizzle-orm"),
  ]);
  const [member] = await db.select({ phone: membersTable.phone, email: membersTable.email })
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  return Boolean(member &&
    normalizeUsPhone(member.phone) === identity.phone &&
    member.email?.trim().toLowerCase() === identity.email);
}