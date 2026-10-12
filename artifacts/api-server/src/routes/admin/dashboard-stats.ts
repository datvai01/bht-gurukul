import { Router } from "express";
import { db } from "@workspace/db";
import {
  enrollmentsTable,
  paymentsTable,
  membershipPaymentsTable,
  studentsTable,
  portalSettingsTable,
} from "@workspace/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getVerifiedAdmin } from "../../lib/admin-session";

const router = Router();

// Curriculum years are stored as "2027-2028" or "2027-28"; match either form.
function yearAliases(value: string): string[] {
  const m = value.trim().match(/^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/);
  if (!m) return [value.trim()];
  const start = Number(m[1]);
  const end = m[2].length === 2 ? Math.floor(start / 100) * 100 + Number(m[2]) : Number(m[2]);
  return Array.from(new Set([value.trim(), `${start}-${end}`, `${start}-${String(end).slice(-2)}`]));
}

function toLongYear(value: string): string {
  return yearAliases(value)[1] ?? value.trim();
}

// GET /api/admin/dashboard/summary?year=2027-2028 — dashboard cards for one curriculum year
router.get("/summary", async (req, res) => {
  try {
    if (!await getVerifiedAdmin(req)) {
      return res.status(401).json({ error: "An active admin session is required." });
    }
    const settingRows = await db.select({ key: portalSettingsTable.key, value: portalSettingsTable.value })
      .from(portalSettingsTable)
      .where(inArray(portalSettingsTable.key, ["registration_curriculum_year", "registration_curriculum_years_list", "active_curriculum_years_list"]));
    const setting = (key: string) => settingRows.find(row => row.key === key)?.value?.trim() ?? "";

    // Years offered in the drop-down: configured lists plus any year that has registrations.
    const registeredYears = await db.execute(sql`SELECT DISTINCT curriculum_year FROM student_registrations`);
    const years = Array.from(new Set([
      ...[setting("registration_curriculum_years_list"), setting("active_curriculum_years_list")]
        .flatMap(list => list.split(",")).map(y => y.trim()).filter(Boolean),
      ...(registeredYears.rows as { curriculum_year: string }[]).map(r => r.curriculum_year),
      setting("registration_curriculum_year"),
    ].filter(Boolean).map(toLongYear))).sort();

    const year = typeof req.query.year === "string" && req.query.year.trim()
      ? toLongYear(req.query.year)
      : toLongYear(setting("registration_curriculum_year")) || years.at(-1) || "";
    const aliases = year ? yearAliases(year) : [""];
    const aliasList = sql.join(aliases.map(a => sql`${a}`), sql`, `);

    const [counts] = (await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM enrollments e
           JOIN student_registrations r ON r.id = e.registration_id
          WHERE e.status = 'Enrolled' AND r.curriculum_year IN (${aliasList})) AS total_enrollments,
        (SELECT COUNT(*)::int FROM teachers t
          WHERE t.status = 'Active' AND t.curriculum_year IN (${aliasList})) AS active_teachers,
        (SELECT COUNT(DISTINCT r.student_id)::int FROM student_registrations r
          WHERE r.curriculum_year IN (${aliasList}) AND (
            EXISTS (SELECT 1 FROM enrollments e JOIN payments p ON p.enrollment_id = e.id
                     WHERE e.registration_id = r.id AND e.status = 'Enrolled' AND p.payment_status <> 'Paid')
            OR EXISTS (SELECT 1 FROM student_fees f
                        WHERE f.registration_id = r.id AND f.payment_status <> 'Paid'))) AS pending_payments
    `)).rows as { total_enrollments: number; active_teachers: number; pending_payments: number }[];

    return res.json({
      year,
      years,
      totalEnrollments: Number(counts?.total_enrollments ?? 0),
      activeTeachers: Number(counts?.active_teachers ?? 0),
      pendingPayments: Number(counts?.pending_payments ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build dashboard summary");
    return res.status(500).json({ error: "Could not load the dashboard summary." });
  }
});

// GET /api/admin/dashboard/stats
router.get("/stats", async (_req, res) => {
  // ── 0. Active curriculum year from settings ─────────────────────────────────
  const settingRows = await db
    .select({ value: portalSettingsTable.value })
    .from(portalSettingsTable)
    .where(eq(portalSettingsTable.key, "registration_curriculum_year"));
  const activeCurrYear = settingRows[0]?.value ?? "";

  // ── 1. Enrollment trend — active curriculum year, last 12 months ────────────
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  const cutoff = twelveMonthsAgo.toISOString().slice(0, 10);

  const enrollConds = activeCurrYear
    ? and(
        gte(enrollmentsTable.enrollDate, cutoff),
        eq(studentsTable.curriculumYear, activeCurrYear),
      )
    : gte(enrollmentsTable.enrollDate, cutoff);

  const enrollmentRows = await db
    .select({
      month: sql<string>`to_char(${enrollmentsTable.enrollDate}::date, 'YYYY-MM')`.as("month"),
      count: sql<number>`count(*)::int`.as("count"),
    })
    .from(enrollmentsTable)
    .innerJoin(studentsTable, eq(enrollmentsTable.studentId, studentsTable.id))
    .where(enrollConds)
    .groupBy(sql`to_char(${enrollmentsTable.enrollDate}::date, 'YYYY-MM')`)
    .orderBy(sql`to_char(${enrollmentsTable.enrollDate}::date, 'YYYY-MM')`);

  const enrollmentMap = new Map(enrollmentRows.map((r) => [r.month, r.count]));
  const enrollmentTrend: { month: string; label: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    d.setDate(1);
    const key   = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    enrollmentTrend.push({ month: key, label, count: enrollmentMap.get(key) ?? 0 });
  }

  // ── 2. Monthly payments — Gurukul class fees vs Temple membership fees ───────
  const gurukulMonthly = await db
    .select({
      month:  sql<string>`to_char(${paymentsTable.createdAt}, 'YYYY-MM')`.as("month"),
      amount: sql<number>`coalesce(sum(${paymentsTable.amountPaid}::numeric), 0)::float`.as("amount"),
    })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.paymentStatus, "Paid"),
      gte(paymentsTable.createdAt, twelveMonthsAgo),
    ))
    .groupBy(sql`to_char(${paymentsTable.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${paymentsTable.createdAt}, 'YYYY-MM')`);

  const membershipMonthly = await db
    .select({
      month:  sql<string>`to_char(${membershipPaymentsTable.createdAt}, 'YYYY-MM')`.as("month"),
      amount: sql<number>`coalesce(sum(${membershipPaymentsTable.amountPaid}::numeric), 0)::float`.as("amount"),
    })
    .from(membershipPaymentsTable)
    .where(and(
      eq(membershipPaymentsTable.paymentStatus, "Paid"),
      gte(membershipPaymentsTable.createdAt, twelveMonthsAgo),
    ))
    .groupBy(sql`to_char(${membershipPaymentsTable.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${membershipPaymentsTable.createdAt}, 'YYYY-MM')`);

  const gurukulMap    = new Map(gurukulMonthly.map((r) => [r.month, r.amount]));
  const membershipMap = new Map(membershipMonthly.map((r) => [r.month, r.amount]));

  const paymentMonthly: { month: string; label: string; gurukul: number; membership: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    d.setDate(1);
    const key   = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    paymentMonthly.push({
      month:      key,
      label,
      gurukul:    gurukulMap.get(key)    ?? 0,
      membership: membershipMap.get(key) ?? 0,
    });
  }

  return res.json({ enrollmentTrend, paymentMonthly, curriculumYear: activeCurrYear });
});

export default router;
