import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { adminUsersTable, adminTasksTable } from "@workspace/db/schema";
import { eq, or, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

// ── Actor resolution ──────────────────────────────────────────────────────────
// Looks up the admin user in the DB from trusted request headers.
// Returns { id, name, role } where role comes from the DB (authoritative source).

async function resolveActor(
  req: { headers: Record<string, string | string[] | undefined> },
): Promise<{ id: number; name: string; role: string } | null> {
  const email = (req.headers["x-user-email"] as string | undefined)?.trim()?.toLowerCase();
  const phone = (req.headers["x-user-phone"] as string | undefined)?.trim();

  try {
    if (email) {
      const rows = await db
        .select({ id: adminUsersTable.id, name: adminUsersTable.name, role: adminUsersTable.role })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.email, email))
        .limit(1);
      if (rows.length) return rows[0];   // DB role is authoritative
    }
    if (phone) {
      const digits = phone.replace(/\D/g, "");
      const rows = await db
        .select({ id: adminUsersTable.id, name: adminUsersTable.name, role: adminUsersTable.role })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.phone, digits))
        .limit(1);
      if (rows.length) return rows[0];   // DB role is authoritative
    }
  } catch { /* ignore lookup errors */ }

  return null;
}

function isSuperAdmin(actor: { role: string } | null): boolean {
  return actor?.role === "super_admin";
}

// Only "admin" and "super_admin" DB roles may access task endpoints.
function hasAdminTasksAccess(actor: { role: string } | null): boolean {
  return actor?.role === "super_admin" || actor?.role === "admin";
}

// ── Mapper ────────────────────────────────────────────────────────────────────

function mapTask(t: typeof adminTasksTable.$inferSelect) {
  return {
    id:             t.id,
    title:          t.title,
    description:    t.description,
    assignedToId:   t.assignedToId,
    assignedToName: t.assignedToName,
    createdById:    t.createdById,
    createdByName:  t.createdByName,
    priority:       t.priority,
    status:         t.status,
    dueDate:        t.dueDate,
    reminderDate:   t.reminderDate,
    completedAt:    t.completedAt ? t.completedAt.toISOString() : null,
    createdAt:      t.createdAt  ? t.createdAt.toISOString()   : null,
    updatedAt:      t.updatedAt  ? t.updatedAt.toISOString()   : null,
  };
}

// ── GET /api/admin/tasks ──────────────────────────────────────────────────────
// super_admin (DB role) → all tasks
// others                → tasks they created or are assigned to

router.get("/", async (req, res) => {
  try {
    const actor = await resolveActor(req);

    if (!hasAdminTasksAccess(actor)) {
      return res.status(403).json({ error: "Admin or super_admin role required" });
    }

    let rows: typeof adminTasksTable.$inferSelect[];

    if (isSuperAdmin(actor)) {
      rows = await db
        .select()
        .from(adminTasksTable)
        .orderBy(desc(adminTasksTable.createdAt));
    } else if (actor) {
      rows = await db
        .select()
        .from(adminTasksTable)
        .where(
          or(
            eq(adminTasksTable.createdById, actor.id),
            eq(adminTasksTable.assignedToId, actor.id),
          ),
        )
        .orderBy(desc(adminTasksTable.createdAt));
    } else {
      rows = [];
    }

    res.json(rows.map(mapTask));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin tasks");
    res.status(500).json({ error: "Failed to fetch admin tasks" });
  }
});

// ── POST /api/admin/tasks ─────────────────────────────────────────────────────
// Creator identity set server-side from resolved actor — never from request body.

router.post("/", async (req, res) => {
  try {
    const actor = await resolveActor(req);

    if (!actor) {
      return res.status(401).json({ error: "Authenticated actor required to create a task" });
    }
    if (!hasAdminTasksAccess(actor)) {
      return res.status(403).json({ error: "Admin or super_admin role required" });
    }

    const { title, description, assignedToId, assignedToName, priority, status, dueDate, reminderDate } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (title.trim().length > 500) {
      return res.status(400).json({ error: "Title must be 500 characters or fewer" });
    }

    // Enforce 10-task limit (count all non-deleted tasks regardless of status)
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminTasksTable);
    if (count >= 10) {
      return res.status(400).json({ error: "Task limit reached. You can have at most 10 tasks. Please delete a task before adding a new one." });
    }

    // Resolve assignee name server-side if id given but name missing
    let resolvedAssigneeName = assignedToName ?? null;
    if (assignedToId && !resolvedAssigneeName) {
      try {
        const [aRow] = await db
          .select({ name: adminUsersTable.name })
          .from(adminUsersTable)
          .where(eq(adminUsersTable.id, Number(assignedToId)));
        if (aRow) resolvedAssigneeName = aRow.name;
      } catch { /* ignore */ }
    }

    const [item] = await db
      .insert(adminTasksTable)
      .values({
        title:          title.trim(),
        description:    description   ?? null,
        assignedToId:   assignedToId  ? Number(assignedToId) : null,
        assignedToName: resolvedAssigneeName,
        createdById:    actor?.id    ?? null,    // server-derived — never from body
        createdByName:  actor?.name  ?? null,    // server-derived — never from body
        priority:       priority ?? "Medium",
        status:         status   ?? "todo",
        dueDate:        dueDate       ?? null,
        reminderDate:   reminderDate  ?? null,
      })
      .returning();

    res.json(mapTask(item));
  } catch (err) {
    req.log.error({ err }, "Failed to create admin task");
    res.status(500).json({ error: "Failed to create admin task" });
  }
});

// ── Authorization helpers ─────────────────────────────────────────────────────

// canEdit: super_admin can edit any task; others can only edit tasks they CREATED.
async function canEdit(taskId: number, actor: { id: number; role: string } | null): Promise<boolean> {
  if (isSuperAdmin(actor)) return true;
  if (!actor) return false;

  const [task] = await db
    .select({ createdById: adminTasksTable.createdById })
    .from(adminTasksTable)
    .where(eq(adminTasksTable.id, taskId));

  if (!task) return false;
  return task.createdById === actor.id;
}

// canUpdateStatus: super_admin, the creator, OR the assignee can update status.
async function canUpdateStatus(taskId: number, actor: { id: number; role: string } | null): Promise<boolean> {
  if (isSuperAdmin(actor)) return true;
  if (!actor) return false;

  const [task] = await db
    .select({ createdById: adminTasksTable.createdById, assignedToId: adminTasksTable.assignedToId })
    .from(adminTasksTable)
    .where(eq(adminTasksTable.id, taskId));

  if (!task) return false;
  return task.createdById === actor.id || task.assignedToId === actor.id;
}

// ── PUT /api/admin/tasks/:id ──────────────────────────────────────────────────

router.put("/:id", async (req, res) => {
  try {
    const id    = parseInt(req.params.id);
    const actor = await resolveActor(req);

    if (!hasAdminTasksAccess(actor)) {
      return res.status(403).json({ error: "Admin or super_admin role required" });
    }
    if (!(await canEdit(id, actor))) {
      return res.status(403).json({ error: "Not authorized to edit this task" });
    }

    const { title, description, assignedToId, assignedToName, priority, status, dueDate, reminderDate } = req.body;
    const completedAt = status === "done" ? new Date() : null;

    let resolvedAssigneeName = assignedToName ?? null;
    if (assignedToId && !resolvedAssigneeName) {
      try {
        const [aRow] = await db
          .select({ name: adminUsersTable.name })
          .from(adminUsersTable)
          .where(eq(adminUsersTable.id, Number(assignedToId)));
        if (aRow) resolvedAssigneeName = aRow.name;
      } catch { /* ignore */ }
    }

    const [item] = await db
      .update(adminTasksTable)
      .set({
        title:          title?.trim() ?? undefined,
        description:    description   ?? null,
        assignedToId:   assignedToId  ? Number(assignedToId) : null,
        assignedToName: resolvedAssigneeName,
        priority:       priority      ?? "Medium",
        status:         status        ?? "todo",
        dueDate:        dueDate       ?? null,
        reminderDate:   reminderDate  ?? null,
        completedAt,
        updatedAt:      new Date(),
      })
      .where(eq(adminTasksTable.id, id))
      .returning();

    if (!item) return res.status(404).json({ error: "Task not found" });
    res.json(mapTask(item));
  } catch (err) {
    req.log.error({ err }, "Failed to update admin task");
    res.status(500).json({ error: "Failed to update admin task" });
  }
});

// ── PATCH /api/admin/tasks/:id/status ────────────────────────────────────────
// Creator, assignee, AND super_admin may update status.

router.patch("/:id/status", async (req, res) => {
  try {
    const id    = parseInt(req.params.id);
    const actor = await resolveActor(req);

    if (!hasAdminTasksAccess(actor)) {
      return res.status(403).json({ error: "Admin or super_admin role required" });
    }
    if (!(await canUpdateStatus(id, actor))) {
      return res.status(403).json({ error: "Not authorized to update this task" });
    }

    const { status } = req.body;
    const completedAt = status === "done" ? new Date() : null;

    const [item] = await db
      .update(adminTasksTable)
      .set({ status, completedAt, updatedAt: new Date() })
      .where(eq(adminTasksTable.id, id))
      .returning();

    if (!item) return res.status(404).json({ error: "Task not found" });
    res.json(mapTask(item));
  } catch (err) {
    req.log.error({ err }, "Failed to update task status");
    res.status(500).json({ error: "Failed to update task status" });
  }
});

// ── DELETE /api/admin/tasks/:id ───────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  try {
    const id    = parseInt(req.params.id);
    const actor = await resolveActor(req);

    if (!hasAdminTasksAccess(actor)) {
      return res.status(403).json({ error: "Admin or super_admin role required" });
    }
    if (!(await canEdit(id, actor))) {
      return res.status(403).json({ error: "Not authorized to delete this task" });
    }

    await db.delete(adminTasksTable).where(eq(adminTasksTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete admin task");
    res.status(500).json({ error: "Failed to delete admin task" });
  }
});

export default router;
