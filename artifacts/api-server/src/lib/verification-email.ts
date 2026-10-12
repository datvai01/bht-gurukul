/**
 * Sends a one-time verification code by email, using the provider chosen by MEMBER_EMAIL_PROVIDER
 * (smtp, gmail, resend, or console for local development). Shared by member registration and
 * admin login.
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import nodemailer from "nodemailer";
import { logger } from "./logger";
import { isValidMemberEmail } from "./member-phone";

export type VerificationPurpose = "member" | "admin login";

const PURPOSES: Record<VerificationPurpose, { subject: string; lead: string }> = {
  "member":      { subject: "Your Gurukul verification code", lead: "Your verification code is" },
  "admin login": { subject: "Your Gurukul admin sign-in code", lead: "Your Gurukul admin sign-in code is" },
};

function normalizeSender(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return isValidMemberEmail(email) ? email : null;
}

export type EmailSendResult = { ok: true } | { ok: false };

export async function sendVerificationEmail(
  email: string,
  code: string,
  purpose: VerificationPurpose = "member",
): Promise<EmailSendResult> {
  const { subject, lead } = PURPOSES[purpose];
  const text = `${lead} ${code}. It expires soon. If you did not request it, ignore this email.`;
  const provider = process.env.MEMBER_EMAIL_PROVIDER?.trim().toLowerCase();
  // Local development only: print the code to the API server log instead of emailing it.
  if (provider === "console" && process.env.NODE_ENV !== "production") {
    logger.warn({ email, code }, `DEV: ${purpose} verification code (not emailed)`);
    return { ok: true };
  }
  if (provider === "gmail") {
    const sender = normalizeSender(process.env.GMAIL_FROM_EMAIL);
    if (!sender) return { ok: false };
    const raw = Buffer.from([
      `From: Gurukul Registration <${sender}>`,
      `To: ${email}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      text,
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
        from, to: email, subject,
        text: text,
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
        subject,
        text: text,
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
