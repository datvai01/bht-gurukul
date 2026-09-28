import { Router } from "express";
import { db } from "@workspace/db";
import {
  enrollmentsTable,
  paymentsTable,
  membershipPaymentsTable,
  studentsTable,
  portalSettingsTable,
} from "@workspace/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

const router = Router();

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
