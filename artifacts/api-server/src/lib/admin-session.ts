import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { adminUsersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

export interface VerifiedAdmin {
  id: number;
  name: string;
  role: "admin" | "super_admin";
}

function sessionSecret(): string | null {
  return process.env.SESSION_SECRET || null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function cookieValue(req: Request): string | null {
  const cookies = req.headers.cookie?.split(";") ?? [];
  const entry = cookies.map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`));
  return entry ? entry.slice(COOKIE_NAME.length + 1) : null;
}

export function setAdminSessionCookie(res: Response, adminId: number): void {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const payload = Buffer.from(JSON.stringify({
    adminId,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  const token = `${payload}.${signature(payload, secret)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`);
}

export function clearAdminSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

export function isSameOriginRequest(req: Request): boolean {
  const originHeader = req.get("origin");
  const refererHeader = req.get("referer");
  const source = originHeader || refererHeader;
  const host = req.get("host");
  if (!source || !host) return false;

  try {
    const sourceUrl = new URL(source);
    const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestProtocol = forwardedProto || req.protocol;
    return sourceUrl.host === host && sourceUrl.protocol === `${requestProtocol}:`;
  } catch {
    return false;
  }
}

export async function getVerifiedAdmin(req: Request): Promise<VerifiedAdmin | null> {
  const secret = sessionSecret();
  const token = cookieValue(req);
  if (!secret || !token) return null;

  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  const expectedSignature = signature(payload, secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) return null;

  let claims: { adminId?: unknown; expiresAt?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    !Number.isSafeInteger(claims.adminId) ||
    typeof claims.expiresAt !== "number" ||
    claims.expiresAt <= Math.floor(Date.now() / 1000)
  ) return null;

  const [admin] = await db
    .select({
      id: adminUsersTable.id,
      name: adminUsersTable.name,
      role: adminUsersTable.role,
      status: adminUsersTable.status,
    })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, claims.adminId as number))
    .limit(1);

  if (!admin || admin.status !== "active" || (admin.role !== "admin" && admin.role !== "super_admin")) {
    return null;
  }
  return { id: admin.id, name: admin.name, role: admin.role };
}