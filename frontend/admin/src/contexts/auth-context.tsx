import {
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { AuthContext, type AuthState } from "@/contexts/auth-context-value";
import { t } from "@/i18n";
import { login as apiLogin } from "@/lib/api";
import type { AuthUser } from "@/types";

const STORAGE_KEY = "admin_auth";

function loadFromStorage(): { token: string; user: AuthUser } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function initialAuthState(): AuthState {
  const stored = loadFromStorage();
  if (stored) {
    return { token: stored.token, user: stored.user, isLoading: false };
  }
  return { token: null, user: null, isLoading: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => initialAuthState());

  const login = useCallback(async (account: string, password: string) => {
    const res = await apiLogin(account, password);
    if (res.user.role !== "admin") {
      throw new Error(t("Admin access required"));
    }
    const payload = { token: res.token, user: res.user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setState({ token: res.token, user: res.user as AuthUser, isLoading: false });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({ token: null, user: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
