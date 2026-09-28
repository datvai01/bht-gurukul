import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { portalSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "../../lib/audit";
import { getVerifiedAdmin, isSameOriginRequest } from "../../lib/admin-session";

const router: IRouter = Router();

// Default settings seeded on first access
const DEFAULTS: Record<string, string> = {
  active_curriculum_year:            "2027-28",
  active_curriculum_years_list:      "2026-2027,2027-2028",
  stripe_publishable_key:            "pk_test_placeholder",
  stripe_secret_key:                 "sk_test_placeholder",
  stripe_membership_fee:             "",
  stripe_course_fee:                 "",
  audit_retention_days:              "7",
  registration_curriculum_year:      "2027-2028",
  registration_curriculum_years_list:"2026-2027,2027-2028",
  registration_open_date:            "",
  registration_close_date:           "",
  session_start_date:                "",
  session_end_date:                  "",
};

// Human-readable labels for audit logging of settings changes
const AUDITED_SETTING_LABELS: Record<string, string> = {
  active_curriculum_year:       "Active Curriculum Year",
  registration_curriculum_year: "Registration Open for Curriculum Year",
  registration_open_date:       "Registration Open Start Date",
  registration_close_date:      "Registration Open End Date",
  session_start_date:           "Session Start Date",
  session_end_date:             "Session End Date",
  stripe_membership_fee:        "Annual Membership Fee",
  stripe_course_fee:            "Default Course Fee",
};

// Write-only secrets: never returned by GET. The response carries a
// `<key>_configured` flag ("true"/"false") instead of the value.
const SECRET_KEYS = new Set(["stripe_secret_key"]);
const SECRET_PLACEHOLDERS: Record<string, string> = {
  stripe_secret_key: "sk_test_placeholder",
};

async function requireVerifiedAdmin(req: Request, res: Response): Promise<boolean> {
  try {
    if (await getVerifiedAdmin(req)) return true;
  } catch (err) {
    req.log.error({ err }, "Failed to verify admin session");
    res.status(500).json({ error: "Could not verify admin session." });
    return false;
  }
  res.status(401).json({ error: "An active admin session is required." });
  return false;
}

function requireSameOrigin(req: Request, res: Response): boolean {
  if (isSameOriginRequest(req)) return true;
  res.status(403).json({ error: "A same-origin request is required." });
  return false;
}

async function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const existing = await db
      .select()
      .from(portalSettingsTable)
      .where(eq(portalSettingsTable.key, key));
    if (existing.length === 0) {
      await db.insert(portalSettingsTable).values({ key, value });
    }
  }
}

// GET /api/admin/settings — returns all settings as a key-value object
router.get("/", async (req, res) => {
  if (!await requireVerifiedAdmin(req, res)) return;
  await ensureDefaults();
  const rows = await db.select().from(portalSettingsTable);
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (SECRET_KEYS.has(row.key)) {
      const configured = row.value.trim() !== "" && row.value !== SECRET_PLACEHOLDERS[row.key];
      result[`${row.key}_configured`] = configured ? "true" : "false";
    } else {
      result[row.key] = row.value;
    }
  }
  res.json(result);
});

// PUT /api/admin/settings — updates one or more settings
// Body: { key: string, value: string } or { settings: Record<string, string> }
router.put("/", async (req, res) => {
  if (!requireSameOrigin(req, res)) return;
  if (!await requireVerifiedAdmin(req, res)) return;
  const { key, value, settings } = req.body as {
    key?: string;
    value?: string;
    settings?: Record<string, string>;
  };

  const updates: Record<string, string> = {};

  if (settings && typeof settings === "object") {
    Object.assign(updates, settings);
  } else if (key && value !== undefined) {
    updates[key] = value;
  } else {
    res.status(400).json({ error: "Provide { key, value } or { settings: {...} }" });
    return;
  }

  for (const [k, v] of Object.entries(updates)) {
    if (typeof v !== "string") {
      res.status(400).json({ error: `Setting "${k}" must be a string.` });
      return;
    }
    if (k.endsWith("_configured") && SECRET_KEYS.has(k.slice(0, -"_configured".length))) {
      res.status(400).json({ error: `"${k}" is read-only.` });
      return;
    }
    // A blank secret means "keep the existing value" — the client never sees
    // the stored secret, so it only sends one when the admin types a new key.
    if (SECRET_KEYS.has(k) && v.trim() === "") delete updates[k];
  }

  for (const [k, v] of Object.entries(updates)) {
    await db
      .insert(portalSettingsTable)
      .values({ key: k, value: v })
      .onConflictDoUpdate({
        target: portalSettingsTable.key,
        set: { value: v, updatedAt: new Date() },
      });
  }

  // Audit any changes to labelled settings
  for (const [k, v] of Object.entries(updates)) {
    if (AUDITED_SETTING_LABELS[k]) {
      await writeAudit(req, {
        moduleName: "Settings Management",
        actionType: "Edit",
        entityName: AUDITED_SETTING_LABELS[k],
        entityId:   k,
        newValue:   { value: v },
      });
    }
  }

  res.json({ success: true, updated: Object.keys(updates) });
});

// POST /api/admin/settings/add-year — appends the next sequential year to a curriculum year list
router.post("/add-year", async (req, res) => {
  if (!requireSameOrigin(req, res)) return;
  if (!await requireVerifiedAdmin(req, res)) return;
  const { kind, year } = req.body as { kind?: string; year?: string };
  if (!kind || !year || (kind !== "active" && kind !== "registration")) {
    res.status(400).json({ error: "Provide { kind: 'active'|'registration', year: 'YYYY-YYYY' }" });
    return;
  }

  const listKey = kind === "active"
    ? "active_curriculum_years_list"
    : "registration_curriculum_years_list";
  const entityName = kind === "active"
    ? "Next Year Added to Active Curriculum Year Dropdown"
    : "Next Year Added to Registration Open for Curriculum Year Dropdown";

  const [row] = await db.select().from(portalSettingsTable).where(eq(portalSettingsTable.key, listKey));
  const currentList: string[] = row?.value
    ? row.value.split(",").map(s => s.trim()).filter(Boolean)
    : ["2026-2027", "2027-2028"];

  if (currentList.includes(year)) {
    res.json({ success: true, list: currentList, message: "Year already exists" });
    return;
  }

  const newList = [...currentList, year];
  await db
    .insert(portalSettingsTable)
    .values({ key: listKey, value: newList.join(",") })
    .onConflictDoUpdate({
      target: portalSettingsTable.key,
      set: { value: newList.join(","), updatedAt: new Date() },
    });

  await writeAudit(req, {
    moduleName: "Settings Management",
    actionType: "Edit",
    entityName,
    entityId:   listKey,
    newValue:   { year },
  });

  res.json({ success: true, list: newList });
});

export default router;
