import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, portalSettingsTable } from "@workspace/db/schema";
import { desc, and, eq, gte, lte, like, sql } from "drizzle-orm";

const router: IRouter = Router();

const DEFAULT_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS     = 15;

async function getRetentionDays(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: portalSettingsTable.value })
      .from(portalSettingsTable)
      .where(eq(portalSettingsTable.key, "audit_retention_days"));
    const parsed = parseInt(row?.value ?? "");
    if (isNaN(parsed) || parsed < 1) return DEFAULT_RETENTION_DAYS;
    return Math.min(parsed, MAX_RETENTION_DAYS);
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}

async function purgeOldEntries(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(auditLogsTable)
    .where(sql`${auditLogsTable.createdAt} < ${cutoff}`)
    .returning({ id: auditLogsTable.id });
  return result.length;
}

// GET /api/admin/audit/users — distinct user names for dropdown filter
router.get("/users", async (_req, res) => {
  try {
    const rows = await db
      .selectDistinct({ name: auditLogsTable.adminName })
      .from(auditLogsTable)
      .orderBy(auditLogsTable.adminName);
    res.json(rows.map((r) => r.name));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /api/admin/audit/activity — last-7-day feature traffic per module per day (stacked bar)
router.get("/activity", async (_req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        moduleName: auditLogsTable.moduleName,
        day:        sql<string>`DATE(${auditLogsTable.createdAt})`,
        count:      sql<number>`cast(count(*) as int)`,
      })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, sevenDaysAgo))
      .groupBy(
        auditLogsTable.moduleName,
        sql`DATE(${auditLogsTable.createdAt})`,
      )
      .orderBy(sql`DATE(${auditLogsTable.createdAt})`);

    // Build the 7-day window (oldest → newest)
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      days.push(d.toISOString().split("T")[0]);
    }

    const modules = [...new Set(rows.map((r) => r.moduleName))].sort();

    const chartDays = days.map((day) => {
      const label = new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short", day: "numeric",
      });
      const entry: Record<string, string | number> = { date: day, label };
      for (const mod of modules) {
        const modRows = rows.filter((r) => r.moduleName === mod && r.day === day);
        entry[mod] = modRows.reduce((sum, r) => sum + r.count, 0);
      }
      return entry;
    });

    res.json({ modules, days: chartDays });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch audit activity" });
  }
});

// GET /api/admin/audit
// Query params: page, limit, module, action, role, admin, curriculumYear, dateFrom, dateTo, search
router.get("/", async (req, res) => {
  try {
    const page       = Math.max(1, parseInt(req.query.page   as string) || 1);
    const limit      = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 100));
    const offset     = (page - 1) * limit;
    const module_    = (req.query.module        as string | undefined)?.trim();
    const action     = (req.query.action        as string | undefined)?.trim();
    const role       = (req.query.role          as string | undefined)?.trim();
    const admin      = (req.query.admin         as string | undefined)?.trim();
    const curricYear = (req.query.curriculumYear as string | undefined)?.trim();
    const dateFrom   = (req.query.dateFrom       as string | undefined)?.trim();
    const dateTo     = (req.query.dateTo         as string | undefined)?.trim();
    const search     = (req.query.search         as string | undefined)?.trim();

    const conditions: ReturnType<typeof eq>[] = [];

    if (module_    && module_    !== "All") conditions.push(eq(auditLogsTable.moduleName,    module_)    as any);
    if (action     && action     !== "All") conditions.push(eq(auditLogsTable.actionType,    action)     as any);
    if (role       && role       !== "All") conditions.push(eq(auditLogsTable.userRole,       role)       as any);
    if (curricYear && curricYear !== "All") conditions.push(eq(auditLogsTable.curriculumYear, curricYear) as any);
    if (admin)                              conditions.push(eq(auditLogsTable.adminName,      admin)      as any);
    if (dateFrom)  conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom + "T00:00:00Z")) as any);
    if (dateTo)    conditions.push(lte(auditLogsTable.createdAt, new Date(dateTo   + "T23:59:59Z")) as any);
    if (search)    conditions.push(
      sql`(${auditLogsTable.entityName} ILIKE ${"%" + search + "%"} OR ${auditLogsTable.entityId} ILIKE ${"%" + search + "%"})` as any
    );

    const where = conditions.length > 0 ? and(...(conditions as any)) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(auditLogsTable)
        .where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`cast(count(*) as int)` })
        .from(auditLogsTable)
        .where(where),
    ]);

    const retentionDays = await getRetentionDays();

    res.json({
      data:          rows,
      total:         countResult[0]?.total ?? 0,
      page,
      limit,
      retentionDays,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch audit logs");
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

// POST /api/admin/audit/purge
router.post("/purge", async (req, res) => {
  try {
    const days    = await getRetentionDays();
    const deleted = await purgeOldEntries(days);
    res.json({ success: true, deleted, retentionDays: days });
  } catch (err) {
    req.log.error({ err }, "Failed to purge audit logs");
    res.status(500).json({ error: "Failed to purge audit logs" });
  }
});

// GET /api/admin/audit/export
router.get("/export", async (req, res) => {
  try {
    const module_    = (req.query.module        as string | undefined)?.trim();
    const action     = (req.query.action        as string | undefined)?.trim();
    const role       = (req.query.role          as string | undefined)?.trim();
    const admin      = (req.query.admin         as string | undefined)?.trim();
    const curricYear = (req.query.curriculumYear as string | undefined)?.trim();
    const dateFrom   = (req.query.dateFrom       as string | undefined)?.trim();
    const dateTo     = (req.query.dateTo         as string | undefined)?.trim();
    const search     = (req.query.search         as string | undefined)?.trim();

    const conditions: ReturnType<typeof eq>[] = [];
    if (module_    && module_    !== "All") conditions.push(eq(auditLogsTable.moduleName,    module_)    as any);
    if (action     && action     !== "All") conditions.push(eq(auditLogsTable.actionType,    action)     as any);
    if (role       && role       !== "All") conditions.push(eq(auditLogsTable.userRole,       role)       as any);
    if (curricYear && curricYear !== "All") conditions.push(eq(auditLogsTable.curriculumYear, curricYear) as any);
    if (admin)     conditions.push(eq(auditLogsTable.adminName, admin) as any);
    if (dateFrom)  conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom + "T00:00:00Z")) as any);
    if (dateTo)    conditions.push(lte(auditLogsTable.createdAt, new Date(dateTo   + "T23:59:59Z")) as any);
    if (search)    conditions.push(sql`(${auditLogsTable.entityName} ILIKE ${"%" + search + "%"} OR ${auditLogsTable.entityId} ILIKE ${"%" + search + "%"})` as any);

    const where = conditions.length > 0 ? and(...(conditions as any)) : undefined;
    const rows  = await db.select().from(auditLogsTable).where(where).orderBy(desc(auditLogsTable.createdAt)).limit(5000);

    const escape = (v: string | null | undefined) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };

    const header = "ID,Date/Time,Admin,Role,Module,Action,Entity,Entity ID,Curriculum Year,Previous Value,New Value,IP Address";
    const csv    = [header, ...rows.map(r =>
      [
        r.id,
        r.createdAt?.toISOString() ?? "",
        escape(r.adminName),
        escape(r.userRole),
        escape(r.moduleName),
        escape(r.actionType),
        escape(r.entityName),
        escape(r.entityId),
        escape(r.curriculumYear),
        escape(r.previousValue),
        escape(r.newValue),
        escape(r.ipAddress),
      ].join(",")
    )].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) {
    req.log.error({ err }, "Failed to export audit logs");
    res.status(500).json({ error: "Failed to export audit logs" });
  }
});

// ─── Auto-purge scheduler ─────────────────────────────────────────────────────
const SIX_HOURS = 6 * 60 * 60 * 1000;

export function startAuditPurgeScheduler(log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void }) {
  async function runPurge() {
    try {
      const days    = await getRetentionDays();
      const deleted = await purgeOldEntries(days);
      log.info({ deleted, retentionDays: days }, "Scheduled audit purge complete");
    } catch (err) {
      log.error({ err }, "Scheduled audit purge failed");
    }
  }
  runPurge();
  setInterval(runPurge, SIX_HOURS);
}

export default router;
