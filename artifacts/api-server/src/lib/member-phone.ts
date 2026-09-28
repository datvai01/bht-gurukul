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

export function isValidMemberEmail(value: unknown): value is string {
  return typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}