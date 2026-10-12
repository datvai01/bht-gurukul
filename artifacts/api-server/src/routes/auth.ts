import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { portalUsersTable, adminUsersTable, teachersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { clearAdminSessionCookie, setAdminSessionCookie } from "../lib/admin-session";
import {
  ADMIN_CODE_TTL_SECONDS,
  clearAdminLoginChallengeCookie,
  maskEmail,
  startAdminLoginChallenge,
  verifyAdminLoginChallenge,
} from "../lib/admin-login-challenge";
import { isValidMemberEmail } from "../lib/member-phone";

const router: IRouter = Router();

const MAX_ATTEMPTS  = 5;
const LOCK_MINUTES  = 15;
const SUPER_ADMIN_EMAIL = "admin@gurukul.org";

// ── Ensure super admin record exists ─────────────────────────────────────────
// Called once at startup from index.ts. Idempotent.
export async function seedSuperAdmin() {
  const existing = await db
    .select({ id: adminUsersTable.id })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.role, "super_admin"))
    .limit(1);
  if (existing.length > 0) return;

  // The initial password comes from SUPER_ADMIN_INITIAL_PASSWORD. Outside production a local
  // development default is used; production never creates the account with a built-in password.
  const configured = process.env.SUPER_ADMIN_INITIAL_PASSWORD ?? "";
  if (process.env.NODE_ENV === "production" && configured.length < 12) {
    console.warn("[auth] Super admin not created: set SUPER_ADMIN_INITIAL_PASSWORD (12+ characters) or run the bootstrap script.");
    return;
  }
  const pinHash = await bcrypt.hash(configured || "JaiHanuman2026$", 10);
  await db.insert(adminUsersTable).values({
    name:    "Super Admin",
    email:   SUPER_ADMIN_EMAIL,
    phone:   null,
    pinHash,
    role:    "super_admin",
    status:  "active",
  });
  console.log("[auth] Super admin seeded.");
}

type AdminRow = typeof adminUsersTable.$inferSelect;

// Where an admin's sign-in code is sent. The super admin signs in as admin@gurukul.org, which may
// not be a real inbox, so SUPER_ADMIN_VERIFICATION_EMAIL can name the mailbox that receives it.
function verificationEmailFor(admin: AdminRow): string | null {
  const configured = admin.role === "super_admin" ? process.env.SUPER_ADMIN_VERIFICATION_EMAIL : undefined;
  const email = (configured || admin.email || "").trim().toLowerCase();
  return isValidMemberEmail(email) ? email : null;
}

// What the admin UI stores about the signed-in admin.
function adminSessionBody(admin: AdminRow, sessionExpiresAt: Date) {
  const isSuperAdmin = admin.role === "super_admin";
  return {
    id:               admin.id,
    name:             admin.name,
    email:            admin.email ?? "",
    phone:            admin.phone ?? "",
    role:             isSuperAdmin ? "admin" : admin.role, // front-end role for RBAC
    dbRole:           admin.role,
    isSuperAdmin,
    pinChanged:       admin.pinChanged ?? false,
    assignedCourseId: isSuperAdmin ? undefined : admin.assignedCourseId ?? null,
    initials:         admin.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase(),
    sessionExpiresAt: sessionExpiresAt.toISOString(),
  };
}

// ── POST /api/auth/admin-login ────────────────────────────────────────────────
// Step 1 of admin sign-in (the login page also requires a CAPTCHA before calling this):
//   - credential = "admin@gurukul.org"  → super admin (email + password)
//   - credential = 10-digit phone       → regular admin (phone + 4-digit PIN)
// When the password or PIN is correct, a 6-digit code is emailed to the admin and the response
// is { verificationRequired: true, maskedEmail }. No session exists until step 2 succeeds.
router.post("/admin-login", async (req, res) => {
  clearAdminSessionCookie(res);
  // The challenge cookie is left alone here: a throttled resend must not void the code already sent.
  try {
    const { credential, secret } = req.body as { credential?: string; secret?: string };
    if (!credential || !secret) {
      return res.status(400).json({ error: "Credential and secret are required." });
    }

    let admin: AdminRow | undefined;
    if (credential.toLowerCase().trim() === SUPER_ADMIN_EMAIL) {
      // Super admin: email + password
      [admin] = await db.select().from(adminUsersTable)
        .where(eq(adminUsersTable.role, "super_admin")).limit(1);
      if (!admin) return res.status(401).json({ error: "Invalid credentials." });
      if (admin.status !== "active") return res.status(403).json({ error: "Account is inactive." });
      if (!(await bcrypt.compare(secret, admin.pinHash))) {
        return res.status(401).json({ error: "Invalid email or password." });
      }
    } else {
      // Regular admin: phone + 4-digit PIN
      const cleanPhone = credential.replace(/\D/g, "");
      if (cleanPhone.length !== 10) {
        return res.status(400).json({ error: "Credential must be the super admin email or a 10-digit phone number." });
      }
      if (!/^\d{4}$/.test(secret)) {
        return res.status(400).json({ error: "PIN must be exactly 4 digits." });
      }
      [admin] = await db.select().from(adminUsersTable)
        .where(eq(adminUsersTable.phone, cleanPhone)).limit(1);
      if (!admin) return res.status(401).json({ error: "Invalid phone number or PIN." });
      if (admin.status !== "active") return res.status(403).json({ error: "Account is inactive. Contact the super admin." });
      if (!(await bcrypt.compare(secret, admin.pinHash))) {
        return res.status(401).json({ error: "Invalid phone number or PIN." });
      }
    }

    const email = verificationEmailFor(admin);
    if (!email) {
      return res.status(409).json({
        error: "No valid email address is on file for this account, so a sign-in code cannot be sent. Ask the super admin to add one.",
      });
    }
    const started = await startAdminLoginChallenge(res, admin.id, email);
    if (!started.ok) return res.status(started.status).json({ error: started.error });
    return res.json({ verificationRequired: true, maskedEmail: maskEmail(email), expiresInSeconds: ADMIN_CODE_TTL_SECONDS });
  } catch (err) {
    console.error("[admin-login]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ── POST /api/auth/admin-login/verify ─────────────────────────────────────────
// Step 2: checks the emailed code and starts a two-hour admin session.
router.post("/admin-login/verify", async (req, res) => {
  clearAdminSessionCookie(res);
  try {
    const verified = await verifyAdminLoginChallenge(req, res, (req.body as { code?: unknown })?.code);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error });

    const [admin] = await db.select().from(adminUsersTable)
      .where(eq(adminUsersTable.id, verified.adminId)).limit(1);
    if (!admin || admin.status !== "active") {
      return res.status(403).json({ error: "Account is inactive. Contact the super admin." });
    }
    await db.update(adminUsersTable).set({ lastLoginAt: new Date() }).where(eq(adminUsersTable.id, admin.id));
    const sessionExpiresAt = setAdminSessionCookie(res, admin.id);
    return res.json(adminSessionBody(admin, sessionExpiresAt));
  } catch (err) {
    console.error("[admin-login/verify]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ── POST /api/auth/admin-logout ───────────────────────────────────────────────
router.post("/admin-logout", (_req, res) => {
  clearAdminSessionCookie(res);
  clearAdminLoginChallengeCookie(res);
  res.json({ success: true });
});

// ── POST /api/auth/pin-login ──────────────────────────────────────────────────
// Teacher / assistant login via portal_users table. Unchanged.
router.post("/pin-login", async (req, res) => {
  clearAdminSessionCookie(res);
  try {
    const { phone, pin } = req.body as { phone?: string; pin?: string };
    if (!phone || !pin) {
      return res.status(400).json({ error: "Phone and PIN are required." });
    }
    const clean = phone.replace(/\D/g, "");
    if (clean.length !== 10) {
      return res.status(400).json({ error: "Phone must be 10 digits." });
    }
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be 4 digits." });
    }

    const [user] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.phone, clean))
      .limit(1);

    if (!user) {
      return res.status(401).json({ error: "Invalid phone number or PIN." });
    }
    if (user.status === "inactive") {
      return res.status(403).json({ error: "Account is inactive. Contact your administrator." });
    }

    // Check lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return res.status(429).json({ error: `Account locked. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` });
    }

    const valid = await bcrypt.compare(pin, user.pinHash);
    if (!valid) {
      const attempts = user.loginAttempts + 1;
      const locked   = attempts >= MAX_ATTEMPTS;
      await db
        .update(portalUsersTable)
        .set({
          loginAttempts: attempts,
          lockedUntil: locked
            ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
            : undefined,
          updatedAt: new Date(),
        })
        .where(eq(portalUsersTable.id, user.id));

      if (locked) {
        return res.status(429).json({
          error: `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`,
        });
      }
      const remaining = MAX_ATTEMPTS - attempts;
      return res.status(401).json({
        error: `Invalid phone number or PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      });
    }

    // Success — reset attempts and record login time
    await db
      .update(portalUsersTable)
      .set({ loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(portalUsersTable.id, user.id));

    // Look up the teacher's email so the frontend can send X-User-Email on subsequent requests
    const [teacherRow] = await db
      .select({ email: teachersTable.email })
      .from(teachersTable)
      .where(eq(teachersTable.phone, clean))
      .limit(1)
      .catch(() => []);

    return res.json({
      id:          user.id,
      name:        user.name,
      phone:       user.phone,
      pinChanged:  user.pinChanged ?? false,
      email:       teacherRow?.email ?? null,
      role:        user.role,
      initials:    user.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase(),
    });
  } catch (err) {
    console.error("[pin-login]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ── POST /api/auth/change-admin-pin ──────────────────────────────────────────
// Change a regular admin's 4-digit PIN (updates adminUsersTable, marks pinChanged).
router.post("/change-admin-pin", async (req, res) => {
  try {
    const { phone, currentPin, newPin } = req.body as {
      phone?: string; currentPin?: string; newPin?: string;
    };
    if (!phone || !currentPin || !newPin) {
      return res.status(400).json({ error: "phone, currentPin and newPin are required." });
    }
    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ error: "New PIN must be exactly 4 digits." });
    }

    const clean = phone.replace(/\D/g, "");
    const [admin] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.phone, clean))
      .limit(1);

    if (!admin) return res.status(404).json({ error: "Admin user not found." });
    if (admin.status !== "active") return res.status(403).json({ error: "Account is inactive." });

    const valid = await bcrypt.compare(currentPin, admin.pinHash);
    if (!valid) return res.status(401).json({ error: "Current PIN is incorrect." });

    if (await bcrypt.compare(newPin, admin.pinHash)) {
      return res.status(400).json({ error: "New PIN must be different from current PIN." });
    }

    const newHash = await bcrypt.hash(newPin, 10);
    await db
      .update(adminUsersTable)
      .set({ pinHash: newHash, pinChanged: true, updatedAt: new Date() })
      .where(eq(adminUsersTable.id, admin.id));

    return res.json({ success: true });
  } catch (err) {
    console.error("[change-admin-pin]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ── POST /api/auth/change-pin ─────────────────────────────────────────────────
// Change a teacher/assistant PIN (portalUsersTable). Marks pinChanged = true.
router.post("/change-pin", async (req, res) => {
  try {
    const { phone, currentPin, newPin } = req.body as {
      phone?: string; currentPin?: string; newPin?: string;
    };
    if (!phone || !currentPin || !newPin) {
      return res.status(400).json({ error: "phone, currentPin and newPin are required." });
    }
    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ error: "New PIN must be exactly 4 digits." });
    }

    const clean = phone.replace(/\D/g, "");
    const [user] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.phone, clean))
      .limit(1);

    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.status === "inactive") {
      return res.status(403).json({ error: "Account is inactive." });
    }

    const valid = await bcrypt.compare(currentPin, user.pinHash);
    if (!valid) return res.status(401).json({ error: "Current PIN is incorrect." });

    if (await bcrypt.compare(newPin, user.pinHash)) {
      return res.status(400).json({ error: "New PIN must be different from current PIN." });
    }

    const newHash = await bcrypt.hash(newPin, 10);
    await db
      .update(portalUsersTable)
      .set({ pinHash: newHash, pinChanged: true, updatedAt: new Date() })
      .where(eq(portalUsersTable.id, user.id));

    return res.json({ success: true });
  } catch (err) {
    console.error("[change-pin]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
