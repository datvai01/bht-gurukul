import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const COOKIE_NAME = "member_otp_session";

function getCookie(req: Request): string | null {
  const entry = req.headers.cookie
    ?.split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(`${COOKIE_NAME}=`));
  return entry ? entry.slice(COOKIE_NAME.length + 1) : null;
}

export function hashMemberOtpSession(phoneHash: string, token: string, secret: string): string {
  return createHmac("sha256", secret)
    .update("gurukul-member-otp-session-v1")
    .update(phoneHash)
    .update(token)
    .digest("hex");
}

export function matchesMemberOtpSession(
  req: Request,
  phoneHash: string,
  expectedHash: string,
  secret: string,
): boolean {
  const token = getCookie(req);
  if (!token || !/^[A-Za-z0-9_-]{40,}$/.test(token)) return false;
  const expected = Buffer.from(expectedHash, "hex");
  const supplied = Buffer.from(hashMemberOtpSession(phoneHash, token, secret), "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function setMemberOtpSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`,
  );
}

export function clearMemberOtpSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}