/**
 * Return the canonical ten-digit representation of a valid US phone number.
 * Formatting punctuation is ignored; invalid area/exchange prefixes,
 * repeated-digit placeholders, international and incomplete numbers are
 * rejected rather than silently truncated.
 */
export function normalizeUsPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  if (/^(.)\1{9}$/.test(digits)) return null;
  return digits;
}

/**
 * Canonical digits-only form of a member phone: a US number as ten digits
 * (an optional +1 country code is dropped), or an India number as "91"
 * followed by its ten-digit mobile number. India numbers must be entered with
 * their +91 country code; a bare ten-digit number is always read as US.
 * Stored and compared as digits so a US and an India number never collide.
 */
export function normalizeMemberPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (/^\+?\s*91/.test(trimmed) && /^91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^\+?\s*1/.test(trimmed) && digits.length === 11) return normalizeUsPhone(digits.slice(1));
  return normalizeUsPhone(trimmed);
}

export function isValidMemberEmail(value: unknown): value is string {
  return typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}