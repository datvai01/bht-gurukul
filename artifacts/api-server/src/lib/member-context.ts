import { createHmac, timingSafeEqual } from "node:crypto";
// @ts-expect-error Node's strip-types test runner requires explicit TS extensions.
import { normalizeMemberPhone } from "./member-phone.ts";

export const MEMBER_CONTEXT_TOKEN_TTL_SECONDS = 2 * 60 * 60;
// A verified registration session lasts 60 minutes, long enough to complete the student form.
export const NEW_MEMBER_CONTEXT_TOKEN_TTL_SECONDS = 60 * 60;
export const VERIFIED_MEMBER_CONTEXT_TOKEN_TTL_SECONDS = 60 * 60;

export type MemberContextPurpose = "lookup" | "new-member" | "verified-member";

export type PrimaryMemberRole = "mother" | "father";

export interface MemberContactDetails {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  employer?: string | null;
}

export interface SubmittedParentContacts {
  motherName?: string;
  motherPhone?: string;
  motherEmail?: string;
  motherEmployer?: string;
  fatherName?: string;
  fatherPhone?: string;
  fatherEmail?: string;
  fatherEmployer?: string;
}

export type PrimaryParentFields = Partial<Record<
  keyof SubmittedParentContacts,
  string | null
>>;

function signingKey(secret: string): Buffer {
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  // Version the signing domain to revoke previously issued untyped phone-lookup
  // tokens, which were indistinguishable from registration-authorizing tokens.
  return createHmac("sha256", secret).update("gurukul-member-context-v2").digest();
}

export function createMemberContextToken(
  memberId: number,
  secret: string,
  now = Date.now(),
  purpose?: MemberContextPurpose,
): string {
  const ttlSeconds = purpose === "new-member"
    ? NEW_MEMBER_CONTEXT_TOKEN_TTL_SECONDS
    : purpose === "verified-member"
      ? VERIFIED_MEMBER_CONTEXT_TOKEN_TTL_SECONDS
    : MEMBER_CONTEXT_TOKEN_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({
    memberId,
    expiresAt: Math.floor(now / 1000) + ttlSeconds,
    ...(purpose ? { purpose } : {}),
  })).toString("base64url");
  const signature = createHmac("sha256", signingKey(secret)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function createNewMemberContextToken(
  memberId: number,
  secret: string,
  now = Date.now(),
): string {
  return createMemberContextToken(memberId, secret, now, "new-member");
}

export function createLookupMemberContextToken(
  memberId: number,
  secret: string,
  now = Date.now(),
): string {
  return createMemberContextToken(memberId, secret, now, "lookup");
}

export function createVerifiedMemberContextToken(
  memberId: number,
  secret: string,
  now = Date.now(),
): string {
  return createMemberContextToken(memberId, secret, now, "verified-member");
}

function verifyContextToken(
  token: unknown,
  expectedMemberId: number,
  secret: string,
  now = Date.now(),
  expectedPurpose?: MemberContextPurpose,
): boolean {
  if (typeof token !== "string" || !token || !secret || !Number.isInteger(expectedMemberId)) return false;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length > 0) return false;

  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  const expectedSignature = createHmac("sha256", signingKey(secret)).update(payload).digest();
  if (suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return false;
    const claims = parsed as { memberId?: unknown; expiresAt?: unknown; purpose?: unknown };
    return claims.memberId === expectedMemberId &&
      typeof claims.expiresAt === "number" &&
      Number.isInteger(claims.expiresAt) &&
      claims.expiresAt > Math.floor(now / 1000) &&
      (expectedPurpose !== undefined
        ? claims.purpose === expectedPurpose
        : claims.purpose === undefined);
  } catch {
    return false;
  }
}

export function verifyMemberContextToken(
  token: unknown,
  expectedMemberId: number,
  secret: string,
  now = Date.now(),
): boolean {
  return verifyContextToken(token, expectedMemberId, secret, now);
}

export function verifyNewMemberContextToken(
  token: unknown,
  memberId: number,
  secret: string,
  now = Date.now(),
): boolean {
  return verifyContextToken(token, memberId, secret, now, "new-member");
}

export function verifyVerifiedMemberContextToken(
  token: unknown,
  memberId: number,
  secret: string,
  now = Date.now(),
): boolean {
  return verifyContextToken(token, memberId, secret, now, "verified-member");
}

function clean(value?: string | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolves the Primary Member's contact fields for a student registration.
 * Details are pre-filled from the verified member record, and the parent may edit them on
 * the registration form: a submitted value is used when present (phone and email must be
 * valid), and a blank field falls back to the member record. The membership record itself
 * is never changed here.
 */
export function resolvePrimaryParentContacts(
  role: PrimaryMemberRole,
  submitted: SubmittedParentContacts,
  member: MemberContactDetails,
):
  | { ok: true; fields: PrimaryParentFields }
  | { ok: false; field: "name" | "phone" | "email" } {
  const submittedForRole = {
    name: clean(submitted[`${role}Name`]),
    phone: clean(submitted[`${role}Phone`]),
    email: clean(submitted[`${role}Email`]),
    employer: clean(submitted[`${role}Employer`]),
  };
  const canonical = {
    name: clean(member.name),
    phone: clean(member.phone),
    email: clean(member.email),
    employer: clean(member.employer),
  };

  let phone = canonical.phone;
  if (submittedForRole.phone) {
    phone = normalizeMemberPhone(submittedForRole.phone);
    if (!phone) return { ok: false, field: "phone" };
  }
  let email = canonical.email;
  if (submittedForRole.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedForRole.email)) return { ok: false, field: "email" };
    email = submittedForRole.email.toLowerCase();
  }
  return {
    ok: true,
    fields: {
      [`${role}Name`]: submittedForRole.name ?? canonical.name,
      [`${role}Phone`]: phone,
      [`${role}Email`]: email,
      [`${role}Employer`]: submittedForRole.employer ?? canonical.employer,
    },
  };
}