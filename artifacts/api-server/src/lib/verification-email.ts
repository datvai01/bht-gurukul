/**
 * Sends a one-time verification code by email (member registration and admin sign-in), through
 * the shared sender in ./email.
 */
import { logger } from "./logger";
import { isConsoleEmailProvider, sendEmail } from "./email";

export type VerificationPurpose = "member" | "admin login";

const PURPOSES: Record<VerificationPurpose, { subject: string; lead: string }> = {
  "member":      { subject: "Your Gurukul verification code", lead: "Your verification code is" },
  "admin login": { subject: "Your Gurukul admin sign-in code", lead: "Your Gurukul admin sign-in code is" },
};

export type EmailSendResult = { ok: true } | { ok: false };

export async function sendVerificationEmail(
  email: string,
  code: string,
  purpose: VerificationPurpose = "member",
): Promise<EmailSendResult> {
  const { subject, lead } = PURPOSES[purpose];
  // Local development only: print the code to the API server log instead of emailing it.
  if (isConsoleEmailProvider()) {
    logger.warn({ email, code }, `DEV: ${purpose} verification code (not emailed)`);
    return { ok: true };
  }
  const result = await sendEmail({
    to: email,
    subject,
    text: `${lead} ${code}. It expires soon. If you did not request it, ignore this email.`,
  });
  return result.ok ? { ok: true } : { ok: false };
}
