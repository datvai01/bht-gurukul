import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import {
  adminLogin,
  adminLogout,
  clearStoredUser,
  getAuthUser,
  updateStoredUser,
  verifyAdminCode,
  type AuthUser,
  type LoginResult,
} from "./auth";

// Set when a session ends on its own so the login page can explain why the admin is there.
export const SESSION_EXPIRED_FLAG = "gurukul_admin_session_expired";

interface AuthContextValue {
  user:           AuthUser | null;
  login:          (credential: string, secret: string) => Promise<LoginResult>;
  verifyCode:     (code: string) => Promise<AuthUser>;
  logout:         () => Promise<void>;
  markPinChanged: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getAuthUser());

  const login = useCallback(async (credential: string, secret: string): Promise<LoginResult> => {
    const result = await adminLogin(credential, secret);
    if (result.status === "signed-in") setUser(result.user);
    return result;
  }, []);

  const verifyCode = useCallback(async (code: string): Promise<AuthUser> => {
    const u = await verifyAdminCode(code);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await adminLogout();
    setUser(null);
  }, []);

  // Sign the admin out when the two-hour session ends.
  useEffect(() => {
    if (!user?.sessionExpiresAt) return;
    const expire = () => {
      clearStoredUser();
      try { sessionStorage.setItem(SESSION_EXPIRED_FLAG, "1"); } catch { /* ignore */ }
      setUser(null);
    };
    const remaining = Date.parse(user.sessionExpiresAt) - Date.now();
    if (remaining <= 0) { expire(); return; }
    const timer = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timer);
  }, [user?.sessionExpiresAt]);

  const markPinChanged = useCallback(() => {
    updateStoredUser({ pinChanged: true });
    setUser(prev => prev ? { ...prev, pinChanged: true } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, verifyCode, logout, markPinChanged }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
