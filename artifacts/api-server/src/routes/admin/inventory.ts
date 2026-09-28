import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { inventoryTable, coursesTable, courseLevelsTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { writeAudit } from "../../lib/audit";

const router: IRouter = Router();

type ItemRow = {
  id: number;
  name: string;
  category: string;
  dateProcured: string | null;
  quantityProcured: number;
  currentStock: number;
  reorderLevel: number;
  lastReplenishment: string | null;
  vendor: string | null;
  remarks: string | null;
  curriculumYear: string | null;
  courseId: number | null;
  levelId:  number | null;
  courseName: string | null;
  levelName:  string | null;
};

function mapItem(i: ItemRow) {
  return {
    id:                i.id,
    name:              i.name,
    category:          i.category,
    dateProcured:      i.dateProcured      ?? "",
    quantityProcured:  i.quantityProcured,
    currentStock:      i.currentStock,
    reorderLevel:      i.reorderLevel,
    lastReplenishment: i.lastReplenishment ?? "",
    vendor:            i.vendor            ?? "",
    remarks:           i.remarks           ?? "",
    curriculumYear:    i.curriculumYear    ?? null,
    courseId:          i.courseId          ?? null,
    levelId:           i.levelId           ?? null,
    courseName:        i.courseName        ?? null,
    levelName:         i.levelName         ?? null,
  };
}

async function enrichItem(item: typeof inventoryTable.$inferSelect) {
  let courseName: string | null = null;
  let levelName:  string | null = null;
  if (item.courseId) {
    const [c] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, item.courseId));
    courseName = c?.name ?? null;
  }
  if (item.levelId) {
    const [l] = await db.select({ className: courseLevelsTable.className }).from(courseLevelsTable).where(eq(courseLevelsTable.id, item.levelId));
    levelName = l?.className ?? null;
  }
  return mapItem({ ...item, courseName, levelName });
}

// GET /api/admin/inventory
router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select({
        id:                inventoryTable.id,
        name:              inventoryTable.name,
        category:          inventoryTable.category,
        dateProcured:      inventoryTable.dateProcured,
        quantityProcured:  inventoryTable.quantityProcured,
        currentStock:      inventoryTable.currentStock,
        reorderLevel:      inventoryTable.reorderLevel,
        lastReplenishment: inventoryTable.lastReplenishment,
        vendor:            inventoryTable.vendor,
        remarks:           inventoryTable.remarks,
        curriculumYear:    inventoryTable.curriculumYear,
        courseId:          inventoryTable.courseId,
        levelId:           inventoryTable.levelId,
        courseName:        coursesTable.name,
        levelName:         courseLevelsTable.className,
      })
      .from(inventoryTable)
      .leftJoin(coursesTable,      eq(inventoryTable.courseId, coursesTable.id))
      .leftJoin(courseLevelsTable, eq(inventoryTable.levelId,  courseLevelsTable.id))
      .orderBy(asc(inventoryTable.id));
    res.json(rows.map(mapItem));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch inventory");
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

// POST /api/admin/inventory
router.post("/", async (req, res) => {
  try {
    const { name, category, dateProcured, quantityProcured, currentStock, reorderLevel, vendor, remarks, curriculumYear, courseId, levelId } = req.body;
    const [item] = await db
      .insert(inventoryTable)
      .values({
        name,
        category,
        dateProcured:      dateProcured  || null,
        quantityProcured:  parseInt(quantityProcured) || 0,
        currentStock:      parseInt(currentStock)     || 0,
        reorderLevel:      parseInt(reorderLevel)     || 5,
        vendor:            vendor        || null,
        remarks:           remarks       || null,
        lastReplenishment: dateProcured  || null,
        curriculumYear:    curriculumYear?.trim() || null,
        courseId:          courseId ? parseInt(courseId) : null,
        levelId:           levelId  ? parseInt(levelId)  : null,
      })
      .returning();
    const enriched = await enrichItem(item);
    await writeAudit(req, {
      moduleName:     "Inventory",
      actionType:     "Add",
      entityName:     item.name,
      entityId:       item.id,
      newValue:       { name: item.name, category: item.category, currentStock: item.currentStock, vendor: item.vendor || null, courseId: item.courseId, levelId: item.levelId },
      curriculumYear: item.curriculumYear ?? null,
    });
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to create inventory item");
    res.status(500).json({ error: "Failed to create inventory item" });
  }
});

// PUT /api/admin/inventory/:id
router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, category, dateProcured, quantityProcured, currentStock, reorderLevel, lastReplenishment, vendor, remarks, curriculumYear, courseId, levelId } = req.body;

    // Capture existing for diff
    const [before] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, id));

    const [item] = await db
      .update(inventoryTable)
      .set({
        name,
        category,
        dateProcured:      dateProcured      || null,
        quantityProcured:  parseInt(quantityProcured) || 0,
        currentStock:      parseInt(currentStock)     || 0,
        reorderLevel:      parseInt(reorderLevel)     || 5,
        lastReplenishment: lastReplenishment || null,
        vendor:            vendor            || null,
        remarks:           remarks           || null,
        curriculumYear:    curriculumYear?.trim() || null,
        courseId:          courseId ? parseInt(courseId) : null,
        levelId:           levelId  ? parseInt(levelId)  : null,
      })
      .where(eq(inventoryTable.id, id))
      .returning();

    const enriched = await enrichItem(item);
    await writeAudit(req, {
      moduleName:     "Inventory",
      actionType:     "Edit",
      entityName:     item.name,
      entityId:       item.id,
      previousValue:  before ? { name: before.name, category: before.category, currentStock: before.currentStock, reorderLevel: before.reorderLevel, vendor: before.vendor, remarks: before.remarks, courseId: before.courseId, levelId: before.levelId } : undefined,
      newValue:       { name: item.name, category: item.category, currentStock: item.currentStock, reorderLevel: item.reorderLevel, vendor: item.vendor, remarks: item.remarks, courseId: item.courseId, levelId: item.levelId },
      curriculumYear: item.curriculumYear ?? null,
    });
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to update inventory item");
    res.status(500).json({ error: "Failed to update inventory item" });
  }
});

// PATCH /api/admin/inventory/:id/replenish
router.patch("/:id/replenish", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { quantity } = req.body;
    const [current] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, id));
    if (!current) return res.status(404).json({ error: "Not found" });

    const [item] = await db
      .update(inventoryTable)
      .set({
        currentStock:      current.currentStock + parseInt(quantity),
        lastReplenishment: new Date().toISOString().split("T")[0],
      })
      .where(eq(inventoryTable.id, id))
      .returning();
    res.json(await enrichItem(item));
  } catch (err) {
    req.log.error({ err }, "Failed to replenish inventory item");
    res.status(500).json({ error: "Failed to replenish inventory item" });
  }
});

// DELETE /api/admin/inventory/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [before] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, id));
    await db.delete(inventoryTable).where(eq(inventoryTable.id, id));
    if (before) {
      await writeAudit(req, {
        moduleName:     "Inventory",
        actionType:     "Delete",
        entityName:     before.name,
        entityId:       before.id,
        previousValue:  { name: before.name, category: before.category, currentStock: before.currentStock, vendor: before.vendor },
        curriculumYear: before.curriculumYear ?? null,
      });
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete inventory item");
    res.status(500).json({ error: "Failed to delete inventory item" });
  }
});

export default router;
