import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { membersTable, studentsTable } from "@workspace/db/schema";
import { isNull, inArray, sql, eq } from "drizzle-orm";
import { isValidMemberEmail, normalizeUsPhone } from "../../lib/member-phone";
import { pgErrorInfo } from "../../lib/pg-error";

const router: IRouter = Router();

// POST /api/admin/backfill-members
// One-time idempotent backfill: creates a members row for every student whose
// member_id is still NULL when a valid parent phone and email are available.
// Siblings who share a normalized phone are linked to the SAME member record.
// Safe to call multiple times — already-linked students are left untouched.
router.post("/members", async (req, res) => {
  try {
    // ── 1. Fetch all unlinked students ──
    const unlinked = await db
      .select({
        id:           studentsTable.id,
        fatherName:   studentsTable.fatherName,
        fatherPhone:  studentsTable.fatherPhone,
        fatherEmail:  studentsTable.fatherEmail,
        motherName:   studentsTable.motherName,
        motherPhone:  studentsTable.motherPhone,
        motherEmail:  studentsTable.motherEmail,
      })
      .from(studentsTable)
      .where(
        isNull(studentsTable.memberId)
      );

    if (unlinked.length === 0) {
      return res.json({ created: 0, linked: 0, reusedExisting: 0, skippedMissingPhone: 0, skippedMissingEmail: 0, skippedAmbiguous: 0, message: "Nothing to backfill." });
    }

    // ── 2. Group students by normalized phone (father first, mother fallback) ──
    type Group = {
      normalizedPhone: string;
      name:            string | null;
      email:           string | null;
      studentIds:      number[];
    };

    const phoneMap = new Map<string, Group>();
    const noPhoneStudentIds: number[] = [];

    for (const s of unlinked) {
      const fatherPhone = normalizeUsPhone(s.fatherPhone);
      const motherPhone = normalizeUsPhone(s.motherPhone);
      const usesFather = Boolean(fatherPhone);
      const normalizedPhone = fatherPhone ?? motherPhone;
      if (!normalizedPhone) {
        noPhoneStudentIds.push(s.id);
        continue;
      }

      if (!phoneMap.has(normalizedPhone)) {
        phoneMap.set(normalizedPhone, {
          normalizedPhone,
          name:       (usesFather ? s.fatherName : s.motherName) || null,
          email:      null,
          studentIds: [],
        });
      }
      const group = phoneMap.get(normalizedPhone)!;
      const parentEmail = usesFather ? s.fatherEmail : s.motherEmail;
      const parentName = usesFather ? s.fatherName : s.motherName;
      if (!group.email && isValidMemberEmail(parentEmail)) group.email = parentEmail.trim();
      if (!group.name && parentName) group.name = parentName;
      group.studentIds.push(s.id);
    }

    let created = 0;
    let linked  = 0;
    let reusedExisting = 0;
    let skippedMissingEmail = 0;
    let skippedAmbiguous = 0;
    const report: { action: string; studentIds: number[] }[] = [];

    // ── 3. For each unique phone, find-or-create a member then link students ──
    for (const group of phoneMap.values()) {
      if (!group.email) {
        skippedMissingEmail += group.studentIds.length;
        report.push({ action: "skipped: valid email is missing for this phone's parent", studentIds: group.studentIds });
        continue;
      }

      // Check whether a member with this phone already exists
      const matches = await db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(
          sql`regexp_replace(${membersTable.phone}, '[^0-9]', '', 'g') = ${group.normalizedPhone}`
        )
        .limit(2);

      if (matches.length > 1) {
        skippedAmbiguous += group.studentIds.length;
        report.push({ action: "skipped: multiple member records match this phone; administrator resolution required", studentIds: group.studentIds });
        continue;
      }

      let memberId: number;

      if (matches[0]) {
        memberId = matches[0].id;
        reusedExisting++;
        report.push({ action: "existing member reused", studentIds: group.studentIds });
      } else {
        try {
          const [newMember] = await db
            .insert(membersTable)
            .values({
              name:             group.name,
              email:            group.email,
              phone:            group.normalizedPhone,
              isExistingMember: true,
              policyAgreed:     false,
            })
            .returning({ id: membersTable.id });

          memberId = newMember.id;
          created++;
          report.push({ action: "created", studentIds: group.studentIds });
        } catch (err) {
          if (pgErrorInfo(err)?.code !== "23505") throw err;
          // Another backfill/request may have inserted the same normalized
          // phone after our check. Re-read; never choose an arbitrary match.
          const racedMatches = await db
            .select({ id: membersTable.id })
            .from(membersTable)
            .where(sql`regexp_replace(${membersTable.phone}, '[^0-9]', '', 'g') = ${group.normalizedPhone}`)
            .limit(2);
          if (racedMatches.length > 1) {
            skippedAmbiguous += group.studentIds.length;
            report.push({ action: "skipped: multiple member records match this phone; administrator resolution required", studentIds: group.studentIds });
            continue;
          }
          if (!racedMatches[0]) throw err;
          memberId = racedMatches[0].id;
          reusedExisting++;
          report.push({ action: "existing member reused after concurrent creation", studentIds: group.studentIds });
        }
      }

      // Link all students in this group to the member
      await db
        .update(studentsTable)
        .set({ memberId })
        .where(inArray(studentsTable.id, group.studentIds));

      linked += group.studentIds.length;
    }

    return res.json({
      created,
      linked,
      reusedExisting,
      skippedMissingPhone: noPhoneStudentIds.length,
      skippedMissingEmail,
      skippedAmbiguous,
      totalStudentsFixed: linked,
      detail: report,
    });
  } catch (err) {
    req.log.error({ err }, "Backfill members failed");
    res.status(500).json({ error: "Backfill failed" });
  }
});

// POST /api/admin/backfill/schema-migrate
// Idempotent DDL migration: adds member_type column + indexes if not present.
// Uses the existing DB connection pool so it works even when push-force can't connect.
router.post("/schema-migrate", async (req, res) => {
  try {
    const steps: string[] = [];

    // 1. Add member_type column (safe IF NOT EXISTS)
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'parent'
    `);
    steps.push("member_type column ensured");

    // 2. Back-fill existing rows: temple members → 'temple', rest stay 'parent'
    const updated = await db.execute(sql`
      UPDATE members
         SET member_type = 'temple'
       WHERE is_existing_member = true
         AND member_type = 'parent'
    `);
    steps.push(`${(updated as unknown as { rowCount: number }).rowCount ?? 0} existing temple member rows updated to 'temple'`);

    // 3. Indexes for fast phone / email lookup
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_members_email ON members(email)
    `);
    steps.push("indexes on phone and email ensured");

    res.json({ ok: true, steps });
  } catch (err) {
    req.log.error({ err }, "Schema migration failed");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
