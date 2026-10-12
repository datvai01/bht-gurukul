import type { UserRole } from "./rbac";

export interface AuthUser {
  id?:               number;
  email?:            string;
  phone?:            string;
  displayName:       string;
  role:              UserRole;
  isSuperAdmin?:     boolean;
  pinChanged?:       boolean;
  initials:          string;
  assignedCourseId?: number | null;
  // Admin sessions end at this time (ISO string); teacher logins have no server session.
  sessionExpiresAt?: string;
}

// Admin sign-in has two steps: the password or PIN, then a code emailed to the admin.
export type LoginResult =
  | { status: "signed-in"; user: AuthUser }
  | { status: "code-sent"; maskedEmail: string };

const AUTH_KEY = "gurukul_admin_auth_v2";

function saveUser(user: AuthUser) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

// ── Unified login ─────────────────────────────────────────────────────────────
// Order of checks:
//   1. Try admin login (super admin or regular admin via adminUsersTable). A correct password or
//      PIN emails a sign-in code; verifyAdminCode() completes the sign-in.
//   2. If the admin login rejects the credential AND it is a 10-digit phone, fall back to
//      teacher/assistant login via portalUsersTable
export async function adminLogin(credential: string, secret: string): Promise<LoginResult> {
  const clean = credential.replace(/\D/g, "");
  const isPhone = /^\d{10}$/.test(clean);

  // Step 1 — Admin login
  const adminRes = await fetch("/api/auth/admin-login", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ credential: credential.trim(), secret }),
    credentials: "same-origin",
  });

  if (adminRes.ok) {
    const data = await adminRes.json();
    return { status: "code-sent", maskedEmail: data.maskedEmail };
  }

  // Step 2 — Fall back to teacher / assistant login only when no admin matched the credentials
  if (isPhone && adminRes.status === 401) {
    return { status: "signed-in", user: await pinLogin(clean, secret) };
  }

  // Surface the admin login error
  const body = await adminRes.json().catch(() => ({}));
  throw new Error(body.error ?? "Login failed.");
}

// ── Emailed sign-in code for admins ───────────────────────────────────────────
export async function verifyAdminCode(code: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/admin-login/verify", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ code: code.trim() }),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error ?? "Verification failed.");
    Object.assign(error, { status: res.status });
    throw error;
  }
  const user: AuthUser = {
    id:               data.id,
    email:            data.email || undefined,
    phone:            data.phone || undefined,
    displayName:      data.name,
    role:             data.role as UserRole,
    isSuperAdmin:     data.isSuperAdmin ?? false,
    pinChanged:       data.pinChanged ?? false,
    initials:         data.initials,
    assignedCourseId: data.assignedCourseId ?? null,
    sessionExpiresAt: data.sessionExpiresAt,
  };
  saveUser(user);
  return user;
}

// ── PIN-based login for teachers / assistants ──────────────────────────────────
export async function pinLogin(phone: string, pin: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/pin-login", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ phone, pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Login failed.");
  }
  const data = await res.json();
  const user: AuthUser = {
    id:          data.id,
    phone:       data.phone,
    email:       data.email || undefined,
    displayName: data.name,
    role:        data.role as UserRole,
    pinChanged:  data.pinChanged ?? false,
    initials:    data.initials,
  };
  saveUser(user);
  return user;
}

// ── PIN change for regular admins (adminUsersTable) ───────────────────────────
export async function changeAdminPin(phone: string, currentPin: string, newPin: string): Promise<void> {
  const res = await fetch("/api/auth/change-admin-pin", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ phone, currentPin, newPin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to change PIN.");
  }
}

// ── PIN change for teachers / assistants (portalUsersTable) ──────────────────
export async function changePin(phone: string, currentPin: string, newPin: string): Promise<void> {
  const res = await fetch("/api/auth/change-pin", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ phone, currentPin, newPin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to change PIN.");
  }
}

// ── Session helpers ────────────────────────────────────────────────────────────
export async function adminLogout(): Promise<void> {
  const response = await fetch("/api/auth/admin-logout", { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not sign out. Please try again.");
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem("gurukul_admin_auth");
}

export function getAuthUser(): AuthUser | null {
  const raw = localStorage.getItem(AUTH_KEY);
  if (raw) {
    try {
      const user = JSON.parse(raw) as AuthUser;
      // An admin whose two-hour session has ended must sign in again.
      if (isSessionExpired(user)) {
        localStorage.removeItem(AUTH_KEY);
        return null;
      }
      return user;
    } catch { /* ignore */ }
  }
  return null;
}

export function isSessionExpired(user: AuthUser): boolean {
  return !!user.sessionExpiresAt && Date.parse(user.sessionExpiresAt) <= Date.now();
}

// Clears the stored sign-in locally (the server session has already expired).
export function clearStoredUser() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem("gurukul_admin_auth");
}

export function updateStoredUser(patch: Partial<AuthUser>) {
  const current = getAuthUser();
  if (current) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ...current, ...patch }));
  }
}

export function isAdminAuthenticated(): boolean {
  return getAuthUser() !== null;
}

export const DEMO_CREDENTIALS = [
  { credential: "admin@gurukul.org", secret: "JaiHanuman2026$", role: "Super Admin", hint: "Email + Password" },
];
