/**
 * Sends one email through the provider chosen by MEMBER_EMAIL_PROVIDER: smtp, gmail, resend, or
 * console (local development only: the message is logged instead of sent). Every message goes to
 * a single recipient, so no recipient ever sees another's address.
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import nodemailer from "nodemailer";
import { logger } from "./logger";
import { isValidMemberEmail } from "./member-phone";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
};

export type EmailResult = { ok: true } | { ok: false; error: string };

export function emailProvider(): string | undefined {
  return process.env.MEMBER_EMAIL_PROVIDER?.trim().toLowerCase();
}

export function isConsoleEmailProvider(): boolean {
  return emailProvider() === "console" && process.env.NODE_ENV !== "production";
}

function normalizeSender(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return isValidMemberEmail(email) ? email : null;
}

// RFC 2047 encoding so subjects and names with non-ASCII characters survive the raw MIME path.
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

let smtpTransport: nodemailer.Transporter | null = null;
let smtpTransportKey = "";

function smtpSettings() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !user || !pass || !from) return null;
  return { host, user, pass, from, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true" };
}

// One pooled connection reused across messages (bulk sends would otherwise reconnect per email).
function getSmtpTransport(settings: NonNullable<ReturnType<typeof smtpSettings>>): nodemailer.Transporter {
  const key = JSON.stringify(settings);
  if (!smtpTransport || smtpTransportKey !== key) {
    smtpTransport = nodemailer.createTransport({
      host: settings.host, port: settings.port, secure: settings.secure,
      auth: { user: settings.user, pass: settings.pass },
      pool: true, maxConnections: 3,
    });
    smtpTransportKey = key;
  }
  return smtpTransport;
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300) || "Send failed";
}

export async function sendEmail(message: OutgoingEmail): Promise<EmailResult> {
  const provider = emailProvider();
  if (provider === "console") {
    if (process.env.NODE_ENV === "production") return { ok: false, error: "The console email provider is disabled in production." };
    // Addresses on the reserved .invalid domain can never be delivered; failing them here lets
    // developers exercise partial-failure handling locally.
    if (message.to.endsWith(".invalid")) return { ok: false, error: "Simulated delivery failure (.invalid address)" };
    logger.info({ to: message.to, subject: message.subject }, "DEV: email (not sent)");
    return { ok: true };
  }

  if (provider === "gmail") {
    const sender = normalizeSender(process.env.GMAIL_FROM_EMAIL);
    if (!sender) return { ok: false, error: "GMAIL_FROM_EMAIL is not configured." };
    const boundary = `gurukul-${Date.now().toString(36)}`;
    const body = message.html
      ? [
        `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
        `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "", message.text,
        `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", message.html,
        `--${boundary}--`,
      ]
      : ["Content-Type: text/plain; charset=UTF-8", "", message.text];
    const raw = Buffer.from([
      `From: ${encodeHeader(message.fromName ?? "Gurukul Registration")} <${sender}>`,
      `To: ${message.to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      "MIME-Version: 1.0",
      ...body,
    ].join("\r\n"), "utf8").toString("base64url");
    try {
      const response = await new ReplitConnectors().proxy(
        "google-mail", "/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        },
      );
      if (!response.ok) return { ok: false, error: `Gmail returned ${response.status}` };
      const result = await response.json() as { id?: unknown };
      return typeof result?.id === "string" && result.id.length > 0
        ? { ok: true } : { ok: false, error: "Gmail did not confirm the message." };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  if (provider && provider !== "smtp" && provider !== "resend") {
    return { ok: false, error: `Unknown email provider "${provider}".` };
  }
  const smtp = provider === "resend" ? null : smtpSettings();
  if (smtp) {
    try {
      await getSmtpTransport(smtp).sendMail({
        from: message.fromName && !smtp.from.includes("<") ? { name: message.fromName, address: smtp.from } : smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }
  if (provider === "smtp") return { ok: false, error: "SMTP settings are incomplete." };

  const resendFrom = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendFrom) return { ok: false, error: "No email provider is configured." };
  try {
    const response = await new ReplitConnectors().proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: resendFrom,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!response.ok) return { ok: false, error: `Resend returned ${response.status}` };
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      return { ok: false, error: "Resend returned an unreadable response." };
    }
    return result && typeof result === "object" &&
      "id" in result && typeof (result as { id?: unknown }).id === "string" &&
      Boolean((result as { id: string }).id.trim())
      ? { ok: true }
      : { ok: false, error: "Resend did not confirm the message." };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}
