import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import type { Request } from "express";

export type AuditModule =
  | "Student Registration"
  | "Staff Management"
  | "Communication Hub"
  | "Course Management"
  | "User Management"
  | "Member Management"
  | "Settings Management"
  | "Inventory"
  | "Academic Management"
  | "Operations";

export type AuditAction =
  | "Add"
  | "Edit"
  | "Delete"
  | "Validate"
  | "Status Change"
  | "Config Update";

export interface AuditOpts {
  moduleName:     AuditModule;
  actionType:     AuditAction;
  entityName:     string;
  entityId?:      string | number | null;
  previousValue?: unknown;
  newValue?:      unknown;
  curriculumYear?: string | null;
}

export function getAdminInfo(req: Request): { adminName: string; adminRole: string } {
  const name =
    (req.headers["x-user-name"]  as string | undefined) ||
    (req.headers["x-user-email"] as string | undefined) ||
    "Admin";
  const role = (req.headers["x-user-role"] as string | undefined) || "admin";
  return { adminName: name, adminRole: role };
}

export async function writeAudit(req: Request, opts: AuditOpts): Promise<void> {
  try {
    const { adminName, adminRole } = getAdminInfo(req);
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() ?? (req.socket?.remoteAddress ?? null);

    await db.insert(auditLogsTable).values({
      adminName,
      userRole:       adminRole,
      moduleName:     opts.moduleName,
      actionType:     opts.actionType,
      entityName:     opts.entityName,
      entityId:       opts.entityId != null ? String(opts.entityId) : null,
      previousValue:  opts.previousValue != null ? JSON.stringify(opts.previousValue) : null,
      newValue:       opts.newValue      != null ? JSON.stringify(opts.newValue)      : null,
      curriculumYear: opts.curriculumYear ?? null,
      ipAddress:      ip,
      userAgent:      (req.headers["user-agent"] as string | undefined) ?? null,
    });
  } catch (err) {
    console.error("[audit] Failed to write audit record:", err);
  }
}
