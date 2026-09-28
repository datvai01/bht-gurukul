import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { adminLogin, adminLogout, getAuthUser, updateStoredUser, type AuthUser } from "./auth";

interface AuthContextValue {
  user:           AuthUser | null;
  login:          (credential: string, secret: string) => Promise<AuthUser | null>;
  logout:         () => Promise<void>;
  markPinChanged: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getAuthUser());

  const login = useCallback(async (credential: string, secret: string): Promise<AuthUser | null> => {
    const u = await adminLogin(credential, secret);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await adminLogout();
    setUser(null);
  }, []);

  const markPinChanged = useCallback(() => {
    updateStoredUser({ pinChanged: true });
    setUser(prev => prev ? { ...prev, pinChanged: true } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, markPinChanged }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
