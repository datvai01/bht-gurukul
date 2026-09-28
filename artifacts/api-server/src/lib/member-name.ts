import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type MemberNameParts = { firstName: string; lastName: string; name: string };

function clean(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
}

// Members store first and last name separately; `name` is the derived full name.
// Accepts firstName/lastName, or a legacy single `name` split at its first space.
export function memberNameParts(input: { firstName?: unknown; lastName?: unknown; name?: unknown }): MemberNameParts | null {
  let firstName = clean(input.firstName);
  let lastName = clean(input.lastName);
  if (!firstName && !lastName) {
    const full = clean(input.name);
    const space = full.indexOf(" ");
    firstName = space === -1 ? full : full.slice(0, space);
    lastName = space === -1 ? "" : full.slice(space + 1);
  }
  if (!firstName || !lastName) return null;
  return { firstName, lastName, name: `${firstName} ${lastName}` };
}

export function isValidMemberNamePart(value: string): boolean {
  return value.length >= 1 && value.length <= 60 && !/\d/.test(value) && /^[\p{L}\s\-'.]+$/u.test(value);
}

// One-time, idempotent split of older single-field member names into first/last name.
export async function backfillMemberNameParts(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE members SET
      first_name = split_part(regexp_replace(trim(name), '\\s+', ' ', 'g'), ' ', 1),
      last_name = NULLIF(substring(regexp_replace(trim(name), '\\s+', ' ', 'g') FROM '^\\S+\\s+(.*)$'), '')
    WHERE first_name IS NULL AND last_name IS NULL AND name IS NOT NULL AND trim(name) <> ''
  `);
  return result.rowCount ?? 0;
}
